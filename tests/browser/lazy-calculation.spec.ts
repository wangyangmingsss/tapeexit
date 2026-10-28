import { test, expect } from '@playwright/test';

test('production recovery does not load the SDK before any calculation', async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  await page.goto('http://127.0.0.1:4175');
  await page.getByRole('button', { name: '恢复入口' }).click();
  await expect(page.getByRole('heading', { name: '提前保存，保留退出路径。' })).toBeVisible();
  expect(scripts.some(url => /\/protocol-[^/]+\.js/.test(url))).toBe(false);
  expect(scripts.length).toBeGreaterThan(0);
});
test('simulation loads the official SDK only when preview is requested', async ({ page }) => {
  const sdkRequests: string[] = [];
  page.on('request', request => { if (/\/protocol-[^/]+\.js/.test(request.url())) sdkRequests.push(request.url()); });
  await page.goto('http://127.0.0.1:4177');
  await page.getByRole('button', { name: '读取仓位' }).click();
  await expect(page.getByText('TEST-USDC / TEST-USDT')).toBeVisible();
  expect(sdkRequests).toHaveLength(0);
  await page.getByRole('button', { name: '预演退出' }).click();
  await expect(page.getByRole('button', { name: '核对交易' })).toBeEnabled();
  expect(sdkRequests).toHaveLength(1);
});
test('a missing calculation chunk blocks preview and cannot reach wallet confirmation', async ({ page }) => {
  await page.route('**/assets/protocol-*.js', route => route.abort());
  await page.goto('http://127.0.0.1:4177');
  await page.getByRole('button', { name: '读取仓位' }).click();
  await expect(page.getByText('TEST-USDC / TEST-USDT')).toBeVisible();
  await page.getByRole('button', { name: '预演退出' }).click();
  await expect(page.getByRole('alert')).toContainText('计算模块加载失败');
  await expect(page.getByRole('button', { name: '核对交易' })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
