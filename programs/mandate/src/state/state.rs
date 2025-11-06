use anchor_lang::prelude::*;

// Maximum allowed values to prevent unrealistic configurations and overflow issues
pub const MAX_DEBIT_AMOUNT: u64 = u64::MAX / 2; // Half of u64::MAX for safety
pub const MAX_DEBIT_FREQUENCY_SECONDS: u64 = 31_536_000 * 10; // 10 years in seconds
pub const MIN_DEBIT_AMOUNT: u64 = 1; // Minimum 1 token unit to prevent dust spam
pub const UNLIMITED_ALLOWANCE: u64 = u64::MAX;

/// Represents a recurring payment mandate on the Solana blockchain.
///
/// A mandate authorizes a specific authority to debit tokens from a user's account
/// under defined constraints (amount, frequency, total limit).
///
/// # Lifecycle
/// 1. **Created**: Authority creates mandate (inactive, not approved)
/// 2. **Approved**: User approves and delegates tokens to mandate PDA
/// 3. **Executed**: Authority executes debits respecting frequency and limits
/// 4. **Modified**: Authority (with user consent) can modify parameters
/// 5. **Cancelled**: Either party can cancel (user revokes delegation, authority closes account)
///
/// # Security Model
/// - User retains full control via SPL token delegation
/// - All constraints enforced on-chain before execution
/// - Delegation amount synced with mandate limit
#[account]
pub struct Mandate {
    /// Unique identifier for this mandate (u64)
    /// Used in PDA derivation: seeds = [b"mandate", authority, id]
    /// Allows authority to create multiple mandates for same user
    pub id: u64,

    /// Authority who can execute debits and modify the mandate (Pubkey)
    /// Typically a service provider or automated system
    /// Can close mandate to reclaim rent (they paid for account creation)
    pub authority: Pubkey,

    /// User whose tokens will be debited (Pubkey)
    /// Must approve mandate and delegate tokens
    /// Can revoke delegation at any time to stop debits
    pub user: Pubkey,

    /// PDA bump seed (u8)
    /// Required for signing transfers as the mandate PDA
    pub bump: u8,

    /// SPL token mint address (Pubkey)
    /// Specifies which token will be debited
    /// Must match user's token account mint
    pub mint: Pubkey,

    /// Amount per debit in token base units (u64)
    /// For Fixed debits: exact amount transferred each time
    /// For Variable debits: maximum amount that can be transferred
    /// Must be >= MIN_DEBIT_AMOUNT and <= MAX_DEBIT_AMOUNT
    pub amount_per_debit: u64,

    /// Total lifetime limit in token base units (u64)
    /// Maximum cumulative amount that can ever be debited
    /// Set to UNLIMITED_ALLOWANCE (u64::MAX) for unlimited mandates
    /// Must be >= amount_per_debit (unless unlimited)
    pub limit: u64,

    /// Cumulative amount debited so far in token base units (u64)
    /// Incremented after each successful execution
    /// Cannot exceed limit (unless unlimited)
    /// Used to prevent over-spending
    pub total_debited_amount: u64,

    /// Whether this mandate has unlimited spending (bool)
    /// If true, limit checks are bypassed
    /// If false, total_debited_amount must stay <= limit
    pub is_unlimited_spend: bool,

    /// Type of debit: Fixed or Variable (DebitType enum)
    /// Fixed: amount_to_debit must equal amount_per_debit
    /// Variable: amount_to_debit can be any value <= amount_per_debit
    pub debit_type: DebitType,

    /// Whether user has approved this mandate (bool)
    /// Set to true when user approves and delegates tokens
    /// Required to be true before execution or modification
    pub is_approved: bool,

    /// Whether this mandate is active (bool)
    /// Set to true when user approves
    /// Can be toggled by modifications (future feature)
    /// Required to be true for execution
    pub is_active: bool,

    /// Unix timestamp of last successful debit (i64)
    /// Set to 0 initially (allows first execution immediately)
    /// Updated to current time after each execution
    /// Used with debit_frequency_seconds to enforce rate limiting
    pub last_debit_date: i64,

    /// Minimum seconds between debits (u64)
    /// Must be > 0 and <= MAX_DEBIT_FREQUENCY_SECONDS
    /// Enforced via: last_debit_date + debit_frequency_seconds <= current_time
    /// Prevents authority from draining funds too quickly
    pub debit_frequency_seconds: u64,

    /// Unix timestamp when mandate was created (i64)
    /// Set once at creation, never modified
    pub created_at: i64,

    /// Unix timestamp of last modification (i64)
    /// Updated on approve, execute, modify, etc.
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
        8 +                                   // debit_frequency_seconds
        8 +                                   // created_at
        8; // updated_at
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, InitSpace)]
pub enum DebitType {
    Fixed = 0,
    Variable = 1,
}
