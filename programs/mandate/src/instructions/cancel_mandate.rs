use anchor_lang::prelude::*;
use anchor_spl::token::{revoke, Mint, Revoke, Token, TokenAccount};

use crate::state::Mandate;
use crate::events::MandateCancelledEvent;

#[derive(Accounts)]
pub struct CancelMandate<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub authority: SystemAccount<'info>,

    #[account(
        mut,
        close = user,
        seeds = [b"mandate", mandate.id.to_le_bytes().as_ref()],
        bump = mandate.bump,
        constraint = mandate.user == user.key() @ ManageError::UnauthorizedOwner,
    )]
    pub mandate: Account<'info, Mandate>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> CancelMandate<'info> {
    pub fn cancel(&mut self) -> Result<()> {
        // Verify mandate owner (redundant with account constraint, but kept for safety)
        require_keys_eq!(
            self.user.key(),
            self.mandate.user,
            ManageError::UnauthorizedOwner
        );

        // Verify mandate status
        require!(self.mandate.is_approved, ManageError::MandateNotApproved);

        // Revoke token approval
        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = Revoke {
            source: self.user_token_account.to_account_info(),
            authority: self.user.to_account_info(),
        };
        let cpi_context = CpiContext::new(cpi_program, cpi_accounts);
        revoke(cpi_context)?;

        // Update mandate state
        self.mandate.is_active = false;
        self.mandate.is_approved = false;
        self.mandate.updated_at = Clock::get()?.unix_timestamp;

        // Emit cancellation event
        emit!(MandateCancelledEvent {
            mandate_id: self.mandate.id,
            user: self.user.key(),
            authority: self.authority.key(),

        });

        Ok(())
    }
}

#[error_code]
pub enum ManageError {
    #[msg("Only the mandate owner can perform this action")]
    UnauthorizedOwner,
    #[msg("Mandate is not approved")]
    MandateNotApproved,
}
