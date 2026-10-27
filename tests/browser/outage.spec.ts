import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('controlled primary-origin outage leaves a matching alternate recovery package reachable', async ({ page, request }) => {
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
  await page.goto(alternate);
  await expect(page.getByText('主网只读 · 部署、代币与发行审阅通过前禁止签名')).toBeVisible();
  await expect(page.getByRole('button', { name: '读取仓位' })).toBeVisible();
  const recovered = await page.request.get(`${alternate}/release-manifest.json`);
  expect(createHash('sha256').update(await recovered.body()).digest('hex')).toBe(trustedDigest);
  await page.screenshot({ path: 'test-results/local-outage-alternate.png', fullPage: true });
  await writeFile('test-results/local-outage.json', JSON.stringify({ schemaVersion: 1,
    sourceCommit: JSON.parse(bytes.toString()).sourceCommit, manifestSha256: trustedDigest,
    environment: 'CONTROLLED_LOOPBACK_BROWSER_FAULT', primary, alternate, failedRequests: failed,
    result: 'ALTERNATE_READ_ONLY_ENTRY_REACHABLE',
    limitations: ['Primary navigation was aborted by Playwright, not a real public-service outage',
      'Both entries share the CI machine and package; no infrastructure independence is claimed',
      'No wallet, chain transaction or actual TapeOut gateway was exercised'] }, null, 2));
});
