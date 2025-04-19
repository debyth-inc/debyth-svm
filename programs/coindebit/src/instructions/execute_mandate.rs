use anchor_lang::prelude::*;
use anchor_spl:: token_interface::{Mint, TokenAccount} ;

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
