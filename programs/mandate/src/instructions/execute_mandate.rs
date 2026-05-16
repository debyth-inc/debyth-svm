use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::errors::{MandateError, validation::*};
use crate::events::MandateExecutedEvent;
use crate::state::{ChargeType, ExecutionStateGlobal, Mandate, MandateStatus, MIN_DEBIT_AMOUNT, UNLIMITED_ALLOWANCE};

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
        seeds = [ExecutionStateGlobal::SEED_PREFIX],
        bump,
        constraint = !execution_state.paused @ MandateError::ExecutionPaused,
    )]
    pub execution_state: Account<'info, ExecutionStateGlobal>,

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
    pub nonce: u64,
}

impl<'info> ExecuteMandate<'info> {
    pub fn execute(&mut self, args: ExecuteMandateArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        // Validate timestamp
        validate_timestamp(now)?;

        // Validate nonce for replay protection
        require!(args.nonce > 0, MandateError::InvalidNonce);
        require!(
            args.nonce > self.mandate.execution_state.execution_nonce,
            MandateError::NonceAlreadyUsed
        );

        // Check frequency constraint
        if self.mandate.execution_state.last_execution_time > 0 {
            let min_interval = self.mandate.policy.min_interval_seconds;
            validate_frequency_elapsed(
                self.mandate.execution_state.last_execution_time,
                min_interval,
                now,
            )?;
        }

        // Check policy timing
        validate_policy_timing(
            self.mandate.start_at,
            self.mandate.end_at,
            self.mandate.policy.min_interval_seconds,
            now,
        )?;

        // Amount validation based on charge type
        match self.mandate.charge_type {
            ChargeType::Fixed => {
                require!(
                    self.mandate.policy.per_execution_limit == args.amount_to_debit,
                    MandateError::InvalidAmountForFixedDebit
                );
            }
            ChargeType::Variable => {
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

        // Validate authorized limit
        let new_total = validate_debit_limit(
            self.mandate.execution_state.total_executed,
            args.amount_to_debit,
            self.mandate.authorized_limit,
            self.mandate.authorized_limit == UNLIMITED_ALLOWANCE,
        )?;

        // Validate period limit if configured
        if self.mandate.policy.period_limit > 0 && self.mandate.policy.period_window > 0 {
            let period_window = self.mandate.policy.period_window as i64;
            let current_period_start = now - (now % period_window);
            if self.mandate.execution_state.last_period_timestamp < current_period_start {
                self.mandate.execution_state.period_executed = 0;
                self.mandate.execution_state.last_period_timestamp = current_period_start;
            }

            require!(
                self.mandate.execution_state.period_executed + args.amount_to_debit <= self.mandate.policy.period_limit,
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

        // Update execution state
        self.mandate.execution_state.last_execution_time = now;
        self.mandate.execution_state.total_executed = new_total;
        self.mandate.execution_state.execution_nonce = args.nonce;

        // Update period execution
        if self.mandate.policy.period_limit > 0 && self.mandate.policy.period_window > 0 {
            self.mandate.execution_state.period_executed = self.mandate.execution_state.period_executed
                .checked_add(args.amount_to_debit)
                .ok_or(MandateError::AmountOverflow)?;
        }

        // Check if mandate is complete
        if self.mandate.authorized_limit != UNLIMITED_ALLOWANCE &&
            self.mandate.execution_state.total_executed >= self.mandate.authorized_limit {
            self.mandate.status = MandateStatus::Complete;
        }

        emit!(MandateExecutedEvent {
            mandate_id: self.mandate.id,
            sender: self.mandate.sender,
            recipient: self.mandate.recipient,
            mint: self.mandate.mint,
            amount: args.amount_to_debit,
            total_executed: self.mandate.execution_state.total_executed,
            timestamp: now,
            nonce: args.nonce,
            policy_hash: self.mandate.policy.policy_hash,
        });

        Ok(())
    }
}
