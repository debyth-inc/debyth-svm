import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
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
        // Initially mandate should be active
        let mandate = await context.program.account.mandate.fetch(context.mandatePda);
        expect(mandate.isActive).to.be.true;

        // Pause the mandate
        await context.program.methods
            .toggleStatus()
            .accountsPartial({
                authority: context.authority.publicKey,
                mandate: context.mandatePda,
            })
            .signers([context.authority])
            .rpc();

        mandate = await context.program.account.mandate.fetch(context.mandatePda);
        expect(mandate.isActive).to.be.false;

        // Unpause the mandate
        await context.program.methods
            .toggleStatus()
            .accountsPartial({
                authority: context.authority.publicKey,
                mandate: context.mandatePda,
            })
            .signers([context.authority])
            .rpc();

        mandate = await context.program.account.mandate.fetch(context.mandatePda);
        expect(mandate.isActive).to.be.true;
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
            // PDA seeds constraint fails first (seeds include authority)
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
        // Pause the mandate
        await context.program.methods
            .toggleStatus()
            .accountsPartial({
                authority: context.authority.publicKey,
                mandate: context.mandatePda,
            })
            .signers([context.authority])
            .rpc();

        // Try to execute - should fail because mandate is paused
        try {
            await context.program.methods
                .executeMandate({
                    amountToDebit: new anchor.BN(100_000),
                })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    user: context.user.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    userTokenAccount: context.userTokenAccount,
                    authorityTokenAccount: context.authorityTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([context.authority])
                .rpc();

            expect.fail("Should have rejected execution on paused mandate");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("MandateNotActive");
        }
    });
});
