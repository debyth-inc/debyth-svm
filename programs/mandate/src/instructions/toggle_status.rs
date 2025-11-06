use anchor_lang::prelude::*;

use crate::errors::MandateError;
use crate::events::MandateStatusToggledEvent;
use crate::state::Mandate;

#[derive(Accounts)]
pub struct ToggleStatus<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"mandate", authority.key().as_ref(), mandate.id.to_le_bytes().as_ref()],
        bump = mandate.bump,
        constraint = mandate.authority == authority.key() @ MandateError::InvalidAuthority,
    )]
    pub mandate: Account<'info, Mandate>,
}

impl<'info> ToggleStatus<'info> {
    /// Toggles the active status of a mandate (pause/unpause).
    ///
    /// This method allows the authority to pause or resume a mandate without
    /// requiring user signature or modifying any financial parameters.
    ///
    /// # Security
    /// - Only authority can toggle status
    /// - Mandate must be approved before toggling
    /// - Does not require user signature (non-financial operation)
    pub fn toggle_status(&mut self) -> Result<()> {
        // Ensure mandate is approved before allowing status changes
        require!(self.mandate.is_approved, MandateError::MandateNotApproved);

        // Toggle the active status
        self.mandate.is_active = !self.mandate.is_active;

        let now = Clock::get()?.unix_timestamp;
        self.mandate.updated_at = now;

        // Emit an event to signify the status change
        emit!(MandateStatusToggledEvent {
            mandate_id: self.mandate.id,
            authority: self.authority.key(),
            user: self.mandate.user,
            is_active: self.mandate.is_active,
            timestamp: now,
        });

        Ok(())
    }
}
