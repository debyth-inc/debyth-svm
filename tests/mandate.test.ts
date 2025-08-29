import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Mandate } from "../target/types/mandate";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTo,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import userwallet from "./dev-wallet.json";
import authoritywallet from "./turbin3-wallet.json";

describe("mandate program tests", () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.Mandate as Program<Mandate>;
    const connection = provider.connection;
    const systemProgram = SystemProgram.programId;
    const tokenProgram = TOKEN_PROGRAM_ID;
    const associatedTokenProgram = ASSOCIATED_TOKEN_PROGRAM_ID;

    const user = Keypair.fromSecretKey(new Uint8Array(userwallet));
    const authority = Keypair.fromSecretKey(new Uint8Array(authoritywallet));

    const mandateAmount = new BN(500000);

    // Test-specific keypairs and variables
    // const user = new PublicKey("Cucujcj54KYPNHB7612BZyiBee4q3FZCsJwAynjyCAu9");
    // const authority = new PublicKey(
    //     "991GzBZPbBMEvr9eQvbcSVxsmbdaiYEKMhxvTbrb45K5"
    // );

    // const user = Keypair.generate();
    // const authority = Keypair.generate();

    let mint: PublicKey;
    let userTokenAccount: PublicKey;
    let authorityTokenAccount: PublicKey;
    const mandateId = new anchor.BN(1);
    let mandatePda: PublicKey;
    let mandateBump: number;

    // Setup before tests
    before(async () => {
        // Airdrop SOL to user and authority
        // const sig1 = await provider.connection.requestAirdrop(
        //     user.publicKey,
        //     2e9
        // );
        // await provider.connection.confirmTransaction(sig1, "confirmed");
        // const sig2 = await provider.connection.requestAirdrop(
        //     authority.publicKey,
        //     2e9
        // );
        // await provider.connection.confirmTransaction(sig2, "confirmed");

        // Create a new mint with TOKEN_PROGRAM_ID, reusing the same mint address
        mint = new PublicKey("4EpEH7DUdAXcuMSVYGJX484NWvDLPS3sSJqFjMvUPtRg");

        // mint = await createMint(
        //     provider.connection,
        //     user,
        //     user.publicKey,
        //     null,
        //     6
        // );

        // Create ATA for user and authority with TOKEN_2022_PROGRAM_ID
        const userAta = await getOrCreateAssociatedTokenAccount(
            provider.connection,
            user,
            mint,
            user.publicKey,
            false,
            undefined,
            undefined,
            tokenProgram
        );
        userTokenAccount = userAta.address;
        console.log("User token account:", userTokenAccount.toString());

        const authAta = await getOrCreateAssociatedTokenAccount(
            provider.connection,
            authority,
            mint,
            authority.publicKey,
            false,
            undefined,
            undefined,
            tokenProgram
        );
        authorityTokenAccount = authAta.address;
        console.log(
            "Authority token account:",
            authorityTokenAccount.toString()
        );

        // Mint tokens to user
        // await mintTo(
        //     provider.connection,
        //     user,
        //     mint,
        //     userTokenAccount,
        //     user,
        //     1_000_000,
        //     undefined,
        //     undefined,
        //     tokenProgram
        // );

        // Compute PDA for mandate
        [mandatePda, mandateBump] = PublicKey.findProgramAddressSync(
            [Buffer.from("mandate"), mandateId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
    });

    it("Creates a mandate", async () => {
        const args = {
            amount: mandateAmount,
            debitType: { fixed: {} },
        };

        await program.methods
            .createMandate(mandateId, args)
            .accountsPartial({
                user: user.publicKey,
                authority: authority.publicKey,
                mandate: mandatePda,
                mint,
                userTokenAccount,
                authorityTokenAccount,
                associatedTokenProgram,
                tokenProgram,
                systemProgram,
            })
            .signers([authority])
            .rpc();

        const mandateAccount = await program.account.mandate.fetch(mandatePda);
        console.log("Mandate account:", mandateAccount);
        assert.ok(mandateAccount.id.eq(mandateId));
        assert.equal(mandateAccount.isApproved, false);
        assert.equal(mandateAccount.isActive, false);
        assert.ok(mandateAccount.amount.eq(mandateAmount));
    });

    it("Approves a mandate", async () => {
        const [expectedMandatePda, _] = PublicKey.findProgramAddressSync(
            [Buffer.from("mandate"), mandateId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        assert.ok(
            mandatePda.equals(expectedMandatePda),
            "Mandate PDAs do not match"
        );

        const tx = await program.methods
            .approveMandate(mandateId)
            .accountsPartial({
                user: user.publicKey,
                authority: authority.publicKey,
                mandate: mandatePda,
                mint,
                userTokenAccount,
                associatedTokenProgram,
                tokenProgram,
                systemProgram,
            })
            .signers([user])
            .rpc();

        console.log("Approve transaction signature:", tx); // Log the transaction signature

        // Wait for the transaction to be confirmed
        await provider.connection.confirmTransaction(tx, "confirmed");

        const mandateAccount = await program.account.mandate.fetch(mandatePda);
        assert.equal(mandateAccount.isApproved, true);
    });

    it("Executes a mandate debit", async () => {
        const args = {
            amount: mandateAmount,
        };

        const tx = await program.methods
            .executeMandate(args)
            .accountsPartial({
                authority: authority.publicKey,
                mandate: mandatePda,
                mint,
                userTokenAccount,
                tokenProgram,
                systemProgram,
            })
            .signers([authority])
            .rpc();

        console.log("Execute transaction signature:", tx);
        // Wait for the transaction to be confirmed
        await provider.connection.confirmTransaction(tx, "confirmed");
        // Check the user's token account balance
        const userTokenAccountInfo = await connection.getTokenAccountBalance(
            userTokenAccount
        );
        console.log(
            "User token account balance after debit:",
            userTokenAccountInfo.value.uiAmountString
        );
        const mandateAccount = await program.account.mandate.fetch(mandatePda);
        assert.equal(mandateAccount.isActive, true);
        assert.equal(mandateAccount.isApproved, true);
    });

    it("Modifies a mandate", async () => {
        const previousState = (await program.account.mandate.fetch(mandatePda))
            .isActive;
        console.log("Previous state:", previousState);

        const tx = await program.methods
            .modifyMandate()
            .accountsPartial({
                authority: authority.publicKey,
                mandate: mandatePda,
                tokenProgram,
                systemProgram,
            })
            .signers([authority])
            .rpc();
        console.log("Modify transaction signature:", tx);

        const newState = await program.account.mandate.fetch(mandatePda);
        assert.notEqual(previousState, newState.isActive);
        console.log("New state:", newState.isActive);
    });

    it("Cancels a mandate", async () => {
        await program.methods
            .cancelMandate()
            .accountsPartial({
                user: user.publicKey,
                authority: authority.publicKey,
                mandate: mandatePda,
                mint,
                userTokenAccount,
                tokenProgram,
                systemProgram,
            })
            .signers([user])
            .rpc();

        try {
            await program.account.mandate.fetch(mandatePda);
            assert.fail("Mandate account should be closed");
        } catch (err: any) {
            assert.include(err.message, "Account does not exist");
        }
    });
});
