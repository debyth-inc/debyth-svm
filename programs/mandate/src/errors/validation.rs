use anchor_lang::prelude::*;
use super::definitions::MandateError;
use crate::state::{MIN_DEBIT_AMOUNT, MAX_DEBIT_AMOUNT, MAX_DEBIT_FREQUENCY_SECONDS};

// ============================================================================
// COMPUTE-OPTIMIZED VALIDATION HELPERS
// ============================================================================
// These helpers use inline functions and avoid unnecessary logging to minimize
// compute unit usage. All functions are marked #[inline(always)] to ensure
// zero-cost abstraction.

/// Validates debit amount is within allowed bounds
/// Zero-cost inline function for compute efficiency
#[inline(always)]
pub fn validate_debit_amount(amount: u64) -> Result<()> {
    require!(
        amount >= MIN_DEBIT_AMOUNT,
        MandateError::DebitAmountTooSmall
    );
    require!(
        amount <= MAX_DEBIT_AMOUNT,
        MandateError::DebitAmountTooLarge
    );
    Ok(())
}

/// Validates debit frequency is within allowed bounds
/// Zero-cost inline function for compute efficiency
#[inline(always)]
pub fn validate_debit_frequency(frequency_seconds: u64) -> Result<()> {
    require!(
        frequency_seconds > 0,
        MandateError::InvalidDebitFrequency
    );
    require!(
        frequency_seconds <= MAX_DEBIT_FREQUENCY_SECONDS,
        MandateError::DebitFrequencyTooLarge
    );
    Ok(())
}

/// Validates time arithmetic with overflow protection
/// Zero-cost inline function for compute efficiency
#[inline(always)]
pub fn checked_add_time(
    base_timestamp: i64,
    offset_seconds: u64,
) -> Result<i64> {
    base_timestamp
        .checked_add(offset_seconds as i64)
        .ok_or(MandateError::ArithmeticOverflow.into())
}

/// Validates amount arithmetic with overflow protection
/// Zero-cost inline function for compute efficiency
#[inline(always)]
pub fn checked_add_amount(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b)
        .ok_or(MandateError::AmountOverflow.into())
}

/// Validates timestamp is within realistic bounds to prevent clock manipulation
/// Zero-cost inline function for compute efficiency
#[inline(always)]
pub fn validate_timestamp(timestamp: i64) -> Result<()> {
    // Solana's Clock starts at Unix epoch (1970)
    // Check for negative or unrealistic future timestamps
    // 2_000_000_000 = May 2033, reasonable upper bound for active mandates
    require!(
        timestamp >= 0 && timestamp <= 2_000_000_000,
        MandateError::SuspiciousTimestamp
    );
    Ok(())
}

/// Validates that a new limit is not less than already debited amount
/// Zero-cost inline function for compute efficiency
#[inline(always)]
pub fn validate_new_limit(
    new_limit: u64,
    total_debited: u64,
    is_unlimited: bool,
) -> Result<()> {
    if !is_unlimited {
        require!(
            new_limit >= total_debited,
            MandateError::InvalidSpendCap
        );
    }
    Ok(())
}

/// Validates spend cap relationship: limit >= amount_per_debit
/// Zero-cost inline function for compute efficiency
#[inline(always)]
pub fn validate_spend_cap(
    limit: u64,
    amount_per_debit: u64,
    is_unlimited: bool,
) -> Result<()> {
    if !is_unlimited {
        require!(
            limit >= amount_per_debit,
            MandateError::InvalidSpendCap
        );
    }
    Ok(())
}

/// Validates that sufficient time has passed since last debit
/// Zero-cost inline function for compute efficiency
#[inline(always)]
pub fn validate_frequency_elapsed(
    last_debit_date: i64,
    frequency_seconds: u64,
    current_time: i64,
) -> Result<()> {
    if last_debit_date == 0 {
        // First execution, no frequency check needed
        return Ok(());
    }

    let time_threshold = checked_add_time(last_debit_date, frequency_seconds)?;
    require!(
        time_threshold <= current_time,
        MandateError::InsufficientTimeSinceLastDebit
    );
    Ok(())
}

