use anchor_lang::prelude::*;

use crate::state::state::{DebitType, Frequency, Mandate};

#[derive(Accounts)]
#[instruction(mandate_id: u64)]
pub struct CreateMandate<'info> {
    // Coindebit is the authority of the mandate
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Mandate::INIT_SPACE,
        seeds = [b"mandate", authority.key().as_ref(), mandate_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub mandate: Account<'info, Mandate>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateMandateArgs {
    pub amount: u64,
    pub frequency: Frequency,
    pub start_date: i64,
    pub end_date: i64,
    pub mint: Pubkey,
    pub debit_type: DebitType,
}

impl<'info> CreateMandate<'info> {
    pub fn create(
        &mut self,
        mandate_id: u64,
        args: CreateMandateArgs,
        bumps: &CreateMandateBumps,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        self.mandate.set_inner(Mandate {
            id: mandate_id,
            authority: self.authority.key(),
            user: Pubkey::default(),
            created_at: now,
            debit_type: args.debit_type,
            amount: args.amount,
            is_approved: false,
            approved_at: 0,
            start_date: args.start_date,
            end_date: args.end_date,
            is_active: false,
            cancelled_at: 0,
            mint: args.mint,
            user_token_account: Pubkey::default(),
            destination_token_account: Pubkey::default(),
            frequency: args.frequency,
            bump: bumps.mandate,
        });
        Ok(())
    }
}
