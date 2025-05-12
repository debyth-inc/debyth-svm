use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::state::state::{DebitType, Mandate};

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
        mint::token_program = token_program,
        constraint = mint.key() == mandate.mint @ MandateError::InvalidMint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = mandate.user,
        associated_token::token_program = token_program,
        // constraint = user_token_account.key() == mandate.user_token_account @ MandateError::InvalidTokenAccount,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut, 
        associated_token::mint = mint,
        associated_token::authority = mandate.authority,
        associated_token::token_program = token_program,
        // constraint = destination_token_account.key() == mandate.destination_token_account @ MandateError::InvalidTokenAccount,
    )]
    pub destination_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ExecuteMandateArgs {
    pub amount: u64,
}

impl<'info> ExecuteMandate<'info> {
    pub fn execute(&mut self, args: ExecuteMandateArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        
        // Basic mandate validation
        require!(self.mandate.is_active, MandateError::MandateNotActive);
        require!(self.mandate.is_approved, MandateError::MandateNotApproved);

        // Amount validation based on debit type
        match self.mandate.debit_type {
            DebitType::Fixed => {
                require!(
                    self.mandate.amount == args.amount,
                    MandateError::InvalidAmountForFixedDebit
                );
            },
            DebitType::Variable => {
                require!(
                    args.amount <= self.mandate.amount,
                    MandateError::InvalidAmountForVariableDebit
                );
            }
        }

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
            args.amount,
            self.mint.decimals,
        )?;

        // Update last execution
        self.mandate.last_execution = now;

        Ok(())
    }

}

#[error_code]
pub enum MandateError {
    #[msg("Mandate is not active")]
    MandateNotActive,
    #[msg("Mandate is not approved")]
    MandateNotApproved,
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("Invalid mint account")]
    InvalidMint,
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    #[msg("Invalid amount for fixed debit")]
    InvalidAmountForFixedDebit,
    #[msg("Invalid amount for variable debit")]
    InvalidAmountForVariableDebit,
}
