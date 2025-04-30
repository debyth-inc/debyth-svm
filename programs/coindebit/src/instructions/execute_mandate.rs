use anchor_lang::prelude::*;
use anchor_spl:: token_interface::{Mint, TokenAccount, TransferChecked, TokenInterface, transfer_checked} ;

use crate::state::state::Mandate;

#[derive(Accounts)]
#[instruction(mandate_id: u64)]
pub struct ExecuteMandate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"mandate", authority.key().as_ref(), mandate_id.to_le_bytes().as_ref()],
        bump,
        // constraint = mandate.owner == user.key() @ MandateError::InvalidOwner,
    )]
    pub mandate: Account<'info, Mandate>,

    #[account(
         mint::token_program = token_program
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
    associated_token::mint = mint,
    associated_token::authority = authority,    
    associated_token::token_program = token_program,
    )]

    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut, 
        associated_token::mint = mint,
    associated_token::authority = authority,    
    associated_token::token_program = token_program
)]
    pub destination_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: InterfaceAccount<'info, TokenAccount>,
}

impl<'info> ExecuteMandate<'info> { 
    pub fn execute_withdraw(&mut self) -> Result<()> {
        // Check if the mandate is already approved
        if self.mandate.is_active || self.mandate.is_approved {
            return Err(ProgramError::Custom(0x1).into());
        }
        // Check if the mandate is expired
        if self.mandate.end_date < Clock::get()?.unix_timestamp {
            return Err(ProgramError::Custom(0x3).into());
        }

        let cpi_program = self.token_program.to_account_info();

        let cpi_accounts = TransferChecked {
            from: self.user_token_account.to_account_info(),
            to: self.destination_token_account.to_account_info(),
            mint: self.mint.to_account_info(),
            authority: self.mandate.to_account_info(),
        };

        let authority_key = self.authority.key();
        let mandate_id_bytes = self.mandate.id.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"mandate",
            authority_key.as_ref(),
            mandate_id_bytes.as_ref(),
        ]];


        transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            self.mandate.amount,
            6,
        )?;
        Ok(())
    }
    
}
