#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

declare_id!("ATMswjeXjUGfkxSo94seuuX4HLXcPwePdjnJc9FCvMaC");

mod instructions;
mod state;
mod errors;

use instructions::*;
use instructions::ModifyMandateArgs;

pub mod events;

#[program]
pub mod mandate {
    use super::*;

    pub fn create_mandate(
        ctx: Context<CreateMandate>,
        mandate_id: u64,
        args: CreateMandateArgs,
    ) -> Result<()> {
        ctx.accounts.create(mandate_id, args, &ctx.bumps)?;
        Ok(())
    }

    pub fn approve_mandate(ctx: Context<ApproveMandate>, mandate_id: u64) -> Result<()> {
        ctx.accounts.approve()?;
        Ok(())
    }
    pub fn execute_mandate(ctx: Context<ExecuteMandate>, args: ExecuteMandateArgs) -> Result<()> {
        ctx.accounts.execute(args)?;
        Ok(())
    }

    pub fn modify_mandate(ctx: Context<ModifyMandate>, args: ModifyMandateArgs) -> Result<()> {
        ctx.accounts.modify(args)?;
        Ok(())
    }

    pub fn cancel_mandate(ctx: Context<CancelMandate>) -> Result<()> {
        ctx.accounts.cancel()?;
        Ok(())
    }
}
