use anchor_lang::prelude::*;

use crate::errors::MandateError;
use crate::events::ExecutionPausedEvent;
use crate::state::ExecutionState;

#[derive(Accounts)]
pub struct PauseExecution<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + ExecutionState::INIT_SPACE,
        seeds = [ExecutionState::SEED_PREFIX],
        bump,
    )]
    pub execution_state: Account<'info, ExecutionState>,

    pub system_program: Program<'info, System>,
}

impl<'info> PauseExecution<'info> {
    pub fn pause_execution(&mut self) -> Result<()> {
        let execution_state = &mut self.execution_state;

        if execution_state.authority == Pubkey::default() {
            execution_state.authority = self.authority.key();
        } else {
            require!(
                execution_state.authority == self.authority.key(),
                MandateError::ExecutionStateAuthorityMismatch
            );
        }

        execution_state.paused = true;

        let now = Clock::get()?.unix_timestamp;

        emit!(ExecutionPausedEvent {
            paused_by: self.authority.key(),
            timestamp: now,
        });

        Ok(())
    }
}
