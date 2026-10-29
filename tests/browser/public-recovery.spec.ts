import { expect, test } from '@playwright/test';
import task from '../../docs/gateway-recovery-task-67042.json';

for (const width of [360, 1440]) test(`read-only transaction recovery survives primary failure and rejects unavailable RPC at ${width}px`, async ({ page }) => {
  const methods: string[] = [];
  await page.setViewportSize({ width, height: 960 });
  await page.route('https://failed-primary.example/**', route => route.abort('connectionrefused'));
  await expect(page.goto('https://failed-primary.example')).rejects.toThrow();
  await page.route(/^https:\/\/(?:rpc\.xlayer\.tech|xlayer\.drpc\.org)\/?$/, async route => {
    methods.push(route.request().postDataJSON().method);
    await route.fulfill({ status: 503, body: 'RPC unavailable fixture' });
  });
  await page.goto('http://127.0.0.1:4175/');
  if (width < 650) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: '恢复入口', exact: true }).click();
  await page.getByLabel('恢复仓位编号', { exact: true }).fill(task.tokenId);
  await page.getByLabel('原钱包公开地址', { exact: true }).fill(task.account);
  await page.getByLabel('已有交易完整哈希', { exact: true }).fill(task.hash);
  await page.getByRole('button', { name: '核验已有交易', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '本次核验未完成：' })).toBeVisible();
  await expect(page.getByRole('button', { name: '导出核验结果', exact: true })).toHaveCount(0);
  expect(methods.length).toBeGreaterThan(0);
  expect(methods.every(m => m === 'eth_chainId')).toBe(true);
  await expect(page.getByText('主网只读 · 部署、代币与发行审阅通过前禁止签名')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/${test.info().project.name}-public-recovery-${width}.png`, fullPage: true });
});
