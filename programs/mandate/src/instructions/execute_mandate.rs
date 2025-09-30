use anchor_lang::prelude::*;
use anchor_spl::token::{
    transfer_checked, Mint, Token, TokenAccount, TransferChecked,
};

use crate::state::{DebitType, Mandate};
use crate::events::MandateExecutedEvent;
use crate::errors::MandateError;

#[derive(Accounts)]
pub struct ExecuteMandate<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"mandate", mandate.id.to_le_bytes().as_ref()],
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

        // Check debit frequency
        let now = Clock::get()?.unix_timestamp;
        require!(
            self.mandate.last_debit_date + self.mandate.debit_frequency_seconds as i64 <= now,
            MandateError::InsufficientTimeSinceLastDebit
        );

        // Amount validation based on debit type
        match self.mandate.debit_type {
            DebitType::Fixed => {
                require!(
                    self.mandate.amount_per_debit == args.amount_to_debit,
                    MandateError::InvalidAmountForFixedDebit
                );
            },
            DebitType::Variable => {
                require!(
                    args.amount_to_debit > 0,
                    MandateError::InvalidAmountForVariableDebit
                );
                require!(
                    args.amount_to_debit <= self.mandate.amount_per_debit,
                    MandateError::InvalidAmountForVariableDebit
                );
            }
        }
        // Check if debit exceeds total limit
        require!(
            self.mandate.total_debited_amount + args.amount_to_debit <= self.mandate.limit,
            MandateError::DebitLimitExceeded
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

        // Update last execution and total debited amount
        self.mandate.updated_at = now;
        self.mandate.last_debit_date = now;
        self.mandate.total_debited_amount = self.mandate.total_debited_amount.checked_add(args.amount_to_debit).ok_or(ProgramError::ArithmeticOverflow)?;

        emit!(MandateExecutedEvent {
            mandate_id: self.mandate.id,
            authority: self.authority.key(),
            user: self.mandate.user,
            amount_per_debit: self.mandate.amount_per_debit,
            total_debited_amount: self.mandate.total_debited_amount,
            timestamp: now,
        });

        Ok(())
    }
}
