import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Mandate } from "../target/types/mandate";
import { BN } from "@coral-xyz/anchor";
import { expect } from "chai";

// filepath: onchain/tests/coindebit.test.ts

describe("mandate tests", () => {
    // Configure the client to use the local cluster.
    anchor.setProvider(anchor.AnchorProvider.env());

    const program = anchor.workspace.mandate as Program<Mandate>;

    it("should create and approve a mandate", async () => {
        const startDate = Math.floor(Date.now() / 1000);
        const endDate = startDate + 60 * 60 * 24 * 30; // 30 days later

        const mandateAccount = anchor.web3.Keypair.generate();

        const tx = await program.methods
            .createMandate({})
            .args({
                amount: new BN(1000),
                currency: "USD",
                description: "Test mandate",
                startDate: new anchor.BN(startDate),
                endDate: new anchor.BN(endDate),
            })
            .accounts({
                mandate: mandateAccount.publicKey,
                authority: anchor.getProvider().wallet.publicKey,
            })
            .rpc();

        console.log("CreateMandate Transaction Signature:", tx);
        expect(tx).to.be.a("string");
        expect(tx).to.have.length.greaterThan(0);
    });

    it("should execute a withdrawal", async () => {
        const mandateAccount = anchor.web3.Keypair.generate();

        const tx = await program.methods
            .executeWithdrawal({})
            .args({
                amount: new BN(1000),
                currency: "USD",
            })
            .accounts({
                mandate: mandateAccount.publicKey,
                authority: anchor.getProvider().wallet.publicKey,
            })
            .rpc();

        console.log("ExecuteWithdrawal Transaction Signature:", tx);
        expect(tx).to.be.a("string");
        expect(tx).to.have.length.greaterThan(0);
    });
});
