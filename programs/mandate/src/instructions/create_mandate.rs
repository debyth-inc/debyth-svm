use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::state::state::{DebitType, Mandate};

#[derive(Accounts)]
#[instruction(mandate_id: u64)]
pub struct CreateMandate<'info> {
    // Move some of the larger accounts into Box to reduce stack usage
    #[account(mut)]
    pub user: Signer<'info>,

    pub authority: SystemAccount<'info>,

    #[account(
        init,
        payer = user,
        space = 8 + Mandate::INIT_SPACE,
        seeds = [b"mandate", mandate_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub mandate: Box<Account<'info, Mandate>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = authority,
        associated_token::token_program = token_program,
    )]
    pub authority_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    // Keep these as regular references since they're smaller
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateMandateArgs {
    pub amount: u64,
    pub debit_type: DebitType,
}

impl<'info> CreateMandate<'info> {
    pub fn create(
        &mut self,
        mandate_id: u64,
        args: CreateMandateArgs,
        bumps: &CreateMandateBumps,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        // Validate inputs
        require!(args.amount > 0, MandateError::InvalidAmount);
        require!(
            self.user_token_account.owner == self.user.key(),
            MandateError::InvalidTokenAccount
        );
        require!(
            self.user_token_account.mint == self.mint.key(),
            MandateError::InvalidMint
        );
        require!(
            self.user_token_account.delegate.is_none(),
            MandateError::TokenAlreadyDelegated
        );

        // Initialize the mandate
        self.mandate.set_inner(Mandate {
            id: mandate_id,
            authority: self.authority.key(),
            user: self.user.key(),
            bump: bumps.mandate,
            mint: self.mint.key(),
            amount: args.amount,
            debit_type: args.debit_type,
            is_approved: false,
            is_active: false,
            last_execution: now,
        });

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
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Token account is already delegated")]
    TokenAlreadyDelegated,
}
