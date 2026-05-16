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
        expect(mandate.status).to.deep.equal({ active: {} });
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

    it("rejects approval attempt by unauthorized sender", async () => {
        const unauthorizedSender = Keypair.generate();
        await testFactory.airdropAndConfirm(
            unauthorizedSender.publicKey,
            anchor.web3.LAMPORTS_PER_SOL
        );

        const unauthorizedSenderTokenAccount = await getOrCreateAssociatedTokenAccount(
            testFactory.getConnection(),
            unauthorizedSender,
            context.mint,
            unauthorizedSender.publicKey,
            false,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );

        try {
            await context.program.methods
                .approveMandate(context.mandateId)
                .accountsPartial({
                    sender: unauthorizedSender.publicKey,
                    recipient: context.recipient.publicKey,
                    mandate: context.mandatePda,
                    mint: context.mint,
                    senderTokenAccount: unauthorizedSenderTokenAccount.address,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([unauthorizedSender])
                .rpc();

            expect.fail("Should have rejected unauthorized sender approval");
        } catch (error) {
            expect(error.error?.errorCode?.code || error.error?.code).to.equal("UnauthorizedSender");
        }
    });
});
