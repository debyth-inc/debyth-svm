use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{approve, Approve, Mint, TokenAccount, TokenInterface},
};

use crate::state::state::{DebitType, Frequency, Mandate};

#[derive(Accounts)]
#[instruction(mandate_id: u64)]
pub struct CreateAndApproveMandate<'info> {
    /// The user creating and approving the mandate
    #[account(mut)]
    pub user: Signer<'info>,

    pub authority: SystemAccount<'info>,

    /// The new mandate account to be created
    #[account(
        init,
        payer = user,
        space = 8 + Mandate::INIT_SPACE,
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
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    /// The authority's token account that will receive the debits
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = mandate.authority,
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
    pub mint: Pubkey,
    pub debit_type: DebitType,
}

impl<'info> CreateAndApproveMandate<'info> {
    pub fn create(
        &mut self,
        mandate_id: u64,
        args: CreateMandateArgs,
        bumps: &CreateAndApproveMandateBumps,
    ) -> Result<()> {
        // Validate input parameters
        let now = Clock::get()?.unix_timestamp;
        require!(args.amount > 0, MandateError::InvalidAmount);
        require!(
            args.start_date >= now && args.end_date > args.start_date,
            MandateError::InvalidDates
        );

        self.mandate.set_inner(Mandate {
            id: mandate_id,
            authority: self.authority.key(), // coindebit is the authority, we set it later
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
            mint: args.mint, // the mint can be USDT, USDC, etc.
            user_token_account: Pubkey::default(),
            destination_token_account: Pubkey::default(), // the destination token account is the authority token account, we set it later
            frequency: args.frequency,
            bump: bumps.mandate,
        });
        Ok(())
    }

    pub fn approve(&mut self) -> Result<()> {
        // Validate mandate state
        require!(
            !self.mandate.is_active && !self.mandate.is_approved,
            MandateError::AlreadyApproved
        );
        require!(
            self.mandate.end_date >= Clock::get()?.unix_timestamp,
            MandateError::Expired
        );

        // Approve token delegation
        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = Approve {
            to: self.user_token_account.to_account_info(),
            authority: self.user.to_account_info(),
            delegate: self.authority.to_account_info(),
        };
        approve(
            CpiContext::new(cpi_program, cpi_accounts),
            self.mandate.amount,
        )?;

        // Update mandate state
        self.mandate.is_approved = true;
        self.mandate.user = self.user.key();
        self.mandate.user_token_account = self.user_token_account.key();
        self.mandate.destination_token_account = self.authority_token_account.key();
        self.mandate.is_active = true;
        self.mandate.approved_at = Clock::get()?.unix_timestamp;

        Ok(())
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
}
