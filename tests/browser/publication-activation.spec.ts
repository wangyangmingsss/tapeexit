import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const publisher = '0x1000000000000000000000000000000000000001';
const binding = '0x3000000000000000000000000000000000000003';
const txHash = `0x${'ab'.repeat(32)}`;
async function install(page: Page, mode = 'success') {
  const base = new URL('../../tools/publication-workbench/', import.meta.url);
  const [html, js, css] = await Promise.all(['index.html', 'client.js', 'styles.css'].map(file => readFile(new URL(file, base), 'utf8')));
  const transaction = { from: publisher, to: binding, data: '0x12345678', value: '0x0',
    chainId: '0xc4', gas: '0x371d2', gasPrice: '0x1406f40', nonce: '0x0' };
  const q = { id: 'activation-quote', expiresAt: Date.now() + 120000, transaction,
    serviceFeeWei: '0', maximumGasCostWei: '4740666000000', maximumTotalWei: '4740666000000' };
  const activation = { contextId: 'activation-context', publisher, binding, name: '2.2.289.tape',
    gasCap: '500000', gasPriceCapWei: '30000000', consent: 'activation-only',
    unresolved: null as string | null, observed: null,
    attempts: [] as { id: string; status: string; quote: typeof q; hash?: string; state?: { paidUntil: string } }[] };
  const context = { contextId: 'upload-context', publisher, fileCount: 9, totalBytes: 587736, totalOperations: 31,
    maximumWei: '7000000000000000', reservedWei: '0', unresolved: null, activation,
    attempts: [{ id: 'upload', operation: 0, status: 'confirmed', batch: { operations: Array.from({ length: 31 }, (_, i) => i) } }] };
  const actions: string[] = [];
  await page.route('**/activation-workbench', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('**/client.js', route => route.fulfill({ contentType: 'text/javascript', body: js }));
  await page.route('**/styles.css', route => route.fulfill({ contentType: 'text/css', body: css }));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    actions.push(path);
    let result: unknown = context;
    if (path === '/api/activation/preview') result = q;
    if (path === '/api/activation/reserve') {
      const attempt = { id: 'activation-attempt', status: 'reserved', quote: q };
      activation.attempts.push(attempt); activation.unresolved = attempt.id;
      result = mode === 'tampered' ? { ...attempt, quote: { ...q, transaction: { ...transaction, value: '0x1' } } } : attempt;
    }
    if (path === '/api/activation/hash') activation.attempts[0].hash = route.request().postDataJSON().hash;
    if (path === '/api/activation/reconcile') {
      activation.attempts[0].status = 'confirmed';
      activation.attempts[0].state = { paidUntil: '2000000000' }; activation.unresolved = null;
      result = activation;
    }
    await route.fulfill({ json: result });
  });
  await page.addInitScript(({ publisher, txHash, mode }) => {
    const fixture = { sends: 0 };
    Object.assign(window, { activationFixture: fixture });
    const provider = { async request({ method }: { method: string }) {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [publisher];
      if (method === 'eth_chainId') return '0xc4';
      if (method === 'eth_sendTransaction') {
        fixture.sends++;
        if (mode === 'unknown') throw new Error('Activation wallet response lost');
        return txHash;
      }
      throw new Error('Unexpected fixture method');
    } };
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'activation-test-wallet', name: 'Activation fixture' }, provider },
    })));
  }, { publisher, txHash, mode });
  await page.goto('/activation-workbench');
  await expect(page.locator('#activation-section')).toBeVisible();
  await page.locator('#connect').click();
  await expect(page.locator('#account')).toContainText(publisher);
  await page.locator('#activation-prepare').click();
  await expect(page.locator('#activation-preview')).toContainText('服务费');
  await expect(page.locator('#activation-send')).toBeDisabled();
  return { actions, activation };
}
const sends = (page: Page) => page.evaluate(() => (window as unknown as { activationFixture: { sends: number } }).activationFixture.sends);
test('activation requires separate consent, verifies expiry and keeps upload history on desktop/mobile', async ({ page }) => {
  const f = await install(page);
  expect(await sends(page)).toBe(0);
  await page.locator('#activation-consent').check();
  await page.locator('#activation-send').click();
  await expect(page.locator('#activation-result')).toContainText('激活核验成功');
  await expect(page.locator('#confirmed')).toHaveText('31 / 31 步');
  expect(await sends(page)).toBe(1);
  expect(f.actions).not.toContain('/api/authorize');
  expect(f.actions).not.toContain('/api/reserve');
  await page.screenshot({ path: `test-results/${test.info().project.name}-activation-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/${test.info().project.name}-activation-mobile.png`, fullPage: true });
});
test('unknown activation result remains reserved across reload and supports manual hash recovery', async ({ page }) => {
  await install(page, 'unknown');
  await page.locator('#activation-consent').check(); await page.locator('#activation-send').click();
  await expect(page.locator('#activation-pending')).toBeVisible();
  await expect(page.locator('#activation-prepare')).toBeDisabled();
  expect(await sends(page)).toBe(1);
  await page.reload();
  await expect(page.locator('#activation-prepare')).toBeDisabled();
  await expect(page.locator('#activation-send')).toBeDisabled();
  expect(await sends(page)).toBe(0);
  await page.locator('#activation-hash').fill(txHash);
  await page.locator('#activation-attach').click();
  await page.locator('#activation-reconcile').click();
  await expect(page.locator('#activation-result')).toContainText('激活核验成功');
  expect(await sends(page)).toBe(0);
});
test('tampered activation reservation is stopped before wallet signing', async ({ page }) => {
  await install(page, 'tampered');
  await page.locator('#activation-consent').check(); await page.locator('#activation-send').click();
  await expect(page.locator('#status')).toContainText('不一致');
  await expect(page.locator('#activation-pending')).toBeVisible();
  expect(await sends(page)).toBe(0);
});
