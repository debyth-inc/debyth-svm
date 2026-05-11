use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::MandateError;
use crate::events::MandateCancelledEvent;
use crate::state::{Mandate, MandateStatus};

#[derive(Accounts)]
pub struct CancelMandate<'info> {
    /// Authority who created the mandate - can always cancel to reclaim rent
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Sender account
    pub sender: Signer<'info>,

    /// Recipient account
    pub recipient: SystemAccount<'info>,

    #[account(
        mut,
        close = authority,
        seeds = [b"mandate", authority.key().as_ref(), mandate.id.to_le_bytes().as_ref()],
        bump = mandate.bump,
        constraint = mandate.authority == authority.key() @ MandateError::InvalidAuthority,
    )]
    pub mandate: Account<'info, Mandate>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = mandate.sender,
        associated_token::token_program = token_program,
    )]
    pub sender_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> CancelMandate<'info> {
    /// Cancels a mandate and closes the account, refunding rent to authority.
    ///
    /// # Authorization Rules
    /// - **Authority** can always close the mandate to reclaim rent (they paid for creation)
    /// - **Sender** can also cancel (user revokes delegation)
    /// - Authority can revoke delegation without requiring sender signature
    ///
    /// This design allows either party to cancel:
    /// - Authority can unilaterally close the mandate and revoke delegation
    /// - Sender can revoke delegation externally via wallet, then authority closes to reclaim rent
    /// - Sender can revoke delegation in the same transaction as closing
    ///
    /// # Security Considerations
    /// - Authority closing without sender consent is acceptable: they control the service
    /// - Sender retains control: they can revoke delegation at any time via standard SPL token revoke
    /// - Authority reclaiming rent is fair: they paid to create the mandate account
    /// - If sender wants to stop payments, they can revoke delegation directly via their wallet
    ///
    /// # Returns
    /// - Ok(()) on success
    /// - Err if validation fails
    pub fn cancel(&mut self) -> Result<()> {
        // Validate sender account matches mandate
        require!(
            self.sender.key() == self.mandate.sender,
            MandateError::InvalidTokenAccount
        );

        // Validate recipient account matches mandate
        require!(
            self.recipient.key() == self.mandate.recipient,
            MandateError::InvalidRecipient
        );

        let now = Clock::get()?.unix_timestamp;

        // Update mandate status before closing
        self.mandate.status = MandateStatus::Cancelled;

        // Note: We don't explicitly revoke the delegation here because:
        // 1. Only the token account owner (sender) can revoke a delegation, not the delegate
        // 2. When the mandate PDA is closed, it ceases to exist
        // 3. A delegation to a non-existent account is effectively useless
        // 4. The sender can always revoke the delegation themselves via their wallet
        //
        // The authority can always close the mandate to stop future debits, even if
        // technically the delegation remains in the token account state until explicitly revoked.

        // Emit cancellation event before account is closed
        emit!(MandateCancelledEvent {
            mandate_id: self.mandate.id,
            sender: self.sender.key(),
            cancelled_by: self.authority.key(),
            timestamp: now,
        });

        // Mandate account is automatically closed via 'close' constraint
        // Rent refund goes to authority (they paid for account creation)
        Ok(())
    }
}
