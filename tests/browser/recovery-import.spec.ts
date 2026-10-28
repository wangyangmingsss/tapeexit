import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { MANAGER } from '../../src/config';

const large = (2n ** 256n - 1n).toString();
const card = { schemaVersion: 1, app: 'TapeExit', chainId: 196, manager: MANAGER,
  tokenIds: ['12', large], gateways: ['https://untrusted.example/entry/'] };
const payload = (value: unknown) => ({
  name: 'recovery.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
});
for (const width of [360, 1280]) test(`production imports, selects and exports every recovery ID at ${width}px`, async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.setViewportSize({ width, height: 900 });
  await page.goto('http://127.0.0.1:4175');
  await page.locator('input[type=file]').setInputFiles(payload(card));
  const select = page.getByLabel('恢复卡仓位'), input = page.getByLabel('仓位 Token ID');
  await expect(select).toBeVisible();
  await expect(select.locator('option')).toHaveCount(2);
  await select.selectOption(large);
  await expect(input).toHaveValue(large);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存恢复卡' }).click();
  const download = await downloadPromise, path = await download.path();
  expect(download.suggestedFilename()).toBe('tapeexit-recovery-card.json');
  const exported = JSON.parse(await readFile(path!, 'utf8'));
  expect(exported).toMatchObject({ app: 'TapeExit', chainId: 196, manager: MANAGER, tokenIds: ['12', large] });
  expect(exported.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(exported.gateways).toBeUndefined();
  expect(requests.some(url => /untrusted\.example|rpc\.xlayer\.tech|xlayer\.drpc\.org/.test(url))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await select.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `test-results/${test.info().project.name}-production-recovery-import-${width}.png`, fullPage: true });
});
test('production rejects duplicate recovery IDs without replacing existing hints and accepts empty drafts', async ({ page }) => {
  await page.goto('http://127.0.0.1:4175');
  const upload = page.locator('input[type=file]'), input = page.getByLabel('仓位 Token ID');
  await upload.setInputFiles(payload(card));
  await expect(input).toHaveValue('12');
  await upload.setInputFiles(payload({ ...card, tokenIds: ['99', '99'] }));
  await expect(page.getByRole('alert')).toContainText('恢复卡格式或字段无效');
  await expect(input).toHaveValue('12');
  await expect(page.getByLabel('恢复卡仓位').locator('option')).toHaveCount(2);
  await upload.setInputFiles(payload({ ...card, tokenIds: [] }));
  await expect(input).toHaveValue('');
  await expect(page.getByLabel('恢复卡仓位')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
