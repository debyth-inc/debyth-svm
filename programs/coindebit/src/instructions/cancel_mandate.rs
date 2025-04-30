use anchor_lang::prelude::*;
use anchor_spl::token_interface::{revoke, Mint, Revoke, TokenAccount, TokenInterface};

use crate::state::state::Mandate;

/// Accounts for cancelling a mandate and revoking token approval
#[derive(Accounts)]
#[instruction(mandate_id: u64)]
pub struct CancelMandate<'info> {
    /// The user who owns the mandate and is authorized to cancel it
    #[account(mut)]
    pub user: Signer<'info>,

    /// The mandate account to be cancelled and closed
    #[account(
        mut,
        close = user,
        seeds = [b"mandate", user.key().as_ref(), mandate_id.to_le_bytes().as_ref()],
        bump = mandate.bump,
    )]
    pub mandate: Account<'info, Mandate>,

    /// The token mint
    #[account(
        mint::token_program = token_program
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// The user's token account that has the approval to be revoked
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

impl<'info> CancelMandate<'info> {
    /// Cancels an existing mandate and revokes token approval
    ///
    /// # Errors
    /// - If the mandate is already active or approved
    /// - If the mandate is expired
    /// - If the signer is not the mandate owner
    pub fn cancel(&mut self) -> Result<()> {
        // Verify mandate owner
        // require_keys_eq!(
        //     self.user.key(),
        //     self.mandate.owner,
        //     ManageError::UnauthorizedOwner
        // );

        // Verify mandate status
        require!(
            !self.mandate.is_active && !self.mandate.is_approved,
            ManageError::MandateAlreadyActive
        );

        // Check if the mandate is expired
        require!(
            self.mandate.end_date >= Clock::get()?.unix_timestamp,
            ManageError::MandateExpired
        );

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
        self.mandate.cancelled_at = Clock::get()?.unix_timestamp;

        Ok(())
    }
}

#[error_code]
pub enum ManageError {
    #[msg("Only the mandate owner can perform this action")]
    UnauthorizedOwner,
    #[msg("Mandate is already active or approved")]
    MandateAlreadyActive,
    #[msg("Mandate has expired")]
    MandateExpired,
}
