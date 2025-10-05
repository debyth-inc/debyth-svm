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

/**
 * Test context containing all accounts and configuration needed for mandate tests
 */
export interface TestContext {
    program: Program<Mandate>;
    connection: anchor.web3.Connection;
    authority: Keypair;           // The service provider who creates and executes mandates
    user: Keypair;                 // The token owner who approves mandates
    mint: PublicKey;               // The SPL token mint
    mandateId: anchor.BN;          // Unique identifier for the mandate
    mandatePda: PublicKey;         // Program derived address for the mandate account
    userTokenAccount: PublicKey;   // User's associated token account (source of debits)
    authorityTokenAccount: PublicKey; // Authority's associated token account (destination)
}

/**
 * Factory for creating and managing test contexts and common mandate operations
 * Uses singleton pattern to share program and connection instances across tests
 */
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

    /**
     * Airdrops SOL to an account and waits for confirmation
     */
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

    /**
     * Creates a fresh test context with new accounts and initial token balances
     * Each context is isolated to prevent test interference
     */
    public async createTestContext(): Promise<TestContext> {
        const authority = Keypair.generate();
        const user = Keypair.generate();
        const mandateId = new anchor.BN(Math.floor(Math.random() * 1000000));

        const SOL_AIRDROP_AMOUNT = 2 * anchor.web3.LAMPORTS_PER_SOL;
        await this.airdropAndConfirm(authority.publicKey, SOL_AIRDROP_AMOUNT);
        await this.airdropAndConfirm(user.publicKey, SOL_AIRDROP_AMOUNT);

        const DECIMALS = 6;
        const mint = await createMint(
            this.connection,
            authority,
            authority.publicKey,
            null,
            DECIMALS
        );

        const userTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
            this.connection,
            user,
            mint,
            user.publicKey,
            false,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );

        const authorityTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
            this.connection,
            authority,
            mint,
            authority.publicKey,
            false,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );

        const INITIAL_USER_BALANCE = 1_000_000; // 1,000 tokens with 6 decimals
        await mintTo(
            this.connection,
            authority,
            mint,
            userTokenAccountInfo.address,
            authority,
            INITIAL_USER_BALANCE
        );

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
            userTokenAccount: userTokenAccountInfo.address,
            authorityTokenAccount: authorityTokenAccountInfo.address,
        };
    }

    /**
     * Creates a mandate with optional custom parameters
     * Defaults to a fixed debit type with standard limits
     */
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
        const DEFAULT_AMOUNT_PER_DEBIT = new anchor.BN(100_000);  // 0.1 tokens
        const DEFAULT_LIMIT = new anchor.BN(1_000_000);            // 1 token total
        const DEFAULT_FREQUENCY = new anchor.BN(60);               // 60 seconds

        const {
            amountPerDebit = DEFAULT_AMOUNT_PER_DEBIT,
            limit = DEFAULT_LIMIT,
            isUnlimitedSpend = false,
            debitType = { fixed: {} },
            debitFrequencySeconds = DEFAULT_FREQUENCY,
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

    /**
     * Approves an existing mandate as the user
     */
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

    /**
     * Helper to create and immediately approve a mandate
     * Useful for tests that need an active mandate as a starting point
     */
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

    /**
     * Fixture: Creates an approved fixed debit mandate with standard parameters
     */
    public async createApprovedFixedMandate(
        context: TestContext,
        options?: {
            amountPerDebit?: anchor.BN;
            limit?: anchor.BN;
            debitFrequencySeconds?: anchor.BN;
        }
    ): Promise<void> {
        await this.createAndApproveMandate(context, {
            ...options,
            debitType: { fixed: {} },
            isUnlimitedSpend: false,
        });
    }

    /**
     * Fixture: Creates an approved variable debit mandate with standard parameters
     */
    public async createApprovedVariableMandate(
        context: TestContext,
        options?: {
            amountPerDebit?: anchor.BN;
            limit?: anchor.BN;
            debitFrequencySeconds?: anchor.BN;
        }
    ): Promise<void> {
        await this.createAndApproveMandate(context, {
            ...options,
            debitType: { variable: {} },
            isUnlimitedSpend: false,
        });
    }

    /**
     * Fixture: Creates an approved unlimited spending mandate
     */
    public async createApprovedUnlimitedMandate(
        context: TestContext,
        options?: {
            amountPerDebit?: anchor.BN;
            debitType?: { fixed: {} } | { variable: {} };
            debitFrequencySeconds?: anchor.BN;
        }
    ): Promise<void> {
        await this.createAndApproveMandate(context, {
            ...options,
            limit: new anchor.BN(0),
            isUnlimitedSpend: true,
        });
    }
}


