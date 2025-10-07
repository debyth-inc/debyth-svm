import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";

describe("Mandate Creation", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
    });

    it("creates a mandate with fixed debit type and limited spending", async () => {
        const AMOUNT_PER_DEBIT = new anchor.BN(1_000_000);  // 1 token
        const TOTAL_LIMIT = new anchor.BN(20_000_000);      // 20 tokens
        const DEBIT_FREQUENCY_SECONDS = new anchor.BN(60);

        await testFactory.createMandate(context, {
            amountPerDebit: AMOUNT_PER_DEBIT,
            limit: TOTAL_LIMIT,
            isUnlimitedSpend: false,
            debitType: { fixed: {} },
            debitFrequencySeconds: DEBIT_FREQUENCY_SECONDS,
        });

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);

        expect(mandate.id.toString()).to.equal(context.mandateId.toString());
        expect(mandate.authority.toString()).to.equal(context.authority.publicKey.toString());
        expect(mandate.user.toString()).to.equal(context.user.publicKey.toString());
        expect(mandate.mint.toString()).to.equal(context.mint.toString());
        expect(mandate.amountPerDebit.toString()).to.equal(AMOUNT_PER_DEBIT.toString());
        expect(mandate.limit.toString()).to.equal(TOTAL_LIMIT.toString());
        expect(mandate.isUnlimitedSpend).to.be.false;
        expect(mandate.debitType).to.deep.equal({ fixed: {} });
        expect(mandate.isApproved).to.be.false;
        expect(mandate.isActive).to.be.false;
        expect(mandate.totalDebitedAmount.toString()).to.equal("0");
    });

    it("creates a mandate with variable debit type and unlimited spending", async () => {
        const AMOUNT_PER_DEBIT = new anchor.BN(1_000_000);  // 1 token
        const LIMIT = new anchor.BN(0);                      // Not enforced when unlimited
        const DEBIT_FREQUENCY_SECONDS = new anchor.BN(60);

        await testFactory.createMandate(context, {
            amountPerDebit: AMOUNT_PER_DEBIT,
            limit: LIMIT,
            isUnlimitedSpend: true,
            debitType: { variable: {} },
            debitFrequencySeconds: DEBIT_FREQUENCY_SECONDS,
        });

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);

        expect(mandate.isUnlimitedSpend).to.be.true;
        expect(mandate.debitType).to.deep.equal({ variable: {} });
    });

    it("rejects duplicate mandate creation with same ID", async () => {
        const mandateConfig = {
            amountPerDebit: new anchor.BN(100_000),
            limit: new anchor.BN(1_000_000),
            isUnlimitedSpend: false,
            debitType: { fixed: {} } as const,
            debitFrequencySeconds: new anchor.BN(60),
        };

        await testFactory.createMandate(context, mandateConfig);

        try {
            await testFactory.createMandate(context, mandateConfig);
            expect.fail("Should have thrown error for duplicate mandate ID");
        } catch (error) {
            expect(error.message).to.include("already in use");
        }
    });

    it("rejects mandate creation with zero amount_per_debit", async () => {
        try {
            await testFactory.createMandate(context, {
                amountPerDebit: new anchor.BN(0),
                limit: new anchor.BN(1_000_000),
                isUnlimitedSpend: false,
                debitType: { fixed: {} },
                debitFrequencySeconds: new anchor.BN(60),
            });
            expect.fail("Should have thrown error for zero amount_per_debit");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidAmount");
        }
    });

    it("rejects mandate creation with zero debit_frequency_seconds", async () => {
        try {
            await testFactory.createMandate(context, {
                amountPerDebit: new anchor.BN(100_000),
                limit: new anchor.BN(1_000_000),
                isUnlimitedSpend: false,
                debitType: { fixed: {} },
                debitFrequencySeconds: new anchor.BN(0),
            });
            expect.fail("Should have thrown error for zero debit_frequency_seconds");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidDebitFrequency");
        }
    });
});
