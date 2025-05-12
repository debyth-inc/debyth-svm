use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{approve, Approve, Mint, TokenAccount, TokenInterface},
};

use crate::state::state::Mandate;

#[derive(Accounts)]
#[instruction(mandate_id: u64)]
pub struct ApproveMandate<'info> {
    /// The user creating and approving the mandate - this account pays for the mandate creation/approval
    #[account(mut)]
    pub user: Signer<'info>,

    // Authority is solely used for mandate validation and signing the delegate CPI.
    // It is NOT marked as payer so that the user covers the fees.
    pub authority: SystemAccount<'info>,

    /// The new mandate account to be created
    #[account(
        mut,
        seeds = [b"mandate", mandate_id.to_le_bytes().as_ref()],
        bump = mandate.bump,
    )]
    pub mandate: Account<'info, Mandate>,

    /// The token mint for the mandate
    #[account(
        mint::token_program = token_program
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// The user's token account that will be debited
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

impl<'info> ApproveMandate<'info> {
    pub fn approve(&mut self) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        // Validate mandate state
        require!(
            !self.mandate.is_active && !self.mandate.is_approved,
            MandateError::AlreadyApproved
        );

        // Validate token account
        require!(
            self.user_token_account.owner == self.user.key(),
            MandateError::InvalidTokenAccount
        );
        require!(
            self.user_token_account.mint == self.mint.key(),
            MandateError::InvalidMint
        );
        require!(
            self.user_token_account.delegate.is_none(),
            MandateError::TokenAlreadyDelegated
        );

        // Approve token delegation
        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = Approve {
            to: self.user_token_account.to_account_info(),
            authority: self.user.to_account_info(),
            delegate: self.mandate.to_account_info(),
        };

        // Since we don't have frequency, start_date, and end_date in the Mandate struct,
        // we'll just use the base amount
        let amount = self.mandate.amount;

        approve(CpiContext::new(cpi_program, cpi_accounts), amount)?;

        // Update mandate state
        self.mandate.is_approved = true;
        self.mandate.is_active = true;
        self.mandate.last_execution = now;

        Ok(())
    }
}

#[error_code]
pub enum MandateError {
    #[msg("Mandate is already approved or active")]
    AlreadyApproved,
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Token account is already delegated")]
    TokenAlreadyDelegated,
}
