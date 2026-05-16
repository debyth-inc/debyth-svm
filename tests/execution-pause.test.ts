import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";

describe("Execution Pause (Global State Controller)", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;
    let execAdmin: Keypair;
    let executionStatePda: PublicKey;
    let isInitializedByUs = false;

    before(async () => {
        context = await testFactory.createTestContext();
        execAdmin = context.execAdmin;

        const [execStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("execution-state")],
            context.program.programId
        );
        executionStatePda = execStatePda;

        await testFactory.createApprovedFixedMandate(context, {
            minIntervalSeconds: new anchor.BN(1),
        });

        // Try to initialize - if it fails, someone else already did
        try {
            await testFactory.initializeExecutionState(context);
            isInitializedByUs = true;
        } catch {
            isInitializedByUs = false;
        }
    });

    it("pauses and resumes execution", async function () {
        if (!isInitializedByUs) {
            this.skip();
        }

        await context.program.methods
            .pauseExecution()
            .accountsPartial({
                authority: execAdmin.publicKey,
                executionState: executionStatePda,
            })
            .signers([execAdmin])
            .rpc();

        let state = await context.program.account.executionState.fetch(executionStatePda);
        expect(state.paused).to.be.true;
        expect(state.authority.toString()).to.equal(execAdmin.publicKey.toString());

        await context.program.methods
            .resumeExecution()
            .accountsPartial({
                authority: execAdmin.publicKey,
                executionState: executionStatePda,
            })
            .signers([execAdmin])
            .rpc();

        state = await context.program.account.executionState.fetch(executionStatePda);
        expect(state.paused).to.be.false;
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
                    executionState: executionStatePda,
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
                    executionState: executionStatePda,
                })
                .signers([unauthorized])
                .rpc();
            expect.fail("Should have rejected non-authority resume");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("ExecutionStateAuthorityMismatch");
        }
    });

    it("rejects execute_mandate when execution is paused", async function () {
        if (!isInitializedByUs) {
            this.skip();
        }

        // Pause first
        await context.program.methods
            .pauseExecution()
            .accountsPartial({
                authority: execAdmin.publicKey,
                executionState: executionStatePda,
            })
            .signers([execAdmin])
            .rpc();

        try {
            await context.program.methods
                .executeMandate({
                    amountToDebit: new anchor.BN(100_000),
                    nonce: new anchor.BN(300),
                })
                .accountsPartial({
                    authority: context.authority.publicKey,
                    mandate: context.mandatePda,
                    executionState: executionStatePda,
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

        // Resume cleanly
        await context.program.methods
            .resumeExecution()
            .accountsPartial({
                authority: execAdmin.publicKey,
                executionState: executionStatePda,
            })
            .signers([execAdmin])
            .rpc();
    });

    it("executes successfully when not paused", async () => {
        await context.program.methods
            .executeMandate({
                amountToDebit: new anchor.BN(100_000),
                nonce: new anchor.BN(400),
            })
            .accountsPartial({
                authority: context.authority.publicKey,
                mandate: context.mandatePda,
                executionState: executionStatePda,
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
