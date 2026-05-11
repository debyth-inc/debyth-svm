use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::events::MandateCreatedEvent;
use crate::state::{
    ChargeType, Frequency, Mandate, MandateStatus, Policy, MAX_DEBIT_AMOUNT, UNLIMITED_ALLOWANCE,
};

use crate::errors::{MandateError, validation::*};

#[derive(Accounts)]
#[instruction(mandate_id: u64)]
pub struct CreateMandate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub sender: SystemAccount<'info>,

    pub recipient: SystemAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Mandate::INIT_SPACE,
        seeds = [b"mandate", authority.key().as_ref(), mandate_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub mandate: Box<Account<'info, Mandate>>,

    pub mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program,
    )]
    pub sender_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateMandateArgs {
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub amount_per_debit: u64,
    pub total_limit: u64,
    pub is_unlimited_spend: bool,
    pub charge_type: ChargeType,
    pub frequency: Frequency,
    pub min_interval_seconds: u64,
    pub start_at: i64,
    pub end_at: i64,
    pub allowed_recipients: Vec<Pubkey>,
    pub allowed_assets: Vec<Pubkey>,
    pub policy_hash: [u8; 32],
}

impl<'info> CreateMandate<'info> {
    pub fn create(
        &mut self,
        mandate_id: u64,
        args: CreateMandateArgs,
        bumps: &CreateMandateBumps,
    ) -> Result<()> {
        // Validate policy parameters
        validate_debit_amount(args.amount_per_debit)?;
        validate_debit_frequency(args.min_interval_seconds)?;
        validate_spend_cap(args.total_limit, args.amount_per_debit, args.is_unlimited_spend)?;

        // Validate policy timing
        let now = Clock::get()?.unix_timestamp;
        validate_policy_timing(
            args.start_at,
            args.end_at,
            args.min_interval_seconds,
            now,
        )?;

        // Validate policy hash is not zero
        require!(
            args.policy_hash != [0u8; 32],
            MandateError::InvalidPolicyHash
        );

        // Validate allowed_recipients and allowed_assets are within bounds
        require!(
            args.allowed_recipients.len() <= 10,
            MandateError::MaxPolicyConstraintsExceeded
        );
        require!(
            args.allowed_assets.len() <= 10,
            MandateError::MaxPolicyConstraintsExceeded
        );

        // Additional validation for non-unlimited mandates
        if !args.is_unlimited_spend {
            require!(
                args.total_limit <= MAX_DEBIT_AMOUNT,
                MandateError::DebitAmountTooLarge
            );
        }

        let actual_total_limit = if args.is_unlimited_spend {
            UNLIMITED_ALLOWANCE
        } else {
            args.total_limit
        };

        // Initialize the mandate with policy
        self.mandate.set_inner(Mandate {
            id: mandate_id,
            authority: self.authority.key(),
            sender: args.sender,
            recipient: args.recipient,
            bump: bumps.mandate,
            mint: self.mint.key(),
            policy: Policy {
                charge_type: args.charge_type,
                frequency: args.frequency,
                min_interval_seconds: args.min_interval_seconds,
                per_execution_limit: args.amount_per_debit,
                lifetime_limit: actual_total_limit,
                period_limit: 0, // Optional period limit
                period_window: 0, // Optional period window
                start_at: args.start_at,
                end_at: args.end_at,
                allowed_recipients: args.allowed_recipients,
                allowed_assets: args.allowed_assets,
                policy_hash: args.policy_hash,
            },
            total_executed: 0,
            last_execution_nonce: 0,
            last_execution_time: 0,
            period_executed: 0,
            status: MandateStatus::Pending,
            created_at: now,
            is_approved: false,
            policy_hash: args.policy_hash,
            last_period_timestamp: 0,
        });

        emit!(MandateCreatedEvent {
            mandate_id,
            sender: args.sender,
            recipient: args.recipient,
            mint: self.mint.key(),
            total_limit: actual_total_limit,
            per_execution_limit: args.amount_per_debit,
            policy_hash: args.policy_hash,
            start_at: args.start_at,
            end_at: args.end_at,
            created_at: now,
        });

        Ok(())
    }
}