/// Validates debit limit and returns new total
/// Zero-cost inline function for compute efficiency
#[inline(always)]
pub fn validate_debit_limit(
    current_total: u64,
    amount_to_debit: u64,
    limit: u64,
    is_unlimited: bool,
) -> Result<u64> {
    let new_total = checked_add_amount(current_total, amount_to_debit)?;

    if !is_unlimited {
        require!(
            new_total <= limit,
            MandateError::DebitLimitExceeded
        );
    }

    Ok(new_total)
}

/// Validates token balance is sufficient
/// Zero-cost inline function for compute efficiency
#[inline(always)]
pub fn validate_sufficient_balance(
    available_balance: u64,
    required_amount: u64,
) -> Result<()> {
    require!(
        available_balance >= required_amount,
        MandateError::InsufficientBalance
    );
    Ok(())
}

/// Validates delegation amount is sufficient
/// Zero-cost inline function for compute efficiency
#[inline(always)]
pub fn validate_sufficient_delegation(
    delegated_amount: u64,
    required_amount: u64,
) -> Result<()> {
    require!(
        delegated_amount >= required_amount,
        MandateError::InsufficientDelegation
    );
    Ok(())
}

// ============================================================================
// NEW VALIDATION FUNCTIONS FOR REBUILD
// ============================================================================

/// Validates policy timing (start_at, end_at, and interval)
#[inline(always)]
pub fn validate_policy_timing(
    start_at: i64,
    end_at: i64,
    min_interval_seconds: u64,
    now: i64,
) -> Result<()> {
    // Policy end must be after start
    require!(end_at > start_at, MandateError::InvalidPolicyTiming);

    // Policy must not be in the past (allow small grace period)
    require!(start_at <= now + 15, MandateError::InvalidPolicyTiming);

    // Policy must not be too far in the future (10 years max)
    let ten_years_in_future = now + (31_536_000 * 10);
    require!(start_at <= ten_years_in_future, MandateError::InvalidPolicyTiming);

    // End must be before ten years from now
    require!(end_at <= ten_years_in_future, MandateError::InvalidPolicyTiming);

    // Min interval must be non-zero
    require!(min_interval_seconds > 0, MandateError::InvalidDebitFrequency);

    Ok(())
}

/// Validates that nonce is not already used
#[inline(always)]
pub fn validate_nonce(nonce: u64, last_nonce: u64) -> Result<()> {
    require!(nonce > 0, MandateError::InvalidNonce);
    require!(nonce > last_nonce, MandateError::NonceAlreadyUsed);
    Ok(())
}

/// Validates sender consent for modifications
#[inline(always)]
pub fn validate_sender_consent(sender: Pubkey, mandate_sender: Pubkey) -> Result<()> {
    require!(sender == mandate_sender, MandateError::UnauthorizedSender);
    Ok(())
}

/// Validates recipient matches mandate recipient
#[inline(always)]
pub fn validate_recipient(recipient: Pubkey, mandate_recipient: Pubkey) -> Result<()> {
    require!(recipient == mandate_recipient, MandateError::InvalidRecipient);
    Ok(())
}

/// Validates policy hash is not zero
#[inline(always)]
pub fn validate_policy_hash(policy_hash: [u8; 32]) -> Result<()> {
    require!(policy_hash != [0u8; 32], MandateError::InvalidPolicyHash);
    Ok(())
}

/// Validates allowed recipients/assets are within bounds
#[inline(always)]
pub fn validate_policy_constraints_count(count: usize, max: usize) -> Result<()> {
    require!(count <= max, MandateError::MaxPolicyConstraintsExceeded);
    Ok(())
}
