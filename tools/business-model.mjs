import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const modelFields = ['setupCostCents', 'hostingMonthlyCents', 'rpcMonthlyCents',
  'monitoringMonthlyCents', 'loadedHourlyCostCents', 'maintenanceMinutesMonthly',
  'supportMinutesPerCustomerMonthly', 'pricePerCustomerMonthlyCents', 'onboardingFeeCents',
  'onboardingMinutesPerCustomer', 'externalReviewPerCustomerCents', 'paymentFeeBps', 'targetCustomers'];
const ceil = (n, d) => (n + d - 1n) / d;
export function businessModel(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.schemaVersion !== 1 ||
      input.currency !== 'USD' || typeof input.scenario !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(input.scenario) ||
      Object.keys(input).some(k => !['schemaVersion', 'currency', 'scenario', ...modelFields].includes(k)))
    throw new Error('Expected a USD assumptions scenario without extra fields');
  const values = {};
  for (const field of modelFields) {
    const value = input[field];
    if (value !== null && (!Number.isSafeInteger(value) || value < 0 ||
        (field === 'paymentFeeBps' && value > 10000) ||
        (field === 'targetCustomers' && value > 1000000)))
      throw new Error(`Explicit nonnegative integer or null required: ${field}`);
    values[field] = value === null ? null : BigInt(value);
  }
  const missing = modelFields.filter(field => values[field] === null);
  const compute = (fields, action) => fields.some(field => values[field] === null) ? null : action();
  const labor = minutes => ceil(minutes * values.loadedHourlyCostCents, 60n);
  const fee = amount => ceil(amount * values.paymentFeeBps, 10000n);
  const fixed = compute(['hostingMonthlyCents', 'rpcMonthlyCents', 'monitoringMonthlyCents',
    'maintenanceMinutesMonthly', 'loadedHourlyCostCents'], () => values.hostingMonthlyCents +
    values.rpcMonthlyCents + values.monitoringMonthlyCents + labor(values.maintenanceMinutesMonthly));
  const contribution = compute(['pricePerCustomerMonthlyCents', 'supportMinutesPerCustomerMonthly',
    'loadedHourlyCostCents', 'paymentFeeBps'], () => values.pricePerCustomerMonthlyCents -
    fee(values.pricePerCustomerMonthlyCents) - labor(values.supportMinutesPerCustomerMonthly));
  const onboarding = compute(['onboardingFeeCents', 'onboardingMinutesPerCustomer',
    'externalReviewPerCustomerCents', 'loadedHourlyCostCents', 'paymentFeeBps'], () =>
    values.onboardingFeeCents - fee(values.onboardingFeeCents) -
    labor(values.onboardingMinutesPerCustomer) - values.externalReviewPerCustomerCents);
  const breakEven = fixed === null || contribution === null ? null :
    contribution > 0n ? ceil(fixed, contribution) : fixed === 0n && contribution === 0n ? 0n : null;
  const monthlyNet = fixed === null || contribution === null || values.targetCustomers === null ? null :
    values.targetCustomers * contribution - fixed;
  const recoveryMonths = monthlyNet !== null && monthlyNet > 0n && values.setupCostCents !== null ?
    ceil(values.setupCostCents, monthlyNet) : null;
  const text = value => value === null ? null : value.toString();
  return { schemaVersion: 1, status: missing.length ? 'INCOMPLETE_ASSUMPTIONS' : 'ASSUMPTIONS_CALCULATED',
    evidenceLevel: 'ASSUMPTIONS_ONLY', currency: 'USD', scenario: input.scenario, missingInputs: missing,
    assumptions: input,
    results: { fixedMonthlyCostCents: text(fixed), contributionPerCustomerMonthlyCents: text(contribution),
      onboardingContributionPerCustomerCents: text(onboarding), operatingBreakEvenCustomers: text(breakEven),
      breakEvenStatus: fixed === null || contribution === null ? 'UNKNOWN' :
        breakEven === null ? 'NO_BREAK_EVEN_AT_ASSUMPTIONS' : 'CALCULATED',
      targetMonthlyOperatingNetCents: text(monthlyNet), setupRecoveryMonthsFromRecurringOnly: text(recoveryMonths) },
    limitations: ['Assumptions are not supplier quotes, customers, signed agreements, revenue or market validation',
      'No acquisition, churn, tax, FX, discounts, refunds, liability or capital costs are modeled',
      'Onboarding is separate; payback uses recurring operating surplus only and assumes the target customer count from month one',
      'Labor and payment costs round up to cents; currency outputs are integer cent strings',
      'Chain activation and upload costs must be converted from actual observations and included explicitly; unknown is not zero'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = 'release-artifacts/business-model.json';
  await mkdir('release-artifacts', { recursive: true }); await rm(output, { force: true });
  if (process.argv.length > 3) throw new Error('Usage: npm run model:business -- [assumptions.json]');
  const input = JSON.parse(await readFile(process.argv[2] || 'docs/competition/BUSINESS-ASSUMPTIONS.example.json', 'utf8'));
  const report = businessModel(input);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status}; ${report.missingInputs.length} missing inputs; no customer evidence claimed.`);
}
