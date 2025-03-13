import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sonic } from "../target/types/sonic";
import { PublicKey, Keypair, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddress, createAssociatedTokenAccount,createAccount, mintTo } from "@solana/spl-token";
import { expect } from "chai";

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

  it("Lists an NFT for lending", async () => {
    const loanDuration = 7 * 24 * 60 * 60; // 7 days in seconds
    const interestRate = 1000; // 10% APR in basis points
    const collateralAmount = 100_000_000; // 100 USDC

    const tx = await program.methods
      .listNft(
        new anchor.BN(loanDuration),
        new anchor.BN(interestRate),
        new anchor.BN(collateralAmount)
      )
      .accounts({
        lender: lender.publicKey,
        listing: listing.publicKey,
        nftMint: nftMint,
        lenderNftAccount: lenderNftAccount,
        vaultNftAccount: vaultNftAccount,
        vaultAuthority: vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([lender, listing])
      .rpc();

    // Verify listing details
    const listingAccount = await program.account.nftListing.fetch(listing.publicKey);
    expect(listingAccount.lender.toBase58()).to.equal(lender.publicKey.toBase58());
    expect(listingAccount.nftMint.toBase58()).to.equal(nftMint.toBase58());
    expect(listingAccount.loanDuration.toNumber()).to.equal(loanDuration);
    expect(listingAccount.interestRate.toNumber()).to.equal(interestRate);
    expect(listingAccount.collateralAmount.toNumber()).to.equal(collateralAmount);
    expect(listingAccount.isActive).to.equal(true);

    // Verify NFT was transferred to vault
    const vaultBalance = await provider.connection.getTokenAccountBalance(vaultNftAccount);
    expect(vaultBalance.value.amount).to.equal("1");
  });

  it("Borrows an NFT by providing collateral", async () => {
    const tx = await program.methods
      .borrowNft()
      .accounts({
        borrower: borrower.publicKey,
        listing: listing.publicKey,
        loan: loan.publicKey,
        collateralMint: collateralMint,
        borrowerCollateralAccount: borrowerCollateralAccount,
        vaultCollateralAccount: vaultCollateralAccount,
        borrowerNftAccount: borrowerNftAccount,
        vaultNftAccount: vaultNftAccount,
        vaultAuthority: vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        nftMint: nftMint,
      })
      .signers([borrower, loan])
      .rpc();

    // Verify loan details
    const loanAccount = await program.account.loan.fetch(loan.publicKey);
    expect(loanAccount.borrower.toBase58()).to.equal(borrower.publicKey.toBase58());
    expect(loanAccount.listing.toBase58()).to.equal(listing.publicKey.toBase58());
    expect(loanAccount.isActive).to.equal(true);
    expect(loanAccount.isLiquidated).to.equal(false);

    // Verify NFT was transferred to borrower
    const borrowerNftBalance = await provider.connection.getTokenAccountBalance(borrowerNftAccount);
    expect(borrowerNftBalance.value.amount).to.equal("1");

    // Verify collateral was transferred to vault
    const vaultCollateralBalance = await provider.connection.getTokenAccountBalance(vaultCollateralAccount);
    const listingAccount = await program.account.nftListing.fetch(listing.publicKey);
    expect(vaultCollateralBalance.value.amount).to.equal(listingAccount.collateralAmount.toString());
  });

  it("Repays a loan", async () => {
    // Wait a bit to accrue some interest
    await new Promise(resolve => setTimeout(resolve, 2000));

    const tx = await program.methods
      .repayLoan()
      .accounts({
        borrower: borrower.publicKey,
        loan: loan.publicKey,
        listing: listing.publicKey,
        collateralMint: collateralMint,
        borrowerCollateralAccount: borrowerCollateralAccount,
        vaultCollateralAccount: vaultCollateralAccount,
        lenderCollateralAccount: lenderCollateralAccount,
        borrowerNftAccount: borrowerNftAccount,
        vaultNftAccount: vaultNftAccount,
        lenderNftAccount: lenderNftAccount,
        vaultAuthority: vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        nftMint: nftMint,
      })
      .signers([borrower])
      .rpc();

    // Verify loan is closed
    const loanAccount = await program.account.loan.fetch(loan.publicKey);
    expect(loanAccount.isActive).to.equal(false);

    // Verify NFT returned to lender
    const lenderNftBalance = await provider.connection.getTokenAccountBalance(lenderNftAccount);
    expect(lenderNftBalance.value.amount).to.equal("1");

    // Verify collateral returned to borrower
    const borrowerCollateralBalance = await provider.connection.getTokenAccountBalance(borrowerCollateralAccount);
    expect(borrowerCollateralBalance.value.uiAmount).to.be.greaterThan(0);
  });

  it("Liquidates an overdue loan", async () => {
    // First, create and borrow a new loan
    const newListing = anchor.web3.Keypair.generate();
    const newLoan = anchor.web3.Keypair.generate();
    
    // List NFT again with very short duration
    await program.methods
      .listNft(
        new anchor.BN(1), // 1 second duration
        new anchor.BN(1000),
        new anchor.BN(100_000_000)
      )
      .accounts({
        lender: lender.publicKey,
        listing: newListing.publicKey,
        nftMint: nftMint,
        lenderNftAccount: lenderNftAccount,
        vaultNftAccount: vaultNftAccount,
        vaultAuthority: vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([lender, newListing])
      .rpc();

    // Borrow the NFT
    await program.methods
      .borrowNft()
      .accounts({
        borrower: borrower.publicKey,
        listing: newListing.publicKey,
        loan: newLoan.publicKey,
        collateralMint: collateralMint,
        borrowerCollateralAccount: borrowerCollateralAccount,
        vaultCollateralAccount: vaultCollateralAccount,
        borrowerNftAccount: borrowerNftAccount,
        vaultNftAccount: vaultNftAccount,
        vaultAuthority: vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        nftMint: nftMint,
      })
      .signers([borrower, newLoan])
      .rpc();

    // Wait for loan to expire
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Liquidate the loan
    const tx = await program.methods
      .liquidateLoan()
      .accounts({
        liquidator: lender.publicKey,
        loan: newLoan.publicKey,
        listing: newListing.publicKey,
        collateralMint: collateralMint,
        vaultCollateralAccount: vaultCollateralAccount,
        lenderCollateralAccount: lenderCollateralAccount,
        vaultAuthority: vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([lender])
      .rpc();

    // Verify loan is liquidated
    const loanAccount = await program.account.loan.fetch(newLoan.publicKey);
    expect(loanAccount.isLiquidated).to.equal(true);
    expect(loanAccount.isActive).to.equal(false);

    // Verify collateral transferred to lender
    const lenderCollateralBalance = await provider.connection.getTokenAccountBalance(lenderCollateralAccount);
    expect(lenderCollateralBalance.value.uiAmount).to.be.greaterThan(0);
  });
});

