import { expect, it } from 'vitest';
// @ts-expect-error Node business tool
import { businessModel, modelFields } from '../tools/business-model.mjs';
const base = { schemaVersion: 1, currency: 'USD', scenario: 'fixture',
  setupCostCents: 10000, hostingMonthlyCents: 1000, rpcMonthlyCents: 2000, monitoringMonthlyCents: 500,
  loadedHourlyCostCents: 6000, maintenanceMinutesMonthly: 60, supportMinutesPerCustomerMonthly: 10,
  pricePerCustomerMonthlyCents: 10000, onboardingFeeCents: 30000, onboardingMinutesPerCustomer: 120,
  externalReviewPerCustomerCents: 5000, paymentFeeBps: 300, targetCustomers: 3 };
it('computes recurring, setup and onboarding separately using integer cents', () => {
  expect(businessModel(base).results).toEqual({
    fixedMonthlyCostCents: '9500', contributionPerCustomerMonthlyCents: '8700',
    onboardingContributionPerCustomerCents: '12100', operatingBreakEvenCustomers: '2',
    breakEvenStatus: 'CALCULATED', targetMonthlyOperatingNetCents: '16600',
    setupRecoveryMonthsFromRecurringOnly: '1',
  });
  expect(businessModel(base).evidenceLevel).toBe('ASSUMPTIONS_ONLY');
});
it('keeps all unknown inputs and dependent outputs null', () => {
  const input = { schemaVersion: 1, currency: 'USD', scenario: 'unset',
    ...Object.fromEntries(modelFields.map((field: string) => [field, null])) };
  const report = businessModel(input);
  expect(report.status).toBe('INCOMPLETE_ASSUMPTIONS');
  expect(report.missingInputs).toHaveLength(13);
  expect(report.results.fixedMonthlyCostCents).toBeNull();
  expect(report.results.operatingBreakEvenCustomers).toBeNull();
  expect(report.results.targetMonthlyOperatingNetCents).toBeNull();
});
it.each([0, -1])('reports no break even for nonpositive contribution %s', contribution => {
  const report = businessModel({ ...base, pricePerCustomerMonthlyCents: 0,
    supportMinutesPerCustomerMonthly: contribution === 0 ? 0 : 1 });
  expect(report.results.breakEvenStatus).toBe('NO_BREAK_EVEN_AT_ASSUMPTIONS');
  expect(report.results.setupRecoveryMonthsFromRecurringOnly).toBeNull();
});
it('rounds labor and payment expenses upward instead of overstating margin', () => {
  expect(businessModel({ ...base, loadedHourlyCostCents: 1, supportMinutesPerCustomerMonthly: 1,
    pricePerCustomerMonthlyCents: 3, paymentFeeBps: 1 }).results.contributionPerCustomerMonthlyCents).toBe('1');
});
it('does not produce payback on an operating loss', () => {
  expect(businessModel({ ...base, targetCustomers: 0 }).results.setupRecoveryMonthsFromRecurringOnly).toBeNull();
});
it('keeps precision above the safe integer range for computed totals', () => {
  const report = businessModel({ ...base, pricePerCustomerMonthlyCents: Number.MAX_SAFE_INTEGER,
    paymentFeeBps: 0, supportMinutesPerCustomerMonthly: 0, targetCustomers: 1000000 });
  expect(report.results.targetMonthlyOperatingNetCents).toBe(
    (BigInt(Number.MAX_SAFE_INTEGER) * 1000000n - 9500n).toString());
});
it.each([-1, 0.5, '100', undefined, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
  'rejects invalid cost values %s', value => {
    expect(() => businessModel({ ...base, setupCostCents: value })).toThrow();
  });
it.each([{ ...base, currency: 'OKB' }, { ...base, customer: 'claimed' },
  { ...base, paymentFeeBps: 10001 }, { ...base, targetCustomers: 1000001 },
])('rejects invalid currency, extra data or out of range assumptions %j', input => {
  expect(() => businessModel(input)).toThrow();
});
