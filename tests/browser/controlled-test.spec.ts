import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { TEST_POLICY } from '../../tools/controlled-test-scope';
import { MANAGER } from '../../src/config';

async function install(page: Page, mode = 'success') {
  const [html, js, css] = await Promise.all([
    readFile('tools/controlled-test/index.html', 'utf8'),
    readFile('tools/controlled-test/client.js', 'utf8'),
    readFile('tools/publication-workbench/styles.css', 'utf8'),
  ]);
  const p = TEST_POLICY, hash = `0x${'ab'.repeat(32)}`;
  const q = { id: 'quote', expiresAt: Date.now() + 90_000, maximumGasCostWei: '5000000000000',
    estimatedAmounts: ['20007', '20007'], minimums: ['19900', '19900'], deadline: '2000000000',
    transaction: { from: p.account, to: MANAGER, value: '0x0', chainId: '0xc4', data: '0x1234',
      nonce: '0x1', gas: '0x3a980', gasPrice: '0x1406f40' } };
  const context = { policy: p, manager: MANAGER, contextId: 'a'.repeat(64), complete: false, freshlyVerified: false,
    unresolved: null as string | null, attempts: [] as any[], sourceCommit: 'b'.repeat(40) };
  await page.route('**/controlled-test', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('**/client.js', route => route.fulfill({ contentType: 'text/javascript', body: js }));
  await page.route('**/styles.css', route => route.fulfill({ contentType: 'text/css', body: css }));
  const calls: string[] = [];
  await page.route('**/api/*', async route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1)!;
    calls.push(action);
    let value: unknown = context;
    if (action === 'preview') value = q;
    if (action === 'reserve') {
      const quote = mode === 'tampered' ? { ...q, transaction: { ...q.transaction, value: '0x1' } } : q;
      const a = { id: 'attempt', status: 'reserved', quote };
      context.attempts.push(a); context.unresolved = a.id; value = a;
    }
    if (action === 'hash') context.attempts[0].hash = route.request().postDataJSON().hash;
    if (action === 'reconcile') {
      if (mode === 'pending') return route.fulfill({ status: 409, json: { error: 'Receipt not finalized' } });
      context.complete = true; context.freshlyVerified = true; context.unresolved = null; context.attempts[0].status = 'confirmed';
      context.attempts[0].outcome = { balances: [{ symbol: 'USDt0', delta: '20007' }, { symbol: 'USDC', delta: '20007' }],
        liquidity: { after: '1980854' } };
    }
    await route.fulfill({ json: value });
  });
  await page.addInitScript(({ account, hash, mode }) => {
    const methods: string[] = [], listeners = new Map<string, Set<() => void>>();
    (window as any).controlledFixture = { methods, emit() {
      for (const fn of listeners.get('accountsChanged') || []) fn();
    } };
    const provider = {
      async request({ method }: { method: string }) {
        methods.push(method);
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
        if (method === 'eth_chainId') return '0xc4';
        if (method === 'eth_sendTransaction') {
          if (mode === 'unknown') throw new Error('Wallet response lost');
          return hash;
        }
        throw new Error('Forbidden fixture method');
      },
      on(event: string, fn: () => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
      },
      removeListener(event: string, fn: () => void) { listeners.get(event)?.delete(fn); },
    };
    window.addEventListener('eip6963:requestProvider', () =>
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: { info: { uuid: 'fixture', name: 'Test OKX provider fixture' }, provider },
      })));
  }, { account: p.account, hash, mode });
  await page.goto('/controlled-test');
  await expect(page.locator('#status')).toContainText('尚未请求签名');
  return { calls, context };
}
async function ready(page: Page) {
  await page.locator('#connect').click();
  await page.locator('#prepare').click();
  await expect(page.locator('#preview')).toContainText('0.020007');
  await expect(page.locator('#send')).toBeDisabled();
  await page.locator('#consent').check();
  await expect(page.locator('#send')).toBeEnabled();
}
async function sends(page: Page) {
  return page.evaluate(() => (window as any).controlledFixture.methods.filter((m: string) => m === 'eth_sendTransaction').length);
}
test('fixed test requires separate risk/fee consent and requests exactly one wallet transaction', async ({ page }) => {
  const { calls } = await install(page); await ready(page); await page.locator('#send').click();
  await expect(page.locator('#status')).toContainText('实测成功');
  await expect(page.locator('#record')).toContainText('1,980,854'.replaceAll(',', ''));
  expect(await sends(page)).toBe(1);
  expect(calls.indexOf('reserve')).toBeLessThan(calls.indexOf('hash'));
  await expect(page.locator('#prepare')).toBeDisabled();
  await page.locator('#recheck').click(); expect(await sends(page)).toBe(1);
  await page.screenshot({ path: `test-results/${test.info().project.name}-controlled-test-desktop.png`, fullPage: true });
});
test('unknown wallet outcome survives reload and does not retry the exit', async ({ page }) => {
  await install(page, 'unknown'); await ready(page); await page.locator('#send').click();
  await expect(page.locator('#status')).toContainText('Wallet response lost');
  await expect(page.locator('#prepare')).toBeDisabled(); expect(await sends(page)).toBe(1);
  await page.reload(); await expect(page.locator('#status')).toContainText('未核验');
  await expect(page.locator('#send')).toBeDisabled(); expect(await sends(page)).toBe(0);
});
test('tampered reservation never reaches the wallet', async ({ page }) => {
  await install(page, 'tampered'); await ready(page); await page.locator('#send').click();
  await expect(page.locator('#status')).toContainText('不一致');
  expect(await sends(page)).toBe(0); await expect(page.locator('#prepare')).toBeDisabled();
});
test('pending finality preserves the hash and permits only read-only recovery', async ({ page }) => {
  await install(page, 'pending'); await ready(page); await page.locator('#send').click();
  await expect(page.locator('#status')).toContainText('not finalized');
  await expect(page.locator('#hash')).toHaveValue(`0x${'ab'.repeat(32)}`);
  await page.locator('#reconcile').click(); expect(await sends(page)).toBe(1);
});
test('wallet change invalidates preview and mobile layout preserves all controls', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await install(page); await ready(page);
  await page.evaluate(() => (window as any).controlledFixture.emit());
  await expect(page.locator('#send')).toBeDisabled();
  await expect(page.locator('#account')).toContainText('已变化');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/${test.info().project.name}-controlled-test-mobile.png`, fullPage: true });
});
