use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::state::{DebitType, Mandate};
use crate::events::MandateCreatedEvent;

#[derive(Accounts)]
#[instruction(mandate_id: u64)]
pub struct CreateMandate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub user: SystemAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Mandate::INIT_SPACE,
        seeds = [b"mandate", mandate_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub mandate: Box<Account<'info, Mandate>>,

    pub mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = authority,
        associated_token::token_program = token_program,
    )]
    pub authority_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateMandateArgs {
    pub amount_per_debit: u64,
    pub limit: u64,
    pub is_unlimited_spend: bool,
    pub debit_type: DebitType,
}

impl<'info> CreateMandate<'info> {
    pub fn create(
        &mut self,
        mandate_id: u64,
        args: CreateMandateArgs,
        bumps: &CreateMandateBumps,
    ) -> Result<()> {
        
        // Validate inputs
        require!(args.amount_per_debit > 0, MandateError::InvalidAmount);
        if !args.is_unlimited_spend {
            require!(args.limit >= args.amount_per_debit, MandateError::InvalidSpendCap);
        }
        
        require!(
            self.user_token_account.mint == self.mint.key(),
            MandateError::InvalidMint
        );
        require!(
            self.user_token_account.delegate.is_none(),
            MandateError::TokenAlreadyDelegated
        );
        

        let actual_limit = if args.is_unlimited_spend {
            u64::MAX
        } else {
            args.limit
        };

        // Initialize the mandate
        self.mandate.set_inner(Mandate {
            id: mandate_id,
            authority: self.authority.key(),
            user: self.user.key(),
            bump: bumps.mandate,
            mint: self.mint.key(),
            amount_per_debit: args.amount_per_debit,
            limit: actual_limit,
            total_debited_amount: 0,
            debit_type: args.debit_type,
            is_unlimited_spend: args.is_unlimited_spend,
            is_approved: false,
            is_active: false,
            last_debit_date: 0,
            created_at: Clock::get()?.unix_timestamp,
            updated_at: Clock::get()?.unix_timestamp,
        });

        emit!(MandateCreatedEvent {
            mandate_id: mandate_id,
            user: self.user.key(),
            mint: self.mint.key(),
            is_approved: false,
            is_active: false,
            created_at: Clock::get()?.unix_timestamp,
            amount_per_debit: args.amount_per_debit,
            limit: actual_limit,
            is_unlimited_spend: args.is_unlimited_spend,
            debit_type: args.debit_type,
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
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid spend cap")]
    InvalidSpendCap,
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Token account is already delegated")]
    TokenAlreadyDelegated,
}
