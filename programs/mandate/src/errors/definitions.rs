use anchor_lang::prelude::*;

#[error_code]
pub enum MandateError {
    // === Authorization Errors (6000-6099) ===
    #[msg("Invalid authority: only the mandate authority can perform this action")]
    InvalidAuthority = 6000,

    #[msg("Unauthorized sender: the signer is not the mandate's designated sender")]
    UnauthorizedSender = 6002,

    // === State Validation Errors (6100-6199) ===
    #[msg("Mandate is already approved")]
    AlreadyApproved = 6100,

    #[msg("Mandate is already active")]
    AlreadyActive = 6101,

    #[msg("Mandate is not active: cannot execute or modify an inactive mandate")]
    MandateNotActive = 6102,

    #[msg("Mandate is not approved: sender must approve before execution")]
    MandateNotApproved = 6103,

    #[msg("Mandate is not pending: cannot approve a non-pending mandate")]
    MandateNotPending = 6104,

    // === Token Account Errors (6200-6299) ===
    #[msg("Invalid token account: the provided account does not match expected constraints")]
    InvalidTokenAccount = 6200,

    #[msg("Invalid mint: the token mint does not match the mandate's configured mint")]
    InvalidMint = 6201,

    #[msg("Token account is already delegated to another program or PDA")]
    TokenAlreadyDelegated = 6202,

    #[msg("Token account delegate does not match the mandate PDA")]
    InvalidDelegate = 6204,

    #[msg("Insufficient token balance: sender account does not have enough tokens for this debit")]
    InsufficientBalance = 6205,

    #[msg("Delegated allowance is insufficient for this operation")]
    InsufficientDelegation = 6206,

    #[msg("Invalid recipient: recipient does not match mandate configuration")]
    InvalidRecipient = 6207,

    // === Amount Validation Errors (6300-6399) ===
    #[msg("Debit amount too large: exceeds maximum allowed value")]
    DebitAmountTooLarge = 6301,

    #[msg("Debit amount too small: must be at least MIN_DEBIT_AMOUNT")]
    DebitAmountTooSmall = 6302,

    #[msg("Invalid amount for fixed debit: must exactly match amount_per_debit")]
    InvalidAmountForFixedDebit = 6303,

    #[msg("Invalid amount for variable debit: must be between MIN_DEBIT_AMOUNT and amount_per_debit")]
    InvalidAmountForVariableDebit = 6304,

    // === Limit Validation Errors (6400-6499) ===
    #[msg("Debit limit exceeded: this transaction would exceed the mandate's total limit")]
    DebitLimitExceeded = 6400,

    #[msg("Invalid spend cap: limit must be at least as large as amount_per_debit")]
    InvalidSpendCap = 6401,

    // === Time/Frequency Errors (6500-6599) ===
    #[msg("Insufficient time since last debit: min_interval_seconds has not elapsed")]
    InsufficientTimeSinceLastDebit = 6500,

    #[msg("Invalid debit frequency: must be greater than zero")]
    InvalidDebitFrequency = 6501,

    #[msg("Debit frequency too large: exceeds maximum allowed value (10 years)")]
    DebitFrequencyTooLarge = 6502,

    #[msg("Clock manipulation detected: timestamp is unrealistic")]
    SuspiciousTimestamp = 6505,

    #[msg("Invalid policy timing: start/end dates or interval are invalid")]
    InvalidPolicyTiming = 6506,

    // === Nonce/Replay Protection Errors (6600-6699) ===
    #[msg("Invalid nonce: nonce must be greater than zero")]
    InvalidNonce = 6600,

    #[msg("Nonce already used: nonce must be strictly increasing")]
    NonceAlreadyUsed = 6601,

    // === Policy Validation Errors (6700-6799) ===
    #[msg("Invalid policy hash: policy hash cannot be zero")]
    InvalidPolicyHash = 6700,

    #[msg("Max policy constraints exceeded: allowed_recipients/allowed_assets limited to 10")]
    MaxPolicyConstraintsExceeded = 6701,

    #[msg("Recipient not allowed: recipient is not in the allowed recipients list")]
    RecipientNotAllowed = 6702,

    #[msg("Asset not allowed: token mint is not in the allowed assets list")]
    AssetNotAllowed = 6703,

    // === Execution Pause Errors (6900-6999) ===
    #[msg("Execution is paused globally: cannot execute mandates until resumed")]
    ExecutionPaused = 6900,

    #[msg("Execution state authority mismatch: only the execution authority can pause or resume")]
    ExecutionStateAuthorityMismatch = 6901,

    // === Arithmetic/Overflow Errors (6800-6899) ===
    #[msg("Arithmetic overflow in time calculation")]
    ArithmeticOverflow = 6800,

    #[msg("Arithmetic overflow in amount calculation")]
    AmountOverflow = 6801,
}
