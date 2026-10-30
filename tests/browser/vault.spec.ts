import { test, expect } from '@playwright/test';

for (const width of [390, 1440]) test(`second protocol vault workflow at ${width}px`, async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      external.push(request.url());
  });
  await page.setViewportSize({ width, height: 950 });
  await page.goto('/');
  if (width <= 650) await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'USDC 金库', exact: true }).click();
  await page.getByRole('button', { name: '读取金库份额' }).click();
  await expect(page.getByText('50 spUSDC', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '50%', exact: true }).click();
  await page.getByRole('button', { name: '预演金库赎回' }).click();
  const preview = page.getByRole('region', { name: '金库退出预览' });
  await expect(preview.getByText('25.5 USDC', { exact: true })).toBeVisible();
  await expect(preview.getByText('25 spUSDC', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '在钱包中确认', exact: true })).toHaveCount(0);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/${test.info().project.name}-vault-${width}.png`, fullPage: true });
});
