use anchor_lang::prelude::*;

use crate::errors::MandateError;
use crate::events::MandateEmergencyCancelledEvent;
use crate::state::{Mandate, MandateStatus};

#[derive(Accounts)]
pub struct EmergencyCancelMandate<'info> {
    #[account(mut)]
    pub exec_admin: Signer<'info>,

    pub authority: SystemAccount<'info>,

    pub sender: SystemAccount<'info>,

    pub recipient: SystemAccount<'info>,

    #[account(
        mut,
        close = exec_admin,
        seeds = [b"mandate", authority.key().as_ref(), mandate.id.to_le_bytes().as_ref()],
        bump = mandate.bump,
        constraint = mandate.authority == authority.key() @ MandateError::InvalidAuthority,
        constraint = mandate.sender == sender.key() @ MandateError::UnauthorizedSender,
        constraint = mandate.status != MandateStatus::Cancelled @ MandateError::MandateNotActive,
        constraint = mandate.status != MandateStatus::Complete @ MandateError::MandateNotActive,
    )]
    pub mandate: Account<'info, Mandate>,

    pub system_program: Program<'info, System>,
}

impl<'info> EmergencyCancelMandate<'info> {
    pub fn emergency_cancel(&mut self) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        self.mandate.status = MandateStatus::Cancelled;

        emit!(MandateEmergencyCancelledEvent {
            mandate_id: self.mandate.id,
            sender: self.sender.key(),
            cancelled_by: self.exec_admin.key(),
            timestamp: now,
        });

        Ok(())
    }
}
