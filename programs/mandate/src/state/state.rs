use anchor_lang::prelude::*;

// Maximum allowed values to prevent unrealistic configurations and overflow issues
pub const MAX_DEBIT_AMOUNT: u64 = u64::MAX / 2; // Half of u64::MAX for safety
pub const MAX_DEBIT_FREQUENCY_SECONDS: u64 = 31_536_000 * 10; // 10 years in seconds
pub const MIN_DEBIT_AMOUNT: u64 = 1; // Minimum 1 token unit to prevent dust spam
pub const UNLIMITED_ALLOWANCE: u64 = u64::MAX;

/// Charge types matching EVM implementation
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, InitSpace)]
pub enum ChargeType {
    Fixed,
    Variable,
}

/// Frequency enum for policy enforcement
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, InitSpace)]
pub enum Frequency {
    Daily,
    Weekly,
    Monthly,
    Annually,
}

/// Mandate status matching EVM implementation
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, InitSpace)]
pub enum MandateStatus {
    Pending,
    Active,
    Paused,
    Expired,
    Cancelled,
    Complete,
}

/// Policy = execution constraints only
/// Not signed, not user-defined, not part of policy hash computation on-chain
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Policy {
    /// Frequency for execution: DAILY, WEEKLY, MONTHLY, ANNUALLY
    pub frequency: Frequency,
    /// Minimum seconds between executions
    pub min_interval_seconds: u64,
    /// Maximum amount per execution
    pub per_execution_limit: u64,
    /// Period limit for recurring checks (0 = disabled)
    pub period_limit: u64,
    /// Period window in seconds (0 = disabled)
    pub period_window: u64,
    /// Canonical policy hash for verification (computed off-chain)
    pub policy_hash: [u8; 32],
}

impl Policy {
    pub fn init() -> Self {
        Policy {
            frequency: Frequency::Monthly,
            min_interval_seconds: 0,
            per_execution_limit: 0,
            period_limit: 0,
            period_window: 0,
            policy_hash: [0u8; 32],
        }
    }
}

/// ExecutionState = runtime bookkeeping only
/// Mutable, not signed, not user-defined, not part of policy hash
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct ExecutionState {
    /// Total amount executed so far (sum of all debits)
    pub total_executed: u64,
    /// Amount executed in current period (for period limits)
    pub period_executed: u64,
    /// Timestamp of last successful execution
    pub last_execution_time: i64,
    /// Last period timestamp (for period limit resets)
    pub last_period_timestamp: i64,
    /// Last execution nonce (for replay protection)
    pub execution_nonce: u64,
}

impl Default for ExecutionState {
    fn default() -> Self {
        Self {
            total_executed: 0,
            period_executed: 0,
            last_execution_time: 0,
            last_period_timestamp: 0,
            execution_nonce: 0,
        }
    }
}

/// Mandate = granted authority
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

    /// Sender wallet address
    /// Wallet whose funds are debited
    pub sender: Pubkey,

    /// Recipient wallet address
    /// Wallet that receives funds
    pub recipient: Pubkey,

    /// PDA bump seed
    pub bump: u8,

    /// SPL token mint address
    pub mint: Pubkey,

    /// Maximum authority granted by sender (0 = unlimited)
    pub authorized_limit: u64,

    /// Charge type: FIXED or VARIABLE
    pub charge_type: ChargeType,

    /// Unix timestamp for start
    pub start_at: i64,

    /// Unix timestamp for end
    pub end_at: i64,

    /// Policy = execution constraints
    pub policy: Policy,

    /// ExecutionState = runtime bookkeeping
    pub execution_state: ExecutionState,

    /// Mandate status
    pub status: MandateStatus,

    /// Unix timestamp of creation
    pub created_at: i64,

    /// Whether mandate is approved (user has delegated tokens)
    pub is_approved: bool,

    /// Signature nonce for modify_mandate replay protection
    pub modify_signature_nonce: u64,
}

impl Mandate {
    pub const INIT_SPACE: usize = 8 +        // discriminator
        8 +                                   // id
        32 +                                  // authority
        32 +                                  // sender
        32 +                                  // recipient
        1 +                                   // bump
        32 +                                  // mint
        8 +                                   // authorized_limit
        1 +                                   // charge_type
        8 +                                   // start_at
        8 +                                   // end_at
        // Policy struct
        1 +                                   // frequency
        8 +                                   // min_interval_seconds
        8 +                                   // per_execution_limit
        8 +                                   // period_limit
        8 +                                   // period_window
        32 +                                  // policy_hash
        // ExecutionState struct
        8 +                                   // total_executed
        8 +                                   // period_executed
        8 +                                   // last_execution_time
        8 +                                   // last_period_timestamp
        8 +                                   // execution_nonce
        1 +                                   // status
        8 +                                   // created_at
        1 +                                   // is_approved
        8;                                    // modify_signature_nonce
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
            authorized_limit: 0,
            charge_type: ChargeType::Variable,
            start_at: 0,
            end_at: 0,
            policy: Policy::init(),
            execution_state: ExecutionState::default(),
            status: MandateStatus::Pending,
            created_at: 0,
            is_approved: false,
            modify_signature_nonce: 0,
        }
    }
}

/// Global execution pause state (singleton PDA at seed "execution-state")
/// Mirrors the EVM contract's `executionPaused` flag
#[account]
pub struct ExecutionStateGlobal {
    /// Whether execution is paused globally
    pub paused: bool,
    /// Authority that can pause/resume execution
    pub authority: Pubkey,
}

impl ExecutionStateGlobal {
    pub const INIT_SPACE: usize = 8 + 1 + 32;

    pub const SEED_PREFIX: &'static [u8] = b"execution-state";
}

impl Default for ExecutionStateGlobal {
    fn default() -> Self {
        Self {
            paused: false,
            authority: Pubkey::default(),
        }
    }
}
