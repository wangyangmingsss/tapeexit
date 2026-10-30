import { test, expect } from '@playwright/test';
import { CHAIN_ID, MANAGER } from '../../src/config';
import task from '../../docs/gateway-recovery-task-67042.json' with { type: 'json' };

test('imports public transaction hints, restores them after reload and never imports claimed success', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4175/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('nav button').last().click();
  const report = { schemaVersion: 1, environment: 'MAINNET_READ_ONLY', signingApproved: false,
    task: { schemaVersion: 1, chainId: CHAIN_ID, manager: MANAGER,
      tokenId: task.tokenId, account: task.account, hash: task.hash },
    observedAt: new Date().toISOString(), outcome: { state: 'block-state-matched', receipt: { finalized: true },
      balances: [{ delta: '20016' }], liquidity: { after: task.remainingLiquidity } } };
  await page.getByLabel('交易恢复记录文件').setInputFiles({
    name: 'public-recovery.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(report)),
  });
  await expect(page.getByRole('status').filter({ hasText: '交易信息已导入' })).toBeVisible();
  await expect(page.getByLabel('已有交易完整哈希')).toHaveValue(task.hash);
  await expect(page.getByText('0.020016', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/${test.info().project.name}-transaction-recovery-mobile.png`, fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('nav button').last().click();
  await expect(page.getByLabel('已有交易完整哈希')).toHaveValue(task.hash);
  await expect(page.getByText('已恢复上次填写的交易信息，请重新核验链上状态。')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/${test.info().project.name}-transaction-recovery-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: '清除恢复线索', exact: true }).click();
  await expect(page.getByLabel('已有交易完整哈希')).toHaveValue('');
  expect(errors).toEqual([]);
});
