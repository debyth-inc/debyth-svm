use anchor_lang::prelude::*;
use anchor_spl::token::{revoke, Mint, Revoke, Token, TokenAccount};

use crate::errors::MandateError;
use crate::events::MandateCancelledEvent;
use crate::state::Mandate;

#[derive(Accounts)]
pub struct CancelMandate<'info> {
    /// Authority who created the mandate - can always cancel to reclaim rent
    #[account(mut)]
    pub authority: Signer<'info>,

    /// User account (must sign if delegation is still active)
    /// CHECK: Validated against mandate.user. If delegation active, must be signer.
    pub user: AccountInfo<'info>,

    #[account(
        mut,
        close = authority,
        seeds = [b"mandate", authority.key().as_ref(), mandate.id.to_le_bytes().as_ref()],
        bump = mandate.bump,
        constraint = mandate.authority == authority.key() @ MandateError::InvalidAuthority,
    )]
    pub mandate: Account<'info, Mandate>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = mandate.user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> CancelMandate<'info> {
    pub fn cancel(&mut self) -> Result<()> {
        // Validate user account matches mandate
        require!(
            self.user.key() == self.mandate.user,
            MandateError::InvalidTokenAccount
        );

        let now = Clock::get()?.unix_timestamp;

        // Try to revoke delegation if it still exists
        // If delegation exists, user must sign to revoke
        if self.user_token_account.delegate == Some(self.mandate.key()).into() {
            // Delegate is still the mandate, user must sign to revoke
            require!(
                self.user.is_signer,
                MandateError::UnauthorizedUser
            );

            let cpi_program = self.token_program.to_account_info();
            let cpi_accounts = Revoke {
                source: self.user_token_account.to_account_info(),
                authority: self.user.clone(),
            };
            let cpi_context = CpiContext::new(cpi_program, cpi_accounts);
            revoke(cpi_context)?;
        }
        // If delegation was already revoked externally, we just close the account

        // Emit cancellation event before account is closed
        emit!(MandateCancelledEvent {
            mandate_id: self.mandate.id,
            user: self.user.key(),
            authority: self.mandate.authority,
            timestamp: now,
        });

        // Mandate account is automatically closed via 'close' constraint
        // Rent refund goes to authority (they paid for account creation)
        Ok(())
    }
}
