use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenInterface;

use crate::state::state::Mandate;

#[derive(Accounts)]
pub struct ModifyMandate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"mandate", authority.key().as_ref(), mandate.id.to_le_bytes().as_ref()],
        bump = mandate.bump,
    )]
    pub mandate: Account<'info, Mandate>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

impl<'info> ModifyMandate<'info> {
    /// Toggles the mandate's active state.
    ///
    /// This method flips the state from active to inactive and vice versa.
    /// It rejects the modification if the mandate has already been cancelled or if it is expired.
    pub fn modify(&mut self) -> Result<()> {
        // Prevent modification if mandate is cancelled.
        require!(
            self.mandate.cancelled_at == 0,
            ManageError::MandateAlreadyCancelled
        );

        let now = Clock::get()?.unix_timestamp;
        require!(self.mandate.end_date >= now, ManageError::MandateExpired);

        // Toggle the active state.
        self.mandate.is_active = !self.mandate.is_active;

        // Emit an event to signify the change.
        emit!(MandateModified {
            mandate_id: self.mandate.id,
            new_status: self.mandate.is_active,
        });

        Ok(())
    }
}

#[event]
pub struct MandateModified {
    pub mandate_id: u64,
    pub new_status: bool,
}

#[error_code]
pub enum ManageError {
    #[msg("Mandate was already cancelled")]
    MandateAlreadyCancelled,
    #[msg("Mandate has expired")]
    MandateExpired,
}
