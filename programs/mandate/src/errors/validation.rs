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
