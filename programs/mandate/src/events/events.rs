use anchor_lang::prelude::*;
use crate::state::DebitType;

#[event]
pub struct MandateCreatedEvent {
    #[index]
    pub mandate_id: u64,
    #[index]
    pub user: Pubkey,
    pub mint: Pubkey,
    pub is_approved: bool,
    pub is_active: bool,
    pub created_at: i64,
    pub amount_per_debit: u64,
    pub limit: u64,
    pub is_unlimited_spend: bool,
    pub debit_type: DebitType,
}

#[event]
pub struct MandateApprovedEvent {
    #[index]
    pub mandate_id: u64,
    #[index]
    pub user: Pubkey,
    pub amount_per_debit: u64,
    pub is_approved: bool,
    pub is_active: bool,
    pub created_at: i64,
}

#[event]
pub struct MandateExecutedEvent {
    #[index]
    pub mandate_id: u64,
    #[index]
    pub authority: Pubkey,
    #[index]
    pub user: Pubkey,
    pub amount_per_debit: u64,
    pub total_debited_amount: u64,
}

#[event]
pub struct MandateModifiedEvent {
    #[index]
    pub mandate_id: u64,
    #[index]
    pub authority: Pubkey,
    #[index]
    pub user: Pubkey,
    pub new_amount_per_debit: u64,
    pub new_limit: u64,
    pub new_is_unlimited_spend: bool,
    pub new_debit_type: DebitType,
    pub new_is_active: bool,
    pub new_is_approved: bool,
}

#[event]
pub struct MandateCancelledEvent {
    #[index]
    pub mandate_id: u64,
    #[index]
    pub authority: Pubkey,
    #[index]
    pub user: Pubkey,
}

#[event]
pub struct MandateExpiredEvent {
    #[index]
    pub mandate_id: u64,
    #[index]
    pub user: Pubkey,
    pub expired_at: i64,
}