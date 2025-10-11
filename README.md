# Mandate Program

This project implements a Solana program for managing recurring payments or debits, referred to as "mandates." It allows a user to approve an authority to debit a specified amount from their token account under certain conditions.

## Project Structure

The core logic of the program resides in the `programs/mandate` directory.

-   `programs/mandate/src/instructions`: Contains the individual instruction handlers for the program.
    -   `create_mandate.rs`: Initializes a new mandate account.
    -   `approve_mandate.rs`: Allows the user to approve the mandate, delegating tokens to the mandate PDA.
    -   `execute_mandate.rs`: Enables the authority to debit tokens from the user's account based on the mandate.
    -   `modify_mandate.rs`: Allows the authority to activate/deactivate an existing mandate.
    -   `cancel_mandate.rs`: Allows the user to cancel an active mandate and revoke token delegation.
-   `programs/mandate/src/state/state.rs`: Defines the `Mandate` account structure and `DebitType` enum.
-   `tests/mandate.test.ts`: Contains client-side tests written in TypeScript, demonstrating how to interact with the program.

## Functionalities

The Mandate program provides the following key functionalities:

1.  **Create Mandate**: A user can create a mandate, specifying the authority, mint, amount, and debit type (fixed or variable).
2.  **Approve Mandate**: The user explicitly approves the mandate, delegating a certain amount of tokens from their token account to the mandate's Program Derived Address (PDA).
3.  **Execute Mandate**: The designated authority can execute the mandate, transferring tokens from the user's delegated token account to the authority's token account. This operation respects the debit type and amount defined in the mandate.
4.  **Modify Mandate**: The authority can modify the active state of an approved mandate.
5.  **Cancel Mandate**: The user can cancel an existing mandate, revoking the token delegation and closing the mandate account.

## How to Run Tests

The project includes a comprehensive test suite to verify the program's functionality.

1.  **Install Dependencies**:
    ```bash
    yarn install
    ```
2.  **Run Tests**:
    ```bash
    yarn test
    ```

This will execute the tests defined in `tests/mandate.test.ts`, which simulate the complete lifecycle of a mandate, including creation, approval, execution, modification, and cancellation.
