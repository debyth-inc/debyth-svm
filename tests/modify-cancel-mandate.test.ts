import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

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

        await context.program.methods
            .modifyMandate({
                newAmountPerDebit: NEW_AMOUNT_PER_DEBIT,
                newLimit: NEW_LIMIT,
                newIsUnlimitedSpend: true,
                newDebitType: { variable: {} },
                newDebitFrequencySeconds: new anchor.BN(60),
            })
            .accountsPartial({
                authority: context.authority.publicKey,
                mandate: context.mandatePda,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([context.authority])
            .rpc();

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);

        expect(mandate.amountPerDebit.toString()).to.equal(NEW_AMOUNT_PER_DEBIT.toString());
        expect(mandate.limit.toString()).to.equal(UNLIMITED_LIMIT_U64_MAX.toString());
        expect(mandate.isUnlimitedSpend).to.be.true;
        expect(mandate.debitType).to.deep.equal({ variable: {} });
    });

    it("rejects modification by non-authority user", async () => {
        const unauthorizedUser = Keypair.generate();
        await testFactory.airdropAndConfirm(
            unauthorizedUser.publicKey,
            anchor.web3.LAMPORTS_PER_SOL
        );

        try {
            await context.program.methods
                .modifyMandate({
                    newAmountPerDebit: new anchor.BN(200_000),
                    newLimit: new anchor.BN(2_000_000),
                    newIsUnlimitedSpend: true,
                    newDebitType: { variable: {} },
                    newDebitFrequencySeconds: new anchor.BN(60),
                })
                .accountsPartial({
                    authority: unauthorizedUser.publicKey,
                    mandate: context.mandatePda,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([unauthorizedUser])
                .rpc();

            expect.fail("Should have rejected non-authority modification");
        } catch (error) {
            // PDA seeds constraint fails first (seeds include authority)
            expect(error.error.errorCode.code).to.equal("ConstraintSeeds");
        }
    });

    it("rejects modification of unapproved mandate", async () => {
        const unapprovedContext = await testFactory.createTestContext();
        await testFactory.createMandate(unapprovedContext);

        try {
            await unapprovedContext.program.methods
                .modifyMandate({
                    newAmountPerDebit: new anchor.BN(200_000),
                    newLimit: new anchor.BN(2_000_000),
                    newIsUnlimitedSpend: false,
                    newDebitType: { fixed: {} },
                    newDebitFrequencySeconds: new anchor.BN(60),
                })
                .accountsPartial({
                    authority: unapprovedContext.authority.publicKey,
                    mandate: unapprovedContext.mandatePda,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([unapprovedContext.authority])
                .rpc();

            expect.fail("Should have rejected modification of unapproved mandate");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("MandateNotApproved");
        }
    });

    it("rejects modification with zero amount_per_debit", async () => {
        try {
            await context.program.methods
                .modifyMandate({
                    newAmountPerDebit: new anchor.BN(0),
                    newLimit: new anchor.BN(1_000_000),
                    newIsUnlimitedSpend: false,
                    newDebitType: { fixed: {} },
                    newDebitFrequencySeconds: new anchor.BN(60),
                })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([context.authority])
                .rpc();

            expect.fail("Should have rejected zero amount_per_debit");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidAmount");
        }
    });

    it("rejects modification with limit less than amount_per_debit", async () => {
        try {
            await context.program.methods
                .modifyMandate({
                    newAmountPerDebit: new anchor.BN(1_000_000),
                    newLimit: new anchor.BN(500_000), // Less than amount_per_debit
                    newIsUnlimitedSpend: false,
                    newDebitType: { fixed: {} },
                    newDebitFrequencySeconds: new anchor.BN(60),
                })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([context.authority])
                .rpc();

            expect.fail("Should have rejected limit less than amount_per_debit");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidSpendCap");
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

    it("allows authority to cancel with user signature (delegation still active)", async () => {
        // When delegation is still active, user must be a signer
        const tx = await context.program.methods
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
            .transaction();

        // Manually add both signatures
        tx.feePayer = context.authority.publicKey;
        const { blockhash, lastValidBlockHeight } = await context.program.provider.connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.sign(context.authority, context.user);

        const signature = await context.program.provider.connection.sendRawTransaction(tx.serialize());
        await context.program.provider.connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight,
        });

        try {
            await context.program.account.mandate.fetch(context.mandatePda);
            expect.fail("Mandate account should have been closed");
        } catch (error) {
            expect(error.message).to.include("Account does not exist");
        }
    });

    it("allows authority to cancel after user revoked delegation externally", async () => {
        // User revokes delegation via wallet (simulated)
        const { revoke } = await import("@solana/spl-token");
        await revoke(
            testFactory.getConnection(),
            context.user,
            context.userTokenAccount,
            context.user,
            [],
            undefined,
            TOKEN_PROGRAM_ID
        );

        // Authority can now cancel without user signature
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
                    user: context.user.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    userTokenAccount: context.userTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .transaction();

            tx.feePayer = unauthorizedAuthority.publicKey;
            const { blockhash } = await context.program.provider.connection.getLatestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.sign(unauthorizedAuthority, context.user);

            await context.program.provider.connection.sendRawTransaction(tx.serialize());

            expect.fail("Should have rejected unauthorized authority cancellation");
        } catch (error) {
            expect(error.message).to.include("ConstraintSeeds");
        }
    });
});


