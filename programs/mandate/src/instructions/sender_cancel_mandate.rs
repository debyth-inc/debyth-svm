use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::MandateError;
use crate::events::MandateCancelledEvent;
use crate::state::{Mandate, MandateStatus};

#[derive(Accounts)]
pub struct SenderCancelMandate<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    pub authority: SystemAccount<'info>,

    pub recipient: SystemAccount<'info>,

    #[account(
        mut,
        close = sender,
        seeds = [b"mandate", authority.key().as_ref(), mandate.id.to_le_bytes().as_ref()],
        bump = mandate.bump,
        constraint = mandate.authority == authority.key() @ MandateError::InvalidAuthority,
        constraint = mandate.sender == sender.key() @ MandateError::UnauthorizedSender,
        constraint = mandate.status != MandateStatus::Cancelled @ MandateError::MandateNotActive,
        constraint = mandate.status != MandateStatus::Complete @ MandateError::MandateNotActive,
    )]
    pub mandate: Account<'info, Mandate>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program,
    )]
    pub sender_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> SenderCancelMandate<'info> {
    pub fn cancel(&mut self) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        self.mandate.status = MandateStatus::Cancelled;

        emit!(MandateCancelledEvent {
            mandate_id: self.mandate.id,
            sender: self.sender.key(),
            cancelled_by: self.sender.key(),
            timestamp: now,
        });

        Ok(())
    }
}
