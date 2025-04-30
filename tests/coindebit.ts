import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Mandate } from "../target/types/mandate";
import { BN } from "@coral-xyz/anchor";

describe("coindebit", () => {
    // Configure the client to use the local cluster.
    anchor.setProvider(anchor.AnchorProvider.env());

    const program = anchor.workspace.coindebit as Program<Mandate>;

    it("Is initialized!", async () => {
        // Add your test here.
        const tx = await program.methods
            .createMandate({})
            .args({
                amount: new BN(1000),
                currency: "USD",
                description: "Test mandate",
                startDate: new anchor.BN(Date.now() / 1000),
                endDate: new anchor.BN(Date.now() / 1000 + 60 * 60 * 24 * 30), // 30 days from now
            })
            .accounts({
                mandate: anchor.web3.Keypair.generate().publicKey,
                authority: anchor.getProvider().wallet.publicKey,
            })
            .rpc();

        console.log("Your transaction signature", tx);
    });
});
