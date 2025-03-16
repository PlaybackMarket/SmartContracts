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
  let lender: Keypair;
  let borrower: Keypair;
  let listing: Keypair;
  let loan: Keypair;
  
  // Token accounts - only for NFT
  let lenderNftAccount: PublicKey;
  let borrowerNftAccount: PublicKey;
  let vaultNftAccount: PublicKey;
  
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

    // Find PDA for vault authority
    [vaultAuthority, vaultAuthorityBump] = await PublicKey.findProgramAddress(
      [Buffer.from("vault_authority")],
      program.programId
    );

    // Create NFT token accounts only
    lenderNftAccount = await getAssociatedTokenAddress(nftMint, lender.publicKey);
    borrowerNftAccount = await getAssociatedTokenAddress(nftMint, borrower.publicKey);
    vaultNftAccount = await getAssociatedTokenAddress(nftMint, vaultAuthority, true);

    // Create ATAs for NFT accounts only
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
    ];

    await provider.sendAndConfirm(new Transaction().add(...createAccountsIx));

    // Mint NFT to lender
    await mintTo(provider.connection, lender, nftMint, lenderNftAccount, lender, 1);
    
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
    // Get initial SOL balances
    const initialBorrowerBalance = await provider.connection.getBalance(borrower.publicKey);
    const initialVaultBalance = await provider.connection.getBalance(vaultAuthority);

    const listingAccount = await program.account.nftListing.fetch(listing.publicKey);
    
    // Add system program for SOL transfer
    const tx = await program.methods
      .borrowNft()
      .accounts({
        borrower: borrower.publicKey,
        listing: listing.publicKey,
        loan: loan.publicKey,
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
      .preInstructions([
        // Add instruction to transfer SOL to vault_authority
        anchor.web3.SystemProgram.transfer({
          fromPubkey: borrower.publicKey,
          toPubkey: vaultAuthority,
          lamports: listingAccount.collateralAmount.toNumber(),
        }),
      ])
      .rpc();

    // Verify loan details
    const loanAccount = await program.account.loan.fetch(loan.publicKey);
    expect(loanAccount.borrower.toBase58()).to.equal(borrower.publicKey.toBase58());
    
    // Verify SOL transfer - account for rent and transaction fees
    const finalBorrowerBalance = await provider.connection.getBalance(borrower.publicKey);
    const finalVaultBalance = await provider.connection.getBalance(vaultAuthority);
    
    const expectedCollateralTransfer = listingAccount.collateralAmount.toNumber();
    const actualTransfer = initialBorrowerBalance - finalBorrowerBalance;
    
    // Allow for transaction fees and rent in the comparison
    expect(actualTransfer).to.be.approximately(
      expectedCollateralTransfer,
      0.1 * anchor.web3.LAMPORTS_PER_SOL // Allow more wiggle room for fees
    );

    // Verify vault received exact collateral amount
    expect(finalVaultBalance - initialVaultBalance).to.equal(expectedCollateralTransfer);

    // Verify NFT transfer
    const borrowerNftBalance = await provider.connection.getTokenAccountBalance(borrowerNftAccount);
    expect(borrowerNftBalance.value.amount).to.equal("1");
  });

  it("Repays a loan", async () => {
    // Create new loan for this test to avoid state conflicts
    const repayLoan = anchor.web3.Keypair.generate();
    
    // Ensure borrower has enough SOL
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        borrower.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      )
    );

    // Borrow first
    await program.methods.borrowNft()
      .accounts({
        borrower: borrower.publicKey,
        listing: listing.publicKey,
        loan: repayLoan.publicKey,
        borrowerNftAccount: borrowerNftAccount,
        vaultNftAccount: vaultNftAccount,
        vaultAuthority: vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        nftMint: nftMint,
      })
      .signers([borrower, repayLoan])
      .rpc();

    // Wait for interest to accrue
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get initial balances
    const initialBorrowerBalance = await provider.connection.getBalance(borrower.publicKey);
    const initialLenderBalance = await provider.connection.getBalance(lender.publicKey);
    const initialVaultBalance = await provider.connection.getBalance(vaultAuthority);

    const tx = await program.methods
      .repayLoan()
      .accounts({
        borrower: borrower.publicKey,
        lender: lender.publicKey,
        loan: repayLoan.publicKey,
        listing: listing.publicKey,
        borrowerNftAccount: borrowerNftAccount,
        vaultNftAccount: vaultNftAccount,
        lenderNftAccount: lenderNftAccount,
        vaultAuthority: vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        nftMint: nftMint,
      })
      .signers([borrower])
      .rpc();

    // Verify SOL transfers
    const finalBorrowerBalance = await provider.connection.getBalance(borrower.publicKey);
    const finalLenderBalance = await provider.connection.getBalance(lender.publicKey);
    const finalVaultBalance = await provider.connection.getBalance(vaultAuthority);

    // Verify collateral returned to borrower
    expect(finalBorrowerBalance - initialBorrowerBalance).to.be.approximately(
      initialVaultBalance - finalVaultBalance,
      1000000 // Allow for transaction fees
    );

    // Verify interest paid to lender
    expect(finalLenderBalance).to.be.greaterThan(initialLenderBalance);

    // Verify NFT returned to lender
    const lenderNftBalance = await provider.connection.getTokenAccountBalance(lenderNftAccount);
    expect(lenderNftBalance.value.amount).to.equal("1");
  });

  it("Liquidates an overdue loan", async () => {
    // Create new loan with short duration
    const liquidationLoan = anchor.web3.Keypair.generate();
    const liquidationListing = anchor.web3.Keypair.generate();

    // Ensure lender has NFT
    await mintTo(
      provider.connection,
      lender,
      nftMint,
      lenderNftAccount,
      lender,
      1
    );

    // List NFT
    await program.methods
      .listNft(
        new anchor.BN(1), // 1 second duration
        new anchor.BN(1000),
        new anchor.BN(anchor.web3.LAMPORTS_PER_SOL)
      )
      .accounts({
        lender: lender.publicKey,
        listing: liquidationListing.publicKey,
        nftMint: nftMint,
        lenderNftAccount: lenderNftAccount,
        vaultNftAccount: vaultNftAccount,
        vaultAuthority: vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([lender, liquidationListing])
      .rpc();

    // Ensure borrower has enough SOL
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        borrower.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      )
    );

    // Borrow
    await program.methods
      .borrowNft()
      .accounts({
        borrower: borrower.publicKey,
        listing: liquidationListing.publicKey,
        loan: liquidationLoan.publicKey,
        borrowerNftAccount: borrowerNftAccount,
        vaultNftAccount: vaultNftAccount,
        vaultAuthority: vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        nftMint: nftMint,
      })
      .signers([borrower, liquidationLoan])
      .rpc();

    // Wait for loan to expire
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get initial balances for verification
    const initialLenderBalance = await provider.connection.getBalance(lender.publicKey);
    const initialVaultBalance = await provider.connection.getBalance(vaultAuthority);

    // Liquidate
    const tx = await program.methods
      .liquidateLoan()
      .accounts({
        liquidator: lender.publicKey,
        lender: lender.publicKey,
        loan: liquidationLoan.publicKey,
        listing: liquidationListing.publicKey,
        vaultAuthority: vaultAuthority,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([lender])
      .rpc();

    // Verify SOL transfers
    const finalLenderBalance = await provider.connection.getBalance(lender.publicKey);
    const finalVaultBalance = await provider.connection.getBalance(vaultAuthority);

    const loanAccount = await program.account.loan.fetch(liquidationLoan.publicKey);
    expect(finalLenderBalance - initialLenderBalance).to.be.approximately(
      loanAccount.collateralAmount.toNumber(),
      1000000 // Allow for transaction fees
    );
    expect(initialVaultBalance - finalVaultBalance).to.equal(
      loanAccount.collateralAmount.toNumber()
    );

    // Verify loan state
    expect(loanAccount.isLiquidated).to.equal(true);
    expect(loanAccount.isActive).to.equal(false);
  });

  it("Cancels an NFT listing", async () => {
    // First, create a new listing
    const newListing = anchor.web3.Keypair.generate();
    
    // Ensure lender has enough SOL
    const lenderAirdrop = await provider.connection.requestAirdrop(
      lender.publicKey, 
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(lenderAirdrop);
    
    // Mint NFT to lender
    await mintTo(
      provider.connection,
      lender,
      nftMint,
      lenderNftAccount,
      lender,
      1
    );
    
    // List NFT
    await program.methods
      .listNft(
        new anchor.BN(7 * 24 * 60 * 60), // 7 days duration
        new anchor.BN(1000), // 10% APR
        new anchor.BN(100_000_000) // 100 USDC
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

    // Verify NFT is in vault
    let vaultBalance = await provider.connection.getTokenAccountBalance(vaultNftAccount);
    expect(vaultBalance.value.amount).to.equal("1");

    // Cancel the listing
    const tx = await program.methods
      .cancelListing()
      .accounts({
        lender: lender.publicKey,
        listing: newListing.publicKey,
        nftMint: nftMint,
        vaultNftAccount: vaultNftAccount,
        lenderNftAccount: lenderNftAccount,
        vaultAuthority: vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([lender])
      .rpc();

    // Verify NFT returned to lender
    const lenderBalance = await provider.connection.getTokenAccountBalance(lenderNftAccount);
    expect(lenderBalance.value.amount).to.equal("1");

    // Verify vault is empty
    vaultBalance = await provider.connection.getTokenAccountBalance(vaultNftAccount);
    expect(vaultBalance.value.amount).to.equal("0");

    // Verify listing account was closed
    try {
      await program.account.nftListing.fetch(newListing.publicKey);
      assert.fail("Listing account should be closed");
    } catch (e) {
      expect(e.toString()).to.include("Account does not exist");
    }
  });
});

