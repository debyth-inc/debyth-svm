use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Mandate {
    // Core fields
    pub id: u64,
    pub authority: Pubkey,
    pub user: Pubkey,
    pub bump: u8,

    // Token related fields
    pub mint: Pubkey,
    pub user_token_account: Pubkey,
    pub destination_token_account: Pubkey,

    // Configuration
    pub amount: u64,
    pub amount_per_debit: u64,
    pub frequency: Frequency,
    pub debit_type: DebitType,

    // Time-related fields
    pub created_at: i64,
    pub start_date: i64,
    pub end_date: i64,

    // Status fields
    pub is_approved: bool,
    pub is_active: bool,
    pub approved_at: i64,
    pub cancelled_at: i64,

    // Debit tracking
    pub last_debit: i64,
    pub last_debit_amount: u64,
    pub total_debited_amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub enum Frequency {
    Daily = 0,
    Weekly = 1,
    Monthly = 2,
    Annually = 3,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, InitSpace)]
pub enum DebitType {
    Fixed = 0,
    Variable = 1,
}
