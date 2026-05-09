import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";
import { TOKEN_PROGRAM_ID, freezeAccount, thawAccount } from "@solana/spl-token";

describe("Security: Modify Mandate Edge Cases", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        await testFactory.createApprovedFixedMandate(context, {
            amountPerDebit: new anchor.BN(100_000),
            limit: new anchor.BN(1_000_000),
            debitFrequencySeconds: new anchor.BN(1),
        });
    });

    it("rejects limit reduction below total_debited_amount", async () => {
        const DEBIT_AMOUNT = new anchor.BN(100_000);
        const DELAY_MS = 1500;

        // Execute 5 debits to reach 500k total
        for (let i = 0; i < 5; i++) {
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

            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);
        expect(mandate.totalDebitedAmount.toString()).to.equal("500000");

        // Try to reduce limit to 300k (below 500k debited)
        try {
            await context.program.methods
                .modifyMandate({
                    newAmountPerDebit: new anchor.BN(100_000),
                    newLimit: new anchor.BN(300_000), // Less than total_debited_amount
                    newIsUnlimitedSpend: false,
                    newDebitType: { fixed: {} },
                    newDebitFrequencySeconds: new anchor.BN(1),
                })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    user: context.user.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    userTokenAccount: context.userTokenAccount,
                    associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([context.authority, context.user])
                .rpc();

            expect.fail("Should have rejected limit reduction below total_debited_amount");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidSpendCap");
        }
    });

    it("handles transition from unlimited to limited spend with validation", async () => {
        // Create unlimited mandate
        const unlimitedContext = await testFactory.createTestContext();

        // Mint additional tokens to user for this test (need 1.5M total, initial is 1M)
        const { mintTo } = await import("@solana/spl-token");
        await mintTo(
            testFactory.getConnection(),
            unlimitedContext.authority,
            unlimitedContext.mint,
            unlimitedContext.userTokenAccount,
            unlimitedContext.authority,
            1_000_000 // Additional 1M tokens (now has 2M total)
        );

        await testFactory.createApprovedUnlimitedMandate(unlimitedContext, {
            amountPerDebit: new anchor.BN(500_000), // Max per debit
            debitType: { variable: {} },
            debitFrequencySeconds: new anchor.BN(1),
        });

        // Execute several large debits
        const LARGE_DEBIT = new anchor.BN(500_000);
        const DELAY_MS = 2000; // Increased delay to ensure frequency check passes

        for (let i = 0; i < 3; i++) {
            await unlimitedContext.program.methods
                .executeMandate({ amountToDebit: LARGE_DEBIT })
                .accountsPartial({
                    authority: unlimitedContext.authority.publicKey,
                    mandate: unlimitedContext.mandatePda,
                    mint: unlimitedContext.mint,
                    userTokenAccount: unlimitedContext.userTokenAccount,
                    destinationTokenAccount: unlimitedContext.authorityTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([unlimitedContext.authority])
                .rpc();

            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }

        // Total debited should be 1.5M now
        const mandateBefore = await unlimitedContext.program.account.mandate.fetch(
            unlimitedContext.mandatePda
        );
        expect(mandateBefore.totalDebitedAmount.toString()).to.equal("1500000");

        // Try to modify to limited with limit less than debited amount
        try {
            await unlimitedContext.program.methods
                .modifyMandate({
                    newAmountPerDebit: new anchor.BN(100_000),
                    newLimit: new anchor.BN(1_000_000), // Less than 1.5M debited
                    newIsUnlimitedSpend: false,
                    newDebitType: { variable: {} },
                    newDebitFrequencySeconds: new anchor.BN(1),
                })
                .accountsPartial({
                    authority: unlimitedContext.authority.publicKey,
                    user: unlimitedContext.user.publicKey,
                    mandate: unlimitedContext.mandatePda,
                    mint: unlimitedContext.mint,
                    userTokenAccount: unlimitedContext.userTokenAccount,
                    associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([unlimitedContext.authority, unlimitedContext.user])
                .rpc();

            expect.fail("Should have rejected unlimited to limited with insufficient limit");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidSpendCap");
        }

        // Should succeed with higher limit
        await unlimitedContext.program.methods
            .modifyMandate({
                newAmountPerDebit: new anchor.BN(100_000),
                newLimit: new anchor.BN(2_000_000), // Greater than 1.5M debited
                newIsUnlimitedSpend: false,
                newDebitType: { variable: {} },
                newDebitFrequencySeconds: new anchor.BN(1),
            })
            .accountsPartial({
                authority: unlimitedContext.authority.publicKey,
                user: unlimitedContext.user.publicKey,
                mandate: unlimitedContext.mandatePda,
                mint: unlimitedContext.mint,
                userTokenAccount: unlimitedContext.userTokenAccount,
                associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([unlimitedContext.authority, unlimitedContext.user])
            .rpc();

        const mandateAfter = await unlimitedContext.program.account.mandate.fetch(
            unlimitedContext.mandatePda
        );
        expect(mandateAfter.isUnlimitedSpend).to.be.false;
        expect(mandateAfter.limit.toString()).to.equal("2000000");
    });
});

describe("Security: Time Overflow and Frequency Edge Cases", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    it("handles extreme debit_frequency_seconds without overflow", async () => {
        context = await testFactory.createTestContext();

        // Create mandate with very large frequency at the maximum allowed value (10 years)
        // MAX_DEBIT_FREQUENCY_SECONDS = 31_536_000 * 10 = 315_360_000 seconds
        const EXTREME_FREQUENCY = new anchor.BN(315_360_000);

        await testFactory.createApprovedFixedMandate(context, {
            amountPerDebit: new anchor.BN(100_000),
            limit: new anchor.BN(1_000_000),
            debitFrequencySeconds: EXTREME_FREQUENCY,
        });

        // Execute first debit - should succeed
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

        // Immediate second execution should fail with proper error (not overflow)
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

            expect.fail("Should have rejected execution before frequency elapsed");
        } catch (error) {
            // Should get frequency error, not arithmetic overflow
            expect(error.error?.errorCode?.code || error.error?.code).to.equal(
                "InsufficientTimeSinceLastDebit"
            );
        }
    });
});

describe("Security: Authority Cancel Edge Cases", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        await testFactory.createApprovedFixedMandate(context, {
            debitFrequencySeconds: new anchor.BN(1),
        });
    });

    it("authority cancel closes mandate (delegation remains until user revokes)", async () => {
        // Authority can cancel without user signature
        // Note: Delegation is not explicitly revoked (only owner can revoke), but the
        // mandate PDA is closed, making any remaining delegation to it useless
        await context.program.methods
            .cancelMandate()
            .accountsPartial({
                authority: context.authority.publicKey,
                user: context.user.publicKey,
                mandate: context.mandatePda,
                mint: context.mint,
                userTokenAccount: context.userTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([context.authority])
            .rpc();

        // Mandate account should be closed
        try {
            await context.program.account.mandate.fetch(context.mandatePda);
            expect.fail("Mandate account should be closed");
        } catch (error) {
            expect(error.message).to.include("Account does not exist");
        }

        // Note: Delegation technically remains in token account state (pointing to non-existent PDA)
        // User can revoke it themselves if desired, but it's harmless since the PDA no longer exists
    });
});

describe("Security: Mandate ID Reuse", () => {
    const testFactory = TestFactory.getInstance();

    it("allows mandate ID reuse by same authority after cancellation", async () => {
        const context1 = await testFactory.createTestContext();
        const authority = context1.authority;
        const mandateId = context1.mandateId;

        // Create and approve first mandate
        await testFactory.createApprovedFixedMandate(context1);

        // Cancel it (authority can cancel without user signature)
        await context1.program.methods
            .cancelMandate()
            .accountsPartial({
                authority: context1.authority.publicKey,
                user: context1.user.publicKey,
                mandate: context1.mandatePda,
                mint: context1.mint,
                userTokenAccount: context1.userTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([context1.authority])
            .rpc();

        // Create new context with SAME authority and SAME mandate ID
        const user2 = Keypair.generate();
        await testFactory.airdropAndConfirm(
            user2.publicKey,
            2 * anchor.web3.LAMPORTS_PER_SOL
        );

        // Calculate PDA with same authority and mandate ID
        const [mandatePda2] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("mandate"),
                authority.publicKey.toBuffer(),
                mandateId.toArrayLike(Buffer, "le", 8),
            ],
            context1.program.programId
        );

        // Now mandate is closed, should be able to reuse the ID
        // Create new user token account for user2
        const user2TokenAccount = await testFactory.createTokenAccount(
            context1.mint,
            user2.publicKey
        );

        // This should SUCCEED now because mandate account was closed
        await context1.program.methods
            .createMandate(mandateId, {
                amountPerDebit: new anchor.BN(50_000),
                limit: new anchor.BN(500_000),
                isUnlimitedSpend: false,
                debitType: { fixed: {} },
                debitFrequencySeconds: new anchor.BN(60),
            })
            .accountsPartial({
                authority: authority.publicKey,
                user: user2.publicKey,
                mandate: mandatePda2,
                mint: context1.mint,
                userTokenAccount: user2TokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([authority])
            .rpc();

        // Verify new mandate was created
        const newMandate = await context1.program.account.mandate.fetch(mandatePda2);
        expect(newMandate.id.toString()).to.equal(mandateId.toString());
        expect(newMandate.user.toString()).to.equal(user2.publicKey.toString());
    });

    it("prevents different authority from using same mandate ID", async () => {
        const context1 = await testFactory.createTestContext();
        const context2 = await testFactory.createTestContext();

        // Use same mandate ID
        const sharedMandateId = new anchor.BN(999999);

        // Authority 1 creates mandate
        const [pda1] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("mandate"),
                context1.authority.publicKey.toBuffer(),
                sharedMandateId.toArrayLike(Buffer, "le", 8),
            ],
            context1.program.programId
        );

        await context1.program.methods
            .createMandate(sharedMandateId, {
                amountPerDebit: new anchor.BN(100_000),
                limit: new anchor.BN(1_000_000),
                isUnlimitedSpend: false,
                debitType: { fixed: {} },
                debitFrequencySeconds: new anchor.BN(60),
            })
            .accountsPartial({
                authority: context1.authority.publicKey,
                user: context1.user.publicKey,
                mandate: pda1,
                mint: context1.mint,
                userTokenAccount: context1.userTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([context1.authority])
            .rpc();

        // Authority 2 creates mandate with same ID - should succeed (different PDA)
        const [pda2] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("mandate"),
                context2.authority.publicKey.toBuffer(),
                sharedMandateId.toArrayLike(Buffer, "le", 8),
            ],
            context2.program.programId
        );

        // PDAs should be different
        expect(pda1.toString()).to.not.equal(pda2.toString());

        await context2.program.methods
            .createMandate(sharedMandateId, {
                amountPerDebit: new anchor.BN(50_000),
                limit: new anchor.BN(500_000),
                isUnlimitedSpend: false,
                debitType: { variable: {} },
                debitFrequencySeconds: new anchor.BN(30),
            })
            .accountsPartial({
                authority: context2.authority.publicKey,
                user: context2.user.publicKey,
                mandate: pda2,
                mint: context2.mint,
                userTokenAccount: context2.userTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([context2.authority])
            .rpc();

        // Both mandates should exist independently
        const mandate1 = await context1.program.account.mandate.fetch(pda1);
        const mandate2 = await context2.program.account.mandate.fetch(pda2);

        expect(mandate1.authority.toString()).to.equal(context1.authority.publicKey.toString());
        expect(mandate2.authority.toString()).to.equal(context2.authority.publicKey.toString());
    });
});

describe("Security: Arithmetic Edge Cases", () => {
    const testFactory = TestFactory.getInstance();

    it("handles unlimited mandate with large debit amounts", async () => {
        const context = await testFactory.createTestContext();

        // Create unlimited variable mandate with high amount per debit at MAX_DEBIT_AMOUNT
        // MAX_DEBIT_AMOUNT = u64::MAX / 2
        const LARGE_AMOUNT = new anchor.BN("9223372036854775807"); // u64::MAX / 2

        await testFactory.createApprovedUnlimitedMandate(context, {
            amountPerDebit: LARGE_AMOUNT,
            debitType: { variable: {} },
            debitFrequencySeconds: new anchor.BN(1),
        });

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);

        // Verify unlimited allowance is set correctly
        expect(mandate.limit.toString()).to.equal("18446744073709551615");
        expect(mandate.isUnlimitedSpend).to.be.true;
        expect(mandate.amountPerDebit.toString()).to.equal(LARGE_AMOUNT.toString());
    });
});

describe("Security: Token Account State Edge Cases", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        // Create context with freeze authority enabled
        context = await testFactory.createTestContext(true);
        await testFactory.createApprovedFixedMandate(context, {
            debitFrequencySeconds: new anchor.BN(1),
        });
    });

    it("rejects execution when token account is frozen", async () => {
        // Freeze the user's token account
        await freezeAccount(
            testFactory.getConnection(),
            context.authority, // Freeze authority (mint authority)
            context.userTokenAccount,
            context.mint,
            context.authority,
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

            expect.fail("Should have rejected execution on frozen account");
        } catch (error) {
            // SPL Token will throw error about frozen account
            expect(error).to.exist;
        }

        // Cleanup: thaw the account for other tests
        await thawAccount(
            testFactory.getConnection(),
            context.authority,
            context.userTokenAccount,
            context.mint,
            context.authority,
            [],
            undefined,
            TOKEN_PROGRAM_ID
        );
    });
});

