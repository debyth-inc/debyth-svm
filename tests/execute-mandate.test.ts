import * as anchor from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";
import { TOKEN_PROGRAM_ID, revoke } from "@solana/spl-token";

describe("Fixed Debit Mandate Execution", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        await testFactory.createApprovedFixedMandate(context, {
            minIntervalSeconds: new anchor.BN(1),
        });
        await testFactory.initializeExecutionState(context);
    });

    it("executes mandate with correct fixed amount", async () => {
        const DEBIT_AMOUNT = new anchor.BN(100_000);

        await context.program.methods
            .executeMandate({ amountToDebit: DEBIT_AMOUNT, nonce: new anchor.BN(1) })
            .accountsPartial({
                authority: context.authority.publicKey,
                mandate: context.mandatePda,
                executionState: context.executionStatePda,
                mint: context.mint,
                senderTokenAccount: context.senderTokenAccount,
                recipientTokenAccount: context.recipientTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([context.authority])
            .rpc();

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);

        expect(mandate.totalExecuted.toString()).to.equal("100000");
    });

    it("rejects execution with incorrect fixed amount", async () => {
        const INCORRECT_AMOUNT = new anchor.BN(50_000);

        try {
            await context.program.methods
                .executeMandate({ amountToDebit: INCORRECT_AMOUNT, nonce: new anchor.BN(1) })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    executionState: context.executionStatePda,
                    mint: context.mint,
                    senderTokenAccount: context.senderTokenAccount,
                    recipientTokenAccount: context.recipientTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([context.authority])
                .rpc();

            expect.fail("Should have rejected incorrect fixed amount");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidAmountForFixedDebit");
        }
    });

    it("rejects execution when total limit is exceeded", async () => {
        const DEBIT_AMOUNT = new anchor.BN(100_000);
        const MAX_EXECUTIONS = 10;
        const DELAY_BETWEEN_DEBITS_MS = 1500;

        for (let i = 0; i < MAX_EXECUTIONS; i++) {
            await context.program.methods
                .executeMandate({ amountToDebit: DEBIT_AMOUNT, nonce: new anchor.BN(i + 1) })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    executionState: context.executionStatePda,
                    mint: context.mint,
                    senderTokenAccount: context.senderTokenAccount,
                    recipientTokenAccount: context.recipientTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([context.authority])
                .rpc();

            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_DEBITS_MS));
        }

        // After reaching limit, mandate status becomes Complete, so further execution fails
        // with MandateNotActive (constraint check happens before limit check)
        try {
            await context.program.methods
                .executeMandate({ amountToDebit: DEBIT_AMOUNT, nonce: new anchor.BN(MAX_EXECUTIONS + 1) })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    executionState: context.executionStatePda,
                    mint: context.mint,
                    senderTokenAccount: context.senderTokenAccount,
                    recipientTokenAccount: context.recipientTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([context.authority])
                .rpc();

            expect.fail("Should have rejected execution after limit exceeded");
        } catch (error) {
            // Status becomes Complete after limit reached, so constraint fails with MandateNotActive
            expect(error.error.errorCode.code).to.equal("MandateNotActive");
        }

        // Verify mandate is in Complete state
        const mandate = await context.program.account.mandate.fetch(context.mandatePda);
        expect(mandate.status).to.deep.equal({ complete: {} });
    });

    it("rejects execution by unauthorized authority", async () => {
        const unauthorizedAuthority = Keypair.generate();
        await testFactory.airdropAndConfirm(
            unauthorizedAuthority.publicKey,
            anchor.web3.LAMPORTS_PER_SOL
        );

        try {
            await context.program.methods
                .executeMandate({ amountToDebit: new anchor.BN(100_000), nonce: new anchor.BN(1) })
                .accountsPartial({
                    authority: unauthorizedAuthority.publicKey,
                    mandate: context.mandatePda,
                    executionState: context.executionStatePda,
                    mint: context.mint,
                    senderTokenAccount: context.senderTokenAccount,
                    recipientTokenAccount: context.recipientTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([unauthorizedAuthority])
                .rpc();

            expect.fail("Should have rejected unauthorized authority");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("ConstraintSeeds");
        }
    });

    it("rejects execution before min_interval_seconds has elapsed", async () => {
        const DEBIT_AMOUNT = new anchor.BN(100_000);

        await context.program.methods
            .executeMandate({ amountToDebit: DEBIT_AMOUNT, nonce: new anchor.BN(1) })
            .accountsPartial({
                authority: context.authority.publicKey,
                mandate: context.mandatePda,
                executionState: context.executionStatePda,
                mint: context.mint,
                senderTokenAccount: context.senderTokenAccount,
                recipientTokenAccount: context.recipientTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([context.authority])
            .rpc();

        try {
            await context.program.methods
                .executeMandate({ amountToDebit: DEBIT_AMOUNT, nonce: new anchor.BN(2) })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    executionState: context.executionStatePda,
                    mint: context.mint,
                    senderTokenAccount: context.senderTokenAccount,
                    recipientTokenAccount: context.recipientTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([context.authority])
                .rpc();

            expect.fail("Should have rejected execution before frequency elapsed");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InsufficientTimeSinceLastDebit");
        }
    });

    it("rejects execution with insufficient token balance", async () => {
        const poorSenderContext = await testFactory.createTestContext();

        await testFactory.createApprovedFixedMandate(poorSenderContext, {
            amountPerDebit: new anchor.BN(2_000_000),
            totalLimit: new anchor.BN(10_000_000),
            minIntervalSeconds: new anchor.BN(1),
        });
        await testFactory.initializeExecutionState(poorSenderContext);

        try {
            await poorSenderContext.program.methods
                .executeMandate({ amountToDebit: new anchor.BN(2_000_000), nonce: new anchor.BN(1) })
                .accountsPartial({
                    authority: poorSenderContext.authority.publicKey,
                    mandate: poorSenderContext.mandatePda,
                    executionState: poorSenderContext.executionStatePda,
                    mint: poorSenderContext.mint,
                    senderTokenAccount: poorSenderContext.senderTokenAccount,
                    recipientTokenAccount: poorSenderContext.recipientTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([poorSenderContext.authority])
                .rpc();

            expect.fail("Should have rejected execution with insufficient balance");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InsufficientBalance");
        }
    });

    it("rejects execution when delegate has been revoked", async () => {
        await revoke(
            testFactory.getConnection(),
            context.sender,
            context.senderTokenAccount,
            context.sender.publicKey,
            [],
            undefined,
            TOKEN_PROGRAM_ID
        );

        try {
            await context.program.methods
                .executeMandate({ amountToDebit: new anchor.BN(100_000), nonce: new anchor.BN(1) })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    executionState: context.executionStatePda,
                    mint: context.mint,
                    senderTokenAccount: context.senderTokenAccount,
                    recipientTokenAccount: context.recipientTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([context.authority])
                .rpc();

            expect.fail("Should have rejected execution with revoked delegate");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidDelegate");
        }
    });

    it("allows execution at exact limit boundary", async () => {
        const exactLimitContext = await testFactory.createTestContext();
        await testFactory.createApprovedFixedMandate(exactLimitContext, {
            amountPerDebit: new anchor.BN(100_000),
            totalLimit: new anchor.BN(100_000),
            minIntervalSeconds: new anchor.BN(1),
        });
        await testFactory.initializeExecutionState(exactLimitContext);

        await exactLimitContext.program.methods
            .executeMandate({ amountToDebit: new anchor.BN(100_000), nonce: new anchor.BN(1) })
            .accountsPartial({
                authority: exactLimitContext.authority.publicKey,
                mandate: exactLimitContext.mandatePda,
                executionState: exactLimitContext.executionStatePda,
                mint: exactLimitContext.mint,
                senderTokenAccount: exactLimitContext.senderTokenAccount,
                recipientTokenAccount: exactLimitContext.recipientTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([exactLimitContext.authority])
            .rpc();

        const mandate = await exactLimitContext.program.account.mandate.fetch(
            exactLimitContext.mandatePda
        );
        expect(mandate.totalExecuted.toString()).to.equal("100000");
        expect(mandate.policy.lifetimeLimit.toString()).to.equal("100000");
        // After reaching exact limit, mandate status becomes Complete
        expect(mandate.status).to.deep.equal({ complete: {} });

        // Second execution should fail - mandate is now Complete (not Active)
        await new Promise(resolve => setTimeout(resolve, 1500));

        try {
            await exactLimitContext.program.methods
                .executeMandate({ amountToDebit: new anchor.BN(100_000), nonce: new anchor.BN(2) })
                .accountsPartial({
                    authority: exactLimitContext.authority.publicKey,
                    mandate: exactLimitContext.mandatePda,
                    executionState: exactLimitContext.executionStatePda,
                    mint: exactLimitContext.mint,
                    senderTokenAccount: exactLimitContext.senderTokenAccount,
                    recipientTokenAccount: exactLimitContext.recipientTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([exactLimitContext.authority])
                .rpc();

            expect.fail("Should have rejected execution after mandate complete");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("MandateNotActive");
        }
    });
});

describe("Variable Debit Mandate Execution", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        await testFactory.createApprovedVariableMandate(context, {
            amountPerDebit: new anchor.BN(1_000_000),
            totalLimit: new anchor.BN(1_000_000),
            minIntervalSeconds: new anchor.BN(1),
        });
        await testFactory.initializeExecutionState(context);
    });

    it("executes variable debits with different amounts", async () => {
        const DEBIT_AMOUNTS = [50_000, 75_000, 125_000];
        const DELAY_BETWEEN_DEBITS_MS = 1500;
        let totalDebited = 0;

        for (let i = 0; i < DEBIT_AMOUNTS.length; i++) {
            await context.program.methods
                .executeMandate({ amountToDebit: new anchor.BN(DEBIT_AMOUNTS[i]), nonce: new anchor.BN(i + 1) })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    executionState: context.executionStatePda,
                    mint: context.mint,
                    senderTokenAccount: context.senderTokenAccount,
                    recipientTokenAccount: context.recipientTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([context.authority])
                .rpc();

            totalDebited += DEBIT_AMOUNTS[i];
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_DEBITS_MS));
        }

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);
        expect(mandate.totalExecuted.toString()).to.equal(totalDebited.toString());
    });

    it("rejects variable debit with zero amount", async () => {
        try {
            await context.program.methods
                .executeMandate({ amountToDebit: new anchor.BN(0), nonce: new anchor.BN(1) })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    executionState: context.executionStatePda,
                    mint: context.mint,
                    senderTokenAccount: context.senderTokenAccount,
                    recipientTokenAccount: context.recipientTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([context.authority])
                .rpc();

            expect.fail("Should have rejected zero amount for variable debit");
        } catch (error) {
            expect(error.error?.errorCode?.code || error.error?.code).to.equal(
                "DebitAmountTooSmall"
            );
        }
    });

    it("rejects variable debit exceeding amount_per_debit", async () => {
        const highLimitContext = await testFactory.createTestContext();
        await testFactory.createApprovedVariableMandate(highLimitContext, {
            amountPerDebit: new anchor.BN(1_000_000),
            totalLimit: new anchor.BN(10_000_000),
            minIntervalSeconds: new anchor.BN(1),
        });
        await testFactory.initializeExecutionState(highLimitContext);

        const EXCESSIVE_AMOUNT = new anchor.BN(1_500_000);

        try {
            await highLimitContext.program.methods
                .executeMandate({ amountToDebit: EXCESSIVE_AMOUNT, nonce: new anchor.BN(1) })
                .accountsPartial({
                    authority: highLimitContext.authority.publicKey,
                    mandate: highLimitContext.mandatePda,
                    executionState: highLimitContext.executionStatePda,
                    mint: highLimitContext.mint,
                    senderTokenAccount: highLimitContext.senderTokenAccount,
                    recipientTokenAccount: highLimitContext.recipientTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([highLimitContext.authority])
                .rpc();

            expect.fail("Should have rejected variable debit exceeding amount_per_debit");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidAmountForVariableDebit");
        }
    });
});
