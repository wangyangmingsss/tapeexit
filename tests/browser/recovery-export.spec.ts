import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

// Production HTTP fixtures; no wallet access or chain operation.
for (const fault of ['http', 'overflow', 'redirect'] as const)
  test(`production recovery export fails visibly on ${fault} and can retry`, async ({ page }) => {
    const origin = 'http://127.0.0.1:4175';
    let downloads = 0, destination = 0;
    page.on('download', () => downloads++);
    await page.route(`${origin}/redirected-manifest`, async route => {
      destination++; await route.fulfill({ body: '{}' });
    });
    await page.route(`${origin}/release-manifest.json`, async route => {
      if (fault === 'http') await route.fulfill({ status: 503, body: 'unavailable' });
      else if (fault === 'redirect') await route.fulfill({
        status: 307, headers: { location: '/redirected-manifest' },
      });
      else await route.fulfill({ body: 'x'.repeat(262145) });
    });
    await page.goto(origin);
    await page.getByLabel('仓位 Token ID').fill('12');
    await page.getByRole('button', { name: '保存恢复卡' }).click();
    await expect(page.getByRole('alert')).toContainText('发行清单读取失败');
    expect(downloads).toBe(0); expect(destination).toBe(0);
    await expect(page.getByLabel('仓位 Token ID')).toHaveValue('12');
    await page.unroute(`${origin}/release-manifest.json`);
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存恢复卡' }).click();
    const download = await downloadEvent;
    const card = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(card.tokenIds).toEqual(['12']);
    expect(card.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(downloads).toBe(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
