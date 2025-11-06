use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{approve, Approve, Mint, Token, TokenAccount},
};

use crate::errors::MandateError;
use crate::events::MandateModifiedEvent;
use crate::state::{
    DebitType, Mandate, MAX_DEBIT_AMOUNT, MAX_DEBIT_FREQUENCY_SECONDS, MIN_DEBIT_AMOUNT,
    UNLIMITED_ALLOWANCE,
};

#[derive(Accounts)]
pub struct ModifyMandate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// User who approved the mandate - required for updating delegation
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"mandate", authority.key().as_ref(), mandate.id.to_le_bytes().as_ref()],
        bump = mandate.bump,
        constraint = mandate.authority == authority.key() @ MandateError::InvalidAuthority,
        constraint = mandate.user == user.key() @ MandateError::UnauthorizedUser,
    )]
    pub mandate: Account<'info, Mandate>,

    pub mint: Account<'info, Mint>,

    /// User's token account - required for updating delegation
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
        constraint = user_token_account.mint == mandate.mint @ MandateError::InvalidMint,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ModifyMandateArgs {
    pub new_amount_per_debit: u64,
    pub new_limit: u64,
    pub new_is_unlimited_spend: bool,
    pub new_debit_type: DebitType,
    pub new_debit_frequency_seconds: u64,
}

impl<'info> ModifyMandate<'info> {
    /// Modifies mandate parameters including amount, limit, type, and frequency.
    ///
    /// This method allows updating mandate configuration after approval.
    /// It requires the mandate to be approved and updates the SPL token delegation
    /// to match the new limit, preventing state inconsistency.
    ///
    /// # Security
    /// - Requires both authority and user signatures
    /// - Updates token delegation via CPI to match new limit
    /// - Validates new limit against already debited amount
    pub fn modify(&mut self, args: ModifyMandateArgs) -> Result<()> {
        // Ensure mandate is approved before allowing modifications
        require!(self.mandate.is_approved, MandateError::MandateNotApproved);

        // Validate new amount_per_debit bounds
        require!(
            args.new_amount_per_debit >= MIN_DEBIT_AMOUNT,
            MandateError::DebitAmountTooSmall
        );
        require!(
            args.new_amount_per_debit <= MAX_DEBIT_AMOUNT,
            MandateError::DebitAmountTooLarge
        );

        // Validate new debit_frequency_seconds bounds
        require!(
            args.new_debit_frequency_seconds > 0,
            MandateError::InvalidDebitFrequency
        );
        require!(
            args.new_debit_frequency_seconds <= MAX_DEBIT_FREQUENCY_SECONDS,
            MandateError::DebitFrequencyTooLarge
        );

        if !args.new_is_unlimited_spend {
            require!(
                args.new_limit >= args.new_amount_per_debit,
                MandateError::InvalidSpendCap
            );
            require!(
                args.new_limit <= MAX_DEBIT_AMOUNT,
                MandateError::DebitAmountTooLarge
            );
            // SECURITY: Ensure new limit is not less than already debited amount
            require!(
                args.new_limit >= self.mandate.total_debited_amount,
                MandateError::InvalidSpendCap
            );
        }

        // Check for potential overflow in time calculations
        let max_realistic_timestamp = i64::MAX / 2;
        require!(
            args.new_debit_frequency_seconds <= max_realistic_timestamp as u64,
            MandateError::ArithmeticOverflow
        );

        // Update mandate fields
        self.mandate.amount_per_debit = args.new_amount_per_debit;
        self.mandate.debit_type = args.new_debit_type;
        self.mandate.is_unlimited_spend = args.new_is_unlimited_spend;
        self.mandate.debit_frequency_seconds = args.new_debit_frequency_seconds;

        let actual_new_limit = if args.new_is_unlimited_spend {
            UNLIMITED_ALLOWANCE
        } else {
            args.new_limit
        };
        self.mandate.limit = actual_new_limit;

        let now = Clock::get()?.unix_timestamp;
        self.mandate.updated_at = now;

        // CRITICAL FIX: Update SPL token delegation to match new limit
        // This prevents state inconsistency between mandate limit and actual delegated amount
        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = Approve {
            to: self.user_token_account.to_account_info(),
            delegate: self.mandate.to_account_info(),
            authority: self.user.to_account_info(),
        };
        approve(CpiContext::new(cpi_program, cpi_accounts), actual_new_limit)?;

        // Emit an event to signify the change
        emit!(MandateModifiedEvent {
            mandate_id: self.mandate.id,
            authority: self.authority.key(),
            user: self.mandate.user,
            new_amount_per_debit: args.new_amount_per_debit,
            new_limit: actual_new_limit,
            new_is_unlimited_spend: args.new_is_unlimited_spend,
            new_debit_type: args.new_debit_type,
            timestamp: now,
        });

        Ok(())
    }
}
