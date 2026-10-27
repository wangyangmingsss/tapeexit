import { test, expect } from '@playwright/test';

// Exercises the actual production build served by the recovery server.
// RPC responses are fixtures, and no real wallet signs or broadcasts.
const origin = 'http://127.0.0.1:4175';
const key = 'tapeexit:submission:v1';
const hash = `0x${'ab'.repeat(32)}`;
const entry = { schemaVersion: 1, id: '11111111-1111-1111-1111-111111111111', chainId: 196,
  account: '0x1000000000000000000000000000000000000001', tokenId: '12',
  inputHash: hash, startedAt: '2026-10-27T12:00:00Z' };
test('production contains no demo controls or signing workaround', async ({ page }) => {
  const response = await page.goto(origin);
  expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  await expect(page.getByText('主网只读 · 部署、代币与发行审阅通过前禁止签名')).toBeVisible();
  await expect(page.getByLabel('故障演练')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '确认模拟退出' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '预演退出' })).toHaveCount(0);
});
test('unknown submission survives reload and rejects a mismatching supplied transaction', async ({ page }) => {
  await page.addInitScript(({ key, entry }) => { localStorage.setItem(key, JSON.stringify(entry)); }, { key, entry });
  const methods: string[] = [];
  await page.route(/^https:\/\/(?:rpc\.xlayer\.tech|xlayer\.drpc\.org)\/?$/, async route => {
    const request = route.request().postDataJSON();
    methods.push(request.method);
    const result = request.method === 'eth_chainId' ? '0xc4' : request.method === 'eth_getTransactionByHash' ?
      { from: entry.account, to: '0x2000000000000000000000000000000000000002', input: '0x1234', value: '0x0' } : null;
    await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': origin },
      body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) });
  });
  await page.goto(origin);
  const check = page.getByRole('button', { name: '核对待处理交易' });
  await expect(check).toBeDisabled();
  await page.getByLabel('钱包交易哈希').fill('0x1234');
  await expect(check).toBeDisabled();
  expect(methods).toEqual([]);
  await page.getByLabel('钱包交易哈希').fill(hash);
  await check.click();
  await expect(page.getByRole('alert')).toContainText('实际交易与待处理记录不匹配');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)).toEqual(entry);
  await page.reload();
  await expect(page.getByText('存在未解决的提交，已锁定发送')).toBeVisible();
  await expect(page.getByLabel('钱包交易哈希')).toHaveValue('');
  expect(methods.every(method => ['eth_chainId', 'eth_getTransactionByHash'].includes(method))).toBe(true);
});
for (const width of [360, 390, 768, 1280, 1440]) test(`production recovery at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ key, entry }) => localStorage.setItem(key, JSON.stringify(entry)), { key, entry });
  await page.goto(origin);
  const input = page.getByLabel('钱包交易哈希');
  await input.fill(hash);
  await expect(input).toHaveValue(hash);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await input.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `test-results/production-recovery-${width}.png`, fullPage: true });
});
