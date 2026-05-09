use crate::state::DebitType;
use anchor_lang::prelude::*;

#[event]
pub struct MandateCreatedEvent {
    pub mandate_id: u64,
    pub user: Pubkey,
    pub mint: Pubkey,
    pub is_approved: bool,
    pub is_active: bool,
    pub created_at: i64,
    pub amount_per_debit: u64,
    pub limit: u64,
    pub is_unlimited_spend: bool,
    pub debit_type: DebitType,
    pub debit_frequency_seconds: u64,
    pub timestamp: i64,
}

#[event]
pub struct MandateApprovedEvent {
    pub mandate_id: u64,
    pub user: Pubkey,
    pub amount_per_debit: u64,
    pub is_approved: bool,
    pub is_active: bool,
    pub created_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct MandateExecutedEvent {
    pub mandate_id: u64,
    pub authority: Pubkey,
    pub user: Pubkey,
    pub amount_per_debit: u64,
    pub amount_debited: u64, // Actual amount transferred in this execution
    pub total_debited_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct MandateModifiedEvent {
    pub mandate_id: u64,
    pub authority: Pubkey,
    pub user: Pubkey,
    pub new_amount_per_debit: u64,
    pub new_limit: u64,
    pub new_is_unlimited_spend: bool,
    pub new_debit_type: DebitType,
    pub timestamp: i64,
}

#[event]
pub struct MandateCancelledEvent {
    pub mandate_id: u64,
    pub authority: Pubkey,
    pub user: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MandateStatusToggledEvent {
    pub mandate_id: u64,
    pub authority: Pubkey,
    pub user: Pubkey,
    pub is_active: bool,
    pub timestamp: i64,
}
