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
import { expect } from "chai";
import { Mandate } from "../target/types/mandate";

describe("mandate", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Mandate as Program<Mandate>;
    const connection = provider.connection;

    async function airdropAndConfirm(
        connection: typeof provider.connection,
        pubkey: PublicKey,
        lamports: number
    ) {
        const sig = await connection.requestAirdrop(pubkey, lamports);
        const latest = await connection.getLatestBlockhash();
        await connection.confirmTransaction({
            signature: sig,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
        });
    }

    let authority: Keypair;
    let user: Keypair;
    let mint: PublicKey;
    let mandateId: anchor.BN;
    let mandatePda: PublicKey;
    let userTokenAccount: PublicKey;
    let authorityTokenAccount: PublicKey;

    beforeEach(async () => {
        // Create new keypairs for each test
        authority = Keypair.generate();
        user = Keypair.generate();
        mandateId = new anchor.BN(Math.floor(Math.random() * 1000000));

        // Airdrop SOL to accounts
        await airdropAndConfirm(
            connection,
            authority.publicKey,
            2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await airdropAndConfirm(
            connection,
            user.publicKey,
            2 * anchor.web3.LAMPORTS_PER_SOL
        );

        // Create mint
        mint = await createMint(
            connection,
            authority,
            authority.publicKey,
            null,
            6
        );

        // Create token accounts
        const uTa = await getOrCreateAssociatedTokenAccount(
            connection,
            user,
            mint,
            user.publicKey,
            false,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );
        userTokenAccount = uTa.address;

        const aTa = await getOrCreateAssociatedTokenAccount(
            connection,
            authority,
            mint,
            authority.publicKey,
            false,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );
        authorityTokenAccount = aTa.address;

        // Mint tokens to user
        await mintTo(
            connection,
            authority,
            mint,
            userTokenAccount,
            authority,
            1000000 // 1,000 tokens with 6 decimals
        );

        // Derive mandate PDA
        [mandatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("mandate"), mandateId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
    });

    describe("create_mandate", () => {
        it("should create a mandate with fixed debit type", async () => {
            const amountPerDebit = new anchor.BN(1000000); // 1 tokens
            const limit = new anchor.BN(2000000000); // 20 tokens
            const debitFrequencySeconds = new anchor.BN(60);

            const tx = await program.methods
                .createMandate(mandateId, {
                    amountPerDebit,
                    limit,
                    isUnlimitedSpend: false,
                    debitType: { fixed: {} },
                    debitFrequencySeconds,
                })
                .accountsPartial({
                    authority: authority.publicKey,
                    user: user.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([authority])
                .rpc();

            // Fetch the mandate account
            const mandateAccount = await program.account.mandate.fetch(
                mandatePda
            );

            expect(mandateAccount.id.toString()).to.equal(mandateId.toString());
            expect(mandateAccount.authority.toString()).to.equal(
                authority.publicKey.toString()
            );
            expect(mandateAccount.user.toString()).to.equal(
                user.publicKey.toString()
            );
            expect(mandateAccount.mint.toString()).to.equal(mint.toString());
            expect(mandateAccount.amountPerDebit.toString()).to.equal(
                amountPerDebit.toString()
            );
            expect(mandateAccount.limit.toString()).to.equal(limit.toString());
            expect(mandateAccount.isUnlimitedSpend).to.be.false;
            expect(mandateAccount.debitType).to.deep.equal({ fixed: {} });
            expect(mandateAccount.isApproved).to.be.false;
            expect(mandateAccount.isActive).to.be.false;
            expect(mandateAccount.totalDebitedAmount.toString()).to.equal("0");
        });

        it("should create a mandate with variable debit type and unlimited spend", async () => {
            const amountPerDebit = new anchor.BN(1000000); // 1 token
            const limit = new anchor.BN(0); // 20 tokens // Variable amount // Unlimited
            const debitFrequencySeconds = new anchor.BN(60);

            await program.methods
                .createMandate(mandateId, {
                    amountPerDebit,
                    limit,
                    isUnlimitedSpend: true,
                    debitType: { variable: {} },
                    debitFrequencySeconds,
                })
                .accountsPartial({
                    authority: authority.publicKey,
                    user: user.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([authority])
                .rpc();

            const mandateAccount = await program.account.mandate.fetch(
                mandatePda
            );

            expect(mandateAccount.isUnlimitedSpend).to.be.true;
            expect(mandateAccount.debitType).to.deep.equal({ variable: {} });
        });

        it("should fail to create mandate with same ID twice", async () => {
            const args = {
                amountPerDebit: new anchor.BN(100000),
                limit: new anchor.BN(1000000),
                isUnlimitedSpend: false,
                debitType: { fixed: {} },
                debitFrequencySeconds: new anchor.BN(60),
            };

            // Create first mandate
            await program.methods
                .createMandate(mandateId, args)
                .accountsPartial({
                    authority: authority.publicKey,
                    user: user.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([authority])
                .rpc();

            // Try to create second mandate with same ID
            try {
                await program.methods
                    .createMandate(mandateId, args)
                    .accountsPartial({
                        authority: authority.publicKey,
                        user: user.publicKey,
                        mandate: mandatePda,
                        mint,
                        userTokenAccount,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([authority])
                    .rpc();

                expect.fail(
                    "Should have thrown error for duplicate mandate ID"
                );
            } catch (error) {
                expect(error.message).to.include("already in use");
            }
        });
    });

    describe("approve_mandate", () => {
        beforeEach(async () => {
            // Create mandate first
            await program.methods
                .createMandate(mandateId, {
                    amountPerDebit: new anchor.BN(100000),
                    limit: new anchor.BN(1000000),
                    isUnlimitedSpend: false,
                    debitType: { fixed: {} },
                    debitFrequencySeconds: new anchor.BN(60),
                })
                .accountsPartial({
                    authority: authority.publicKey,
                    user: user.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([authority])
                .rpc();
        });

        it("should approve a mandate", async () => {
            await program.methods
                .approveMandate(mandateId)
                .accountsPartial({
                    user: user.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([user])
                .rpc();

            const mandateAccount = await program.account.mandate.fetch(
                mandatePda
            );
            expect(mandateAccount.isApproved).to.be.true;
            expect(mandateAccount.isActive).to.be.true;
        });

        it("should fail to approve already approved mandate", async () => {
            // First approval
            await program.methods
                .approveMandate(mandateId)
                .accountsPartial({
                    user: user.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([user])
                .rpc();

            // Second approval should fail
            try {
                await program.methods
                    .approveMandate(mandateId)
                    .accountsPartial({
                        user: user.publicKey,
                        mandate: mandatePda,
                        mint,
                        userTokenAccount,
                        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([user])
                    .rpc();

                expect.fail(
                    "Should have failed to approve already approved mandate"
                );
            } catch (error) {
                expect(error.error.errorCode.code).to.equal("AlreadyApproved");
            }
        });

        it("should fail if wrong user tries to approve", async () => {
            const wrongUser = Keypair.generate();
            await airdropAndConfirm(
                connection,
                wrongUser.publicKey,
                anchor.web3.LAMPORTS_PER_SOL
            );

            const wrongUserTokenAccount =
                await getOrCreateAssociatedTokenAccount(
                    connection,
                    wrongUser,
                    mint,
                    wrongUser.publicKey,
                    false,
                    undefined,
                    undefined,
                    TOKEN_PROGRAM_ID
                );

            try {
                await program.methods
                    .approveMandate(mandateId)
                    .accountsPartial({
                        user: wrongUser.publicKey,
                        mandate: mandatePda,
                        mint,
                        userTokenAccount: wrongUserTokenAccount.address,
                        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([wrongUser])
                    .rpc();

                expect.fail("Should have failed with wrong user");
            } catch (error) {
                // This should fail due to PDA derivation or account constraint
                expect(error.error?.errorCode?.code || error.error?.code).to.equal("Unauthorized");
            }
        });
    });

    describe("execute_mandate", () => {
        beforeEach(async () => {
            // Create and approve mandate
            await program.methods
                .createMandate(mandateId, {
                    amountPerDebit: new anchor.BN(100000),
                    limit: new anchor.BN(1000000),
                    isUnlimitedSpend: false,
                    debitType: { fixed: {} },
                    debitFrequencySeconds: new anchor.BN(1),
                })
                .accountsPartial({
                    authority: authority.publicKey,
                    user: user.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([authority])
                .rpc();

            await program.methods
                .approveMandate(mandateId)
                .accountsPartial({
                    user: user.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([user])
                .rpc();
        });

        it("should execute mandate with correct fixed amount", async () => {
            const amountToDebit = new anchor.BN(100000); // Should match amountPerDebit

            await program.methods
                .executeMandate({ amountToDebit })
                .accountsPartial({
                    authority: authority.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    destinationTokenAccount: authorityTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([authority])
                .rpc();

            const mandateAccount = await program.account.mandate.fetch(
                mandatePda
            );
            expect(mandateAccount.totalDebitedAmount.toString()).to.equal(
                "100000"
            );
        });

        it("should fail to execute with wrong fixed amount", async () => {
            const wrongAmount = new anchor.BN(50000); // Different from amountPerDebit

            try {
                await program.methods
                    .executeMandate({ amountToDebit: wrongAmount })
                    .accountsPartial({
                        authority: authority.publicKey,
                        mandate: mandatePda,
                        mint,
                        userTokenAccount,
                        destinationTokenAccount: authorityTokenAccount,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([authority])
                    .rpc();

                expect.fail("Should have failed with wrong fixed amount");
            } catch (error) {
                expect(error.error.errorCode.code).to.equal(
                    "InvalidAmountForFixedDebit"
                );
            }
        });

        it("should fail to execute when limit is exceeded", async () => {
            // Execute multiple times to exceed limit
            const amountToDebit = new anchor.BN(100000);

            // Execute 10 times (10 * 100000 = 1000000, which equals the limit)
            for (let i = 0; i < 10; i++) {
                await program.methods
                    .executeMandate({ amountToDebit })
                    .accountsPartial({
                        authority: authority.publicKey,
                        mandate: mandatePda,
                        mint,
                        userTokenAccount,
                        destinationTokenAccount: authorityTokenAccount,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([authority])
                    .rpc();
                
                // Add delay to avoid time constraint issues
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // 11th execution should fail
            try {
                await program.methods
                    .executeMandate({ amountToDebit })
                    .accountsPartial({
                        authority: authority.publicKey,
                        mandate: mandatePda,
                        mint,
                        userTokenAccount,
                        destinationTokenAccount: authorityTokenAccount,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([authority])
                    .rpc();

                expect.fail("Should have failed when limit exceeded");
            } catch (error) {
                expect(error.error.errorCode.code).to.equal(
                    "DebitLimitExceeded"
                );
            }
        });

        it("should fail if wrong authority tries to execute", async () => {
            const wrongAuthority = Keypair.generate();
            await connection.confirmTransaction(
                await connection.requestAirdrop(
                    wrongAuthority.publicKey,
                    anchor.web3.LAMPORTS_PER_SOL
                )
            );

            try {
                await program.methods
                    .executeMandate({ amountToDebit: new anchor.BN(100000) })
                    .accountsPartial({
                        authority: wrongAuthority.publicKey,
                        mandate: mandatePda,
                        mint,
                        userTokenAccount,
                        destinationTokenAccount: authorityTokenAccount,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([wrongAuthority])
                    .rpc();

                expect.fail("Should have failed with wrong authority");
            } catch (error) {
                expect(error.error.errorCode.code).to.equal("InvalidAuthority");
            }
        });
    });

    describe("modify_mandate", () => {
        beforeEach(async () => {
            // Create mandate
            await program.methods
                .createMandate(mandateId, {
                    amountPerDebit: new anchor.BN(100000),
                    limit: new anchor.BN(1000000),
                    isUnlimitedSpend: false,
                    debitType: { fixed: {} },
                    debitFrequencySeconds: new anchor.BN(60),
                })
                .accountsPartial({
                    authority: authority.publicKey,
                    user: user.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([authority])
                .rpc();

            await program.methods
                .approveMandate(mandateId)
                .accountsPartial({
                    user: user.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([user])
                .rpc();
        });

        it("should modify mandate parameters", async () => {
            const newAmountPerDebit = new anchor.BN(200000);
            const newLimit = new anchor.BN(2000000);

            await program.methods
                .modifyMandate({
                    newAmountPerDebit,
                    newLimit,
                    newIsUnlimitedSpend: true,
                    newDebitType: { variable: {} },
                })
                .accountsPartial({
                    authority: authority.publicKey,
                    mandate: mandatePda,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([authority])
                .rpc();

            const mandateAccount = await program.account.mandate.fetch(
                mandatePda
            );
            expect(mandateAccount.amountPerDebit.toString()).to.equal(
                newAmountPerDebit.toString()
            );
            expect(mandateAccount.limit.toString()).to.equal(
                new anchor.BN("18446744073709551615").toString()
            );
            expect(mandateAccount.isUnlimitedSpend).to.be.true;
            expect(mandateAccount.debitType).to.deep.equal({ variable: {} });
        });

        it("should fail if non-authority tries to modify", async () => {
            const nonAuthority = Keypair.generate();
            await connection.confirmTransaction(
                await connection.requestAirdrop(
                    nonAuthority.publicKey,
                    anchor.web3.LAMPORTS_PER_SOL
                )
            );

            try {
                await program.methods
                    .modifyMandate({
                        newAmountPerDebit: new anchor.BN(200000),
                        newLimit: new anchor.BN(2000000),
                        newIsUnlimitedSpend: true,
                        newDebitType: { variable: {} },
                    })
                    .accountsPartial({
                        authority: nonAuthority.publicKey,
                        mandate: mandatePda,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([nonAuthority])
                    .rpc();

                expect.fail("Should have failed with non-authority");
            } catch (error) {
                expect(error.error.errorCode.code).to.equal("InvalidAuthority");
            }
        });
    });

    describe("cancel_mandate", () => {
        beforeEach(async () => {
            // Create and approve mandate
            await program.methods
                .createMandate(mandateId, {
                    amountPerDebit: new anchor.BN(100000),
                    limit: new anchor.BN(1000000),
                    isUnlimitedSpend: false,
                    debitType: { fixed: {} },
                    debitFrequencySeconds: new anchor.BN(60),
                })
                .accountsPartial({
                    authority: authority.publicKey,
                    user: user.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([authority])
                .rpc();

            await program.methods
                .approveMandate(mandateId)
                .accountsPartial({
                    user: user.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([user])
                .rpc();
        });

        it("should allow user to cancel mandate", async () => {
            await program.methods
                .cancelMandate()
                .accountsPartial({
                    user: user.publicKey,
                    authority: authority.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([user])
                .rpc();

            // Expect the account to be closed, so fetching it should fail
            try {
                await program.account.mandate.fetch(mandatePda);
                expect.fail("Fetching mandate account should have failed");
            } catch (error) {
                expect(error.message).to.include("Account does not exist");
            }
        });

        it("should allow authority to cancel mandate", async () => {
            await program.methods
                .cancelMandate()
                .accountsPartial({
                    user: user.publicKey,
                    authority: authority.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount: userTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([authority])
                .rpc();

            // Expect the account to be closed, so fetching it should fail
            try {
                await program.account.mandate.fetch(mandatePda);
                expect.fail("Fetching mandate account should have failed");
            } catch (error) {
                expect(error.message).to.include("Account does not exist");
            }
        });

        it("should fail if unauthorized user tries to cancel", async () => {
            const unauthorizedUser = Keypair.generate();
            await connection.confirmTransaction(
                await connection.requestAirdrop(
                    unauthorizedUser.publicKey,
                    anchor.web3.LAMPORTS_PER_SOL
                )
            );

            try {
                await program.methods
                    .cancelMandate()
                    .accountsPartial({
                        user: unauthorizedUser.publicKey,
                        authority: authority.publicKey,
                        mandate: mandatePda,
                        mint,
                        userTokenAccount,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([unauthorizedUser])
                    .rpc();

                expect.fail("Should have failed with unauthorized user");
            } catch (error) {
                expect(error.error.errorCode.code).to.equal(
                    "UnauthorizedOwner"
                );
            }
        });
    });

    describe("variable debit mandate", () => {
        beforeEach(async () => {
            // Create variable debit mandate
            await program.methods
                .createMandate(mandateId, {
                    amountPerDebit: new anchor.BN(1000000), // Variable amount
                    limit: new anchor.BN(1000000),
                    isUnlimitedSpend: false,
                    debitType: { variable: {} },
                    debitFrequencySeconds: new anchor.BN(1),
                })
                .accountsPartial({
                    authority: authority.publicKey,
                    user: user.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([authority])
                .rpc();

            await program.methods
                .approveMandate(mandateId)
                .accountsPartial({
                    user: user.publicKey,
                    mandate: mandatePda,
                    mint,
                    userTokenAccount,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([user])
                .rpc();
        });

        it("should execute variable debit with different amounts", async () => {
            // Execute with different amounts
            const amounts = [50000, 75000, 125000];
            let totalDebited = 0;

            for (const amount of amounts) {
                await program.methods
                    .executeMandate({ amountToDebit: new anchor.BN(amount) })
                    .accountsPartial({
                        authority: authority.publicKey,
                        mandate: mandatePda,
                        mint,
                        userTokenAccount,
                        destinationTokenAccount: authorityTokenAccount,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([authority])
                    .rpc();

                totalDebited += amount;
                
                // Add delay to avoid time constraint issues
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            const mandateAccount = await program.account.mandate.fetch(
                mandatePda
            );
            expect(mandateAccount.totalDebitedAmount.toString()).to.equal(
                totalDebited.toString()
            );
        });

        it("should fail variable debit with zero amount", async () => {
            try {
                await program.methods
                    .executeMandate({ amountToDebit: new anchor.BN(0) })
                    .accountsPartial({
                        authority: authority.publicKey,
                        mandate: mandatePda,
                        mint,
                        userTokenAccount,
                        destinationTokenAccount: authorityTokenAccount,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([authority])
                    .rpc();

                expect.fail(
                    "Should have failed with zero amount for variable debit"
                );
            } catch (error) {
                expect(error.error?.errorCode?.code || error.error?.code).to.equal(
                    "InvalidAmountForVariableDebit"
                );
            }
        });
    });
});
