use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, transfer, TransferChecked, InitializeMint},
};

declare_id!("BEF3CqKU1Db7FsqHyuugE7xd6YCz7gD3jMi2wA1yeD4x");

#[program]
pub mod sonic {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.authority = ctx.accounts.authority.key();
        state.protocol_fee = 100; // 1% default fee (basis points)
        msg!("NFT Lending protocol initialized");
        Ok(())
    }

    pub fn list_nft(
        ctx: Context<ListNFT>,
        loan_duration: i64,
        interest_rate: u64,
        collateral_amount: u64,
    ) -> Result<()> {
        require!(loan_duration > 0, ErrorCode::InvalidDuration);
        require!(collateral_amount > 0, ErrorCode::InvalidCollateral);
        
        let listing = &mut ctx.accounts.listing;
        listing.lender = ctx.accounts.lender.key();
        listing.nft_mint = ctx.accounts.nft_mint.key();
        listing.loan_duration = loan_duration;
        listing.interest_rate = interest_rate;
        listing.collateral_amount = collateral_amount;
        listing.is_active = true;

        // Transfer NFT to protocol vault
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.lender_nft_account.to_account_info(),
                mint: ctx.accounts.nft_mint.to_account_info(),
                to: ctx.accounts.vault_nft_account.to_account_info(),
                authority: ctx.accounts.lender.to_account_info(),
            },
        );
        token::transfer_checked(transfer_ctx, 1, 0)?;

        Ok(())
    }

    pub fn borrow_nft(ctx: Context<BorrowNFT>) -> Result<()> {
        let listing = &mut ctx.accounts.listing;
        let loan = &mut ctx.accounts.loan;

        require!(listing.is_active, ErrorCode::ListingNotActive);

        // Transfer SOL from borrower to vault using system program
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.borrower.key(),
            &ctx.accounts.vault_authority.key(),
            listing.collateral_amount,
        );
        
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.borrower.to_account_info(),
                ctx.accounts.vault_authority.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Transfer NFT to borrower
        let vault_authority_bump = ctx.bumps.vault_authority;
        let seeds = &[b"vault_authority".as_ref(), &[vault_authority_bump]];
        let signer = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault_nft_account.to_account_info(),
                mint: ctx.accounts.nft_mint.to_account_info(),
                to: ctx.accounts.borrower_nft_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer,
        );
        token::transfer_checked(transfer_ctx, 1, 0)?;

        // Initialize loan details
        loan.borrower = ctx.accounts.borrower.key();
        loan.listing = listing.key();
        loan.start_time = Clock::get()?.unix_timestamp;
        loan.end_time = loan.start_time + listing.loan_duration;
        loan.collateral_amount = listing.collateral_amount;
        loan.interest_rate = listing.interest_rate;
        loan.is_active = true;
        loan.is_liquidated = false;

        listing.is_active = false;

        Ok(())
    }

    pub fn repay_loan(ctx: Context<RepayLoan>) -> Result<()> {
        let loan = &mut ctx.accounts.loan;
        let listing = &mut ctx.accounts.listing;

        require!(loan.is_active, ErrorCode::LoanNotActive);
        require!(!loan.is_liquidated, ErrorCode::LoanLiquidated);

        // Calculate interest
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;
        let time_elapsed = current_time.checked_sub(loan.start_time)
            .ok_or(ErrorCode::MathOverflow)?;
        let interest = (loan.collateral_amount as u128)
            .checked_mul(loan.interest_rate as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_mul(time_elapsed as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(365 * 24 * 60 * 60 * 10000)
            .ok_or(ErrorCode::MathOverflow)? as u64;

        // Transfer interest in SOL from borrower to lender using system program
        let transfer_interest_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.borrower.key(),
            &ctx.accounts.lender.key(),
            interest,
        );
        
        anchor_lang::solana_program::program::invoke(
            &transfer_interest_ix,
            &[
                ctx.accounts.borrower.to_account_info(),
                ctx.accounts.lender.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Return NFT to vault
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.borrower_nft_account.to_account_info(),
                mint: ctx.accounts.nft_mint.to_account_info(),
                to: ctx.accounts.vault_nft_account.to_account_info(),
                authority: ctx.accounts.borrower.to_account_info(),
            },
        );
        token::transfer_checked(transfer_ctx, 1, 0)?;

        // Return collateral to borrower using system program
        let vault_authority_bump = ctx.bumps.vault_authority;
        let seeds = &[b"vault_authority".as_ref(), &[vault_authority_bump]];
        let signer = &[&seeds[..]];

        let transfer_collateral_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.vault_authority.key(),
            &ctx.accounts.borrower.key(),
            loan.collateral_amount,
        );
        
        anchor_lang::solana_program::program::invoke_signed(
            &transfer_collateral_ix,
            &[
                ctx.accounts.vault_authority.to_account_info(),
                ctx.accounts.borrower.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer,
        )?;

        // Return NFT to lender
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault_nft_account.to_account_info(),
                mint: ctx.accounts.nft_mint.to_account_info(),
                to: ctx.accounts.lender_nft_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer,
        );
        token::transfer_checked(transfer_ctx, 1, 0)?;

        // Close loan
        loan.is_active = false;
        listing.is_active = true;

        Ok(())
    }

    pub fn liquidate_loan(ctx: Context<LiquidateLoan>) -> Result<()> {
        let loan = &mut ctx.accounts.loan;
        let listing = &mut ctx.accounts.listing;

        require!(loan.is_active, ErrorCode::LoanNotActive);
        require!(!loan.is_liquidated, ErrorCode::LoanLiquidated);

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp > loan.end_time,
            ErrorCode::LoanNotLiquidatable
        );

        // Transfer collateral SOL to lender using system program
        let vault_authority_bump = ctx.bumps.vault_authority;
        let seeds = &[b"vault_authority".as_ref(), &[vault_authority_bump]];
        let signer = &[&seeds[..]];

        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.vault_authority.key(),
            &ctx.accounts.lender.key(),
            loan.collateral_amount,
        );
        
        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.vault_authority.to_account_info(),
                ctx.accounts.lender.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer,
        )?;

        loan.is_liquidated = true;
        loan.is_active = false;
        listing.is_active = true;

        Ok(())
    }

    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        require!(ctx.accounts.listing.is_active, ErrorCode::ListingNotActive);
        require!(
            ctx.accounts.listing.lender == ctx.accounts.lender.key(),
            ErrorCode::UnauthorizedAccess
        );

        // Transfer NFT back to lender from vault
        let vault_authority_bump = ctx.bumps.vault_authority;
        let seeds = &[b"vault_authority".as_ref(), &[vault_authority_bump]];
        let signer = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault_nft_account.to_account_info(),
                mint: ctx.accounts.nft_mint.to_account_info(),
                to: ctx.accounts.lender_nft_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer,
        );
        token::transfer_checked(transfer_ctx, 1, 0)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolState::LEN
    )]
    pub state: Account<'info, ProtocolState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ListNFT<'info> {
    #[account(mut)]
    pub lender: Signer<'info>,
    
    #[account(
        init,
        payer = lender,
        space = 8 + NFTListing::LEN
    )]
    pub listing: Account<'info, NFTListing>,
    
    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = nft_mint,
        token::authority = lender
    )]
    pub lender_nft_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = nft_mint,
        token::authority = vault_authority
    )]
    pub vault_nft_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA for vault authority
    #[account(seeds = [b"vault_authority"], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct BorrowNFT<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,
    
    #[account(
        mut,
        constraint = listing.is_active @ ErrorCode::ListingNotActive
    )]
    pub listing: Account<'info, NFTListing>,
    
    #[account(
        init,
        payer = borrower,
        space = 8 + Loan::LEN
    )]
    pub loan: Account<'info, Loan>,

    #[account(
        mut,
        token::mint = listing.nft_mint,
        token::authority = borrower
    )]
    pub borrower_nft_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = listing.nft_mint,
        token::authority = vault_authority
    )]
    pub vault_nft_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA for vault authority
    #[account(mut, seeds = [b"vault_authority"], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    pub nft_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
