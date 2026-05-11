use anchor_lang::prelude::*;

use crate::errors::MandateError;
use crate::events::ExecutionResumedEvent;
use crate::state::ExecutionState;

#[derive(Accounts)]
pub struct ResumeExecution<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [ExecutionState::SEED_PREFIX],
        bump,
    )]
    pub execution_state: Account<'info, ExecutionState>,
}

impl<'info> ResumeExecution<'info> {
    pub fn resume_execution(&mut self) -> Result<()> {
        let execution_state = &mut self.execution_state;

        require!(
            execution_state.authority == self.authority.key(),
            MandateError::ExecutionStateAuthorityMismatch
        );

        execution_state.paused = false;

        let now = Clock::get()?.unix_timestamp;

        emit!(ExecutionResumedEvent {
            resumed_by: self.authority.key(),
            timestamp: now,
        });

        Ok(())
    }
}
