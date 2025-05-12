use anchor_lang::prelude::*;

#[account]
pub struct Mandate {
    // Essential on-chain data
    pub id: u64,               // Required for PDA
    pub authority: Pubkey,     // Required for validation
    pub user: Pubkey,          // Required for validation
    pub bump: u8,              // Required for PDA
    pub mint: Pubkey,          // Required for token operations
    pub amount: u64,           // Required for debit cap
    pub debit_type: DebitType, // Required for validation
    pub is_approved: bool,     // Required state
    pub is_active: bool,       // Required state
    pub last_execution: i64,   // Required for frequency validation
}

impl Mandate {
    pub const INIT_SPACE: usize = 8 +        // discriminator
        8 +                                   // id
        32 +                                  // authority
        32 +                                  // user
        1 +                                   // bump
        32 +                                  // mint
        8 +                                   // amount
        1 +                                   // debit_type
        1 +                                   // is_approved
        1 +                                   // is_active
        8; // last_execution
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, InitSpace)]
pub enum DebitType {
    Fixed = 0,
    Variable = 1,
}
