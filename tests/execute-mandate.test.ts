import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";
import { TOKEN_PROGRAM_ID, revoke } from "@solana/spl-token";

describe("Fixed Debit Mandate Execution", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        await testFactory.createApprovedFixedMandate(context, {
            debitFrequencySeconds: new anchor.BN(1), // Short frequency for testing
        });
    });

    it("executes mandate with correct fixed amount", async () => {
        const DEBIT_AMOUNT = new anchor.BN(100_000); // Matches default amountPerDebit

        await context.program.methods
            .executeMandate({ amountToDebit: DEBIT_AMOUNT })
            .accountsPartial({
                authority: context.authority.publicKey,
                mandate: context.mandatePda,
                mint: context.mint,
                userTokenAccount: context.userTokenAccount,
                destinationTokenAccount: context.authorityTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([context.authority])
            .rpc();

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);

        expect(mandate.totalDebitedAmount.toString()).to.equal("100000");
    });

    it("rejects execution with incorrect fixed amount", async () => {
        const INCORRECT_AMOUNT = new anchor.BN(50_000); // Different from amountPerDebit

        try {
            await context.program.methods
                .executeMandate({ amountToDebit: INCORRECT_AMOUNT })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    userTokenAccount: context.userTokenAccount,
                    destinationTokenAccount: context.authorityTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
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
        const MAX_EXECUTIONS = 10; // 10 * 100_000 = 1_000_000 (equals limit)
        const DELAY_BETWEEN_DEBITS_MS = 1500;

        for (let i = 0; i < MAX_EXECUTIONS; i++) {
            await context.program.methods
                .executeMandate({ amountToDebit: DEBIT_AMOUNT })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    userTokenAccount: context.userTokenAccount,
                    destinationTokenAccount: context.authorityTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([context.authority])
                .rpc();

            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_DEBITS_MS));
        }

        try {
            await context.program.methods
                .executeMandate({ amountToDebit: DEBIT_AMOUNT })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    userTokenAccount: context.userTokenAccount,
                    destinationTokenAccount: context.authorityTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([context.authority])
                .rpc();

            expect.fail("Should have rejected execution after limit exceeded");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("DebitLimitExceeded");
        }
    });

    it("rejects execution by unauthorized authority", async () => {
        const unauthorizedAuthority = Keypair.generate();
        await testFactory.airdropAndConfirm(
            unauthorizedAuthority.publicKey,
            anchor.web3.LAMPORTS_PER_SOL
        );

        try {
            await context.program.methods
                .executeMandate({ amountToDebit: new anchor.BN(100_000) })
                .accountsPartial({
                    authority: unauthorizedAuthority.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    userTokenAccount: context.userTokenAccount,
                    destinationTokenAccount: context.authorityTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([unauthorizedAuthority])
                .rpc();

            expect.fail("Should have rejected unauthorized authority");
        } catch (error) {
            // PDA seeds constraint fails first (seeds include authority)
            expect(error.error.errorCode.code).to.equal("ConstraintSeeds");
        }
    });

    it("rejects execution before debit_frequency_seconds has elapsed", async () => {
        const DEBIT_AMOUNT = new anchor.BN(100_000);

        // First execution should succeed
        await context.program.methods
            .executeMandate({ amountToDebit: DEBIT_AMOUNT })
            .accountsPartial({
                authority: context.authority.publicKey,
                mandate: context.mandatePda,
                mint: context.mint,
                userTokenAccount: context.userTokenAccount,
                destinationTokenAccount: context.authorityTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([context.authority])
            .rpc();

        // Immediate second execution should fail
        try {
            await context.program.methods
                .executeMandate({ amountToDebit: DEBIT_AMOUNT })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    userTokenAccount: context.userTokenAccount,
                    destinationTokenAccount: context.authorityTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([context.authority])
                .rpc();

            expect.fail("Should have rejected execution before frequency elapsed");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InsufficientTimeSinceLastDebit");
        }
    });

    it("rejects execution with insufficient token balance", async () => {
        // Create a new context with minimal token balance
        const poorUserContext = await testFactory.createTestContext();

        // Create mandate with high debit amount
        await testFactory.createApprovedFixedMandate(poorUserContext, {
            amountPerDebit: new anchor.BN(2_000_000), // More than user has (1_000_000)
            limit: new anchor.BN(10_000_000),
            debitFrequencySeconds: new anchor.BN(1),
        });

        try {
            await poorUserContext.program.methods
                .executeMandate({ amountToDebit: new anchor.BN(2_000_000) })
                .accountsPartial({
                    authority: poorUserContext.authority.publicKey,
                    mandate: poorUserContext.mandatePda,
                    mint: poorUserContext.mint,
                    userTokenAccount: poorUserContext.userTokenAccount,
                    destinationTokenAccount: poorUserContext.authorityTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([poorUserContext.authority])
                .rpc();

            expect.fail("Should have rejected execution with insufficient balance");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InsufficientBalance");
        }
    });

    it("rejects execution when delegate has been revoked", async () => {
        // Revoke the delegation after approval
        await revoke(
            testFactory.getConnection(),
            context.user,
            context.userTokenAccount,
            context.user.publicKey,
            [],
            undefined,
            TOKEN_PROGRAM_ID
        );

        try {
            await context.program.methods
                .executeMandate({ amountToDebit: new anchor.BN(100_000) })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    userTokenAccount: context.userTokenAccount,
                    destinationTokenAccount: context.authorityTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
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
            limit: new anchor.BN(100_000), // Exact same as amount
            debitFrequencySeconds: new anchor.BN(1),
        });

        // Should succeed - exactly at limit
        await exactLimitContext.program.methods
            .executeMandate({ amountToDebit: new anchor.BN(100_000) })
            .accountsPartial({
                authority: exactLimitContext.authority.publicKey,
                mandate: exactLimitContext.mandatePda,
                mint: exactLimitContext.mint,
                userTokenAccount: exactLimitContext.userTokenAccount,
                destinationTokenAccount: exactLimitContext.authorityTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([exactLimitContext.authority])
            .rpc();

        const mandate = await exactLimitContext.program.account.mandate.fetch(
            exactLimitContext.mandatePda
        );
        expect(mandate.totalDebitedAmount.toString()).to.equal("100000");
        expect(mandate.limit.toString()).to.equal("100000");

        // Second execution should fail - now over limit
        await new Promise(resolve => setTimeout(resolve, 1500));

        try {
            await exactLimitContext.program.methods
                .executeMandate({ amountToDebit: new anchor.BN(100_000) })
                .accountsPartial({
                    authority: exactLimitContext.authority.publicKey,
                    mandate: exactLimitContext.mandatePda,
                    mint: exactLimitContext.mint,
                    userTokenAccount: exactLimitContext.userTokenAccount,
                    destinationTokenAccount: exactLimitContext.authorityTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([exactLimitContext.authority])
                .rpc();

            expect.fail("Should have rejected execution over limit");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("DebitLimitExceeded");
        }
    });
});

describe("Variable Debit Mandate Execution", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        await testFactory.createApprovedVariableMandate(context, {
            amountPerDebit: new anchor.BN(1_000_000), // Not enforced for variable
            limit: new anchor.BN(1_000_000),
            debitFrequencySeconds: new anchor.BN(1),
        });
    });

    it("executes variable debits with different amounts", async () => {
        const DEBIT_AMOUNTS = [50_000, 75_000, 125_000];
        const DELAY_BETWEEN_DEBITS_MS = 1500;
        let totalDebited = 0;

        for (const amount of DEBIT_AMOUNTS) {
            await context.program.methods
                .executeMandate({ amountToDebit: new anchor.BN(amount) })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    userTokenAccount: context.userTokenAccount,
                    destinationTokenAccount: context.authorityTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([context.authority])
                .rpc();

            totalDebited += amount;
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_DEBITS_MS));
        }

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);
        expect(mandate.totalDebitedAmount.toString()).to.equal(totalDebited.toString());
    });

    it("rejects variable debit with zero amount", async () => {
        try {
            await context.program.methods
                .executeMandate({ amountToDebit: new anchor.BN(0) })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    userTokenAccount: context.userTokenAccount,
                    destinationTokenAccount: context.authorityTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
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
        // Create context with higher limit to avoid DebitLimitExceeded error
        const highLimitContext = await testFactory.createTestContext();
        await testFactory.createApprovedVariableMandate(highLimitContext, {
            amountPerDebit: new anchor.BN(1_000_000), // Max per debit: 1 token
            limit: new anchor.BN(10_000_000), // Total limit: 10 tokens (high enough)
            debitFrequencySeconds: new anchor.BN(1),
        });

        const EXCESSIVE_AMOUNT = new anchor.BN(1_500_000); // 1.5 tokens (exceeds amount_per_debit)

        try {
            await highLimitContext.program.methods
                .executeMandate({ amountToDebit: EXCESSIVE_AMOUNT })
                .accountsPartial({
                    authority: highLimitContext.authority.publicKey,
                    mandate: highLimitContext.mandatePda,
                    mint: highLimitContext.mint,
                    userTokenAccount: highLimitContext.userTokenAccount,
                    destinationTokenAccount: highLimitContext.authorityTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([highLimitContext.authority])
                .rpc();

            expect.fail("Should have rejected variable debit exceeding amount_per_debit");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidAmountForVariableDebit");
        }
    });
});


