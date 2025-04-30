use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TransferChecked, TokenInterface, transfer_checked};

use crate::state::state::Mandate;

#[derive(Accounts)]
#[instruction(mandate_id: u64)]
pub struct ExecuteMandate<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"mandate", authority.key().as_ref(), mandate_id.to_le_bytes().as_ref()],
        bump = mandate.bump,
        constraint = mandate.authority == authority.key() @ MandateError::InvalidAuthority,
        constraint = mandate.is_active @ MandateError::MandateNotActive,
        constraint = mandate.is_approved @ MandateError::MandateNotApproved,
    )]
    pub mandate: Account<'info, Mandate>,

    #[account(
        mint::token_program = token_program,
        constraint = mint.key() == mandate.mint @ MandateError::InvalidMint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = mandate.user,
        associated_token::token_program = token_program,
        constraint = user_token_account.key() == mandate.user_token_account @ MandateError::InvalidTokenAccount,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut, 
        associated_token::mint = mint,
        associated_token::authority = mandate.authority,
        associated_token::token_program = token_program,
        constraint = destination_token_account.key() == mandate.destination_token_account @ MandateError::InvalidTokenAccount,
    )]
    pub destination_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

impl<'info> ExecuteMandate<'info> { 
    pub fn execute_withdraw(&mut self) -> Result<()> {
        // Check if the mandate is expired
        require!(
            self.mandate.end_date >= Clock::get()?.unix_timestamp,
            MandateError::MandateExpired
        );

        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = TransferChecked {
            from: self.user_token_account.to_account_info(),
            to: self.destination_token_account.to_account_info(),
            mint: self.mint.to_account_info(),
            authority: self.authority.to_account_info(),
        };

        transfer_checked(
            CpiContext::new(
                cpi_program,
                cpi_accounts,
            ),
            self.mandate.amount,
            self.mint.decimals,
        )?;

        Ok(())
    }
}

#[error_code]
pub enum MandateError {
    #[msg("Mandate is not active")]
    MandateNotActive,
    #[msg("Mandate is not approved")]
    MandateNotApproved,
    #[msg("Mandate has expired")]
    MandateExpired,
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("Invalid mint account")]
    InvalidMint,
    #[msg("Invalid token account")]
    InvalidTokenAccount,
}
