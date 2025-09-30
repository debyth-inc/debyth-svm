use anchor_lang::prelude::*;

#[error_code]
pub enum MandateError {
    #[msg("Mandate is already approved or active")]
    AlreadyApproved,
    #[msg("Mandate is already active")]
    AlreadyActive,
    #[msg("Mandate has expired")]
    Expired,
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Token account is already delegated")]
    TokenAlreadyDelegated,

    #[msg("Mandate is not active")]
    MandateNotActive,
    #[msg("Mandate is not approved")]
    MandateNotApproved,
    #[msg("Invalid amount for fixed debit")]
    InvalidAmountForFixedDebit,
    #[msg("Invalid amount for variable debit")]
    InvalidAmountForVariableDebit,
    #[msg("Debit limit exceeded")]
    DebitLimitExceeded,
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("Unauthorized owner")]
    UnauthorizedOwner,

    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid spend cap")]
    InvalidSpendCap,
    #[msg("Insufficient time since last debit")]
    InsufficientTimeSinceLastDebit,
    #[msg("Token account is not delegated to the mandate program or has insufficient allowance")]
    NotDelegatedToProgram,
}
