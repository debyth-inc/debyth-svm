use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{approve, Approve, Mint, TokenAccount, TokenInterface},
};

use crate::state::state::{DebitType, Frequency, Mandate};

#[derive(Accounts)]
#[instruction(mandate_id: u64)]
pub struct CreateAndApproveMandate<'info> {
    /// The user creating and approving the mandate - this account pays for the mandate creation/approval
    #[account(mut)]
    pub user: Signer<'info>,

    // Authority is solely used for mandate validation and signing the delegate CPI.
    // It is NOT marked as payer so that the user covers the fees.
    pub authority: SystemAccount<'info>,

    /// The new mandate account to be created
    #[account(
        init,
        payer = user,
        space = 8 + Mandate::INIT_SPACE,
        // Endianness: mandate_id is converted to little-endian bytes as required by PDA derivation.
        // If a different endianness is required, consider using to_be_bytes().
        seeds = [b"mandate", authority.key().as_ref(), mandate_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub mandate: Account<'info, Mandate>,

    /// The token mint for the mandate
    #[account(
        mint::token_program = token_program
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// The user's token account that will be debited
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    /// The authority's token account that will receive the debits
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = authority,
        associated_token::token_program = token_program,
    )]
    pub authority_token_account: InterfaceAccount<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateMandateArgs {
    pub amount: u64,
    pub frequency: Frequency,
    pub start_date: i64,
    pub end_date: i64,
    pub debit_type: DebitType,
    pub amount_per_debit: u64,
}

impl<'info> CreateAndApproveMandate<'info> {
    pub fn create(
        &mut self,
        mandate_id: u64,
        args: CreateMandateArgs,
        bumps: &CreateAndApproveMandateBumps,
    ) -> Result<()> {
        // Fetch timestamp once
        let now = Clock::get()?.unix_timestamp;
        require!(args.amount > 0, MandateError::InvalidAmount);
        require!(
            args.start_date >= now && args.end_date > args.start_date,
            MandateError::InvalidDates
        );
        // Verify that the user token account is properly configured
        require!(
            self.user_token_account.owner == self.user.key(),
            MandateError::InvalidTokenAccount
        );
        require!(
            self.user_token_account.mint == self.mint.key(),
            MandateError::InvalidMint
        );
        // Prevent overriding existing delegation (if any)
        require!(
            self.user_token_account.delegate.is_none(),
            MandateError::TokenAlreadyDelegated
        );

        self.mandate.set_inner(Mandate {
            id: mandate_id,
            authority: self.authority.key(), // authority remains a SystemAccount, used only for validation and CPI signing
            user: self.user.key(),
            created_at: now,
            debit_type: args.debit_type,
            amount: args.amount,
            is_approved: false,
            approved_at: 0,
            start_date: args.start_date,
            end_date: args.end_date,
            is_active: false,
            cancelled_at: 0,
            mint: self.mint.key(), // the mint can be USDT, USDC, etc.
            user_token_account: self.user_token_account.key(),
            destination_token_account: self.authority_token_account.key(), // destination token account is the authority's AT
            frequency: args.frequency,
            last_debit: 0,
            last_debit_amount: 0,
            total_debited_amount: 0,
            amount_per_debit: args.amount_per_debit,
            bump: bumps.mandate,
        });
        Ok(())
    }

    pub fn approve(&mut self) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        // Validate mandate state
        require!(
            !self.mandate.is_active && !self.mandate.is_approved,
            MandateError::AlreadyApproved
        );
        require!(self.mandate.end_date >= now, MandateError::Expired);
        require!(
            self.user_token_account.owner == self.user.key(),
            MandateError::InvalidTokenAccount
        );
        require!(
            self.user_token_account.mint == self.mint.key(),
            MandateError::InvalidMint
        );
        // Ensure no existing delegation is set (so that we can safely approve)
        require!(
            self.user_token_account.delegate.is_none(),
            MandateError::TokenAlreadyDelegated
        );

        // Approve token delegation: user delegates their tokens to the mandate PDA.
        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = Approve {
            to: self.user_token_account.to_account_info(),
            authority: self.user.to_account_info(),
            delegate: self.mandate.to_account_info(), // use the PDA as delegate
        };
        let amount = amountIfFixed(
            self.mandate.amount,
            self.mandate.debit_type,
            self.mandate.frequency,
            self.mandate.start_date,
            self.mandate.end_date,
        )?;
        approve(CpiContext::new(cpi_program, cpi_accounts), amount)?;

        // Update mandate state to reflect approval and activation
        self.mandate.is_approved = true;
        self.mandate.is_active = true;
        self.mandate.approved_at = now;

        Ok(())
    }
}

/// Calculates the total amount to be debited based on the debit type and frequency. For example, if the amount is $10 and the end_date is 3 years from now and it's a fixed debit with monthly frequency, then the amount is 10 * 12 * 3 = 360
fn amountIfFixed(
    amount: u64,
    debit_type: DebitType,
    frequency: Frequency,
    start_date: i64,
    end_date: i64,
) -> Result<u64> {
    if debit_type == DebitType::Fixed {
        let duration = end_date
            .checked_sub(start_date)
            .ok_or(MandateError::InvalidDates)?;
        let cycles = match frequency {
            Frequency::Monthly => {
                // Approximate a month as 30 days
                let seconds_per_month = 30 * 86400;
                let months = duration / seconds_per_month;
                if duration % seconds_per_month > 0 {
                    months + 1
                } else {
                    months
                }
            }
            Frequency::Weekly => {
                let seconds_per_week = 7 * 86400;
                let weeks = duration / seconds_per_week;
                if duration % seconds_per_week > 0 {
                    weeks + 1
                } else {
                    weeks
                }
            }
            Frequency::Daily => {
                let seconds_per_day = 86400;
                let days = duration / seconds_per_day;
                if duration % seconds_per_day > 0 {
                    days + 1
                } else {
                    days
                }
            }
            Frequency::Annually => {
                let seconds_per_year = 365 * 86400;
                let years = duration / seconds_per_year;
                if duration % seconds_per_year > 0 {
                    years + 1
                } else {
                    years
                }
            }
        };
        amount
            .checked_mul(cycles as u64)
            .ok_or(MandateError::InvalidAmount.into())
    } else {
        // For non-fixed debit types return the base amount;
        Ok(amount)
    }
}

#[error_code]
pub enum MandateError {
    #[msg("Mandate is already approved or active")]
    AlreadyApproved,
    #[msg("Mandate has expired")]
    Expired,
    #[msg("Invalid dates provided")]
    InvalidDates,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Token account is already delegated")]
    TokenAlreadyDelegated,
}
