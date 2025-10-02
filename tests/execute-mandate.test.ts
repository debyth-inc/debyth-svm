import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("execute_mandate", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        // Create and approve mandate
        await testFactory.createAndApproveMandate(context, {
            debitFrequencySeconds: new anchor.BN(1), // Short frequency for testing
        });
    });

    it("should execute mandate with correct fixed amount", async () => {
        const amountToDebit = new anchor.BN(100000); // Should match amountPerDebit

        await context.program.methods
            .executeMandate({ amountToDebit })
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

        const mandateAccount = await context.program.account.mandate.fetch(
            context.mandatePda
        );
        expect(mandateAccount.totalDebitedAmount.toString()).to.equal("100000");
    });

    it("should fail to execute with wrong fixed amount", async () => {
        const wrongAmount = new anchor.BN(50000); // Different from amountPerDebit

        try {
            await context.program.methods
                .executeMandate({ amountToDebit: wrongAmount })
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

            expect.fail("Should have failed with wrong fixed amount");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidAmountForFixedDebit");
        }
    });

    it("should fail to execute when limit is exceeded", async () => {
        // Execute multiple times to exceed limit
        const amountToDebit = new anchor.BN(100000);

        // Execute 10 times (10 * 100000 = 1000000, which equals the limit)
        for (let i = 0; i < 10; i++) {
            await context.program.methods
                .executeMandate({ amountToDebit })
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
            
            // Add delay to avoid time constraint issues
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        // 11th execution should fail
        try {
            await context.program.methods
                .executeMandate({ amountToDebit })
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

            expect.fail("Should have failed when limit exceeded");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("DebitLimitExceeded");
        }
    });

    it("should fail if wrong authority tries to execute", async () => {
        const wrongAuthority = Keypair.generate();
        await testFactory.airdropAndConfirm(
            wrongAuthority.publicKey,
            anchor.web3.LAMPORTS_PER_SOL
        );

        try {
            await context.program.methods
                .executeMandate({ amountToDebit: new anchor.BN(100000) })
                .accountsPartial({
                    authority: wrongAuthority.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    userTokenAccount: context.userTokenAccount,
                    destinationTokenAccount: context.authorityTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([wrongAuthority])
                .rpc();

            expect.fail("Should have failed with wrong authority");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidAuthority");
        }
    });
});

describe("variable debit mandate", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        // Create variable debit mandate
        await testFactory.createAndApproveMandate(context, {
            amountPerDebit: new anchor.BN(1000000), // Variable amount
            limit: new anchor.BN(1000000),
            isUnlimitedSpend: false,
            debitType: { variable: {} },
            debitFrequencySeconds: new anchor.BN(1),
        });
    });

    it("should execute variable debit with different amounts", async () => {
        // Execute with different amounts
        const amounts = [50000, 75000, 125000];
        let totalDebited = 0;

        for (const amount of amounts) {
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
            
            // Add delay to avoid time constraint issues
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        const mandateAccount = await context.program.account.mandate.fetch(
            context.mandatePda
        );
        expect(mandateAccount.totalDebitedAmount.toString()).to.equal(
            totalDebited.toString()
        );
    });

    it("should fail variable debit with zero amount", async () => {
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

            expect.fail("Should have failed with zero amount for variable debit");
        } catch (error) {
            expect(error.error?.errorCode?.code || error.error?.code).to.equal(
                "InvalidAmountForVariableDebit"
            );
        }
    });
});


