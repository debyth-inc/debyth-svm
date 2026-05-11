import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createMint,
    mintTo,
    getOrCreateAssociatedTokenAccount,
    approve,
} from "@solana/spl-token";
import { Mandate } from "../target/types/mandate";

export interface TestContext {
    program: Program<Mandate>;
    connection: anchor.web3.Connection;
    authority: Keypair;
    sender: Keypair;
    recipient: Keypair;
    mint: PublicKey;
    mandateId: anchor.BN;
    mandatePda: PublicKey;
    senderTokenAccount: PublicKey;
    recipientTokenAccount: PublicKey;
    executionStatePda: PublicKey;
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
        publicKey: PublicKey,
        lamports: number
    ): Promise<void> {
        const signature = await this.connection.requestAirdrop(publicKey, lamports);
        const latestBlockhash = await this.connection.getLatestBlockhash();
        await this.connection.confirmTransaction({
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        });
    }

    public async createTokenAccount(
        mint: PublicKey,
        owner: PublicKey
    ): Promise<PublicKey> {
        const ownerKeypair = Keypair.generate();
        await this.airdropAndConfirm(ownerKeypair.publicKey, anchor.web3.LAMPORTS_PER_SOL);

        const tokenAccount = await getOrCreateAssociatedTokenAccount(
            this.connection,
            ownerKeypair,
            mint,
            owner,
            false,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );

        return tokenAccount.address;
    }

    public async createTestContext(withFreezeAuthority: boolean = false): Promise<TestContext> {
        const authority = Keypair.generate();
        const sender = Keypair.generate();
        const recipient = Keypair.generate();
        const mandateId = new anchor.BN(Math.floor(Math.random() * 1000000));

        const SOL_AIRDROP_AMOUNT = 2 * anchor.web3.LAMPORTS_PER_SOL;
        await this.airdropAndConfirm(authority.publicKey, SOL_AIRDROP_AMOUNT);
        await this.airdropAndConfirm(sender.publicKey, SOL_AIRDROP_AMOUNT);
        await this.airdropAndConfirm(recipient.publicKey, SOL_AIRDROP_AMOUNT);

        const DECIMALS = 6;
        const mint = await createMint(
            this.connection,
            authority,
            authority.publicKey,
            withFreezeAuthority ? authority.publicKey : null,
            DECIMALS
        );

        const senderTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
            this.connection,
            sender,
            mint,
            sender.publicKey,
            false,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );

        const recipientTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
            this.connection,
            recipient,
            mint,
            recipient.publicKey,
            false,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );

        const INITIAL_USER_BALANCE = 1_000_000;
        await mintTo(
            this.connection,
            authority,
            mint,
            senderTokenAccountInfo.address,
            authority,
            INITIAL_USER_BALANCE
        );

        const [mandatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("mandate"), authority.publicKey.toBuffer(), mandateId.toArrayLike(Buffer, "le", 8)],
            this.program.programId
        );

        const [executionStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("execution-state")],
            this.program.programId
        );

        return {
            program: this.program,
            connection: this.connection,
            authority,
            sender,
            recipient,
            mint,
            mandateId,
            mandatePda,
            senderTokenAccount: senderTokenAccountInfo.address,
            recipientTokenAccount: recipientTokenAccountInfo.address,
            executionStatePda,
        };
    }

    public async createMandate(
        context: TestContext,
        options: {
            amountPerDebit?: anchor.BN;
            totalLimit?: anchor.BN;
            isUnlimitedSpend?: boolean;
            chargeType?: { fixed: {} } | { variable: {} };
            frequency?: { daily: {} } | { weekly: {} } | { monthly: {} } | { annually: {} };
            minIntervalSeconds?: anchor.BN;
            startAt?: anchor.BN;
            endAt?: anchor.BN;
            allowedRecipients?: PublicKey[];
            allowedAssets?: PublicKey[];
            policyHash?: number[];
        } = {}
    ): Promise<void> {
        const now = Math.floor(Date.now() / 1000);
        const DEFAULT_AMOUNT_PER_DEBIT = new anchor.BN(100_000);
        const DEFAULT_LIMIT = new anchor.BN(1_000_000);
        const DEFAULT_FREQUENCY_SECS = new anchor.BN(60);

        const {
            amountPerDebit = DEFAULT_AMOUNT_PER_DEBIT,
            totalLimit = DEFAULT_LIMIT,
            isUnlimitedSpend = false,
            chargeType = { fixed: {} },
            frequency = { daily: {} },
            minIntervalSeconds = DEFAULT_FREQUENCY_SECS,
            startAt = new anchor.BN(now - 3600),
            endAt = new anchor.BN(now + 365 * 86400),
            allowedRecipients = [],
            allowedAssets = [],
            policyHash = Array(32).fill(0),
        } = options;

        policyHash[0] = 1;

        await context.program.methods
            .createMandate(context.mandateId, {
                sender: context.sender.publicKey,
                recipient: context.recipient.publicKey,
                amountPerDebit,
                totalLimit,
                isUnlimitedSpend,
                chargeType,
                frequency,
                minIntervalSeconds,
                startAt,
                endAt,
                allowedRecipients,
                allowedAssets,
                policyHash,
            })
            .accountsPartial({
                authority: context.authority.publicKey,
                sender: context.sender.publicKey,
                recipient: context.recipient.publicKey,
                mandate: context.mandatePda,
                mint: context.mint,
                senderTokenAccount: context.senderTokenAccount,
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
                sender: context.sender.publicKey,
                recipient: context.recipient.publicKey,
                mandate: context.mandatePda,
                mint: context.mint,
                senderTokenAccount: context.senderTokenAccount,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([context.sender])
            .rpc();
    }

    public async createAndApproveMandate(
        context: TestContext,
        options?: {
            amountPerDebit?: anchor.BN;
            totalLimit?: anchor.BN;
            isUnlimitedSpend?: boolean;
            chargeType?: { fixed: {} } | { variable: {} };
            frequency?: { daily: {} } | { weekly: {} } | { monthly: {} } | { annually: {} };
            minIntervalSeconds?: anchor.BN;
        }
    ): Promise<void> {
        await this.createMandate(context, options);
        await this.approveMandate(context);
    }

    public async createApprovedFixedMandate(
        context: TestContext,
        options?: {
            amountPerDebit?: anchor.BN;
            totalLimit?: anchor.BN;
            minIntervalSeconds?: anchor.BN;
        }
    ): Promise<void> {
        await this.createAndApproveMandate(context, {
            ...options,
            chargeType: { fixed: {} },
            isUnlimitedSpend: false,
        });
    }

    public async createApprovedVariableMandate(
        context: TestContext,
        options?: {
            amountPerDebit?: anchor.BN;
            totalLimit?: anchor.BN;
            minIntervalSeconds?: anchor.BN;
        }
    ): Promise<void> {
        await this.createAndApproveMandate(context, {
            ...options,
            chargeType: { variable: {} },
            isUnlimitedSpend: false,
        });
    }

    public async createApprovedUnlimitedMandate(
        context: TestContext,
        options?: {
            amountPerDebit?: anchor.BN;
            chargeType?: { fixed: {} } | { variable: {} };
            minIntervalSeconds?: anchor.BN;
        }
    ): Promise<void> {
        await this.createAndApproveMandate(context, {
            ...options,
            totalLimit: new anchor.BN(0),
            isUnlimitedSpend: true,
        });
    }
}
