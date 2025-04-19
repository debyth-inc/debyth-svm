use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Approve, Mint, TokenAccount, TokenInterface},
};

use crate::state::state::Mandate;

#[derive(Accounts)]
#[instruction(mandate_id: u64)]
pub struct CancelMandate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        close = authority,
        seeds = [b"mandate", authority.key().as_ref(), mandate_id.to_le_bytes().as_ref()],
        bump  = mandate.bump,
    )]
    pub mandate: Account<'info, Mandate>,

    #[account(
         mint::token_program = token_program
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
