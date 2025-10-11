import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";

describe("Mandate Approval", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        await testFactory.createMandate(context);
    });

    it("approves a mandate and activates it", async () => {
        await testFactory.approveMandate(context);

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);

        expect(mandate.isApproved).to.be.true;
        expect(mandate.isActive).to.be.true;
    });

    it("rejects double approval of same mandate", async () => {
        await testFactory.approveMandate(context);

        try {
            await testFactory.approveMandate(context);
            expect.fail("Should have rejected already approved mandate");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("AlreadyApproved");
        }
    });

    it("rejects approval attempt by unauthorized user", async () => {
        const unauthorizedUser = Keypair.generate();
        await testFactory.airdropAndConfirm(
            unauthorizedUser.publicKey,
            anchor.web3.LAMPORTS_PER_SOL
        );

        const unauthorizedUserTokenAccount = await getOrCreateAssociatedTokenAccount(
            testFactory.getConnection(),
            unauthorizedUser,
            context.mint,
            unauthorizedUser.publicKey,
            false,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );

        try {
            await context.program.methods
                .approveMandate(context.mandateId)
                .accountsPartial({
                    user: unauthorizedUser.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    userTokenAccount: unauthorizedUserTokenAccount.address,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([unauthorizedUser])
                .rpc();

            expect.fail("Should have rejected unauthorized user approval");
        } catch (error) {
            expect(error.error?.errorCode?.code || error.error?.code).to.equal("UnauthorizedUser");
        }
    });
});
