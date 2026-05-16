use anchor_lang::prelude::*;

use crate::state::ExecutionStateGlobal;

#[derive(Accounts)]
pub struct InitializeExecutionState<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + ExecutionStateGlobal::INIT_SPACE,
        seeds = [ExecutionStateGlobal::SEED_PREFIX],
        bump,
    )]
    pub execution_state: Account<'info, ExecutionStateGlobal>,

    pub system_program: Program<'info, System>,
}

impl<'info> InitializeExecutionState<'info> {
    pub fn initialize(&mut self) -> Result<()> {
        if self.execution_state.authority == Pubkey::default() {
            self.execution_state.paused = false;
            self.execution_state.authority = self.admin.key();
        }

        Ok(())
    }
}
