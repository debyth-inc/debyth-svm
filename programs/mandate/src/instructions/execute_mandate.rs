use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::errors::{MandateError, validation::*};
use crate::events::MandateExecutedEvent;
use crate::state::{ChargeType, ExecutionState, Mandate, MandateStatus, MIN_DEBIT_AMOUNT, UNLIMITED_ALLOWANCE};

#[derive(Accounts)]
pub struct ExecuteMandate<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"mandate", authority.key().as_ref(), mandate.id.to_le_bytes().as_ref()],
        bump = mandate.bump,
        constraint = mandate.authority == authority.key() @ MandateError::InvalidAuthority,
        constraint = mandate.status == MandateStatus::Active @ MandateError::MandateNotActive,
        constraint = mandate.is_approved @ MandateError::MandateNotApproved,
    )]
    pub mandate: Account<'info, Mandate>,

    #[account(
        seeds = [ExecutionState::SEED_PREFIX],
        bump,
        constraint = !execution_state.paused @ MandateError::ExecutionPaused,
    )]
    pub execution_state: Account<'info, ExecutionState>,

    #[account(
        constraint = mint.key() == mandate.mint @ MandateError::InvalidMint,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = mandate.sender,
        associated_token::token_program = token_program,
    )]
    pub sender_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = mandate.recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ExecuteMandateArgs {
    pub amount_to_debit: u64,
    pub nonce: u64, // Replay protection nonce
}

impl<'info> ExecuteMandate<'info> {
    pub fn execute(&mut self, args: ExecuteMandateArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        // Basic mandate validation
        require!(self.mandate.is_approved, MandateError::MandateNotApproved);
        require!(self.mandate.status == MandateStatus::Active, MandateError::MandateNotActive);

        // Validate timestamp
        validate_timestamp(now)?;

        // Validate nonce for replay protection
        require!(args.nonce > 0, MandateError::InvalidNonce);
        require!(
            args.nonce > self.mandate.last_execution_nonce,
            MandateError::NonceAlreadyUsed
        );

        // Check frequency constraint
        if self.mandate.last_execution_time > 0 {
            let min_interval = self.mandate.policy.min_interval_seconds;
            validate_frequency_elapsed(
                self.mandate.last_execution_time,
                min_interval,
                now,
            )?;
        }

        // Check policy timing
        validate_policy_timing(
            self.mandate.policy.start_at,
            self.mandate.policy.end_at,
            self.mandate.policy.min_interval_seconds,
            now,
        )?;

        // Validate recipient is allowed if policy has restrictions
        if self.mandate.policy.allowed_recipients.len() > 0 {
            let allowed = self.mandate.policy.allowed_recipients
                .iter()
                .any(|addr| addr == &self.mandate.recipient);
            require!(allowed, MandateError::RecipientNotAllowed);
        }

        // Validate asset is allowed if policy has restrictions
        if self.mandate.policy.allowed_assets.len() > 0 {
            let allowed = self.mandate.policy.allowed_assets
                .iter()
                .any(|addr| addr == &self.mandate.mint);
            require!(allowed, MandateError::AssetNotAllowed);
        }

        // Amount validation based on charge type
        match self.mandate.policy.charge_type {
            ChargeType::Fixed => {
                require!(
                    self.mandate.policy.per_execution_limit == args.amount_to_debit,
                    MandateError::InvalidAmountForFixedDebit
                );
            }
            ChargeType::Variable => {
                // Validate amount is within allowed range
                require!(
                    args.amount_to_debit >= MIN_DEBIT_AMOUNT,
                    MandateError::DebitAmountTooSmall
                );
                require!(
                    args.amount_to_debit <= self.mandate.policy.per_execution_limit,
                    MandateError::InvalidAmountForVariableDebit
                );
            }
        }

        // Validate limit with detailed context
        let new_total = validate_debit_limit(
            self.mandate.total_executed,
            args.amount_to_debit,
            self.mandate.policy.lifetime_limit,
            self.mandate.policy.lifetime_limit == UNLIMITED_ALLOWANCE,
        )?;

        // Validate period limit if configured
        if self.mandate.policy.period_limit > 0 && self.mandate.policy.period_window > 0 {
            // Calculate current period start
            let period_start = now - (now % self.mandate.policy.period_window as i64);
            if self.mandate.last_period_timestamp < period_start {
                self.mandate.period_executed = 0;
                self.mandate.last_period_timestamp = period_start;
            }

            // Check period limit
            require!(
                self.mandate.period_executed as u64 + args.amount_to_debit <= self.mandate.policy.period_limit,
                MandateError::DebitLimitExceeded
            );
        }

        // Validate sufficient balance
        validate_sufficient_balance(
            self.sender_token_account.amount,
            args.amount_to_debit,
        )?;

        // Validate delegation is set correctly
        require!(
            self.sender_token_account.delegate == Some(self.mandate.key()).into(),
            MandateError::InvalidDelegate
        );

        // Validate sufficient delegation amount
        validate_sufficient_delegation(
            self.sender_token_account.delegated_amount,
            args.amount_to_debit,
        )?;

        // Token account validation
        require!(
            self.sender_token_account.owner == self.mandate.sender,
            MandateError::InvalidTokenAccount
        );
        require!(
            self.sender_token_account.mint == self.mint.key(),
            MandateError::InvalidMint
        );
        require!(
            self.recipient_token_account.owner == self.mandate.recipient,
            MandateError::InvalidRecipient
        );

        // Execute the transfer directly to recipient
        let cpi_program = self.token_program.to_account_info();
        let seeds: &[&[u8]] = &[
            b"mandate",
            self.mandate.authority.as_ref(),
            &self.mandate.id.to_le_bytes(),
            &[self.mandate.bump],
        ];
        let signer = &[&seeds[..]];

        transfer_checked(
            CpiContext::new_with_signer(
                cpi_program,
                TransferChecked {
                    from: self.sender_token_account.to_account_info(),
                    to: self.recipient_token_account.to_account_info(),
                    mint: self.mint.to_account_info(),
                    authority: self.mandate.to_account_info(),
                },
                signer,
            ),
            args.amount_to_debit,
            self.mint.decimals,
        )?;

        // Update mandate state
        self.mandate.last_execution_time = now;
        self.mandate.total_executed = new_total; // Safe assignment
        self.mandate.last_execution_nonce = args.nonce;
        self.mandate.period_executed += args.amount_to_debit;

        // Check if mandate is complete
        if self.mandate.policy.lifetime_limit != UNLIMITED_ALLOWANCE &&
            self.mandate.total_executed >= self.mandate.policy.lifetime_limit {
            self.mandate.status = MandateStatus::Complete;
        }

        emit!(MandateExecutedEvent {
            mandate_id: self.mandate.id,
            sender: self.mandate.sender,
            recipient: self.mandate.recipient,
            mint: self.mandate.mint,
            amount: args.amount_to_debit,
            total_charged: self.mandate.total_executed,
            timestamp: now,
            nonce: args.nonce,
            policy_hash: self.mandate.policy_hash,
        });

        Ok(())
    }
}
