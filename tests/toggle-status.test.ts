import * as anchor from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("Mandate Status Toggle (Pause/Unpause)", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        await testFactory.createApprovedFixedMandate(context);
    });

    it("toggles mandate status successfully (pause then unpause)", async () => {
        let mandate = await context.program.account.mandate.fetch(context.mandatePda);
        expect(mandate.status).to.deep.equal({ active: {} });

        await context.program.methods
            .toggleStatus()
            .accountsPartial({
                authority: context.authority.publicKey,
                mandate: context.mandatePda,
            })
            .signers([context.authority])
            .rpc();

        mandate = await context.program.account.mandate.fetch(context.mandatePda);
        expect(mandate.status).to.deep.equal({ paused: {} });

        await context.program.methods
            .toggleStatus()
            .accountsPartial({
                authority: context.authority.publicKey,
                mandate: context.mandatePda,
            })
            .signers([context.authority])
            .rpc();

        mandate = await context.program.account.mandate.fetch(context.mandatePda);
        expect(mandate.status).to.deep.equal({ active: {} });
    });

    it("rejects toggle by non-authority user", async () => {
        const unauthorizedUser = Keypair.generate();
        await testFactory.airdropAndConfirm(
            unauthorizedUser.publicKey,
            anchor.web3.LAMPORTS_PER_SOL
        );

        try {
            await context.program.methods
                .toggleStatus()
                .accountsPartial({
                    authority: unauthorizedUser.publicKey,
                    mandate: context.mandatePda,
                })
                .signers([unauthorizedUser])
                .rpc();

            expect.fail("Should have rejected non-authority toggle");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("ConstraintSeeds");
        }
    });

    it("rejects toggle on unapproved mandate", async () => {
        const unapprovedContext = await testFactory.createTestContext();
        await testFactory.createMandate(unapprovedContext);

        try {
            await unapprovedContext.program.methods
                .toggleStatus()
                .accountsPartial({
                    authority: unapprovedContext.authority.publicKey,
                    mandate: unapprovedContext.mandatePda,
                })
                .signers([unapprovedContext.authority])
                .rpc();

            expect.fail("Should have rejected toggle on unapproved mandate");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("MandateNotApproved");
        }
    });

    it("prevents execution when mandate is paused", async () => {
        await testFactory.initializeExecutionState(context);

        await context.program.methods
            .toggleStatus()
            .accountsPartial({
                authority: context.authority.publicKey,
                mandate: context.mandatePda,
            })
            .signers([context.authority])
            .rpc();

        try {
            await context.program.methods
                .executeMandate({
                    amountToDebit: new anchor.BN(100_000),
                    nonce: new anchor.BN(1),
                })
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

            expect.fail("Should have rejected execution on paused mandate");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("MandateNotActive");
        }
    });
});
