use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{approve, Approve, Mint, TokenAccount, TokenInterface},
};

use crate::state::state::Mandate;

#[derive(Accounts)]
#[instruction(mandate_id: u64)]
pub struct ApproveMandate<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"mandate", mandate.authority.as_ref(), mandate_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub mandate: Account<'info, Mandate>,

    #[account(
         mint::token_program = token_program
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
    associated_token::mint = mint,
    associated_token::authority = user,
    associated_token::token_program = token_program,
    )]
    // The token account of the user that will be will approve the mandate and be debited.
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
    associated_token::mint = mint,
    associated_token::authority = mandate.authority,
    associated_token::token_program = token_program,
    )]
    // Coindebit is the authority of the mandate so we get the token account of the authority
    pub authority_token_account: InterfaceAccount<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

impl<'info> ApproveMandate<'info> {
    pub fn approve(&mut self) -> Result<()> {
        // Check if the mandate is already approved
        if self.mandate.is_active || self.mandate.is_approved {
            return Err(ProgramError::Custom(0x1).into());
        }
        // Check if the mandate is expired
        if self.mandate.end_date < Clock::get()?.unix_timestamp {
            return Err(ProgramError::Custom(0x3).into());
        }

        let cpi_program = self.token_program.to_account_info();

        let cpi_accounts = Approve {
            to: self.user_token_account.to_account_info(),
            authority: self.user.to_account_info(),
            delegate: self.mandate.to_account_info(),
        };

        approve(
            CpiContext::new(cpi_program, cpi_accounts),
            self.mandate.amount,
        )?;

        self.mandate.is_approved = true;
        self.mandate.user = self.user.key();
        self.mandate.user_token_account = self.user_token_account.key();
        self.mandate.destination_token_account = self.authority_token_account.key();
        self.mandate.is_active = true;
        self.mandate.created_at = Clock::get()?.unix_timestamp;

        Ok(())
    }
}
