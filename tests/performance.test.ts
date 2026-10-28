import { expect, it } from 'vitest';
// @ts-expect-error Node build-tool module
import { analyzePerformance } from '../tools/performance-core.mjs';
const entry = { path: 'assets/index-123.js', entry: true, bytes: 350000, gzipBytes: 110000,
  imports: [], dynamicImports: ['assets/protocol-123.js'], modules: ['<project>/src/App.tsx'] };
const sdk = { path: 'assets/protocol-123.js', entry: false, bytes: 166000, gzipBytes: 50000,
  imports: [], dynamicImports: [], modules: ['<project>/node_modules/@uniswap/v3-sdk/dist/index.js'] };
it('measures static dependencies independently of deferred SDK bytes', () => {
  const report = analyzePerformance([entry, sdk]);
  expect(report.initial.bytes).toBe(350000);
  expect(report.total.bytes).toBe(516000);
  expect(report.officialSdkDeferred).toBe(true);
});
it('includes shared static chunks exactly once even across cycles', () => {
  const shared = { ...entry, path: 'assets/shared-123.js', entry: false, bytes: 10, gzipBytes: 10,
    imports: [entry.path], dynamicImports: [] };
  expect(analyzePerformance([{ ...entry, imports: [shared.path] }, sdk, shared]).initial.bytes).toBe(350010);
});
it.each([
  [entry], [entry, sdk, sdk], [{ ...entry, imports: [sdk.path] }, sdk],
  [{ ...entry, bytes: 400001 }, sdk], [{ ...entry, gzipBytes: 130001 }, sdk],
  [entry, { ...sdk, bytes: 300000 }], [{ ...entry, imports: ['https://external.example/file.js'] }, sdk],
  [{ ...entry, path: '../outside.js' }, sdk], [{ ...entry, bytes: -1 }, sdk],
  [{ ...entry, bytes: 1.5 }, sdk], [{ ...entry, modules: [null] }, sdk],
  [{ ...entry, entry: false }, sdk], [entry, { ...sdk, entry: true }],
].map(chunks => ({ chunks })))('rejects missing SDK, eager SDK, graph corruption or a budget regression %j', ({ chunks }) => {
  expect(() => analyzePerformance(chunks)).toThrow();
});
