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
// import userwallet from "./dev-wallet.json";
// import authoritywallet from "./turbin3-wallet.json";

describe("mandate program tests", () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.Mandate as Program<Mandate>;
    const connection = provider.connection;
    const systemProgram = SystemProgram.programId;
    const tokenProgram = TOKEN_PROGRAM_ID;
    const associatedTokenProgram = ASSOCIATED_TOKEN_PROGRAM_ID;

    // const user = Keypair.fromSecretKey(new Uint8Array(userwallet));
    // const authority = Keypair.fromSecretKey(new Uint8Array(authoritywallet));

    // const mandateAmount = new BN(500000);

    // Test-specific keypairs and variables
    // const user = new PublicKey("Cucujcj54KYPNHB7612BZyiBee4q3FZCsJwAynjyCAu9");
    // const authority = new PublicKey(
    //     "991GzBZPbBMEvr9eQvbcSVxsmbdaiYEKMhxvTbrb45K5"
    // );

    // const user = Keypair.generate();
    // const authority = Keypair.generate();

    let user: Keypair;
    let authority: Keypair;
    let mint: PublicKey;
    let userTokenAccount: PublicKey;
    let authorityTokenAccount: PublicKey;
    let mandatePda: PublicKey;
    let mandateBump: number;
    let mandateId: BN;

    const mandateAmount = new BN(500000);

    beforeEach(async () => {
        this.user = Keypair.generate();
        this.authority = Keypair.generate();
        this.mandateId = new anchor.BN(Date.now()); // Unique ID for each test

        // Airdrop SOL to user and authority
        await this.provider.connection.requestAirdrop(this.user.publicKey, 2e9);
        await this.provider.connection.requestAirdrop(this.authority.publicKey, 2e9);

        // Create a new mint
        this.mint = await createMint(
            this.provider.connection,
            this.user,
            this.user.publicKey,
            null,
            6
        );

        // Create ATA for user and authority
        const userAta = await getOrCreateAssociatedTokenAccount(
            this.provider.connection,
            this.user,
            this.mint,
            this.user.publicKey,
            false,
            undefined,
            undefined,
            this.tokenProgram
        );
        this.userTokenAccount = userAta.address;

        const authAta = await getOrCreateAssociatedTokenAccount(
            this.provider.connection,
            this.authority,
            this.mint,
            this.authority.publicKey,
            false,
            undefined,
            undefined,
            this.tokenProgram
        );
        this.authorityTokenAccount = authAta.address;

        // Mint tokens to user
        await mintTo(
            this.provider.connection,
            this.user,
            this.mint,
            this.userTokenAccount,
            this.user,
            1_000_000,
            undefined,
            undefined,
            this.tokenProgram
        );

        // Compute PDA for mandate
        [this.mandatePda, this.mandateBump] = PublicKey.findProgramAddressSync(
            [Buffer.from("mandate"), this.mandateId.toArrayLike(Buffer, "le", 8)],
            this.program.programId
        );
    });

    it("Creates a mandate successfully", async () => {
        const args = {
            amountPerDebit: mandateAmount,
            limit: mandateAmount.mul(new BN(10)), // Example limit
            isUnlimitedSpend: false,
            debitType: { fixed: {} },
        };

        await this.program.methods
            .createMandate(this.mandateId, args)
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                authorityTokenAccount: this.authorityTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.authority])
            .rpc();

        const mandateAccount = await this.program.account.mandate.fetch(this.mandatePda);
        assert.ok(mandateAccount.id.eq(this.mandateId));
        assert.equal(mandateAccount.isApproved, false);
        assert.equal(mandateAccount.isActive, false);
        assert.ok(mandateAccount.amountPerDebit.eq(mandateAmount));
        assert.ok(mandateAccount.authority.equals(this.authority.publicKey));
        assert.ok(mandateAccount.user.equals(this.user.publicKey));
        assert.ok(mandateAccount.mint.equals(this.mint));
    });

    it("Fails to create a mandate if not signed by authority", async () => {
        const args = {
            amountPerDebit: mandateAmount,
            limit: mandateAmount.mul(new BN(10)),
            isUnlimitedSpend: false,
            debitType: { fixed: {} },
        };

        try {
            await this.program.methods
                .createMandate(this.mandateId, args)
                .accounts({
                    user: this.user.publicKey,
                    authority: this.authority.publicKey,
                    mandate: this.mandatePda,
                    mint: this.mint,
                    userTokenAccount: this.userTokenAccount,
                    authorityTokenAccount: this.authorityTokenAccount,
                    associatedTokenProgram: this.associatedTokenProgram,
                    tokenProgram: this.tokenProgram,
                    systemProgram: this.systemProgram,
                })
                .signers([this.user]) // Incorrect signer
                .rpc();
            assert.fail("Should have failed to create mandate");
        } catch (err: any) {
            assert.include(err.message, "Signature verification failed");
        }
    });

    it("Approves a mandate successfully", async () => {
        // Create the mandate first
        const createArgs = {
            amountPerDebit: mandateAmount,
            limit: mandateAmount.mul(new BN(10)),
            isUnlimitedSpend: false,
            debitType: { fixed: {} },
        };
        await this.program.methods
            .createMandate(this.mandateId, createArgs)
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                authorityTokenAccount: this.authorityTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.authority])
            .rpc();

        await this.program.methods
            .approveMandate()
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.user])
            .rpc();

        const mandateAccount = await this.program.account.mandate.fetch(this.mandatePda);
        assert.equal(mandateAccount.isApproved, true);
        assert.equal(mandateAccount.isActive, false);
    });

    it("Fails to approve a mandate if not signed by user", async () => {
        // Create the mandate first
        const createArgs = {
            amountPerDebit: mandateAmount,
            limit: mandateAmount.mul(new BN(10)),
            isUnlimitedSpend: false,
            debitType: { fixed: {} },
        };
        await this.program.methods
            .createMandate(this.mandateId, createArgs)
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                authorityTokenAccount: this.authorityTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.authority])
            .rpc();

        try {
            await this.program.methods
                .approveMandate()
                .accounts({
                    user: this.user.publicKey,
                    authority: this.authority.publicKey,
                    mandate: this.mandatePda,
                    mint: this.mint,
                    userTokenAccount: this.userTokenAccount,
                    associatedTokenProgram: this.associatedTokenProgram,
                    tokenProgram: this.tokenProgram,
                    systemProgram: this.systemProgram,
                })
                .signers([this.authority]) // Incorrect signer
                .rpc();
            assert.fail("Should have failed to approve mandate");
        } catch (err: any) {
            assert.include(err.message, "Signature verification failed");
        }
    });

    it("Executes a mandate debit successfully", async () => {
        // Create and approve the mandate first
        const createArgs = {
            amountPerDebit: mandateAmount,
            limit: mandateAmount.mul(new BN(10)),
            isUnlimitedSpend: false,
            debitType: { fixed: {} },
        };
        await this.program.methods
            .createMandate(this.mandateId, createArgs)
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                authorityTokenAccount: this.authorityTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.authority])
            .rpc();

        await this.program.methods
            .approveMandate()
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.user])
            .rpc();

        const initialUserTokenAccountInfo = await this.connection.getTokenAccountBalance(
            this.userTokenAccount
        );
        const initialUserBalance = new BN(initialUserTokenAccountInfo.value.amount);

        const args = {
            amountToDebit: mandateAmount,
        };

        await this.program.methods
            .executeMandate(args)
            .accounts({
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                destinationTokenAccount: this.authorityTokenAccount,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.authority])
            .rpc();

        const userTokenAccountInfo = await this.connection.getTokenAccountBalance(
            this.userTokenAccount
        );
        const currentUserBalance = new BN(userTokenAccountInfo.value.amount);
        assert.ok(
            currentUserBalance.eq(initialUserBalance.sub(mandateAmount)),
            "User token account balance should decrease by mandate amount"
        );

        const mandateAccount = await this.program.account.mandate.fetch(this.mandatePda);
        assert.equal(mandateAccount.isActive, true);
        assert.equal(mandateAccount.isApproved, true);
    });

    it("Fails to execute a mandate debit if not signed by authority", async () => {
        const createArgs = {
            amountPerDebit: mandateAmount,
            limit: mandateAmount.mul(new BN(10)),
            isUnlimitedSpend: false,
            debitType: { fixed: {} },
        };
        await this.program.methods
            .createMandate(this.mandateId, createArgs)
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                authorityTokenAccount: this.authorityTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.authority])
            .rpc();

        await this.program.methods
            .approveMandate()
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.user])
            .rpc();

        const args = {
            amountToDebit: mandateAmount,
        };

        try {
            await this.program.methods
                .executeMandate(args)
                .accounts({
                    authority: this.authority.publicKey,
                    mandate: this.mandatePda,
                    mint: this.mint,
                    userTokenAccount: this.userTokenAccount,
                    destinationTokenAccount: this.authorityTokenAccount,
                    tokenProgram: this.tokenProgram,
                    systemProgram: this.systemProgram,
                })
                .signers([this.user]) // Incorrect signer
                .rpc();
            assert.fail("Should have failed to execute mandate");
        } catch (err: any) {
            assert.include(err.message, "Signature verification failed");
        }
    });

    it("Modifies a mandate successfully", async () => {
        const createArgs = {
            amountPerDebit: mandateAmount,
            limit: mandateAmount.mul(new BN(10)),
            isUnlimitedSpend: false,
            debitType: { fixed: {} },
        };
        await this.program.methods
            .createMandate(this.mandateId, createArgs)
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                authorityTokenAccount: this.authorityTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.authority])
            .rpc();

        await this.program.methods
            .approveMandate()
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.user])
            .rpc();

        const previousMandateAccount = await this.program.account.mandate.fetch(
            this.mandatePda
        );
        const previousState = previousMandateAccount.isActive;

        await this.program.methods
            .modifyMandate({
                newAmountPerDebit: mandateAmount.add(new BN(100)),
                newLimit: mandateAmount.mul(new BN(20)),
                newIsUnlimitedSpend: false,
                newDebitType: { variable: {} },
            })
            .accounts({
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.authority])
            .rpc();

        const newMandateAccount = await this.program.account.mandate.fetch(this.mandatePda);
        assert.notEqual(previousState, newMandateAccount.isActive);
    });

    it("Fails to modify a mandate if not signed by authority", async () => {
        const createArgs = {
            amountPerDebit: mandateAmount,
            limit: mandateAmount.mul(new BN(10)),
            isUnlimitedSpend: false,
            debitType: { fixed: {} },
        };
        await this.program.methods
            .createMandate(this.mandateId, createArgs)
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                authorityTokenAccount: this.authorityTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.authority])
            .rpc();

        await this.program.methods
            .approveMandate()
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.user])
            .rpc();

        try {
            await this.program.methods
                .modifyMandate({
                    newAmountPerDebit: mandateAmount.add(new BN(100)),
                    newLimit: mandateAmount.mul(new BN(20)),
                    newIsUnlimitedSpend: false,
                    newDebitType: { variable: {} },
                })
                .accounts({
                    authority: this.authority.publicKey,
                    mandate: this.mandatePda,
                    tokenProgram: this.tokenProgram,
                    systemProgram: this.systemProgram,
                })
                .signers([this.user]) // Incorrect signer
                .rpc();
            assert.fail("Should have failed to modify mandate");
        } catch (err: any) {
            assert.include(err.message, "Signature verification failed");
        }
    });

    it("Cancels a mandate successfully", async () => {
        const createArgs = {
            amountPerDebit: mandateAmount,
            limit: mandateAmount.mul(new BN(10)),
            isUnlimitedSpend: false,
            debitType: { fixed: {} },
        };
        await this.program.methods
            .createMandate(this.mandateId, createArgs)
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                authorityTokenAccount: this.authorityTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.authority])
            .rpc();

        await this.program.methods
            .approveMandate()
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.user])
            .rpc();

        await this.program.methods
            .cancelMandate()
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.user])
            .rpc();

        try {
            await this.program.account.mandate.fetch(this.mandatePda);
            assert.fail("Mandate account should be closed");
        } catch (err: any) {
            assert.include(err.message, "Account does not exist");
        }
    });

    it("Fails to cancel a mandate if not signed by user", async () => {
        const createArgs = {
            amountPerDebit: mandateAmount,
            limit: mandateAmount.mul(new BN(10)),
            isUnlimitedSpend: false,
            debitType: { fixed: {} },
        };
        await this.program.methods
            .createMandate(this.mandateId, createArgs)
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                authorityTokenAccount: this.authorityTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.authority])
            .rpc();

        await this.program.methods
            .approveMandate()
            .accounts({
                user: this.user.publicKey,
                authority: this.authority.publicKey,
                mandate: this.mandatePda,
                mint: this.mint,
                userTokenAccount: this.userTokenAccount,
                associatedTokenProgram: this.associatedTokenProgram,
                tokenProgram: this.tokenProgram,
                systemProgram: this.systemProgram,
            })
            .signers([this.user])
            .rpc();

        try {
            await this.program.methods
                .cancelMandate()
                .accounts({
                    user: this.user.publicKey,
                    authority: this.authority.publicKey,
                    mandate: this.mandatePda,
                    mint: this.mint,
                    userTokenAccount: this.userTokenAccount,
                    tokenProgram: this.tokenProgram,
                    systemProgram: this.systemProgram,
                })
                .signers([this.authority]) // Incorrect signer
                .rpc();
            assert.fail("Should have failed to cancel mandate");
        } catch (err: any) {
            assert.include(err.message, "Account does not exist");
        }
    });
});
