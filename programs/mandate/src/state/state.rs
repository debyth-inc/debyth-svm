use anchor_lang::prelude::*;

// Maximum allowed values to prevent unrealistic configurations and overflow issues
pub const MAX_DEBIT_AMOUNT: u64 = u64::MAX / 2; // Half of u64::MAX for safety
pub const MAX_DEBIT_FREQUENCY_SECONDS: u64 = 31_536_000 * 10; // 10 years in seconds
pub const MIN_DEBIT_AMOUNT: u64 = 1; // Minimum 1 token unit to prevent dust spam
pub const UNLIMITED_ALLOWANCE: u64 = u64::MAX;

/// Policy types matching EVM implementation
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, InitSpace)]
pub enum ChargeType {
    Fixed = 0,      // Must execute exact amount per policy
    Variable = 1,   // Can execute any amount up to limit per policy
}

/// Frequency enum for policy enforcement
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, InitSpace)]
pub enum Frequency {
    Daily = 0,
    Weekly = 1,
    Monthly = 2,
    Annually = 3,
}

/// Mandate status matching EVM implementation
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, InitSpace)]
pub enum MandateStatus {
    Pending = 0,     // Created but not yet approved
    Active = 1,      // Approved and active
    Paused = 2,      // Temporarily paused by executor
    Expired = 3,     // Past end_time
    Cancelled = 4,   // Cancelled by sender or admin
    Complete = 5,    // All limits reached
}

/// Policy configuration for mandate execution rules
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Policy {
    /// Charge type: FIXED or VARIABLE
    pub charge_type: ChargeType,
    /// Frequency for execution: DAILY, WEEKLY, MONTHLY, ANNUALLY
    pub frequency: Frequency,
    /// Minimum seconds between executions
    pub min_interval_seconds: u64,
    /// Maximum amount per execution
    pub per_execution_limit: u64,
    /// Total lifetime limit (0 = unlimited)
    pub lifetime_limit: u64,
    /// Period limit for recurring checks (0 = disabled)
    pub period_limit: u64,
    /// Period window in seconds (0 = disabled)
    pub period_window: u64,
    /// Unix timestamp for start
    pub start_at: i64,
    /// Unix timestamp for end
    pub end_at: i64,
    /// List of allowed recipient addresses (empty = any)
    #[max_len(10)]
    pub allowed_recipients: Vec<Pubkey>,
    /// List of allowed token mints (empty = any)
    #[max_len(10)]
    pub allowed_assets: Vec<Pubkey>,
    /// Canonical policy hash for verification
    pub policy_hash: [u8; 32],
}

impl Policy {
    pub fn init() -> Self {
        Policy {
            charge_type: ChargeType::Variable,
            frequency: Frequency::Monthly,
            min_interval_seconds: 0,
            per_execution_limit: 0,
            lifetime_limit: 0,
            period_limit: 0,
            period_window: 0,
            start_at: 0,
            end_at: 0,
            allowed_recipients: Vec::new(),
            allowed_assets: Vec::new(),
            policy_hash: [0u8; 32],
        }
    }
}

/// Represents a recurring payment mandate on the Solana blockchain.
///
/// A mandate authorizes specific execution of debits from a sender's account
/// to a recipient account under defined constraints.
///
/// # Lifecycle
/// 1. **Created**: Executor creates mandate (pending state)
/// 2. **Approved**: Sender approves and delegates tokens to mandate PDA
/// 3. **Active**: Mandate ready for execution within policy constraints
/// 4. **Paused**: Execution temporarily stopped by executor
/// 5. **Executed**: Executor executes debits respecting policy
/// 6. **Modified**: Executor can modify (requires sender consent)
/// 7. **Cancelled**: Either party can cancel
/// 8. **Complete**: All limits reached
///
/// # Security Model
/// - Sender retains full control via SPL token delegation
/// - All constraints enforced on-chain before execution
/// - Nonce-based replay protection for each execution
/// - Policy hash verification for integrity
#[account]
pub struct Mandate {
    /// Unique identifier for this mandate
    pub id: u64,

    /// Executor authority who can execute debits and modify mandate
    /// Debyth executor key (not the sender)
    pub authority: Pubkey,

    /// Sender wallet address (was: user)
    /// Wallet whose funds are debited
    pub sender: Pubkey,

    /// Recipient wallet address (NEW - explicit recipient)
    /// Wallet that receives funds
    pub recipient: Pubkey,

    /// PDA bump seed
    pub bump: u8,

    /// SPL token mint address
    pub mint: Pubkey,

    /// Policy for this mandate
    pub policy: Policy,

    /// Total amount executed so far (sum of all debits)
    pub total_executed: u64,

    /// Last execution nonce (for replay protection)
    pub last_execution_nonce: u64,

    /// Timestamp of last successful execution
    pub last_execution_time: i64,

    /// Amount executed in current period (for period limits)
    pub period_executed: u64,

    /// Mandate status
    pub status: MandateStatus,

    /// Unix timestamp of creation
    pub created_at: i64,

    /// Whether mandate is approved (user has delegated tokens)
    pub is_approved: bool,

    /// Policy hash at creation time (for integrity verification)
    pub policy_hash: [u8; 32],

    /// Last period timestamp (for period limit resets)
    pub last_period_timestamp: i64,
}

impl Mandate {
    pub const INIT_SPACE: usize = 8 +        // discriminator
        8 +                                   // id
        32 +                                  // authority
        32 +                                  // sender
        32 +                                  // recipient
        1 +                                   // bump
        32 +                                  // mint
        // Policy struct: ~240 bytes
        1 +                                   // charge_type
        1 +                                   // frequency
        8 +                                   // min_interval_seconds
        8 +                                   // per_execution_limit
        8 +                                   // lifetime_limit
        8 +                                   // period_limit
        8 +                                   // period_window
        8 +                                   // start_at
        8 +                                   // end_at
        4 +                                   // allowed_recipients len
        32 * 10 +                             // allowed_recipients (max 10)
        4 +                                   // allowed_assets len
        32 * 10 +                             // allowed_assets (max 10)
        32 +                                  // policy_hash
        8 +                                   // total_executed
        8 +                                   // last_execution_nonce
        8 +                                   // last_execution_time
        8 +                                   // period_executed
        1 +                                   // status
        8 +                                   // created_at
        1 +                                   // is_approved
        32 +                                  // policy_hash duplicate
        8;                                    // last_period_timestamp
}

impl Default for Mandate {
    fn default() -> Self {
        Self {
            id: 0,
            authority: Pubkey::default(),
            sender: Pubkey::default(),
            recipient: Pubkey::default(),
            bump: 0,
            mint: Pubkey::default(),
            policy: Policy::init(),
            total_executed: 0,
            last_execution_nonce: 0,
            last_execution_time: 0,
            period_executed: 0,
            status: MandateStatus::Pending,
            created_at: 0,
            is_approved: false,
            policy_hash: [0u8; 32],
            last_period_timestamp: 0,
        }
    }
}

/// Global execution pause state (singleton PDA at seed "execution-state")
/// Mirrors the EVM contract's `executionPaused` flag
#[account]
pub struct ExecutionState {
    /// Whether execution is paused globally
    pub paused: bool,
    /// Authority that can pause/resume execution
    pub authority: Pubkey,
}

impl ExecutionState {
    pub const INIT_SPACE: usize = 8 + 1 + 32;

    pub const SEED_PREFIX: &'static [u8] = b"execution-state";
}

impl Default for ExecutionState {
    fn default() -> Self {
        Self {
            paused: false,
            authority: Pubkey::default(),
        }
    }
}


