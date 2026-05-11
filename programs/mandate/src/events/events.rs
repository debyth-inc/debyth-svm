use anchor_lang::prelude::*;

#[event]
pub struct MandateCreatedEvent {
    pub mandate_id: u64,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub total_limit: u64,
    pub per_execution_limit: u64,
    pub policy_hash: [u8; 32],
    pub start_at: i64,
    pub end_at: i64,
    pub created_at: i64,
}

#[event]
pub struct MandateExecutedEvent {
    pub mandate_id: u64,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub total_charged: u64,
    pub timestamp: i64,
    pub nonce: u64,
    pub policy_hash: [u8; 32],
}

#[event]
pub struct MandateCancelledEvent {
    pub mandate_id: u64,
    pub sender: Pubkey,
    pub cancelled_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MandateApprovedEvent {
    pub mandate_id: u64,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub total_limit: u64,
    pub per_execution_limit: u64,
    pub policy_hash: [u8; 32],
    pub created_at: i64,
}

#[event]
pub struct MandatePausedEvent {
    pub mandate_id: u64,
    pub sender: Pubkey,
    pub paused_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MandateResumedEvent {
    pub mandate_id: u64,
    pub sender: Pubkey,
    pub resumed_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MandateModifiedEvent {
    pub mandate_id: u64,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub old_policy_hash: [u8; 32],
    pub new_policy_hash: [u8; 32],
    pub modified_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ExecutionPausedEvent {
    pub paused_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ExecutionResumedEvent {
    pub resumed_by: Pubkey,
    pub timestamp: i64,
}

