import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";

describe("create_mandate", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
    });

    it("should create a mandate with fixed debit type", async () => {
        const amountPerDebit = new anchor.BN(1000000); // 1 tokens
        const limit = new anchor.BN(2000000000); // 20 tokens
        const debitFrequencySeconds = new anchor.BN(60);

        await testFactory.createMandate(context, {
            amountPerDebit,
            limit,
            isUnlimitedSpend: false,
            debitType: { fixed: {} },
            debitFrequencySeconds,
        });

        // Fetch the mandate account
        const mandateAccount = await context.program.account.mandate.fetch(
            context.mandatePda
        );

        expect(mandateAccount.id.toString()).to.equal(context.mandateId.toString());
        expect(mandateAccount.authority.toString()).to.equal(
            context.authority.publicKey.toString()
        );
        expect(mandateAccount.user.toString()).to.equal(
            context.user.publicKey.toString()
        );
        expect(mandateAccount.mint.toString()).to.equal(context.mint.toString());
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
        const limit = new anchor.BN(0); // Variable amount // Unlimited
        const debitFrequencySeconds = new anchor.BN(60);

        await testFactory.createMandate(context, {
            amountPerDebit,
            limit,
            isUnlimitedSpend: true,
            debitType: { variable: {} },
            debitFrequencySeconds,
        });

        const mandateAccount = await context.program.account.mandate.fetch(
            context.mandatePda
        );

        expect(mandateAccount.isUnlimitedSpend).to.be.true;
        expect(mandateAccount.debitType).to.deep.equal({ variable: {} });
    });

    it("should fail to create mandate with same ID twice", async () => {
        const args = {
            amountPerDebit: new anchor.BN(100000),
            limit: new anchor.BN(1000000),
            isUnlimitedSpend: false,
            debitType: { fixed: {} } as const,
            debitFrequencySeconds: new anchor.BN(60),
        };

        // Create first mandate
        await testFactory.createMandate(context, args);

        // Try to create second mandate with same ID
        try {
            await testFactory.createMandate(context, args);
            expect.fail("Should have thrown error for duplicate mandate ID");
        } catch (error) {
            expect(error.message).to.include("already in use");
        }
    });
});
