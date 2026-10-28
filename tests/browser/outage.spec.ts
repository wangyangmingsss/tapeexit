import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('controlled primary-origin outage leaves a matching alternate recovery package reachable', async ({ page, context, request }) => {
  const primary = 'http://127.0.0.1:4175', alternate = 'http://127.0.0.1:4176';
  const bytes = await readFile('dist/release-manifest.json');
  const trustedDigest = createHash('sha256').update(bytes).digest('hex');
  const original = await request.get(`${primary}/release-manifest.json`);
  expect(createHash('sha256').update(await original.body()).digest('hex')).toBe(trustedDigest);
  const failed: string[] = [];
  page.on('requestfailed', req => failed.push(req.url()));
  await page.route(`${primary}/**`, route => route.abort('connectionrefused'));
  await expect(page.goto(primary)).rejects.toThrow();
  expect(failed.some(url => url.startsWith(primary))).toBe(true);
  const recovery = await context.newPage();
  await recovery.goto(alternate);
  await expect(recovery.getByText('主网只读 · 部署、代币与发行审阅通过前禁止签名')).toBeVisible();
  await expect(recovery.getByRole('button', { name: '读取仓位' })).toBeVisible();
  const recovered = await recovery.request.get(`${alternate}/release-manifest.json`);
  expect(createHash('sha256').update(await recovered.body()).digest('hex')).toBe(trustedDigest);
  await recovery.screenshot({ path: `test-results/${test.info().project.name}-local-outage-alternate.png`, fullPage: true });
  await writeFile(`test-results/${test.info().project.name}-local-outage.json`, JSON.stringify({ schemaVersion: 1,
    browserEngine: test.info().project.name,
    sourceCommit: JSON.parse(bytes.toString()).sourceCommit, manifestSha256: trustedDigest,
    environment: 'CONTROLLED_LOOPBACK_BROWSER_FAULT', primary, alternate, failedRequests: failed,
    result: 'ALTERNATE_READ_ONLY_ENTRY_REACHABLE',
    limitations: ['Primary navigation was aborted by Playwright, not a real public-service outage',
      'Both entries share the CI machine and package; no infrastructure independence is claimed',
      'No wallet, chain transaction or actual TapeOut gateway was exercised'] }, null, 2));
});
