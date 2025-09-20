use anchor_lang::prelude::*;
use anchor_spl::token::Token;

use crate::state::{DebitType, Mandate};
use crate::events::MandateModifiedEvent;

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

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ModifyMandateArgs {
    pub new_amount_per_debit: u64,
    pub new_limit: u64,
    pub new_is_unlimited_spend: bool,
    pub new_debit_type: DebitType,
}

impl<'info> ModifyMandate<'info> {
    /// Toggles the mandate's active state.
    ///
    /// This method flips the state from active to inactive and vice versa.
    /// It requires the mandate to be approved before modification.
    pub fn modify(&mut self, args: ModifyMandateArgs) -> Result<()> {
        // Ensure mandate is approved before allowing modifications
        require!(self.mandate.is_approved, ManageError::MandateNotApproved);

        // Update mandate fields
        self.mandate.amount_per_debit = args.new_amount_per_debit;
        self.mandate.debit_type = args.new_debit_type;

        let actual_new_limit = if args.new_is_unlimited_spend {
            u64::MAX
        } else {
            args.new_limit
        };
        self.mandate.limit = actual_new_limit;

        // Toggle the active state (optional, depending on intended modification)
        // self.mandate.is_active = !self.mandate.is_active;

        self.mandate.updated_at = Clock::get()?.unix_timestamp;

        // Emit an event to signify the change
        emit!(MandateModifiedEvent {
            mandate_id: self.mandate.id,
            authority: self.authority.key(),
            user: self.mandate.user,
            new_amount_per_debit: args.new_amount_per_debit,
            new_limit: actual_new_limit,
            new_is_unlimited_spend: args.new_is_unlimited_spend,
            new_debit_type: args.new_debit_type,
            new_is_active: self.mandate.is_active,
            new_is_approved: self.mandate.is_approved,
        });

        Ok(())
    }
}

#[error_code]
pub enum ManageError {
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("Mandate is not approved")]
    MandateNotApproved,
}
