import * as anchor from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("Mandate Modification", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        await testFactory.createApprovedFixedMandate(context);
    });

    it("modifies mandate parameters successfully", async () => {
        const NEW_AMOUNT_PER_DEBIT = new anchor.BN(200_000);
        const NEW_LIMIT = new anchor.BN(2_000_000);
        const UNLIMITED_LIMIT_U64_MAX = new anchor.BN("18446744073709551615");
        const SIGNATURE_NONCE = new anchor.BN(1);

        const now = Math.floor(Date.now() / 1000);
        const newPolicyHash = Array(32).fill(0).map((_, i) => (i === 0 ? 2 : 0));

        await context.program.methods
            .modifyMandate({
                newAmountPerDebit: NEW_AMOUNT_PER_DEBIT,
                newTotalLimit: NEW_LIMIT,
                newIsUnlimitedSpend: true,
                newChargeType: { variable: {} },
                newFrequency: { daily: {} },
                newMinIntervalSeconds: new anchor.BN(60),
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

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);

        expect(mandate.policy.perExecutionLimit.toString()).to.equal(NEW_AMOUNT_PER_DEBIT.toString());
        expect(mandate.policy.lifetimeLimit.toString()).to.equal(UNLIMITED_LIMIT_U64_MAX.toString());
        expect(mandate.policy.chargeType).to.deep.equal({ variable: {} });
        expect(mandate.modifySignatureNonce.toString()).to.equal(SIGNATURE_NONCE.toString());
    });

    it("rejects modification by non-authority user", async () => {
        const unauthorizedUser = Keypair.generate();
        await testFactory.airdropAndConfirm(
            unauthorizedUser.publicKey,
            anchor.web3.LAMPORTS_PER_SOL
        );

        const now = Math.floor(Date.now() / 1000);
        const newPolicyHash = Array(32).fill(0).map((_, i) => (i === 0 ? 2 : 0));
        const SIGNATURE_NONCE = new anchor.BN(1);

        try {
            await context.program.methods
                .modifyMandate({
                    newAmountPerDebit: new anchor.BN(200_000),
                    newTotalLimit: new anchor.BN(2_000_000),
                    newIsUnlimitedSpend: true,
                    newChargeType: { variable: {} },
                    newFrequency: { daily: {} },
                    newMinIntervalSeconds: new anchor.BN(60),
                    newStartAt: new anchor.BN(now - 3600),
                    newEndAt: new anchor.BN(now + 365 * 86400),
                    newAllowedRecipients: [],
                    newAllowedAssets: [],
                    newPolicyHash,
                    signatureNonce: SIGNATURE_NONCE,
                })
                .accountsPartial({
                    authority: unauthorizedUser.publicKey,
                    sender: context.sender.publicKey,
                    recipient: context.recipient.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    senderTokenAccount: context.senderTokenAccount,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([unauthorizedUser, context.sender])
                .rpc();

            expect.fail("Should have rejected non-authority modification");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("ConstraintSeeds");
        }
    });

    it("rejects modification of unapproved mandate", async () => {
        const unapprovedContext = await testFactory.createTestContext();
        await testFactory.createMandate(unapprovedContext);

        const now = Math.floor(Date.now() / 1000);
        const newPolicyHash = Array(32).fill(0).map((_, i) => (i === 0 ? 2 : 0));
        const SIGNATURE_NONCE = new anchor.BN(1);

        try {
            await unapprovedContext.program.methods
                .modifyMandate({
                    newAmountPerDebit: new anchor.BN(200_000),
                    newTotalLimit: new anchor.BN(2_000_000),
                    newIsUnlimitedSpend: false,
                    newChargeType: { fixed: {} },
                    newFrequency: { daily: {} },
                    newMinIntervalSeconds: new anchor.BN(60),
                    newStartAt: new anchor.BN(now - 3600),
                    newEndAt: new anchor.BN(now + 365 * 86400),
                    newAllowedRecipients: [],
                    newAllowedAssets: [],
                    newPolicyHash,
                    signatureNonce: SIGNATURE_NONCE,
                })
                .accountsPartial({
                    authority: unapprovedContext.authority.publicKey,
                    sender: unapprovedContext.sender.publicKey,
                    recipient: unapprovedContext.recipient.publicKey,
                    mandate: unapprovedContext.mandatePda,
                    mint: unapprovedContext.mint,
                    senderTokenAccount: unapprovedContext.senderTokenAccount,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([unapprovedContext.authority, unapprovedContext.sender])
                .rpc();

            expect.fail("Should have rejected modification of unapproved mandate");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("MandateNotApproved");
        }
    });

    it("rejects modification with zero amount_per_debit", async () => {
        const now = Math.floor(Date.now() / 1000);
        const newPolicyHash = Array(32).fill(0).map((_, i) => (i === 0 ? 2 : 0));
        const SIGNATURE_NONCE = new anchor.BN(1);

        try {
            await context.program.methods
                .modifyMandate({
                    newAmountPerDebit: new anchor.BN(0),
                    newTotalLimit: new anchor.BN(1_000_000),
                    newIsUnlimitedSpend: false,
                    newChargeType: { fixed: {} },
                    newFrequency: { daily: {} },
                    newMinIntervalSeconds: new anchor.BN(60),
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

            expect.fail("Should have rejected zero amount_per_debit");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("DebitAmountTooSmall");
        }
    });

    it("rejects modification with limit less than amount_per_debit", async () => {
        const now = Math.floor(Date.now() / 1000);
        const newPolicyHash = Array(32).fill(0).map((_, i) => (i === 0 ? 2 : 0));
        const SIGNATURE_NONCE = new anchor.BN(1);

        try {
            await context.program.methods
                .modifyMandate({
                    newAmountPerDebit: new anchor.BN(1_000_000),
                    newTotalLimit: new anchor.BN(500_000),
                    newIsUnlimitedSpend: false,
                    newChargeType: { fixed: {} },
                    newFrequency: { daily: {} },
                    newMinIntervalSeconds: new anchor.BN(60),
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

            expect.fail("Should have rejected limit less than amount_per_debit");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidSpendCap");
        }
    });

    it("rejects modification with reused signature nonce", async () => {
        const NEW_AMOUNT_PER_DEBIT = new anchor.BN(200_000);
        const NEW_LIMIT = new anchor.BN(2_000_000);
        const SIGNATURE_NONCE = new anchor.BN(1);

        const now = Math.floor(Date.now() / 1000);
        const newPolicyHash = Array(32).fill(0).map((_, i) => (i === 0 ? 2 : 0));

        await context.program.methods
            .modifyMandate({
                newAmountPerDebit: NEW_AMOUNT_PER_DEBIT,
                newTotalLimit: NEW_LIMIT,
                newIsUnlimitedSpend: true,
                newChargeType: { variable: {} },
                newFrequency: { daily: {} },
                newMinIntervalSeconds: new anchor.BN(60),
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

        const newPolicyHash2 = Array(32).fill(0).map((_, i) => (i === 0 ? 3 : 0));

        try {
            await context.program.methods
                .modifyMandate({
                    newAmountPerDebit: NEW_AMOUNT_PER_DEBIT,
                    newTotalLimit: NEW_LIMIT,
                    newIsUnlimitedSpend: true,
                    newChargeType: { variable: {} },
                    newFrequency: { daily: {} },
                    newMinIntervalSeconds: new anchor.BN(60),
                    newStartAt: new anchor.BN(now - 3600),
                    newEndAt: new anchor.BN(now + 365 * 86400),
                    newAllowedRecipients: [],
                    newAllowedAssets: [],
                    newPolicyHash: newPolicyHash2,
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

            expect.fail("Should have rejected reused nonce");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("SignatureNonceAlreadyUsed");
        }
    });
});

describe("Mandate Cancellation", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        await testFactory.createApprovedFixedMandate(context);
    });

    it("allows authority to cancel mandate (without sender signature)", async () => {
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
            expect.fail("Mandate account should have been closed");
        } catch (error) {
            expect(error.message).to.include("Account does not exist");
        }
    });

    it("allows sender to cancel mandate", async () => {
        await context.program.methods
            .senderCancelMandate()
            .accountsPartial({
                sender: context.sender.publicKey,
                authority: context.authority.publicKey,
                recipient: context.recipient.publicKey,
                mandate: context.mandatePda,
                mint: context.mint,
                senderTokenAccount: context.senderTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([context.sender])
            .rpc();

        try {
            await context.program.account.mandate.fetch(context.mandatePda);
            expect.fail("Mandate account should have been closed");
        } catch (error) {
            expect(error.message).to.include("Account does not exist");
        }
    });

    it("allows authority to cancel after sender revoked delegation externally", async () => {
        const { revoke } = await import("@solana/spl-token");
        await revoke(
            testFactory.getConnection(),
            context.sender,
            context.senderTokenAccount,
            context.sender.publicKey,
            [],
            undefined,
            TOKEN_PROGRAM_ID
        );

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
            expect.fail("Mandate account should have been closed");
        } catch (error) {
            expect(error.message).to.include("Account does not exist");
        }
    });

    it("rejects cancellation by unauthorized authority", async () => {
        const unauthorizedAuthority = Keypair.generate();
        await testFactory.airdropAndConfirm(
            unauthorizedAuthority.publicKey,
            anchor.web3.LAMPORTS_PER_SOL
        );

        try {
            const tx = await context.program.methods
                .cancelMandate()
                .accountsPartial({
                    authority: unauthorizedAuthority.publicKey,
                    sender: context.sender.publicKey,
                    recipient: context.recipient.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    senderTokenAccount: context.senderTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .transaction();

            tx.feePayer = unauthorizedAuthority.publicKey;
            const { blockhash } = await context.program.provider.connection.getLatestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.sign(unauthorizedAuthority);

            await context.program.provider.connection.sendRawTransaction(tx.serialize());

            expect.fail("Should have rejected unauthorized authority cancellation");
        } catch (error) {
            expect(error.message).to.include("ConstraintSeeds");
        }
    });
});
