import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

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
            expect(error.error.errorCode.code).to.equal("InvalidAuthority");
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
                "InvalidAmountForVariableDebit"
            );
        }
    });
});


