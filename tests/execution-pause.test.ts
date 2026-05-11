import * as anchor from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";

describe("Execution Pause (Global State Controller)", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;
    let execAuth: Keypair;

    before(async () => {
        execAuth = Keypair.generate();
        await testFactory.airdropAndConfirm(
            execAuth.publicKey,
            5 * anchor.web3.LAMPORTS_PER_SOL
        );
    });

    beforeEach(async () => {
        context = await testFactory.createTestContext();
        await testFactory.createApprovedFixedMandate(context, {
            minIntervalSeconds: new anchor.BN(1),
        });
    });

    it("initializes execution state and sets paused=true on first pause", async () => {
        await context.program.methods
            .pauseExecution()
            .accountsPartial({
                authority: execAuth.publicKey,
                executionState: context.executionStatePda,
                systemProgram: SystemProgram.programId,
            })
            .signers([execAuth])
            .rpc();

        const state = await context.program.account.executionState.fetch(
            context.executionStatePda
        );
        expect(state.paused).to.be.true;
        expect(state.authority.toString()).to.equal(execAuth.publicKey.toString());
    });

    it("rejects non-authority pause", async () => {
        const unauthorized = Keypair.generate();
        await testFactory.airdropAndConfirm(
            unauthorized.publicKey,
            anchor.web3.LAMPORTS_PER_SOL
        );

        try {
            await context.program.methods
                .pauseExecution()
                .accountsPartial({
                    authority: unauthorized.publicKey,
                    executionState: context.executionStatePda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([unauthorized])
                .rpc();
            expect.fail("Should have rejected non-authority pause");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("ExecutionStateAuthorityMismatch");
        }
    });

    it("rejects non-authority resume", async () => {
        const unauthorized = Keypair.generate();
        await testFactory.airdropAndConfirm(
            unauthorized.publicKey,
            anchor.web3.LAMPORTS_PER_SOL
        );

        try {
            await context.program.methods
                .resumeExecution()
                .accountsPartial({
                    authority: unauthorized.publicKey,
                    executionState: context.executionStatePda,
                })
                .signers([unauthorized])
                .rpc();
            expect.fail("Should have rejected non-authority resume");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("ExecutionStateAuthorityMismatch");
        }
    });

    it("resumes execution (paused=false)", async () => {
        await context.program.methods
            .resumeExecution()
            .accountsPartial({
                authority: execAuth.publicKey,
                executionState: context.executionStatePda,
            })
            .signers([execAuth])
            .rpc();

        const state = await context.program.account.executionState.fetch(
            context.executionStatePda
        );
        expect(state.paused).to.be.false;
    });

    it("rejects execute_mandate when execution is paused", async () => {
        // Pause first
        await context.program.methods
            .pauseExecution()
            .accountsPartial({
                authority: execAuth.publicKey,
                executionState: context.executionStatePda,
                systemProgram: SystemProgram.programId,
            })
            .signers([execAuth])
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
            expect.fail("Should have rejected execution when paused");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("ExecutionPaused");
        }

        // Resume cleanly for next test
        await context.program.methods
            .resumeExecution()
            .accountsPartial({
                authority: execAuth.publicKey,
                executionState: context.executionStatePda,
            })
            .signers([execAuth])
            .rpc();
    });

    it("executes successfully when not paused", async () => {
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

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);
        expect(mandate.totalExecuted.toString()).to.equal("100000");
    });
});
