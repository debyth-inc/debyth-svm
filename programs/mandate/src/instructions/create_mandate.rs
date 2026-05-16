use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::events::MandateCreatedEvent;
use crate::state::{
    ChargeType, ExecutionState, Frequency, Mandate, MandateStatus, Policy, MAX_DEBIT_AMOUNT, UNLIMITED_ALLOWANCE,
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
    pub authorized_limit: u64,
    pub charge_type: ChargeType,
    pub frequency: Frequency,
    pub min_interval_seconds: u64,
    pub per_execution_limit: u64,
    pub period_limit: u64,
    pub period_window: u64,
    pub start_at: i64,
    pub end_at: i64,
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
        validate_debit_amount(args.per_execution_limit)?;
        validate_debit_frequency(args.min_interval_seconds)?;
        validate_spend_cap(args.authorized_limit, args.per_execution_limit, args.authorized_limit == 0)?;

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

        // Policy constraints may tighten authority but never broaden it
        if args.authorized_limit != 0 && args.per_execution_limit > args.authorized_limit {
            return Err(MandateError::PolicyExceedsAuthority.into());
        }

        // Additional validation for non-unlimited mandates
        if args.authorized_limit != 0 {
            require!(
                args.authorized_limit <= MAX_DEBIT_AMOUNT,
                MandateError::DebitAmountTooLarge
            );
        }

        let effective_limit = if args.authorized_limit == 0 {
            UNLIMITED_ALLOWANCE
        } else {
            args.authorized_limit
        };

        // Initialize the mandate with new structure
        self.mandate.set_inner(Mandate {
            id: mandate_id,
            authority: self.authority.key(),
            sender: args.sender,
            recipient: args.recipient,
            bump: bumps.mandate,
            mint: self.mint.key(),
            authorized_limit: effective_limit,
            charge_type: args.charge_type,
            start_at: args.start_at,
            end_at: args.end_at,
            policy: Policy {
                frequency: args.frequency,
                min_interval_seconds: args.min_interval_seconds,
                per_execution_limit: args.per_execution_limit,
                period_limit: args.period_limit,
                period_window: args.period_window,
                policy_hash: args.policy_hash,
            },
            execution_state: ExecutionState::default(),
            status: MandateStatus::Pending,
            created_at: now,
            is_approved: false,
            modify_signature_nonce: 0,
        });

        emit!(MandateCreatedEvent {
            mandate_id,
            authority: self.authority.key(),
            sender: args.sender,
            recipient: args.recipient,
            mint: self.mint.key(),
            authorized_limit: effective_limit,
            charge_type: args.charge_type as u8,
            start_at: args.start_at,
            end_at: args.end_at,
            policy_hash: args.policy_hash,
            created_at: now,
        });

        Ok(())
    }
}
