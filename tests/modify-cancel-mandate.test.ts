import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("modify_mandate", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        // Create and approve mandate
        await testFactory.createAndApproveMandate(context);
    });

    it("should modify mandate parameters", async () => {
        const newAmountPerDebit = new anchor.BN(200000);
        const newLimit = new anchor.BN(2000000);

        await context.program.methods
            .modifyMandate({
                newAmountPerDebit,
                newLimit,
                newIsUnlimitedSpend: true,
                newDebitType: { variable: {} },
            })
            .accountsPartial({
                authority: context.authority.publicKey,
                mandate: context.mandatePda,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([context.authority])
            .rpc();

        const mandateAccount = await context.program.account.mandate.fetch(
            context.mandatePda
        );
        expect(mandateAccount.amountPerDebit.toString()).to.equal(
            newAmountPerDebit.toString()
        );
        expect(mandateAccount.limit.toString()).to.equal(
            new anchor.BN("18446744073709551615").toString()
        );
        expect(mandateAccount.isUnlimitedSpend).to.be.true;
        expect(mandateAccount.debitType).to.deep.equal({ variable: {} });
    });

    it("should fail if non-authority tries to modify", async () => {
        const nonAuthority = Keypair.generate();
        await testFactory.airdropAndConfirm(
            nonAuthority.publicKey,
            anchor.web3.LAMPORTS_PER_SOL
        );

        try {
            await context.program.methods
                .modifyMandate({
                    newAmountPerDebit: new anchor.BN(200000),
                    newLimit: new anchor.BN(2000000),
                    newIsUnlimitedSpend: true,
                    newDebitType: { variable: {} },
                })
                .accountsPartial({
                    authority: nonAuthority.publicKey,
                    mandate: context.mandatePda,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([nonAuthority])
                .rpc();

            expect.fail("Should have failed with non-authority");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidAuthority");
        }
    });
});

describe("cancel_mandate", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        // Create and approve mandate
        await testFactory.createAndApproveMandate(context);
    });

    it("should allow user to cancel mandate", async () => {
        await context.program.methods
            .cancelMandate()
            .accountsPartial({
                signer: context.user.publicKey, // User is the signer
                user: context.user.publicKey, // Same as signer for user cancellation
                mandate: context.mandatePda,
                mint: context.mint,
                userTokenAccount: context.userTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([context.user]) // User signs
            .rpc();

        // Expect the account to be closed, so fetching it should fail
        try {
            await context.program.account.mandate.fetch(context.mandatePda);
            expect.fail("Fetching mandate account should have failed");
        } catch (error) {
            expect(error.message).to.include("Account does not exist");
        }
    });

    it("should allow authority to cancel mandate", async () => {
        await context.program.methods
            .cancelMandate()
            .accountsPartial({
                signer: context.authority.publicKey, // Authority is the signer
                user: context.user.publicKey, // User for validation
                mandate: context.mandatePda,
                mint: context.mint,
                userTokenAccount: context.userTokenAccount, // User's token account
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([context.authority]) // Authority signs
            .rpc();

        // Expect the account to be closed, so fetching it should fail
        try {
            await context.program.account.mandate.fetch(context.mandatePda);
            expect.fail("Fetching mandate account should have failed");
        } catch (error) {
            expect(error.message).to.include("Account does not exist");
        }
    });

    it("should fail if unauthorized user tries to cancel", async () => {
        const unauthorizedUser = Keypair.generate();
        await testFactory.airdropAndConfirm(
            unauthorizedUser.publicKey,
            anchor.web3.LAMPORTS_PER_SOL
        );

        try {
            await context.program.methods
                .cancelMandate()
                .accountsPartial({
                    signer: unauthorizedUser.publicKey,
                    user: context.user.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    userTokenAccount: context.userTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([unauthorizedUser])
                .rpc();

            expect.fail("Should have failed with unauthorized user");
        } catch (error) {
            expect(error.error?.errorCode?.code || error.message).to.include("UnauthorizedOwner");
        }
    });
});


