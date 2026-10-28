import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function installFixture(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const listeners = new Map<string, Set<(value: unknown) => void>>();
    let chain = '0x1';
    const fixture = { methods: [] as string[], reject: false, emit(name: string, value: unknown) {
      for (const listener of listeners.get(name) || []) listener(value);
    } };
    (window as unknown as { walletFixture: typeof fixture }).walletFixture = fixture;
    const provider = {
      async request({ method }: { method: string }) {
        fixture.methods.push(method);
        if (fixture.reject) throw Object.assign(new Error('Fixture rejection'), { code: 4001 });
        if (method === 'eth_requestAccounts' || method === 'eth_accounts')
          return ['0x1000000000000000000000000000000000000001'];
        if (method === 'eth_chainId') return chain;
        if (method === 'wallet_switchEthereumChain') { chain = '0xc4'; fixture.emit('chainChanged', chain); return null; }
        throw new Error('Forbidden method');
      },
      on(name: string, listener: (value: unknown) => void) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(listener);
      },
      removeListener(name: string, listener: (value: unknown) => void) { listeners.get(name)?.delete(listener); },
    };
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: '11111111-1111-4111-8111-111111111111', name: '<img src=x onerror=alert(1)> fixture',
        rdns: 'test.fixture' }, provider },
    })));
  });
}
test('wallet harness discovers a fixture safely and never requests transaction signing', async ({ page }) => {
  await installFixture(page);
  await page.goto('http://127.0.0.1:4180');
  await expect(page.getByLabel('钱包', { exact: true })).toContainText('<img src=x onerror=alert(1)> fixture');
  expect(await page.locator('img').count()).toBe(0);
  await page.getByRole('button', { name: '连接钱包' }).click();
  await expect(page.locator('#chain')).toContainText('0x1');
  await page.getByRole('button', { name: '切换到 X Layer' }).click();
  await expect(page.locator('#chain')).toContainText('0xc4');
  await expect(page.getByRole('button', { name: '导出接入记录' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出接入记录' }).click();
  const download = await downloadEvent;
  const report = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(report).toMatchObject({ status: 'OBSERVATIONS_ONLY', consentToExport: true,
    transactionAcceptance: 'NOT_TESTED', tapeOutOriginAcceptance: 'NOT_TESTED' });
  const methods = await page.evaluate(() =>
    (window as unknown as { walletFixture: { methods: string[] } }).walletFixture.methods);
  expect(methods.every(m => ['eth_accounts', 'eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain'].includes(m))).toBe(true);
  await page.screenshot({ path: `test-results/${test.info().project.name}-wallet-harness-fixture.png`, fullPage: true });
});
test('wallet harness records an actual provider rejection response without inventing acceptance', async ({ page }) => {
  await installFixture(page);
  await page.goto('http://127.0.0.1:4180');
  await page.evaluate(() => { (window as unknown as { walletFixture: { reject: boolean } }).walletFixture.reject = true; });
  await page.getByRole('button', { name: '连接钱包' }).click();
  await expect(page.getByRole('status')).toContainText('用户拒绝');
  await expect(page.locator('#events')).toContainText('4001');
  await expect(page.locator('#account')).toHaveText('—');
});
test('wallet harness mobile export controls fit and context failures prevent evidence export', async ({ page }) => {
  await installFixture(page);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.route('**/context.json', route => route.fulfill({ status: 200, body: '{}' }));
  await page.goto('http://127.0.0.1:4180');
  await expect(page.getByRole('status')).toContainText('无法确认发行身份');
  await page.getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: '导出接入记录' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
