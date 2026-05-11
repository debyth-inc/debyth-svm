use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{approve, Approve, Mint, Token, TokenAccount},
};

use crate::errors::{MandateError, validation::*};
use crate::events::MandateModifiedEvent;
use crate::state::{
    ChargeType, Frequency, Mandate, MandateStatus, Policy, MAX_DEBIT_AMOUNT, UNLIMITED_ALLOWANCE,
};

#[derive(Accounts)]
pub struct ModifyMandate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Sender who approved the mandate - required for updating delegation and consent
    pub sender: Signer<'info>,

    /// Recipient for this mandate
    pub recipient: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [b"mandate", authority.key().as_ref(), mandate.id.to_le_bytes().as_ref()],
        bump = mandate.bump,
        constraint = mandate.authority == authority.key() @ MandateError::InvalidAuthority,
        constraint = mandate.sender == sender.key() @ MandateError::UnauthorizedSender,
    )]
    pub mandate: Account<'info, Mandate>,

    pub mint: Account<'info, Mint>,

    /// Sender's token account - required for updating delegation
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program,
        constraint = sender_token_account.mint == mandate.mint @ MandateError::InvalidMint,
    )]
    pub sender_token_account: Account<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ModifyMandateArgs {
    pub new_amount_per_debit: u64,
    pub new_total_limit: u64,
    pub new_is_unlimited_spend: bool,
    pub new_charge_type: ChargeType,
    pub new_frequency: Frequency,
    pub new_min_interval_seconds: u64,
    pub new_start_at: i64,
    pub new_end_at: i64,
    pub new_allowed_recipients: Vec<Pubkey>,
    pub new_allowed_assets: Vec<Pubkey>,
    pub new_policy_hash: [u8; 32],
}

impl<'info> ModifyMandate<'info> {
    /// Modifies mandate parameters including amount, limit, type, frequency, and timing.
    ///
    /// This method allows updating mandate configuration after approval.
    /// It requires the mandate to be active and updates the SPL token delegation
    /// to match the new limit, preventing state inconsistency.
    ///
    /// # Security
    /// - Requires both authority and sender signatures
    /// - Sender consent is required (sender signs the transaction)
    /// - Updates token delegation via CPI to match new limit
    /// - Validates new limit against already executed amount
    pub fn modify(&mut self, args: ModifyMandateArgs) -> Result<()> {
        // Ensure mandate is active before allowing modifications
        require!(self.mandate.is_approved, MandateError::MandateNotApproved);
        require!(self.mandate.status == MandateStatus::Active, MandateError::MandateNotActive);
        require!(self.mandate.recipient == self.recipient.key(), MandateError::InvalidRecipient);

        // Validate new amount_per_debit bounds
        validate_debit_amount(args.new_amount_per_debit)?;
        validate_debit_frequency(args.new_min_interval_seconds)?;

        // Validate policy timing
        validate_policy_timing(
            args.new_start_at,
            args.new_end_at,
            args.new_min_interval_seconds,
            Clock::get()?.unix_timestamp,
        )?;

        // Validate new limit and spend cap relationship
        validate_spend_cap(
            args.new_total_limit,
            args.new_amount_per_debit,
            args.new_is_unlimited_spend,
        )?;

        // Validate new limit is not less than already executed amount
        validate_new_limit(
            args.new_total_limit,
            self.mandate.total_executed,
            args.new_is_unlimited_spend,
        )?;

        // Additional validation for non-unlimited mandates
        if !args.new_is_unlimited_spend {
            require!(
                args.new_total_limit <= MAX_DEBIT_AMOUNT,
                MandateError::DebitAmountTooLarge
            );
        }

        // Validate policy hash is not zero
        require!(
            args.new_policy_hash != [0u8; 32],
            MandateError::InvalidPolicyHash
        );

        // Validate allowed_recipients and allowed_assets are within bounds
        require!(
            args.new_allowed_recipients.len() <= 10,
            MandateError::MaxPolicyConstraintsExceeded
        );
        require!(
            args.new_allowed_assets.len() <= 10,
            MandateError::MaxPolicyConstraintsExceeded
        );

        let old_policy_hash = self.mandate.policy_hash;

        // Update mandate fields
        let actual_new_limit = if args.new_is_unlimited_spend {
            UNLIMITED_ALLOWANCE
        } else {
            args.new_total_limit
        };

        self.mandate.policy = Policy {
            charge_type: args.new_charge_type,
            frequency: args.new_frequency,
            min_interval_seconds: args.new_min_interval_seconds,
            per_execution_limit: args.new_amount_per_debit,
            lifetime_limit: actual_new_limit,
            period_limit: 0, // Optional period limit
            period_window: 0, // Optional period window
            start_at: args.new_start_at,
            end_at: args.new_end_at,
            allowed_recipients: args.new_allowed_recipients,
            allowed_assets: args.new_allowed_assets,
            policy_hash: args.new_policy_hash,
        };

        self.mandate.policy_hash = args.new_policy_hash;
        self.mandate.last_period_timestamp = Clock::get()?.unix_timestamp;

        // CRITICAL FIX: Update SPL token delegation to match new limit
        // This prevents state inconsistency between mandate limit and actual delegated amount
        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = Approve {
            to: self.sender_token_account.to_account_info(),
            delegate: self.mandate.to_account_info(),
            authority: self.sender.to_account_info(),
        };
        approve(CpiContext::new(cpi_program, cpi_accounts), actual_new_limit)?;

        // Emit modification event
        emit!(MandateModifiedEvent {
            mandate_id: self.mandate.id,
            sender: self.mandate.sender,
            recipient: self.mandate.recipient,
            old_policy_hash,
            new_policy_hash: args.new_policy_hash,
            modified_by: self.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}