pub struct RepayLoan<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    /// CHECK: Verified in logic
    #[account(mut)]
    pub lender: AccountInfo<'info>,

    #[account(
        mut,
        constraint = loan.borrower == borrower.key() @ ErrorCode::UnauthorizedAccess,
        constraint = loan.is_active @ ErrorCode::LoanNotActive
    )]
    pub loan: Account<'info, Loan>,

    #[account(mut)]
    pub listing: Account<'info, NFTListing>,

    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = nft_mint,
        token::authority = borrower
    )]
    pub borrower_nft_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = nft_mint,
        token::authority = vault_authority
    )]
    pub vault_nft_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = nft_mint,
        token::authority = listing.lender
    )]
    pub lender_nft_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA for vault authority
    #[account(mut, seeds = [b"vault_authority"], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LiquidateLoan<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(mut)]
    pub lender: SystemAccount<'info>,

    #[account(mut)]
    pub loan: Account<'info, Loan>,

    #[account(mut)]
    pub listing: Account<'info, NFTListing>,

    /// CHECK: PDA for vault authority
    #[account(mut, seeds = [b"vault_authority"], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(mut)]
    pub lender: Signer<'info>,

    #[account(
        mut,
        constraint = listing.lender == lender.key() @ ErrorCode::UnauthorizedAccess,
        constraint = listing.is_active @ ErrorCode::ListingNotActive,
        close = lender // This will close the account and send rent to lender
    )]
    pub listing: Account<'info, NFTListing>,

    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = nft_mint,
        token::authority = vault_authority
    )]
    pub vault_nft_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = nft_mint,
        token::authority = lender
    )]
    pub lender_nft_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA for vault authority
    #[account(seeds = [b"vault_authority"], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct ProtocolState {
    pub authority: Pubkey,
    pub protocol_fee: u16, // basis points
}

#[account]
pub struct NFTListing {
    pub lender: Pubkey,
    pub nft_mint: Pubkey,
    pub loan_duration: i64,
    pub interest_rate: u64,  // basis points per year
    pub collateral_amount: u64,
    pub is_active: bool,
}

#[account]
pub struct Loan {
    pub borrower: Pubkey,
    pub listing: Pubkey,
    pub start_time: i64,
    pub end_time: i64,
    pub collateral_amount: u64,
    pub interest_rate: u64,
    pub is_active: bool,
    pub is_liquidated: bool,
}

impl ProtocolState {
    pub const LEN: usize = 32 + 2;
}

impl NFTListing {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 1;
}

impl Loan {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1;
}

#[error_code]
pub enum ErrorCode {
    #[msg("The listing is not active")]
    ListingNotActive,
    #[msg("The loan is not active")]
    LoanNotActive,
    #[msg("The loan has already been liquidated")]
    LoanLiquidated,
    #[msg("The loan cannot be liquidated yet")]
    LoanNotLiquidatable,
    #[msg("Invalid loan duration")]
    InvalidDuration,
    #[msg("Invalid collateral amount")]
    InvalidCollateral,
    #[msg("Unauthorized access")]
    UnauthorizedAccess,
    #[msg("Math overflow")]
    MathOverflow,
}
