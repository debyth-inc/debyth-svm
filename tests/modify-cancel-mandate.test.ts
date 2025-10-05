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
            expect(error.error.errorCode.code).to.equal("InvalidAuthority");
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

    it("allows user to cancel their mandate", async () => {
        await context.program.methods
            .cancelMandate()
            .accountsPartial({
                signer: context.user.publicKey,
                user: context.user.publicKey,
                mandate: context.mandatePda,
                mint: context.mint,
                userTokenAccount: context.userTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([context.user])
            .rpc();

        try {
            await context.program.account.mandate.fetch(context.mandatePda);
            expect.fail("Mandate account should have been closed");
        } catch (error) {
            expect(error.message).to.include("Account does not exist");
        }
    });

    it("allows authority to cancel mandate", async () => {
        await context.program.methods
            .cancelMandate()
            .accountsPartial({
                signer: context.authority.publicKey,
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

    it("rejects cancellation by unauthorized user", async () => {
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

            expect.fail("Should have rejected unauthorized cancellation");
        } catch (error) {
            expect(error.error?.errorCode?.code || error.message).to.include("UnauthorizedOwner");
        }
    });
});


