import { test, expect } from '@playwright/test';
test('complete isolated exit and persist clearly labelled local history', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('隔离演示 · 测试资产')).toBeVisible();
  await page.getByRole('button', { name: '读取仓位' }).click();
  await expect(page.getByText('TEST-USDC / TEST-USDT')).toBeVisible();
  await page.getByRole('button', { name: '预演退出' }).click();
  await page.getByRole('button', { name: '核对交易', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('checkbox', { name: '我已核对目标、仓位和收款地址；此操作由我确认。' }).check();
  await page.getByRole('button', { name: '确认模拟退出' }).click();
  await expect(page.getByText('领取证据已核对')).toBeVisible();
  await expect(page.getByText('模拟结果，不代表真实链上交易。')).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop-completed.png', fullPage: true });
  await page.getByRole('button', { name: '操作记录', exact: true }).click();
  await expect(page.getByText('received-checked')).toBeVisible();
  expect(errors).toEqual([]);
});
test('operator conflict stops the workflow', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('故障演练').selectOption('conflict');
  await page.getByRole('button', { name: '读取仓位' }).click();
  await expect(page.getByRole('alert')).toContainText('读取结果不一致');
  await expect(page.getByRole('button', { name: '预演退出' })).toHaveCount(0);
});
test('recovery import rejects injected fields', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '恢复入口', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'hostile.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'TapeExit', schemaVersion: 1, chainId: 196, calldata: '0x1234' })),
  });
  await expect(page.getByRole('alert')).toBeVisible();
});
test('mobile task has no horizontal overflow or clipped controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '读取仓位' }).click();
  await page.getByRole('button', { name: '预演退出' }).click();
  await expect(page.getByRole('button', { name: '核对交易', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-preview.png', fullPage: true });
  await page.setViewportSize({ width: 360, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
