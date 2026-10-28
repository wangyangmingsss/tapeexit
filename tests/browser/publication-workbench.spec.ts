import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const publisher = '0x1000000000000000000000000000000000000001';
const txHash = `0x${'ab'.repeat(32)}`;
async function install(page: Page, mode = 'success') {
  const base = new URL('../../tools/publication-workbench/', import.meta.url);
  const [html, js, css] = await Promise.all(['index.html', 'client.js', 'styles.css'].map(file => readFile(new URL(file, base), 'utf8')));
  const transaction = { from: publisher, to: '0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6',
    data: '0x12345678', value: '0x0', chainId: '0xc4', gas: '0x1d4c0', gasPrice: '0x1406f40', nonce: '0x0' };
  const context = { schemaVersion: 1, contextId: 'a'.repeat(64), chainId: 196, publisher,
    container: '0x2000000000000000000000000000000000000002', registry: transaction.to,
    manifestSha256: 'b'.repeat(64), fileCount: 9, totalBytes: 587736, totalOperations: 31,
    maximumWei: '7000000000000000', maxGas: '7000000', maxGasPriceWei: '30000000',
    reservedWei: '0', authorization: null as null | { expiresAt: number }, unresolved: null as null | string,
    attempts: [] as { id: string; operation: number; status: string; transaction: typeof transaction; hash?: string }[] };
  const calls: string[] = [];
  await page.route('**/publication-workbench', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('**/client.js', route => route.fulfill({ contentType: 'text/javascript', body: js }));
  await page.route('**/styles.css', route => route.fulfill({ contentType: 'text/css', body: css }));
  await page.route('**/api/*', async route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1)!;
    calls.push(action);
    let value: unknown = context;
    if (action === 'authorize') context.authorization = { expiresAt: Date.now() + 3600000 };
    if (action === 'preview') value = { id: 'preview', expiresAt: Date.now() + 30000,
      operation: 0, remaining: 31, file: 'LICENSE.txt', chunk: 0, maximumCostWei: '2520000000000', transaction };
    if (action === 'reserve') {
      const reservedTx = mode === 'tampered' ? { ...transaction, value: '0x1' } : transaction;
      const a = { id: 'attempt', operation: 0, status: 'reserved', transaction: reservedTx };
      context.attempts.push(a); context.unresolved = a.id; context.reservedWei = '2520000000000'; value = a;
    }
    if (action === 'hash') context.attempts[0].hash = route.request().postDataJSON().hash;
    if (action === 'reconcile') {
      if (mode === 'pending') return route.fulfill({ status: 409, json: { error: 'Transaction not confirmed; keep waiting' } });
      context.attempts[0].status = 'confirmed'; context.unresolved = null;
    }
    return route.fulfill({ json: value });
  });
  await page.addInitScript(({ publisher, txHash, mode }) => {
    const listeners = new Map<string, Set<() => void>>();
    const fixture = { methods: [] as string[], emit() {
      for (const fn of listeners.get('accountsChanged') || []) fn();
    } };
    (window as unknown as { uploadFixture: typeof fixture }).uploadFixture = fixture;
    const provider = {
      async request({ method }: { method: string }) {
        fixture.methods.push(method);
        if (method === 'eth_chainId') return '0xc4';
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [publisher];
        if (method === 'eth_sendTransaction') {
          if (mode === 'unknown') throw new Error('Fixture wallet response lost');
          return txHash;
        }
        throw new Error('Forbidden fixture method');
      },
      on(name: string, fn: () => void) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(fn);
      },
      removeListener(name: string, fn: () => void) { listeners.get(name)?.delete(fn); },
    };
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: '11111111-1111-4111-8111-111111111111', name: 'Explicit test wallet fixture' }, provider },
    })));
  }, { publisher, txHash, mode });
  await page.goto('/publication-workbench');
  await expect(page.locator('#status')).toContainText('发行信息已加载');
  return { calls, context };
}
async function ready(page: Page) {
  await page.getByRole('button', { name: '连接钱包', exact: true }).click();
  await expect(page.locator('#account')).toContainText(publisher);
  await expect(page.locator('#send')).toBeDisabled();
  await page.locator('#consent').check();
  await page.locator('#authorize').click();
  await expect(page.locator('#badge')).toHaveText('费用已确认');
  await page.locator('#refresh').click();
  await expect(page.locator('#preview')).toContainText('LICENSE.txt');
  await expect(page.locator('#send')).toBeEnabled();
}
async function sends(page: Page) {
  return page.evaluate(() => (window as unknown as { uploadFixture: { methods: string[] } })
    .uploadFixture.methods.filter(method => method === 'eth_sendTransaction').length);
}
test('publication fixture requires fee consent and signs exactly one reserved transaction', async ({ page }) => {
  const { calls } = await install(page); await ready(page);
  expect(await sends(page)).toBe(0);
  await page.locator('#send').click();
  await expect(page.locator('#attempts')).toContainText('交易与文件已核验');
  expect(await sends(page)).toBe(1);
  expect(calls.indexOf('reserve')).toBeLessThan(calls.indexOf('hash'));
  await expect(page.locator('#send')).toBeDisabled();
  await page.screenshot({ path: `test-results/${test.info().project.name}-publication-workbench-desktop.png`, fullPage: true });
});
test('unknown wallet result remains blocked across page reload without resending', async ({ page }) => {
  await install(page, 'unknown'); await ready(page);
  await page.locator('#send').click();
  await expect(page.locator('#pending-section')).toBeVisible();
  await expect(page.locator('#refresh')).toBeDisabled();
  expect(await sends(page)).toBe(1);
  await page.reload();
  await expect(page.locator('#status')).toContainText('未核验');
  await expect(page.locator('#send')).toBeDisabled();
  await expect(page.locator('#refresh')).toBeDisabled();
  expect(await sends(page)).toBe(0);
});
test('tampered reserved parameters stop before requesting a wallet transaction', async ({ page }) => {
  await install(page, 'tampered'); await ready(page); await page.locator('#send').click();
  await expect(page.locator('#status')).toContainText('不一致');
  expect(await sends(page)).toBe(0);
  await expect(page.locator('#refresh')).toBeDisabled();
});
test('pending receipt retains transaction hash and does not request the next upload', async ({ page }) => {
  await install(page, 'pending'); await ready(page); await page.locator('#send').click();
  await expect(page.locator('#tx-hash')).toHaveValue(txHash);
  await expect(page.locator('#refresh')).toBeDisabled();
  await page.locator('#reconcile').click();
  expect(await sends(page)).toBe(1);
});
test('wallet events clear the preview and mobile layout keeps controls in view', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await install(page); await ready(page);
  await page.evaluate(() => (window as unknown as { uploadFixture: { emit(): void } }).uploadFixture.emit());
  await expect(page.locator('#send')).toBeDisabled();
  await expect(page.locator('#account')).toContainText('已变化');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/${test.info().project.name}-publication-workbench-mobile.png`, fullPage: true });
});
