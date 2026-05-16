use anchor_lang::prelude::*;

use crate::errors::MandateError;
use crate::events::ExecutionPausedEvent;
use crate::state::ExecutionStateGlobal;

#[derive(Accounts)]
pub struct PauseExecution<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [ExecutionStateGlobal::SEED_PREFIX],
        bump,
        constraint = execution_state.authority == authority.key() @ MandateError::ExecutionStateAuthorityMismatch,
    )]
    pub execution_state: Account<'info, ExecutionStateGlobal>,
}

impl<'info> PauseExecution<'info> {
    pub fn pause_execution(&mut self) -> Result<()> {
        self.execution_state.paused = true;

        let now = Clock::get()?.unix_timestamp;

        emit!(ExecutionPausedEvent {
            paused_by: self.authority.key(),
            timestamp: now,
        });

        Ok(())
    }
}
