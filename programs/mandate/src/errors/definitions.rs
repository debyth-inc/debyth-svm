use anchor_lang::prelude::*;

#[error_code]
pub enum MandateError {
    // === Authorization Errors (6000-6099) ===
    #[msg("Invalid authority: only the mandate authority can perform this action")]
    InvalidAuthority = 6000,

    #[msg("Unauthorized owner: the signer is not the owner of the token account")]
    UnauthorizedOwner = 6001,

    #[msg("Unauthorized user: the signer is not the mandate's designated user")]
    UnauthorizedUser = 6002,

    // === State Validation Errors (6100-6199) ===
    #[msg("Mandate is already approved")]
    AlreadyApproved = 6100,

    #[msg("Mandate is already active")]
    AlreadyActive = 6101,

    #[msg("Mandate is not active: cannot execute or modify an inactive mandate")]
    MandateNotActive = 6102,

    #[msg("Mandate is not approved: user must approve before execution")]
    MandateNotApproved = 6103,

    #[msg("Mandate has been cancelled and cannot be used")]
    MandateCancelled = 6104,

    #[msg("Mandate is paused and cannot execute transactions")]
    MandatePaused = 6105,

    // === Token Account Errors (6200-6299) ===
    #[msg("Invalid token account: the provided account does not match expected constraints")]
    InvalidTokenAccount = 6200,

    #[msg("Invalid mint: the token mint does not match the mandate's configured mint")]
    InvalidMint = 6201,

    #[msg("Token account is already delegated to another program or PDA")]
    TokenAlreadyDelegated = 6202,

    #[msg("Token account is not delegated to the mandate program or has insufficient allowance")]
    NotDelegatedToProgram = 6203,

    #[msg("Token account delegate does not match the mandate PDA")]
    InvalidDelegate = 6204,

    #[msg("Insufficient token balance: user account does not have enough tokens for this debit")]
    InsufficientBalance = 6205,

    #[msg("Delegated allowance is insufficient for this operation")]
    InsufficientDelegation = 6206,

    // === Amount Validation Errors (6300-6399) ===
    #[msg("Invalid amount: amount must be greater than zero")]
    InvalidAmount = 6300,

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

    #[msg("New limit cannot be less than already debited amount")]
    NewLimitTooLow = 6402,

    // === Time/Frequency Errors (6500-6599) ===
    #[msg("Insufficient time since last debit: debit_frequency_seconds has not elapsed")]
    InsufficientTimeSinceLastDebit = 6500,

    #[msg("Invalid debit frequency: must be greater than zero")]
    InvalidDebitFrequency = 6501,

    #[msg("Debit frequency too large: exceeds maximum allowed value (10 years)")]
    DebitFrequencyTooLarge = 6502,

    #[msg("Mandate has expired: current time exceeds expiration timestamp")]
    Expired = 6503,

    #[msg("Invalid expiration: expiration must be in the future")]
    InvalidExpiration = 6504,

    #[msg("Clock manipulation detected: timestamp is unrealistic")]
    SuspiciousTimestamp = 6505,

    // === Arithmetic/Overflow Errors (6600-6699) ===
    #[msg("Arithmetic overflow in time calculation")]
    ArithmeticOverflow = 6600,

    #[msg("Arithmetic overflow in amount calculation")]
    AmountOverflow = 6601,

    // === Parameter Validation Errors (6700-6799) ===
    #[msg("Invalid mandate ID: mandate ID cannot be used")]
    InvalidMandateId = 6700,

    #[msg("Duplicate mandate: a mandate with this ID already exists")]
    DuplicateMandate = 6701,

    // === Reentrancy/Concurrency Errors (6800-6899) ===
    #[msg("Reentrancy detected: this mandate is currently being executed")]
    ReentrancyDetected = 6800,

    #[msg("Execution in progress: cannot modify while execution is occurring")]
    ExecutionInProgress = 6801,
}
