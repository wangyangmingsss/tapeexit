import { expect, test, type Page } from '@playwright/test';

async function installFixture(page: Page) {
  await page.addInitScript(() => {
    const fixture = { methods: [] as { id: string; method: string }[], invalid: false,
      complete: {} as Record<string, () => void> };
    (window as unknown as { connectionFixture: typeof fixture }).connectionFixture = fixture;
    for (const [id, name, account] of [
      ['A', 'Fixture A', '0x1000000000000000000000000000000000000001'],
      ['B', 'Fixture B', '0x2000000000000000000000000000000000000002'],
    ]) {
      const provider = {
        async request({ method }: { method: string }) {
          fixture.methods.push({ id, method });
          if (method === 'eth_chainId') return '0xc4';
          if (method === 'eth_accounts') return [account];
          if (method === 'eth_requestAccounts') {
            if (fixture.invalid) return account; // Invalid scalar response, deliberately.
            return new Promise(resolve => { fixture.complete[id] = () => resolve([account]); });
          }
          throw new Error('No signing methods allowed in fixture');
        },
      };
      window.addEventListener('eip6963:requestProvider', () => {
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider,
          info: { uuid: `${id === 'A' ? '11111111' : '22222222'}-1111-4111-8111-111111111111`, name } } }));
      });
    }
  });
}
async function complete(page: Page, id: string) {
  await expect.poll(() => page.evaluate(id =>
    typeof (window as unknown as { connectionFixture: { complete: Record<string, () => void> } })
      .connectionFixture.complete[id] === 'function', id)).toBe(true);
  await page.evaluate(id => {
    (window as unknown as { connectionFixture: { complete: Record<string, () => void> } }).connectionFixture.complete[id]();
  }, id);
}
test('production wallet choice keeps the newer connection when an older provider responds late', async ({ page }) => {
  await installFixture(page);
  await page.goto('http://127.0.0.1:4175');
  await page.getByRole('button', { name: '连接钱包' }).click();
  await page.getByRole('button', { name: 'Fixture A' }).click();
  await expect(page.getByRole('button', { name: 'Fixture A' })).toBeDisabled();
  await page.getByRole('button', { name: 'Fixture B' }).click();
  await complete(page, 'B');
  await expect(page.getByRole('button', { name: /0x2000/ })).toBeVisible();
  await complete(page, 'A');
  await expect(page.getByRole('button', { name: /0x2000/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /0x1000/ })).toHaveCount(0);
  const methods = await page.evaluate(() =>
    (window as unknown as { connectionFixture: { methods: { id: string; method: string }[] } }).connectionFixture.methods);
  expect(methods.filter(m => m.id === 'A').map(m => m.method)).toEqual(['eth_chainId', 'eth_requestAccounts']);
  expect(methods.some(m => /send|sign/i.test(m.method))).toBe(false);
  await page.screenshot({ path: 'test-results/production-wallet-connection-fixture.png', fullPage: true });
});
test('closing production wallet choice discards a pending provider response', async ({ page }) => {
  await installFixture(page);
  await page.goto('http://127.0.0.1:4175');
  await page.getByRole('button', { name: '连接钱包' }).click();
  await page.getByRole('button', { name: 'Fixture A' }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await complete(page, 'A');
  await expect(page.getByRole('button', { name: '连接钱包' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('production wallet connection rejects malformed account responses', async ({ page }) => {
  await installFixture(page);
  await page.goto('http://127.0.0.1:4175');
  await page.evaluate(() => {
    (window as unknown as { connectionFixture: { invalid: boolean } }).connectionFixture.invalid = true;
  });
  await page.getByRole('button', { name: '连接钱包' }).click();
  await page.getByRole('button', { name: 'Fixture A' }).click();
  await expect(page.getByRole('alert')).toContainText('钱包返回的数据无效');
  await expect(page.getByRole('button', { name: 'Fixture A' })).toBeEnabled();
});
