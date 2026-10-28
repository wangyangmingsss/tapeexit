import { expect, it } from 'vitest';
// @ts-expect-error Node report tool
import { summarizeCompatibility } from '../tools/compatibility-core.mjs';
function fixture() {
  const engines = ['chromium', 'firefox', 'webkit'];
  const capabilities = { webLocks: true, serviceWorker: true, subtleCrypto: true, streams: true, bigint: true };
  return { errors: [], stats: { expected: 138, unexpected: 0, skipped: 0, flaky: 0 },
    config: { projects: engines.map(name => ({ name })) },
    suites: [{ suites: engines.map(engine => ({ specs: Array.from({ length: 46 }, (_, i) => ({
      tests: [{ projectName: engine, expectedStatus: 'passed', status: 'expected',
        results: [{ status: 'passed', retry: 0, attachments: i ? [] : [{ name: 'browser-capabilities',
          contentType: 'application/json', body: Buffer.from(JSON.stringify({
            engine, version: 'fixture-version', capabilities,
          })).toString('base64') }] }] }],
    })) })) }] };
}
it('counts equal engine matrices and requires observed API capabilities', () => {
  const result = summarizeCompatibility(fixture());
  expect(result.passed).toBe(138);
  expect(result.projects.map((p: { passed: number }) => p.passed)).toEqual([46, 46, 46]);
  expect(result.scope).toContain('Not branded Safari');
});
it.each(['unexpected', 'skipped', 'flaky'] as const)('rejects a matrix with %s cases', field => {
  const report = fixture(); report.stats[field] = 1;
  expect(() => summarizeCompatibility(report)).toThrow();
});
it('rejects missing engines, partial results and retry passes', () => {
  const missing = fixture(); missing.config.projects.pop();
  expect(() => summarizeCompatibility(missing)).toThrow();
  const partial = fixture(); partial.suites[0].suites[0].specs.pop();
  expect(() => summarizeCompatibility(partial)).toThrow();
  const retry = fixture(); retry.suites[0].suites[0].specs[0].tests[0].results[0].retry = 1;
  expect(() => summarizeCompatibility(retry)).toThrow();
});
it('rejects absent capability evidence and falsely declared API support', () => {
  const missing = fixture(); missing.suites[0].suites[0].specs[0].tests[0].results[0].attachments = [];
  expect(() => summarizeCompatibility(missing)).toThrow();
  const invalid = fixture();
  invalid.suites[0].suites[0].specs[0].tests[0].results[0].attachments[0].body =
    Buffer.from(JSON.stringify({ engine: 'chromium', version: 'fixture', capabilities: { webLocks: false } })).toString('base64');
  expect(() => summarizeCompatibility(invalid)).toThrow();
});
