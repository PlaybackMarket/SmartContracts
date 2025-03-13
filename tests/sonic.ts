import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sonic } from "../target/types/sonic";
import { PublicKey, Keypair, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddress, createAssociatedTokenAccount,createAccount, mintTo } from "@solana/spl-token";
import { assert } from "chai";

import { Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction } from "@solana/spl-token";

describe("initialize_program", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Sonic as Program<Sonic>;

  it("Is initialized!", async () => {
    // Generate a new keypair for the program account
    const stateAccount = anchor.web3.Keypair.generate();

    // Pass the new account to initialize
    const tx = await program.methods
      .initialize()
      .accounts({
        authority: anchor.getProvider().publicKey,
        state: stateAccount.publicKey,
      })
      .signers([stateAccount])
      .rpc();

    console.log("Your transaction signature", tx);
  });
});








describe("sonic", () => {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Sonic as Program<Sonic>;
  const provider = anchor.getProvider();

  // Test accounts
  let stateAccount: Keypair;
  let nftMint: PublicKey;
  let collateralMint: PublicKey;
  let lender: Keypair;
  let borrower: Keypair;
  let listing: Keypair;
  let loan: Keypair;
  
  // Token accounts
  let lenderNftAccount: PublicKey;
  let borrowerNftAccount: PublicKey;
  let vaultNftAccount: PublicKey;
  let lenderCollateralAccount: PublicKey;
  let borrowerCollateralAccount: PublicKey;
  let vaultCollateralAccount: PublicKey;
  
  // PDAs
  let vaultAuthority: PublicKey;
  let vaultAuthorityBump: number;
  before(async () => {
    // Generate test accounts

  });


  it("Initializes the protocol", async () => {
    stateAccount = anchor.web3.Keypair.generate();
    lender = anchor.web3.Keypair.generate();
    borrower = anchor.web3.Keypair.generate();
    listing = anchor.web3.Keypair.generate();
    loan = anchor.web3.Keypair.generate();

    // Fund accounts
    const lenderAirdrop = await provider.connection.requestAirdrop(lender.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    const borrowerAirdrop = await provider.connection.requestAirdrop(borrower.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
  // Wait for airdrops to confirm
  await provider.connection.confirmTransaction(lenderAirdrop);
  await provider.connection.confirmTransaction(borrowerAirdrop);

    // Create NFT mint
    nftMint = await createMint(
      provider.connection,
      lender,
      lender.publicKey,
      null,
      0
    );

    // Create collateral token mint (e.g., USDC with 6 decimals)
    collateralMint = await createMint(
      provider.connection,
      borrower,
      borrower.publicKey,
      null,
      6
    );

    // Find PDA for vault authority
    [vaultAuthority, vaultAuthorityBump] = await PublicKey.findProgramAddress(
      [Buffer.from("vault_authority")],
      program.programId
    );

    // Create token accounts using ATAs
    lenderNftAccount = await getAssociatedTokenAddress(nftMint, lender.publicKey);
    borrowerNftAccount = await getAssociatedTokenAddress(nftMint, borrower.publicKey);
    vaultNftAccount = await getAssociatedTokenAddress(nftMint, vaultAuthority, true); // true for allowing PDAs
    
    lenderCollateralAccount = await getAssociatedTokenAddress(collateralMint, lender.publicKey);
    borrowerCollateralAccount = await getAssociatedTokenAddress(collateralMint, borrower.publicKey);
    vaultCollateralAccount = await getAssociatedTokenAddress(collateralMint, vaultAuthority, true);

    // Create ATAs if they don't exist
    const createAccountsIx = [
      createAssociatedTokenAccountInstruction(
        provider.publicKey,
        lenderNftAccount,
        lender.publicKey,
        nftMint
      ),
      createAssociatedTokenAccountInstruction(
        provider.publicKey,
        borrowerNftAccount,
        borrower.publicKey,
        nftMint
      ),
      createAssociatedTokenAccountInstruction(
        provider.publicKey,
        vaultNftAccount,
        vaultAuthority,
        nftMint
      ),
      createAssociatedTokenAccountInstruction(
        provider.publicKey,
        lenderCollateralAccount,
        lender.publicKey,
        collateralMint
      ),
      createAssociatedTokenAccountInstruction(
        provider.publicKey,
        borrowerCollateralAccount,
        borrower.publicKey,
        collateralMint
      ),
      createAssociatedTokenAccountInstruction(
        provider.publicKey,
        vaultCollateralAccount,
        vaultAuthority,
        collateralMint
      ),
    ];

    // Send transaction to create all ATAs
    await provider.sendAndConfirm(new Transaction().add(...createAccountsIx));

    // Mint NFT to lender
    await mintTo(provider.connection, lender, nftMint, lenderNftAccount, lender, 1);
    
    // Mint collateral tokens to borrower
    await mintTo(provider.connection, borrower, collateralMint, borrowerCollateralAccount, borrower, 1000000000); // 1000 USDC

      const tx = await program.methods
      .initialize()
      .accounts({
        authority: anchor.getProvider().publicKey,
        state: stateAccount.publicKey,
      })
      .signers([stateAccount])
      .rpc();
    const state = await program.account.protocolState.fetch(stateAccount.publicKey);
    
  });

});

