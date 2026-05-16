use anchor_lang::prelude::*;

use crate::errors::MandateError;
use crate::events::{MandatePausedEvent, MandateResumedEvent};
use crate::state::{Mandate, MandateStatus};

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
    /// requiring sender signature or modifying any financial parameters.
    ///
    /// # Security
    /// - Only authority can toggle status
    /// - Mandate must be approved before toggling
    /// - Does not require sender signature (non-financial operation)
    pub fn toggle_status(&mut self) -> Result<()> {
        // Ensure mandate is approved before allowing status changes
        require!(self.mandate.is_approved, MandateError::MandateNotApproved);

        let now = Clock::get()?.unix_timestamp;

        // Toggle the status between Active and Paused
        match self.mandate.status {
            MandateStatus::Active => {
                self.mandate.status = MandateStatus::Paused;
                emit!(MandatePausedEvent {
                    mandate_id: self.mandate.id,
                    sender: self.mandate.sender,
                    paused_by: self.authority.key(),
                    timestamp: now,
                });
            }
            MandateStatus::Paused => {
                self.mandate.status = MandateStatus::Active;
                emit!(MandateResumedEvent {
                    mandate_id: self.mandate.id,
                    sender: self.mandate.sender,
                    resumed_by: self.authority.key(),
                    timestamp: now,
                });
            }
            _ => {
                return Err(MandateError::MandateNotActive.into());
            }
        }

        Ok(())
    }
}
