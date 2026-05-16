import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, freezeAccount, thawAccount } from "@solana/spl-token";

describe("Security: Modify Mandate Edge Cases", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        await testFactory.createApprovedFixedMandate(context, {
            amountPerDebit: new anchor.BN(100_000),
            totalLimit: new anchor.BN(1_000_000),
            minIntervalSeconds: new anchor.BN(1),
        });
    });

    it("rejects limit reduction below total_executed", async () => {
        const DEBIT_AMOUNT = new anchor.BN(100_000);
        const DELAY_MS = 1500;

        await testFactory.initializeExecutionState(context);

        for (let i = 0; i < 5; i++) {
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

            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);
        expect(mandate.totalExecuted.toString()).to.equal("500000");

        const now = Math.floor(Date.now() / 1000);
        const newPolicyHash = Array(32).fill(0).map((_, i) => (i === 0 ? 2 : 0));
        const SIGNATURE_NONCE = new anchor.BN(1);

        try {
            await context.program.methods
                .modifyMandate({
                    newAmountPerDebit: new anchor.BN(100_000),
                    newTotalLimit: new anchor.BN(300_000),
                    newIsUnlimitedSpend: false,
                    newChargeType: { fixed: {} },
                    newFrequency: { daily: {} },
                    newMinIntervalSeconds: new anchor.BN(1),
                    newStartAt: new anchor.BN(now - 3600),
                    newEndAt: new anchor.BN(now + 365 * 86400),
                    newAllowedRecipients: [],
                    newAllowedAssets: [],
                    newPolicyHash,
                    signatureNonce: SIGNATURE_NONCE,
                })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    sender: context.sender.publicKey,
                    recipient: context.recipient.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    senderTokenAccount: context.senderTokenAccount,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([context.authority, context.sender])
                .rpc();

            expect.fail("Should have rejected limit reduction below total_executed");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidSpendCap");
        }
    });

    it("handles transition from unlimited to limited spend with validation", async () => {
        const unlimitedContext = await testFactory.createTestContext();

        const { mintTo } = await import("@solana/spl-token");
        await mintTo(
            testFactory.getConnection(),
            unlimitedContext.authority,
            unlimitedContext.mint,
            unlimitedContext.senderTokenAccount,
            unlimitedContext.authority,
            1_000_000
        );

        await testFactory.createApprovedUnlimitedMandate(unlimitedContext, {
            amountPerDebit: new anchor.BN(500_000),
            chargeType: { variable: {} },
            minIntervalSeconds: new anchor.BN(1),
        });
        await testFactory.initializeExecutionState(unlimitedContext);

        const LARGE_DEBIT = new anchor.BN(500_000);
        const DELAY_MS = 2000;

        for (let i = 0; i < 3; i++) {
            await unlimitedContext.program.methods
                .executeMandate({ amountToDebit: LARGE_DEBIT, nonce: new anchor.BN(i + 1) })
                .accountsPartial({
                    authority: unlimitedContext.authority.publicKey,
                    mandate: unlimitedContext.mandatePda,
                    executionState: unlimitedContext.executionStatePda,
                    mint: unlimitedContext.mint,
                    senderTokenAccount: unlimitedContext.senderTokenAccount,
                    recipientTokenAccount: unlimitedContext.recipientTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([unlimitedContext.authority])
                .rpc();

            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }

        const mandateBefore = await unlimitedContext.program.account.mandate.fetch(
            unlimitedContext.mandatePda
        );
        expect(mandateBefore.totalExecuted.toString()).to.equal("1500000");

        const now = Math.floor(Date.now() / 1000);
        const newPolicyHash = Array(32).fill(0).map((_, i) => (i === 0 ? 2 : 0));
        const SIGNATURE_NONCE = new anchor.BN(1);

        try {
            await unlimitedContext.program.methods
                .modifyMandate({
                    newAmountPerDebit: new anchor.BN(100_000),
                    newTotalLimit: new anchor.BN(1_000_000),
                    newIsUnlimitedSpend: false,
                    newChargeType: { variable: {} },
                    newFrequency: { daily: {} },
                    newMinIntervalSeconds: new anchor.BN(1),
                    newStartAt: new anchor.BN(now - 3600),
                    newEndAt: new anchor.BN(now + 365 * 86400),
                    newAllowedRecipients: [],
                    newAllowedAssets: [],
                    newPolicyHash,
                    signatureNonce: SIGNATURE_NONCE,
                })
                .accountsPartial({
                    authority: unlimitedContext.authority.publicKey,
                    sender: unlimitedContext.sender.publicKey,
                    recipient: unlimitedContext.recipient.publicKey,
                    mandate: unlimitedContext.mandatePda,
                    mint: unlimitedContext.mint,
                    senderTokenAccount: unlimitedContext.senderTokenAccount,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([unlimitedContext.authority, unlimitedContext.sender])
                .rpc();

            expect.fail("Should have rejected unlimited to limited with insufficient limit");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidSpendCap");
        }

        const newPolicyHash2 = Array(32).fill(0).map((_, i) => (i === 0 ? 3 : 0));
        const SIGNATURE_NONCE2 = new anchor.BN(2);

        await unlimitedContext.program.methods
            .modifyMandate({
                newAmountPerDebit: new anchor.BN(100_000),
                newTotalLimit: new anchor.BN(2_000_000),
                newIsUnlimitedSpend: false,
                newChargeType: { variable: {} },
                newFrequency: { daily: {} },
                newMinIntervalSeconds: new anchor.BN(1),
                newStartAt: new anchor.BN(now - 3600),
                newEndAt: new anchor.BN(now + 365 * 86400),
                newAllowedRecipients: [],
                newAllowedAssets: [],
                newPolicyHash: newPolicyHash2,
                signatureNonce: SIGNATURE_NONCE2,
            })
            .accountsPartial({
                authority: unlimitedContext.authority.publicKey,
                sender: unlimitedContext.sender.publicKey,
                recipient: unlimitedContext.recipient.publicKey,
                mandate: unlimitedContext.mandatePda,
                mint: unlimitedContext.mint,
                senderTokenAccount: unlimitedContext.senderTokenAccount,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([unlimitedContext.authority, unlimitedContext.sender])
            .rpc();

        const mandateAfter = await unlimitedContext.program.account.mandate.fetch(
            unlimitedContext.mandatePda
        );
        expect(mandateAfter.policy.lifetimeLimit.toString()).to.equal("2000000");
    });
});

describe("Security: Time Overflow and Frequency Edge Cases", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    it("handles extreme min_interval_seconds without overflow", async () => {
        context = await testFactory.createTestContext();

        const EXTREME_FREQUENCY = new anchor.BN(315_360_000);

        await testFactory.createApprovedFixedMandate(context, {
            amountPerDebit: new anchor.BN(100_000),
            totalLimit: new anchor.BN(1_000_000),
            minIntervalSeconds: EXTREME_FREQUENCY,
        });
        await testFactory.initializeExecutionState(context);

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

        try {
            await context.program.methods
                .executeMandate({ amountToDebit: new anchor.BN(100_000), nonce: new anchor.BN(2) })
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
            minIntervalSeconds: new anchor.BN(1),
        });
    });

    it("authority cancel closes mandate (delegation remains until sender revokes)", async () => {
        await context.program.methods
            .cancelMandate()
            .accountsPartial({
                authority: context.authority.publicKey,
                sender: context.sender.publicKey,
                recipient: context.recipient.publicKey,
                mandate: context.mandatePda,
                mint: context.mint,
                senderTokenAccount: context.senderTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([context.authority])
            .rpc();

        try {
            await context.program.account.mandate.fetch(context.mandatePda);
            expect.fail("Mandate account should be closed");
        } catch (error) {
            expect(error.message).to.include("Account does not exist");
        }
    });
});

describe("Security: Mandate ID Reuse", () => {
    const testFactory = TestFactory.getInstance();

    it("allows mandate ID reuse by same authority after cancellation", async () => {
        const context1 = await testFactory.createTestContext();
        const authority = context1.authority;
        const mandateId = context1.mandateId;

        await testFactory.createApprovedFixedMandate(context1);

        await context1.program.methods
            .cancelMandate()
            .accountsPartial({
                authority: context1.authority.publicKey,
                sender: context1.sender.publicKey,
                recipient: context1.recipient.publicKey,
                mandate: context1.mandatePda,
                mint: context1.mint,
                senderTokenAccount: context1.senderTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([context1.authority])
            .rpc();

        const sender2 = Keypair.generate();
        await testFactory.airdropAndConfirm(
            sender2.publicKey,
            2 * anchor.web3.LAMPORTS_PER_SOL
        );

        const [mandatePda2] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("mandate"),
                authority.publicKey.toBuffer(),
                mandateId.toArrayLike(Buffer, "le", 8),
            ],
            context1.program.programId
        );

        const sender2TokenAccount = await testFactory.createTokenAccount(
            context1.mint,
            sender2.publicKey,
            context1.authority
        );

        const now = Math.floor(Date.now() / 1000);

        await context1.program.methods
            .createMandate(mandateId, {
                sender: sender2.publicKey,
                recipient: context1.recipient.publicKey,
                amountPerDebit: new anchor.BN(50_000),
                totalLimit: new anchor.BN(500_000),
                isUnlimitedSpend: false,
                chargeType: { fixed: {} },
                frequency: { daily: {} },
                minIntervalSeconds: new anchor.BN(60),
                startAt: new anchor.BN(now - 3600),
                endAt: new anchor.BN(now + 365 * 86400),
                allowedRecipients: [],
                allowedAssets: [],
                policyHash: Array(32).fill(0).map((_, i) => i === 0 ? 1 : 0),
            })
            .accountsPartial({
                authority: authority.publicKey,
                sender: sender2.publicKey,
                recipient: context1.recipient.publicKey,
                mandate: mandatePda2,
                mint: context1.mint,
                senderTokenAccount: sender2TokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([authority])
            .rpc();

        const newMandate = await context1.program.account.mandate.fetch(mandatePda2);
        expect(newMandate.id.toString()).to.equal(mandateId.toString());
        expect(newMandate.sender.toString()).to.equal(sender2.publicKey.toString());
    });

    it("prevents different authority from using same mandate ID", async () => {
        const context1 = await testFactory.createTestContext();
        const context2 = await testFactory.createTestContext();

        const sharedMandateId = new anchor.BN(999999);

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
                sender: context1.sender.publicKey,
                recipient: context1.recipient.publicKey,
                amountPerDebit: new anchor.BN(100_000),
                totalLimit: new anchor.BN(1_000_000),
                isUnlimitedSpend: false,
                chargeType: { fixed: {} },
                frequency: { daily: {} },
                minIntervalSeconds: new anchor.BN(60),
                startAt: new anchor.BN(Math.floor(Date.now() / 1000) - 3600),
                endAt: new anchor.BN(Math.floor(Date.now() / 1000) + 365 * 86400),
                allowedRecipients: [],
                allowedAssets: [],
                policyHash: Array(32).fill(0).map((_, i) => i === 0 ? 1 : 0),
            })
            .accountsPartial({
                authority: context1.authority.publicKey,
                sender: context1.sender.publicKey,
                recipient: context1.recipient.publicKey,
                mandate: pda1,
                mint: context1.mint,
                senderTokenAccount: context1.senderTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([context1.authority])
            .rpc();

        const [pda2] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("mandate"),
                context2.authority.publicKey.toBuffer(),
                sharedMandateId.toArrayLike(Buffer, "le", 8),
            ],
            context2.program.programId
        );

        expect(pda1.toString()).to.not.equal(pda2.toString());

        await context2.program.methods
            .createMandate(sharedMandateId, {
                sender: context2.sender.publicKey,
                recipient: context2.recipient.publicKey,
                amountPerDebit: new anchor.BN(50_000),
                totalLimit: new anchor.BN(500_000),
                isUnlimitedSpend: false,
                chargeType: { variable: {} },
                frequency: { daily: {} },
                minIntervalSeconds: new anchor.BN(30),
                startAt: new anchor.BN(Math.floor(Date.now() / 1000) - 3600),
                endAt: new anchor.BN(Math.floor(Date.now() / 1000) + 365 * 86400),
                allowedRecipients: [],
                allowedAssets: [],
                policyHash: Array(32).fill(0).map((_, i) => i === 0 ? 1 : 0),
            })
            .accountsPartial({
                authority: context2.authority.publicKey,
                sender: context2.sender.publicKey,
                recipient: context2.recipient.publicKey,
                mandate: pda2,
                mint: context2.mint,
                senderTokenAccount: context2.senderTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([context2.authority])
            .rpc();

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

        const LARGE_AMOUNT = new anchor.BN("9223372036854775807");

        await testFactory.createApprovedUnlimitedMandate(context, {
            amountPerDebit: LARGE_AMOUNT,
            chargeType: { variable: {} },
            minIntervalSeconds: new anchor.BN(1),
        });

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);

        expect(mandate.policy.lifetimeLimit.toString()).to.equal("18446744073709551615");
        expect(mandate.policy.perExecutionLimit.toString()).to.equal(LARGE_AMOUNT.toString());
    });
});

describe("Security: Token Account State Edge Cases", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext(true);
        await testFactory.createApprovedFixedMandate(context, {
            minIntervalSeconds: new anchor.BN(1),
        });
        await testFactory.initializeExecutionState(context);
    });

    it("rejects execution when token account is frozen", async () => {
        await freezeAccount(
            testFactory.getConnection(),
            context.authority,
            context.senderTokenAccount,
            context.mint,
            context.authority,
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

            expect.fail("Should have rejected execution on frozen account");
        } catch (error) {
            expect(error).to.exist;
        }

        await thawAccount(
            testFactory.getConnection(),
            context.authority,
            context.senderTokenAccount,
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

        await testFactory.createApprovedFixedMandate(context1);

        const mandateId2 = new anchor.BN(Math.floor(Math.random() * 1000000));
        const [mandatePda2] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("mandate"),
                authority2.publicKey.toBuffer(),
                mandateId2.toArrayLike(Buffer, "le", 8),
            ],
            context1.program.programId
        );

        const now = Math.floor(Date.now() / 1000);

        await context1.program.methods
            .createMandate(mandateId2, {
                sender: context1.sender.publicKey,
                recipient: context1.recipient.publicKey,
                amountPerDebit: new anchor.BN(50_000),
                totalLimit: new anchor.BN(500_000),
                isUnlimitedSpend: false,
                chargeType: { fixed: {} },
                frequency: { daily: {} },
                minIntervalSeconds: new anchor.BN(60),
                startAt: new anchor.BN(now - 3600),
                endAt: new anchor.BN(now + 365 * 86400),
                allowedRecipients: [],
                allowedAssets: [],
                policyHash: Array(32).fill(0).map((_, i) => i === 0 ? 1 : 0),
            })
            .accountsPartial({
                authority: authority2.publicKey,
                sender: context1.sender.publicKey,
                recipient: context1.recipient.publicKey,
                mandate: mandatePda2,
                mint: context1.mint,
                senderTokenAccount: context1.senderTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([authority2])
            .rpc();

        try {
            await context1.program.methods
                .approveMandate(mandateId2)
                .accountsPartial({
                    sender: context1.sender.publicKey,
                    recipient: context1.recipient.publicKey,
                    mandate: mandatePda2,
                    mint: context1.mint,
                    senderTokenAccount: context1.senderTokenAccount,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([context1.sender])
                .rpc();

            expect.fail("Should have rejected approval - token already delegated");
        } catch (error) {
            expect(error.error?.errorCode?.code).to.equal("TokenAlreadyDelegated");
        }
    });
});
