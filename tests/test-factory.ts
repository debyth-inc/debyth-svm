import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createMint,
    mintTo,
    getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { Mandate } from "../target/types/mandate";

export interface TestContext {
    program: Program<Mandate>;
    connection: anchor.web3.Connection;
    authority: Keypair;
    user: Keypair;
    mint: PublicKey;
    mandateId: anchor.BN;
    mandatePda: PublicKey;
    userTokenAccount: PublicKey;
    authorityTokenAccount: PublicKey;
}

export class TestFactory {
    private static instance: TestFactory;
    private program: Program<Mandate>;
    private connection: anchor.web3.Connection;

    private constructor() {
        const provider = anchor.AnchorProvider.env();
        anchor.setProvider(provider);
        this.program = anchor.workspace.Mandate as Program<Mandate>;
        this.connection = provider.connection;
    }

    public static getInstance(): TestFactory {
        if (!TestFactory.instance) {
            TestFactory.instance = new TestFactory();
        }
        return TestFactory.instance;
    }

    public getProgram(): Program<Mandate> {
        return this.program;
    }

    public getConnection(): anchor.web3.Connection {
        return this.connection;
    }

    public async airdropAndConfirm(
        pubkey: PublicKey,
        lamports: number
    ): Promise<void> {
        const sig = await this.connection.requestAirdrop(pubkey, lamports);
        const latest = await this.connection.getLatestBlockhash();
        await this.connection.confirmTransaction({
            signature: sig,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
        });
    }

    public async createTestContext(): Promise<TestContext> {
        // Create new keypairs for each test
        const authority = Keypair.generate();
        const user = Keypair.generate();
        const mandateId = new anchor.BN(Math.floor(Math.random() * 1000000));

        // Airdrop SOL to accounts
        await this.airdropAndConfirm(
            authority.publicKey,
            2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await this.airdropAndConfirm(
            user.publicKey,
            2 * anchor.web3.LAMPORTS_PER_SOL
        );

        // Create mint
        const mint = await createMint(
            this.connection,
            authority,
            authority.publicKey,
            null,
            6
        );

        // Create token accounts
        const uTa = await getOrCreateAssociatedTokenAccount(
            this.connection,
            user,
            mint,
            user.publicKey,
            false,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );
        const userTokenAccount = uTa.address;

        const aTa = await getOrCreateAssociatedTokenAccount(
            this.connection,
            authority,
            mint,
            authority.publicKey,
            false,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );
        const authorityTokenAccount = aTa.address;

        // Mint tokens to user
        await mintTo(
            this.connection,
            authority,
            mint,
            userTokenAccount,
            authority,
            1000000 // 1,000 tokens with 6 decimals
        );

        // Derive mandate PDA
        const [mandatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("mandate"), mandateId.toArrayLike(Buffer, "le", 8)],
            this.program.programId
        );

        return {
            program: this.program,
            connection: this.connection,
            authority,
            user,
            mint,
            mandateId,
            mandatePda,
            userTokenAccount,
            authorityTokenAccount,
        };
    }

    public async createMandate(
        context: TestContext,
        options: {
            amountPerDebit?: anchor.BN;
            limit?: anchor.BN;
            isUnlimitedSpend?: boolean;
            debitType?: { fixed: {} } | { variable: {} };
            debitFrequencySeconds?: anchor.BN;
        } = {}
    ): Promise<void> {
        const {
            amountPerDebit = new anchor.BN(100000),
            limit = new anchor.BN(1000000),
            isUnlimitedSpend = false,
            debitType = { fixed: {} },
            debitFrequencySeconds = new anchor.BN(60),
        } = options;

        await context.program.methods
            .createMandate(context.mandateId, {
                amountPerDebit,
                limit,
                isUnlimitedSpend,
                debitType,
                debitFrequencySeconds,
            })
            .accountsPartial({
                authority: context.authority.publicKey,
                user: context.user.publicKey,
                mandate: context.mandatePda,
                mint: context.mint,
                userTokenAccount: context.userTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([context.authority])
            .rpc();
    }

    public async approveMandate(context: TestContext): Promise<void> {
        await context.program.methods
            .approveMandate(context.mandateId)
            .accountsPartial({
                user: context.user.publicKey,
                mandate: context.mandatePda,
                mint: context.mint,
                userTokenAccount: context.userTokenAccount,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([context.user])
            .rpc();
    }

    public async createAndApproveMandate(
        context: TestContext,
        options?: {
            amountPerDebit?: anchor.BN;
            limit?: anchor.BN;
            isUnlimitedSpend?: boolean;
            debitType?: { fixed: {} } | { variable: {} };
            debitFrequencySeconds?: anchor.BN;
        }
    ): Promise<void> {
        await this.createMandate(context, options);
        await this.approveMandate(context);
    }
}


