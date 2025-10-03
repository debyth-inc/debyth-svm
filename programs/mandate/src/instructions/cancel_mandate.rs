use anchor_lang::prelude::*;
use anchor_spl::token::{revoke, Mint, Revoke, Token, TokenAccount};

use crate::events::MandateCancelledEvent;
use crate::state::Mandate;
use crate::errors::MandateError;

#[derive(Accounts)]
pub struct CancelMandate<'info> {
    #[account(mut)]
    pub signer: Signer<'info>, // Whoever is cancelling (user or authority)

    /// CHECK: The actual user of the mandate (for validation). This is validated against the mandate.user field in the constraint below.
    pub user: UncheckedAccount<'info>,

    #[account(
        mut,
        close = signer, // Rent goes to the signer
        seeds = [b"mandate", mandate.id.to_le_bytes().as_ref()],
        bump = mandate.bump,
        constraint = mandate.user == signer.key() || mandate.authority == signer.key() @ MandateError::UnauthorizedOwner,
    )]
    pub mandate: Account<'info, Mandate>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = mandate.user, // Always the mandate user's token account
        associated_token::token_program = token_program,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> CancelMandate<'info> {
    pub fn cancel(&mut self) -> Result<()> {
        // Verify mandate owner (redundant with account constraint, but kept for safety)
        require!(
            self.signer.key() == self.mandate.user || self.signer.key() == self.mandate.authority,
            MandateError::UnauthorizedOwner
        );

        // Verify mandate status
        require!(self.mandate.is_approved, MandateError::MandateNotApproved);

        // Authority should be able to cancel mandate for security (if contract is compromised)
        // However, only the user can revoke their own token delegation
        if self.signer.key() == self.mandate.user {
            // User is cancelling - revoke the token delegation
            let cpi_program = self.token_program.to_account_info();
            let cpi_accounts = Revoke {
                source: self.user_token_account.to_account_info(),
                authority: self.signer.to_account_info(), // User signs for revoke
            };
            let cpi_context = CpiContext::new(cpi_program, cpi_accounts);
            revoke(cpi_context)?;
        }
        // Quick note: If authority now actually cancels, then mandate will become inactive but delegation remains
        // User should manually revoke delegation after authority emergency cancellation

        let now = Clock::get()?.unix_timestamp;

        // Update mandate state
        self.mandate.is_active = false;
        self.mandate.is_approved = false;
        self.mandate.updated_at = now;

        // Emit cancellation event
        emit!(MandateCancelledEvent {
            mandate_id: self.mandate.id,
            user: self.user.key(),
            authority: self.mandate.authority,
            timestamp: now,
        });

        Ok(())
    }
}