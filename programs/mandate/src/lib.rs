#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use anchor_lang::prelude::*;

declare_id!("CtUQeRyYYBN1P9bnqogVDDi6UeHbF96Rpinj6cyGentp");

mod errors;
mod instructions;
mod state;

use instructions::ModifyMandateArgs;
use instructions::*;

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

    pub fn approve_mandate(ctx: Context<ApproveMandate>, _mandate_id: u64) -> Result<()> {
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
