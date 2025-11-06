use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::errors::MandateError;
use crate::events::MandateExecutedEvent;
use crate::state::{DebitType, Mandate, MIN_DEBIT_AMOUNT};

#[derive(Accounts)]
pub struct ExecuteMandate<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"mandate", authority.key().as_ref(), mandate.id.to_le_bytes().as_ref()],
        bump = mandate.bump,
        constraint = mandate.authority == authority.key() @ MandateError::InvalidAuthority,
        constraint = mandate.is_active @ MandateError::MandateNotActive,
        constraint = mandate.is_approved @ MandateError::MandateNotApproved,
    )]
    pub mandate: Account<'info, Mandate>,

    #[account(
        constraint = mint.key() == mandate.mint @ MandateError::InvalidMint,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = mandate.user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = mandate.authority,
        associated_token::token_program = token_program,
    )]
    pub destination_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ExecuteMandateArgs {
    pub amount_to_debit: u64,
}

impl<'info> ExecuteMandate<'info> {
    pub fn execute(&mut self, args: ExecuteMandateArgs) -> Result<()> {
        // Basic mandate validation
        require!(self.mandate.is_active, MandateError::MandateNotActive);
        require!(self.mandate.is_approved, MandateError::MandateNotApproved);

        // Check debit frequency (skip check for first execution when last_debit_date is 0)
        let now = Clock::get()?.unix_timestamp;
        if self.mandate.last_debit_date != 0 {
            // SECURITY: Use checked arithmetic to prevent overflow
            let time_threshold = self
                .mandate
                .last_debit_date
                .checked_add(self.mandate.debit_frequency_seconds as i64)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            require!(
                time_threshold <= now,
                MandateError::InsufficientTimeSinceLastDebit
            );
        }

        // SECURITY FIX 3: Use checked arithmetic for limit check EARLY
        let new_total = self
            .mandate
            .total_debited_amount
            .checked_add(args.amount_to_debit)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        require!(
            new_total <= self.mandate.limit,
            MandateError::DebitLimitExceeded
        );

        // Amount validation based on debit type
        match self.mandate.debit_type {
            DebitType::Fixed => {
                require!(
                    self.mandate.amount_per_debit == args.amount_to_debit,
                    MandateError::InvalidAmountForFixedDebit
                );
            }
            DebitType::Variable => {
                // Prevent dust spam attacks by enforcing minimum debit amount
                require!(
                    args.amount_to_debit >= MIN_DEBIT_AMOUNT,
                    MandateError::DebitAmountTooSmall
                );
                require!(
                    args.amount_to_debit <= self.mandate.amount_per_debit,
                    MandateError::InvalidAmountForVariableDebit
                );
            }
        }

        // SECURITY FIX 5: Check if the user has sufficient balance
        require!(
            self.user_token_account.amount >= args.amount_to_debit,
            MandateError::InsufficientBalance
        );

        // SECURITY FIX 2: Validate that the delegate is still active
        require!(
            self.user_token_account.delegate == Some(self.mandate.key()).into(),
            MandateError::InvalidDelegate
        );

        // Token account validation
        require!(
            self.user_token_account.owner == self.mandate.user,
            MandateError::InvalidTokenAccount
        );
        require!(
            self.user_token_account.mint == self.mint.key(),
            MandateError::InvalidMint
        );

        // Execute the transfer
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
                    from: self.user_token_account.to_account_info(),
                    to: self.destination_token_account.to_account_info(),
                    mint: self.mint.to_account_info(),
                    authority: self.mandate.to_account_info(),
                },
                signer,
            ),
            args.amount_to_debit,
            self.mint.decimals,
        )?;

        // Update last execution and total debited amount (using the checked value)
        self.mandate.updated_at = now;
        self.mandate.last_debit_date = now;
        self.mandate.total_debited_amount = new_total; // Safe assignment

        emit!(MandateExecutedEvent {
            mandate_id: self.mandate.id,
            authority: self.authority.key(),
            user: self.mandate.user,
            amount_per_debit: self.mandate.amount_per_debit,
            amount_debited: args.amount_to_debit, // Actual amount transferred
            total_debited_amount: self.mandate.total_debited_amount,
            timestamp: now,
        });

        Ok(())
    }
}
