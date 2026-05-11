use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{approve, Approve, Mint, Token, TokenAccount},
};

use crate::errors::MandateError;
use crate::events::MandateApprovedEvent;
use crate::state::{Mandate, MandateStatus, UNLIMITED_ALLOWANCE};

#[derive(Accounts)]
#[instruction(mandate_id: u64)]
pub struct ApproveMandate<'info> {
    /// The sender who approved the mandate - this account pays for the mandate creation/approval
    #[account(mut)]
    pub sender: Signer<'info>,

    /// The recipient for this mandate
    pub recipient: SystemAccount<'info>,

    /// The new mandate account to be created
    #[account(
        mut,
        seeds = [b"mandate", mandate.authority.key().as_ref(), mandate_id.to_le_bytes().as_ref()],
        bump = mandate.bump,
    )]
    pub mandate: Account<'info, Mandate>,

    /// The token mint for the mandate
    pub mint: Account<'info, Mint>,

    /// The sender's token account that will be debited
    #[account(
        init_if_needed,
        payer = sender,
        associated_token::mint = mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program,
        constraint = sender_token_account.owner == sender.key()
    )]
    pub sender_token_account: Account<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> ApproveMandate<'info> {
    pub fn approve(&mut self) -> Result<()> {
        // Validate that the sender actually matches the mandate sender
        require!(
            self.sender.key() == self.mandate.sender,
            MandateError::UnauthorizedSender
        );

        // Validate recipient matches mandate recipient
        require!(
            self.recipient.key() == self.mandate.recipient,
            MandateError::InvalidRecipient
        );

        // Validate mandate state
        require!(!self.mandate.is_approved, MandateError::AlreadyApproved);
        require!(self.mandate.status == MandateStatus::Pending, MandateError::MandateNotPending);

        // Validate token account
        require!(
            self.sender_token_account.owner == self.sender.key(),
            MandateError::InvalidTokenAccount
        );
        require!(
            self.sender_token_account.mint == self.mint.key(),
            MandateError::InvalidMint
        );
        require!(
            self.sender_token_account.delegate.is_none(),
            MandateError::TokenAlreadyDelegated
        );

        // SECURITY FIX 1: Update the state BEFORE external call
        self.mandate.is_approved = true;
        self.mandate.status = MandateStatus::Active;
        self.mandate.last_period_timestamp = Clock::get()?.unix_timestamp;

        // Approve token delegation
        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = Approve {
            to: self.sender_token_account.to_account_info(),
            authority: self.sender.to_account_info(),
            delegate: self.mandate.to_account_info(),
        };

        let amount = if self.mandate.policy.lifetime_limit == UNLIMITED_ALLOWANCE {
            UNLIMITED_ALLOWANCE
        } else {
            self.mandate.policy.lifetime_limit
        };
        approve(CpiContext::new(cpi_program, cpi_accounts), amount)?;

        // Emit approval event for monitoring
        emit!(MandateApprovedEvent {
            mandate_id: self.mandate.id,
            sender: self.mandate.sender,
            recipient: self.mandate.recipient,
            mint: self.mandate.mint,
            total_limit: self.mandate.policy.lifetime_limit,
            per_execution_limit: self.mandate.policy.per_execution_limit,
            policy_hash: self.mandate.policy_hash,
            created_at: self.mandate.created_at,
        });

        Ok(())
    }
}
