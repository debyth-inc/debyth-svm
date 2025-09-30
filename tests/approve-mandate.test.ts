import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";

describe("approve_mandate", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        // Create mandate first
        await testFactory.createMandate(context);
    });

    it("should approve a mandate", async () => {
        await testFactory.approveMandate(context);

        const mandateAccount = await context.program.account.mandate.fetch(
            context.mandatePda
        );
        expect(mandateAccount.isApproved).to.be.true;
        expect(mandateAccount.isActive).to.be.true;
    });

    it("should fail to approve already approved mandate", async () => {
        // First approval
        await testFactory.approveMandate(context);

        // Second approval should fail
        try {
            await testFactory.approveMandate(context);
            expect.fail("Should have failed to approve already approved mandate");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("AlreadyApproved");
        }
    });

    it("should fail if wrong user tries to approve", async () => {
        const wrongUser = Keypair.generate();
        await testFactory.airdropAndConfirm(
            wrongUser.publicKey,
            anchor.web3.LAMPORTS_PER_SOL
        );

        const wrongUserTokenAccount = await getOrCreateAssociatedTokenAccount(
            testFactory.getConnection(),
            wrongUser,
            context.mint,
            wrongUser.publicKey,
            false,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );

        try {
            await context.program.methods
                .approveMandate(context.mandateId)
                .accountsPartial({
                    user: wrongUser.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    userTokenAccount: wrongUserTokenAccount.address,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([wrongUser])
                .rpc();

            expect.fail("Should have failed with wrong user");
        } catch (error) {
            // This should fail due to PDA derivation or account constraint
            expect(error.error?.errorCode?.code || error.error?.code).to.equal("Unauthorized");
        }
    });
});
