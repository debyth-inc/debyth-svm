#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

declare_id!("6mBVkki6chiDDMULzWNjPQmM52dc5fRdnH5d3MShMBPr");

mod instructions;
mod state;

use instructions::*;

#[program]
pub mod mandate {
    use super::*;

    pub fn create_mandate(ctx: Context<CreateMandate>, expiry_time: i64) -> Result<()> {
        Ok(())
    }
    pub fn execute_transfer(
        ctx: Context<ExecuteMandate>,
        amount: u64,
        mandate_id: u64,
    ) -> Result<()> {
        Ok(())
    }
    pub fn modify_mandate(ctx: Context<ModifyMandate>, state: bool, mandate_id: u64) -> Result<()> {
        Ok(())
    }
    pub fn approve_mandate(ctx: Context<ApproveMandate>, mandate_id: u64) -> Result<()> {
        Ok(())
    }
    pub fn cancel_mandate(ctx: Context<CancelMandate>, mandate_id: u64) -> Result<()> {
        Ok(())
    }
}

#[error_code]
pub enum MandateError {
    #[msg("Mandate has expired")]
    MandateExpired,

    #[msg("Mandate is not active")]
    MandateInactive,

    #[msg("Invalid token account owner")]
    InvalidOwner,

    #[msg("Token account not owned by mandate PDA")]
    InvalidTokenAuthority,
}