describe("Security: Multiple Mandates on Same Token Account", () => {
    const testFactory = TestFactory.getInstance();

    it("prevents multiple mandates from delegating same token account", async () => {
        const context1 = await testFactory.createTestContext();
        const authority2 = Keypair.generate();
        await testFactory.airdropAndConfirm(
            authority2.publicKey,
            2 * anchor.web3.LAMPORTS_PER_SOL
        );

        // Create and approve first mandate
        await testFactory.createApprovedFixedMandate(context1);

        // Try to create second mandate with different authority but same user
        // This should fail because the token account is already delegated
        const mandateId2 = new anchor.BN(Math.floor(Math.random() * 1000000));
        const [mandatePda2] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("mandate"),
                authority2.publicKey.toBuffer(),
                mandateId2.toArrayLike(Buffer, "le", 8),
            ],
            context1.program.programId
        );

        try {
            await context1.program.methods
                .createMandate(mandateId2, {
                    amountPerDebit: new anchor.BN(50_000),
                    limit: new anchor.BN(500_000),
                    isUnlimitedSpend: false,
                    debitType: { fixed: {} },
                    debitFrequencySeconds: new anchor.BN(60),
                })
                .accountsPartial({
                    authority: authority2.publicKey,
                    user: context1.user.publicKey,
                    mandate: mandatePda2,
                    mint: context1.mint,
                    userTokenAccount: context1.userTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([authority2])
                .rpc();

            expect.fail("Should have rejected creation - token already delegated");
        } catch (error) {
            expect(error.error?.errorCode?.code).to.equal("TokenAlreadyDelegated");
        }
    });
});
