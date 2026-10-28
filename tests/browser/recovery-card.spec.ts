import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('printable recovery card contains valid public JSON and renders its embedded bitmap on mobile', async ({ page, browserName }) => {
  const text = await readFile('release-artifacts/recovery-card/card.json', 'utf8');
  expect(JSON.parse(text)).toMatchObject({ schemaVersion: 1, app: 'TapeExit', chainId: 196, tokenIds: [] });
  await page.setViewportSize({ width: 360, height: 1000 });
  await page.setContent(await readFile('release-artifacts/recovery-card/card.html', 'utf8'));
  const qr = page.getByRole('img');
  await expect(qr).toBeVisible();
  await expect.poll(() => qr.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByText(/主网发送未批准/)).toBeVisible();
  await page.screenshot({ path: `test-results/${test.info().project.name}-recovery-card-mobile.png`, fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (browserName === 'chromium')
    await page.pdf({ path: 'release-artifacts/recovery-card/card.pdf', format: 'A4', printBackground: true });
});
