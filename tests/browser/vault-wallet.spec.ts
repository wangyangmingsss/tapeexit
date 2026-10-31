import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodeFunctionData } from 'viem';
import { VAULT_TEST as p, walletVaultAbi } from '../../tools/vault-wallet-core';

async function install(page: Page, mode = 'pending-once') {
  const [html, js, css] = await Promise.all([
    readFile('tools/controlled-vault/index.html', 'utf8'), readFile('tools/controlled-vault/client.js', 'utf8'),
    readFile('tools/publication-workbench/styles.css', 'utf8'),
  ]);
  const hash = `0x${'ab'.repeat(32)}`;
  const quote = { id: 'quote', stage: 'approve', expiresAt: Date.now() + 90000,
    amount: '1000000', output: '1000000', minimumOutput: '995000', beforeShares: '0', maximumGasCostWei: '1000000000000',
    transaction: { from: p.account, to: p.asset, value: '0x0', chainId: '0xc4', nonce: '0x0',
      gas: '0x186a0', gasPrice: '0x989680',
      data: encodeFunctionData({ abi: walletVaultAbi, functionName: 'approve', args: [p.vault, 1000000n] }) } };
  const context = { policy: p, contextId: 'a'.repeat(64), sourceCommit: 'b'.repeat(40),
    stage: 'approve', complete: false, freshlyVerified: false, remainingWalletConfirmations: 4,
    unresolved: null as string | null, attempts: [] as any[] };
  if (mode === 'approved-start') {
    context.stage = 'deposit'; context.remainingWalletConfirmations = 3;
    context.attempts.push({ id: 'approved', status: 'confirmed', quote, hash,
      outcome: { assets: '0', shares: '0', remainingShares: '0', gasUsed: '50000', effectiveGasPrice: '10000000' } });
  }
  await page.route('**/vault-wallet-test', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('**/client.js', route => route.fulfill({ contentType: 'text/javascript', body: js }));
  await page.route('**/styles.css', route => route.fulfill({ contentType: 'text/css', body: css }));
  let checks = 0;
  await page.route('**/api/*', async route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1)!;
    let value: unknown = context;
    if (action === 'preview') value = context.stage === 'approve' ? quote : {
      ...quote, id: `quote-${context.stage}`, stage: context.stage, output: '996244', minimumOutput: '991262',
      transaction: { ...quote.transaction, to: p.vault, nonce: '0x1',
        data: encodeFunctionData({ abi: walletVaultAbi, functionName: 'deposit', args: [1000000n, p.account] }) },
    };
    if (action === 'reserve') {
      const preview = route.request().postDataJSON().previewId === 'quote' ? quote : {
        ...quote, id: `quote-${context.stage}`, stage: context.stage, output: '996244', minimumOutput: '991262',
        transaction: { ...quote.transaction, to: p.vault, nonce: '0x1',
          data: encodeFunctionData({ abi: walletVaultAbi, functionName: 'deposit', args: [1000000n, p.account] }) },
      };
      const a = { id: `attempt-${context.attempts.length}`, status: 'reserved', quote: mode === 'tampered'
        ? { ...preview, transaction: { ...preview.transaction, to: p.account } } : preview };
      context.unresolved = a.id; context.attempts.push(a); value = a;
    }
    if (action === 'hash') context.attempts.at(-1).hash = route.request().postDataJSON().hash;
    if (action === 'reconcile') {
      if (checks++ < (mode === 'long-finality' ? 21 : 1)) return route.fulfill({ status: 409, json: {
        error: mode === 'busy-check' ? 'Check already running' : 'Receipt not finalized',
      } });
      const attempt = context.attempts.at(-1);
      context.unresolved = null; context.stage = attempt.quote.stage === 'approve' ? 'deposit' : 'partial';
      context.remainingWalletConfirmations = attempt.quote.stage === 'approve' ? 3 : 2;
      context.freshlyVerified = true; attempt.status = 'confirmed';
      attempt.outcome = { assets: '0', shares: '0', remainingShares: '0', gasUsed: '50000', effectiveGasPrice: '10000000' };
    }
    await route.fulfill({ json: value });
  });
  await page.addInitScript(({ account, hash, mode }) => {
    const sends: unknown[] = [];
    (window as any).vaultWalletFixture = { sends };
    const provider = { async request({ method, params }: { method: string; params?: unknown[] }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
      if (method === 'eth_chainId') return '0xc4';
      if (method === 'eth_sendTransaction') {
        sends.push(params);
        if (mode === 'unknown') throw Error('Wallet response lost');
        return hash;
      }
      throw Error('Unexpected wallet fixture method');
    } };
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent(
      'eip6963:announceProvider', { detail: { info: { uuid: 'fixture', name: 'OKX test fixture' }, provider } },
    )));
  }, { account: p.account, hash, mode });
  await page.goto('/vault-wallet-test');
  await expect(page.locator('#status')).toContainText(mode === 'approved-start' ? '无需重复授权' : '尚未请求签名');
  return { quote, hash };
}
async function ready(page: Page) {
  await page.locator('#connect').click();
  await page.locator('#prepare').click();
  await expect(page.locator('#preview')).toContainText('1.000000 USDC');
  await expect(page.locator('#send')).toBeDisabled();
  await page.locator('#consent').check();
  await expect(page.locator('#send')).toBeEnabled();
}
for (const width of [390, 1440]) test(`vault wallet consent and 3-second read-only continuation at ${width}px`, async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width, height: 950 });
  const { quote, hash } = await install(page);
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/${test.info().project.name}-vault-wallet-${width}.png`, fullPage: true });
  await page.locator('#send').click();
  await expect(page.locator('#hash')).toHaveValue(hash);
  await expect(page.locator('#next-check')).toContainText('只读核验');
  expect(await page.evaluate(() => (window as any).vaultWalletFixture.sends)).toEqual([[quote.transaction]]);
  await page.clock.fastForward(3100);
  await expect(page.locator('#status')).toContainText('本笔已核验');
  await expect(page.locator('#prepare')).toBeEnabled();
  await expect(page.locator('#prepare')).toContainText('存入 1 USDC');
  await expect(page.locator('#preview')).toBeEmpty();
  await expect(page.locator('#consent')).not.toBeChecked();
  await expect(page.locator('#next-check')).toContainText('自动准备');
  await page.clock.fastForward(3100);
  await expect(page.locator('#preview')).toContainText('存入 1 USDC');
  await expect(page.locator('#send')).toContainText('存入 1 USDC');
  await expect(page.locator('#send')).toBeDisabled();
  expect(await page.evaluate(() => (window as any).vaultWalletFixture.sends.length)).toBe(1);
  await page.locator('#consent').check();
  await expect(page.locator('#next-action')).toContainText('已勾选');
  expect(await page.evaluate(() => (window as any).vaultWalletFixture.sends.length)).toBe(1);
  await page.locator('#send').click();
  await expect.poll(() => page.evaluate(() => (window as any).vaultWalletFixture.sends.length)).toBe(2);
  const sends = await page.evaluate(() => (window as any).vaultWalletFixture.sends);
  expect(sends).toHaveLength(2);
  expect(sends[1][0].to).toBe(p.vault);
  expect(sends[1][0].data).toBe(encodeFunctionData({ abi: walletVaultAbi, functionName: 'deposit', args: [1000000n, p.account] }));
});
test('reload after approved USDC resumes at deposit without another approval', async ({ page }) => {
  await page.clock.install();
  await install(page, 'approved-start');
  await expect(page.locator('#status')).toContainText('无需重复授权');
  await expect(page.locator('#stage')).toHaveText('存入 1 USDC');
  await page.clock.fastForward(4100);
  await expect(page.locator('#preview')).toContainText('存入 1 USDC');
  await expect(page.locator('#send')).toBeDisabled();
  expect(await page.evaluate(() => (window as any).vaultWalletFixture.sends)).toEqual([]);
  await page.locator('#connect').click();
  await page.locator('#prepare').click();
  await expect(page.locator('#consent')).not.toBeChecked();
  await page.locator('#consent').check();
  await page.locator('#send').click();
  await expect.poll(() => page.evaluate(() => (window as any).vaultWalletFixture.sends.length)).toBe(1);
  const sends = await page.evaluate(() => (window as any).vaultWalletFixture.sends);
  expect(sends).toHaveLength(1);
  expect(sends[0][0].to).toBe(p.vault);
});
test('automatic next preparation can be disabled after verification', async ({ page }) => {
  await page.clock.install();
  await install(page); await ready(page); await page.locator('#send').click();
  await page.clock.fastForward(3100);
  await expect(page.locator('#status')).toContainText('本笔已核验');
  await page.locator('#auto-check').uncheck();
  await page.clock.fastForward(4100);
  await expect(page.locator('#preview')).toBeEmpty();
  await expect(page.locator('#next-check')).toBeEmpty();
  expect(await page.evaluate(() => (window as any).vaultWalletFixture.sends.length)).toBe(1);
});
test('another in-flight verification continues read-only checks and resumes without resending', async ({ page }) => {
  await page.clock.install();
  await install(page, 'busy-check'); await ready(page); await page.locator('#send').click();
  await expect(page.locator('#action-status')).toContainText('后台正在核验');
  await expect(page.locator('#next-check')).toContainText('只读核验');
  await expect(page.locator('#send')).toBeDisabled();
  await page.clock.fastForward(3100);
  await expect(page.locator('#stage')).toHaveText('存入 1 USDC');
  await expect(page.locator('#action-status')).toContainText('本笔已核验');
  expect(await page.evaluate(() => (window as any).vaultWalletFixture.sends.length)).toBe(1);
});
test('waiting for finality continues beyond twenty checks without resending', async ({ page }) => {
  await page.clock.install();
  await install(page, 'long-finality'); await ready(page); await page.locator('#send').click();
  for (let check = 0; check < 21; check++) {
    await expect(page.locator('#next-check')).toContainText('只读核验');
    await page.clock.fastForward(3100);
  }
  await expect(page.locator('#stage')).toHaveText('存入 1 USDC');
  expect(await page.evaluate(() => (window as any).vaultWalletFixture.sends.length)).toBe(1);
});
test('changed vault reservation never opens the wallet transaction prompt', async ({ page }) => {
  await install(page, 'tampered'); await ready(page); await page.locator('#send').click();
  await expect(page.locator('#status')).toContainText('预约不匹配');
  expect(await page.evaluate(() => (window as any).vaultWalletFixture.sends.length)).toBe(0);
  await expect(page.locator('#prepare')).toBeDisabled();
});
test('lost vault wallet response remains blocked after reload', async ({ page }) => {
  await install(page, 'unknown'); await ready(page); await page.locator('#send').click();
  await expect(page.locator('#status')).toContainText('Wallet response lost');
  await expect(page.locator('#prepare')).toBeDisabled();
  await page.reload();
  await expect(page.locator('#status')).toContainText('待核验请求');
  await expect(page.locator('#send')).toBeDisabled();
  expect(await page.evaluate(() => (window as any).vaultWalletFixture.sends.length)).toBe(0);
});
