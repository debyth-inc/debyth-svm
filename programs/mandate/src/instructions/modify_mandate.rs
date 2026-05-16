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

    pub sender: Signer<'info>,

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
    pub new_authorized_limit: u64,
    pub new_charge_type: ChargeType,
    pub new_frequency: Frequency,
    pub new_min_interval_seconds: u64,
    pub new_per_execution_limit: u64,
    pub new_period_limit: u64,
    pub new_period_window: u64,
    pub new_start_at: i64,
    pub new_end_at: i64,
    pub new_policy_hash: [u8; 32],
    pub signature_nonce: u64,
}

impl<'info> ModifyMandate<'info> {
    pub fn modify(&mut self, args: ModifyMandateArgs) -> Result<()> {
        require!(self.mandate.is_approved, MandateError::MandateNotApproved);
        require!(self.mandate.status == MandateStatus::Active, MandateError::MandateNotActive);
        require!(self.mandate.recipient == self.recipient.key(), MandateError::InvalidRecipient);

        validate_debit_amount(args.new_per_execution_limit)?;
        validate_debit_frequency(args.new_min_interval_seconds)?;

        validate_policy_timing(
            args.new_start_at,
            args.new_end_at,
            args.new_min_interval_seconds,
            Clock::get()?.unix_timestamp,
        )?;

        validate_spend_cap(
            args.new_authorized_limit,
            args.new_per_execution_limit,
            args.new_authorized_limit == 0,
        )?;

        validate_new_limit(
            args.new_authorized_limit,
            self.mandate.execution_state.total_executed,
            args.new_authorized_limit == 0,
        )?;

        if args.new_authorized_limit != 0 {
            require!(
                args.new_authorized_limit <= MAX_DEBIT_AMOUNT,
                MandateError::DebitAmountTooLarge
            );
        }

        // Policy constraints may tighten authority but never broaden it
        if args.new_authorized_limit != 0 && args.new_per_execution_limit > args.new_authorized_limit {
            return Err(MandateError::PolicyExceedsAuthority.into());
        }

        require!(
            args.new_policy_hash != [0u8; 32],
            MandateError::InvalidPolicyHash
        );

        require!(
            args.signature_nonce > self.mandate.modify_signature_nonce,
            MandateError::SignatureNonceAlreadyUsed
        );

        let old_policy_hash = self.mandate.policy.policy_hash;

        let effective_limit = if args.new_authorized_limit == 0 {
            UNLIMITED_ALLOWANCE
        } else {
            args.new_authorized_limit
        };

        self.mandate.authorized_limit = effective_limit;
        self.mandate.charge_type = args.new_charge_type;
        self.mandate.start_at = args.new_start_at;
        self.mandate.end_at = args.new_end_at;

        self.mandate.policy = Policy {
            frequency: args.new_frequency,
            min_interval_seconds: args.new_min_interval_seconds,
            per_execution_limit: args.new_per_execution_limit,
            period_limit: args.new_period_limit,
            period_window: args.new_period_window,
            policy_hash: args.new_policy_hash,
        };

        self.mandate.modify_signature_nonce = args.signature_nonce;

        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = Approve {
            to: self.sender_token_account.to_account_info(),
            delegate: self.mandate.to_account_info(),
            authority: self.sender.to_account_info(),
        };
        approve(CpiContext::new(cpi_program, cpi_accounts), effective_limit)?;

        emit!(MandateModifiedEvent {
            mandate_id: self.mandate.id,
            sender: self.mandate.sender,
            old_policy_hash,
            new_policy_hash: args.new_policy_hash,
            modified_by: self.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}
