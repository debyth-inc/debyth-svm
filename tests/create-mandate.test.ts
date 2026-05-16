import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { TestFactory, TestContext } from "./test-factory";

describe("Mandate Creation", () => {
    const testFactory = TestFactory.getInstance();
    let context: TestContext;

    beforeEach(async () => {
        context = await testFactory.createTestContext();
    });

    it("creates a mandate with fixed charge type and limited spending", async () => {
        const AMOUNT_PER_DEBIT = new anchor.BN(1_000_000);
        const TOTAL_LIMIT = new anchor.BN(20_000_000);
        const MIN_INTERVAL_SECONDS = new anchor.BN(60);

        await testFactory.createMandate(context, {
            amountPerDebit: AMOUNT_PER_DEBIT,
            totalLimit: TOTAL_LIMIT,
            isUnlimitedSpend: false,
            chargeType: { fixed: {} },
            minIntervalSeconds: MIN_INTERVAL_SECONDS,
        });

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);

        expect(mandate.id.toString()).to.equal(context.mandateId.toString());
        expect(mandate.authority.toString()).to.equal(context.authority.publicKey.toString());
        expect(mandate.sender.toString()).to.equal(context.sender.publicKey.toString());
        expect(mandate.mint.toString()).to.equal(context.mint.toString());
        expect(mandate.policy.perExecutionLimit.toString()).to.equal(AMOUNT_PER_DEBIT.toString());
        expect(mandate.policy.lifetimeLimit.toString()).to.equal(TOTAL_LIMIT.toString());
        expect(mandate.policy.chargeType).to.deep.equal({ fixed: {} });
        expect(mandate.isApproved).to.be.false;
        expect(mandate.status).to.deep.equal({ pending: {} });
        expect(mandate.totalExecuted.toString()).to.equal("0");
    });

    it("creates a mandate with variable charge type and unlimited spending", async () => {
        const AMOUNT_PER_DEBIT = new anchor.BN(1_000_000);
        const MIN_INTERVAL_SECONDS = new anchor.BN(60);

        await testFactory.createMandate(context, {
            amountPerDebit: AMOUNT_PER_DEBIT,
            totalLimit: new anchor.BN(0),
            isUnlimitedSpend: true,
            chargeType: { variable: {} },
            minIntervalSeconds: MIN_INTERVAL_SECONDS,
        });

        const mandate = await context.program.account.mandate.fetch(context.mandatePda);

        expect(mandate.policy.lifetimeLimit.toString()).to.equal("18446744073709551615");
        expect(mandate.policy.chargeType).to.deep.equal({ variable: {} });
    });

    it("rejects duplicate mandate creation with same ID", async () => {
        const mandateConfig = {
            amountPerDebit: new anchor.BN(100_000),
            totalLimit: new anchor.BN(1_000_000),
            isUnlimitedSpend: false,
            chargeType: { fixed: {} } as const,
            minIntervalSeconds: new anchor.BN(60),
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
                totalLimit: new anchor.BN(1_000_000),
                isUnlimitedSpend: false,
                chargeType: { fixed: {} },
                minIntervalSeconds: new anchor.BN(60),
            });
            expect.fail("Should have thrown error for zero amount_per_debit");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("DebitAmountTooSmall");
        }
    });

    it("rejects mandate creation with zero min_interval_seconds", async () => {
        try {
            await testFactory.createMandate(context, {
                amountPerDebit: new anchor.BN(100_000),
                totalLimit: new anchor.BN(1_000_000),
                isUnlimitedSpend: false,
                chargeType: { fixed: {} },
                minIntervalSeconds: new anchor.BN(0),
            });
            expect.fail("Should have thrown error for zero min_interval_seconds");
        } catch (error) {
            expect(error.error.errorCode.code).to.equal("InvalidDebitFrequency");
        }
    });
});
