use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{approve, Approve, Mint, Token, TokenAccount},
};

use crate::errors::MandateError;
use crate::state::state::{Mandate, UNLIMITED_ALLOWANCE};

#[derive(Accounts)]
#[instruction(mandate_id: u64)]
pub struct ApproveMandate<'info> {
    /// The user creating and approving the mandate - this account pays for the mandate creation/approval
    #[account(mut)]
    pub user: Signer<'info>,

    // // Authority is solely used for mandate validation and signing the delegate CPI.
    // // It is NOT marked as payer so that the user covers the fees.
    // pub authority: SystemAccount<'info>,
    /// The new mandate account to be created
    #[account(
        mut,
        seeds = [b"mandate", mandate.authority.key().as_ref(), mandate_id.to_le_bytes().as_ref()],
        bump = mandate.bump,
    )]
    pub mandate: Account<'info, Mandate>,

    /// The token mint for the mandate
    pub mint: Account<'info, Mint>,

    /// The user's token account that will be debited
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> ApproveMandate<'info> {
    pub fn approve(&mut self) -> Result<()> {
        // Validate that the user actually matches the mandate user
        require!(
            self.user.key() == self.mandate.user,
            MandateError::UnauthorizedUser
        );
        // Validate mandate state
        // Fail early with clear errors for the two distinct states.
        require!(!self.mandate.is_approved, MandateError::AlreadyApproved);
        require!(!self.mandate.is_active, MandateError::AlreadyActive);

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

        // SECURITY FIX 1: Update the state BEFORE external call
        self.mandate.is_approved = true;
        self.mandate.is_active = true;
        self.mandate.updated_at = Clock::get()?.unix_timestamp;

        // Approve token delegation
        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = Approve {
            to: self.user_token_account.to_account_info(),
            authority: self.user.to_account_info(),
            delegate: self.mandate.to_account_info(),
        };

        let amount = if self.mandate.is_unlimited_spend {
            UNLIMITED_ALLOWANCE
        } else {
            self.mandate.limit
        };
        approve(CpiContext::new(cpi_program, cpi_accounts), amount)?;

        // SECURITY FIX 7: Emit approval event for monitoring
        emit!(crate::events::MandateApprovedEvent {
            mandate_id: self.mandate.id,
            user: self.user.key(),
            amount_per_debit: self.mandate.amount_per_debit,
            is_approved: self.mandate.is_approved,
            is_active: self.mandate.is_active,
            created_at: self.mandate.created_at,
            timestamp: self.mandate.updated_at,
        });

        Ok(())
    }
}
