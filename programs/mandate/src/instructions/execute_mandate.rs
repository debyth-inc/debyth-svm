use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::state::state::{DebitType, Frequency, Mandate};

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

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ExecuteMandateArgs {
    pub amount: u64,
    pub debit_type: DebitType,
    pub frequency: Frequency,
}

impl<'info> ExecuteMandate<'info> {
    pub fn execute_withdraw(&mut self, mandate_id: u64, args: ExecuteMandateArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        // Check if the mandate is expired
        require!(self.mandate.end_date >= now, MandateError::MandateExpired);

        if args.debit_type == DebitType::Fixed {
            require!(
                self.mandate.amount == args.amount,
                MandateError::CanNotDebitThisAmount
            );
        } else if args.debit_type == DebitType::Variable {
            require!(
                self.mandate.total_debited_amount + args.amount <= self.mandate.amount,
                MandateError::CanNotDebitThisAmount
            );

            require!(
                self.mandate.amount_per_debit <= args.amount,
                MandateError::CanNotDebitThisAmount
            );
        }
        // Check if the mandate is active
        require!(self.mandate.is_active, MandateError::MandateNotActive);
        // Check if the mandate is approved
        require!(self.mandate.is_approved, MandateError::MandateNotApproved);
        // Check if the user token account is owned by the user
        require!(
            self.user_token_account.owner == self.mandate.user,
            MandateError::InvalidTokenAccount
        );
        // Check if the user token account mint is the same as the mandate mint
        require!(
            self.user_token_account.mint == self.mint.key(),
            MandateError::InvalidMint
        );

        let cpi_program = self.token_program.to_account_info();
        let seeds: &[&[u8]] = &[
            b"mandate",
            self.authority.key.as_ref(),
            &mandate_id.to_le_bytes(),
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
                    authority: self.mandate.to_account_info(), // using the PDA account info
                },
                signer,
            ),
            args.amount,
            self.mint.decimals,
        )?;

        self.mandate.total_debited_amount += args.amount;
        self.mandate.last_debit = now;
        self.mandate.last_debit_amount = args.amount;

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
    #[msg("Not ready for debit")]
    NotReadyForDebit,
    #[msg("Invalid amount for fixed debit")]
    InvalidAmountForFixedDebit,
    #[msg("Invalid amount for variable debit")]
    InvalidAmountForVariableDebit,
    #[msg("Can not debit this amount")]
    CanNotDebitThisAmount,
}
