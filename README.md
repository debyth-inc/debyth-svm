# Mandate Program

This project implements a Solana program for managing recurring payments or debits, referred to as "mandates." It allows a sender to approve an authority (executor) to debit tokens from their account under configurable policy constraints.

## Project Structure

The core logic of the program resides in the `programs/mandate` directory.

-   `programs/mandate/src/instructions`: Contains the individual instruction handlers
    -   `create_mandate.rs`: Initializes a new mandate account
    -   `approve_mandate.rs`: Sender approves the mandate and delegates tokens to the mandate PDA
    -   `execute_mandate.rs`: Authority executes debits within policy constraints
    -   `modify_mandate.rs`: Authority modifies mandate parameters (requires sender consent)
    -   `cancel_mandate.rs`: Authority cancels a mandate and closes the account
    -   `toggle_status.rs`: Authority pauses/unpauses a mandate
    -   `initialize_execution_state.rs`: Admin initializes the global execution pause state
    -   `pause_execution.rs`: Admin pauses all mandate executions globally
    -   `resume_execution.rs`: Admin resumes all mandate executions globally
-   `programs/mandate/src/state/state.rs`: Defines `Mandate`, `ExecutionState`, `Policy`, `ChargeType`, `Frequency`, and `MandateStatus`
-   `programs/mandate/src/errors/`: Error definitions and validation helpers
-   `programs/mandate/src/events/`: Event definitions for monitoring

## Functionalities

1.  **Create Mandate**: Authority creates a mandate specifying sender, recipient, token mint, charge type (fixed/variable), limits, frequency, and optional allowed recipients/assets.
2.  **Approve Mandate**: Sender approves the mandate, delegating tokens from their token account to the mandate PDA. Mandate transitions from Pending to Active.
3.  **Execute Mandate**: Authority executes token transfers from sender to recipient, respecting policy constraints (amount limits, frequency, time windows, allowed recipients/assets).
4.  **Modify Mandate**: Authority updates mandate parameters. Requires both authority and sender signatures. Updates SPL token delegation to match new limits.
5.  **Cancel Mandate**: Authority cancels a mandate unilaterally, closing the account and refunding rent. Sender can revoke delegation via their wallet at any time.
6.  **Toggle Status**: Authority pauses or resumes an individual mandate without requiring sender signature.
7.  **Initialize Execution State**: Admin initializes the global execution pause controller (one-time setup).
8.  **Pause/Resume Execution**: Admin globally pauses or resumes all mandate executions (emergency circuit breaker).

## Mandate Lifecycle

1. **Created** → Pending state
2. **Approved** → Active state (sender delegates tokens)
3. **Executed** → Debits within policy constraints
4. **Paused** → Temporarily stopped by authority (toggle)
5. **Modified** → Parameters updated (requires sender consent)
6. **Cancelled** → Account closed by authority
7. **Complete** → All lifetime limits reached

## Security Model

- Sender retains full control via SPL token delegation (can revoke at any time)
- All constraints enforced on-chain before execution
- Nonce-based replay protection for each execution
- Policy hash verification for integrity
- Checked arithmetic for all amount/time calculations
- Global execution pause for emergency situations
- Authority front-run protection on execution state initialization

## How to Run Tests

1.  **Install Dependencies**:
    ```bash
    yarn install
    ```

2.  **Run All Tests**:
    ```bash
    yarn test
    ```

3.  **Run Individual Test Suites**:
    ```bash
    yarn test:create       # Mandate creation tests
    yarn test:approve      # Mandate approval tests
    yarn test:execute      # Mandate execution tests
    yarn test:modify-cancel # Modification and cancellation tests
    yarn test:security     # Security edge case tests
    ```
