use anchor_lang::prelude::*;

#[account]
pub struct Mandate {
    // Essential on-chain data
    pub id: u64,               // Required for PDA
    pub authority: Pubkey,     // Required for validation
    pub user: Pubkey,          // Required for validation
    pub bump: u8,              // Required for PDA
    pub mint: Pubkey,          // Required for token operations
    pub amount_per_debit: u64, // Required for debit cap
    pub limit: u64,            // Total amount that can ever be debited
    pub total_debited_amount: u64, // Cumulative amount debited so far
    pub is_unlimited_spend: bool, // Required for validation
    pub debit_type: DebitType, // Required for validation
    pub is_approved: bool,     // Required state
    pub is_active: bool,       // Required state
    pub last_debit_date: i64,   // Required for frequency validation
    pub created_at: i64,       
    pub updated_at: i64,       

}

impl Mandate {
    pub const INIT_SPACE: usize = 8 +        // discriminator
        8 +                                   // id
        32 +                                  // authority
        32 +                                  // user
        1 +                                   // bump
        32 +                                  // mint
        8 +                                   // amount_per_debit
        8 +                                   // limit
        8 +                                   // total_debited_amount
        1 +                                   // is_unlimited_spend
        1 +                                   // debit_type
        1 +                                   // is_approved
        1 +                                   // is_active
        8 +                                   // last_debit_date
        8 +                                   // created_at
        8; // updated_at
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, InitSpace)]
pub enum DebitType {
    Fixed = 0,
    Variable = 1,
}
