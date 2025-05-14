use anchor_lang::prelude::*;
use anchor_spl::token::Token;

use crate::state::state::Mandate;

#[derive(Accounts)]
pub struct ModifyMandate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"mandate", mandate.id.to_le_bytes().as_ref()],
        bump = mandate.bump,
        constraint = mandate.authority == authority.key() @ ManageError::InvalidAuthority,
    )]
    pub mandate: Account<'info, Mandate>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> ModifyMandate<'info> {
    /// Toggles the mandate's active state.
    ///
    /// This method flips the state from active to inactive and vice versa.
    /// It requires the mandate to be approved before modification.
    pub fn modify(&mut self) -> Result<()> {
        // Ensure mandate is approved before allowing modifications
        require!(self.mandate.is_approved, ManageError::MandateNotApproved);

        // Toggle the active state
        self.mandate.is_active = !self.mandate.is_active;

        // Update last execution timestamp
        self.mandate.last_execution = Clock::get()?.unix_timestamp;

        // Emit an event to signify the change
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
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("Mandate is not approved")]
    MandateNotApproved,
}
