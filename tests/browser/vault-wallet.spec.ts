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
  const previewForStage = () => context.stage === 'approve' ? quote : {
    ...quote, id: `quote-${context.stage}`, stage: context.stage,
    ...(context.stage === 'deposit' ? { output: '996244', minimumOutput: '991262' } : {
      amount: context.stage === 'partial' ? '498083' : '498084',
      beforeShares: context.stage === 'partial' ? '996167' : '498084',
      output: '499999', minimumOutput: '497499',
    }),
    transaction: { ...quote.transaction, to: p.vault, nonce: '0x1',
      data: context.stage === 'deposit'
        ? encodeFunctionData({ abi: walletVaultAbi, functionName: 'deposit', args: [1000000n, p.account] })
        : encodeFunctionData({ abi: walletVaultAbi, functionName: 'redeem',
          args: [context.stage === 'partial' ? 498083n : 498084n, p.account, p.account] }) },
  };
  if (mode.startsWith('redeem-')) {
    context.stage = 'deposit';
    context.attempts.push({ id: 'approved', status: 'confirmed', quote, hash });
    context.attempts.push({ id: 'deposited', status: 'confirmed', quote: previewForStage(), hash });
    context.stage = 'partial'; context.remainingWalletConfirmations = 2;
  }
  await page.route('**/vault-wallet-test', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('**/client.js', route => route.fulfill({ contentType: 'text/javascript', body: js }));
  await page.route('**/styles.css', route => route.fulfill({ contentType: 'text/css', body: css }));
  let checks = 0;
  await page.route('**/api/*', async route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1)!;
    let value: unknown = context;
    if (action === 'preview') value = previewForStage();
    if (action === 'reserve') {
      const preview = previewForStage();
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
      context.unresolved = null;
      context.stage = { approve: 'deposit', deposit: 'partial', partial: 'full', full: 'complete' }[attempt.quote.stage as string]!;
      context.complete = context.stage === 'complete';
      context.remainingWalletConfirmations = { deposit: 3, partial: 2, full: 1, complete: 0 }[context.stage]!;
      context.freshlyVerified = true; attempt.status = 'confirmed';
      attempt.outcome = { assets: '0', shares: '0', remainingShares: '0', gasUsed: '50000', effectiveGasPrice: '10000000' };
    }
    await route.fulfill({ json: value });
  });
  await page.addInitScript(({ account, hash, mode }) => {
    const sends: unknown[] = [], calls: string[] = [], listeners = new Map<string, Set<(...args: any[]) => void>>();
    let authorized = !['redeem-events', 'redeem-denied'].includes(mode), connectionRequests = 0;
    const emit = (event: string, value: unknown) => listeners.get(event)?.forEach(handler => handler(value));
    (window as any).vaultWalletFixture = { sends, calls, emit };
    const provider = { async request({ method, params }: { method: string; params?: unknown[] }) {
      calls.push(method);
      if (method === 'eth_accounts') return authorized ? [account] : [];
      if (method === 'eth_requestAccounts') {
        if (mode === 'redeem-denied' && connectionRequests++ === 0)
          throw Object.assign(Error('Request Signature: User denied request signature.'), { code: 4001 });
        authorized = true;
        emit('accountsChanged', [account]); emit('chainChanged', '0xc4');
        return [account];
      }
      if (method === 'eth_chainId') return '0xc4';
      if (method === 'eth_sendTransaction') {
        sends.push(params);
        if (mode === 'unknown') throw Error('Wallet response lost');
        return hash;
      }
      throw Error('Unexpected wallet fixture method');
    },
      on(event: string, handler: (...args: any[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(handler);
      },
      removeListener(event: string, handler: (...args: any[]) => void) { listeners.get(event)?.delete(handler); },
    };
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent(
      'eip6963:announceProvider', { detail: { info: { uuid: 'fixture', name: 'OKX test fixture' }, provider } },
    )));
  }, { account: p.account, hash, mode });
  await page.goto('/vault-wallet-test');
  await expect(page.locator('#status')).toContainText(
    mode === 'approved-start' || mode.startsWith('redeem-') ? '无需重复授权' : '尚未请求签名');
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
  await expect(page.locator('#preview')).toBeEmpty();
  await expect(page.locator('#prepare')).toBeDisabled();
  await expect(page.locator('#send')).toContainText('连接 OKX 钱包以继续');
  await expect(page.locator('#send')).toBeEnabled();
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
test('redeem action reconnects an authorized wallet without another permission prompt or transaction', async ({ page }) => {
  await page.clock.install();
  await install(page, 'redeem-authorized');
  await page.clock.fastForward(4100);
  await expect(page.locator('#preview')).toBeEmpty();
  await expect(page.locator('#prepare')).toBeDisabled();
  await expect(page.locator('#send')).toContainText('连接 OKX 钱包以继续：赎回一半份额');
  await page.locator('#send').click();
  await expect(page.locator('#account')).toContainText(p.account);
  await expect(page.locator('#send')).toBeDisabled();
  const fixture = await page.evaluate(() => (window as any).vaultWalletFixture);
  expect(fixture.calls).not.toContain('eth_requestAccounts');
  expect(fixture.sends).toEqual([]);
  await page.clock.fastForward(3100);
  await expect(page.locator('#preview')).toContainText('0.498083 spUSDC');
  await page.locator('#consent').check(); await page.locator('#send').click();
  await expect.poll(() => page.evaluate(() => (window as any).vaultWalletFixture.sends.length)).toBe(1);
  const sends = await page.evaluate(() => (window as any).vaultWalletFixture.sends);
  expect(sends[0][0].data).toBe(encodeFunctionData({ abi: walletVaultAbi,
    functionName: 'redeem', args: [498083n, p.account, p.account] }));
  await page.clock.fastForward(3100);
  await expect(page.locator('#stage')).toHaveText('赎回剩余份额');
  await page.clock.fastForward(3100);
  await expect(page.locator('#preview')).toContainText('0.498084 spUSDC');
  await page.locator('#consent').check(); await page.locator('#send').click();
  await expect.poll(() => page.evaluate(() => (window as any).vaultWalletFixture.sends.length)).toBe(2);
  await expect(page.locator('#stage')).toHaveText('实测流程完成');
});
test('matching account and chain events during connection retain the redeem connection', async ({ page }) => {
  await page.clock.install();
  await install(page, 'redeem-events'); await page.locator('#send').click();
  await expect(page.locator('#account')).toContainText(p.account);
  await page.clock.fastForward(3100);
  await page.locator('#consent').check(); await page.locator('#send').click();
  await expect.poll(() => page.evaluate(() => (window as any).vaultWalletFixture.sends.length)).toBe(1);
});
test('declined wallet connection leaves no redemption request and can be retried', async ({ page }) => {
  await page.clock.install();
  await install(page, 'redeem-denied'); await page.locator('#send').click();
  await expect(page.locator('#action-status')).toContainText('钱包连接未获授权');
  await expect(page.locator('#action-status')).toContainText('尚未请求本笔交易');
  await expect(page.locator('#send')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).vaultWalletFixture.sends)).toEqual([]);
  await page.locator('#send').click();
  await expect(page.locator('#account')).toContainText(p.account);
  expect(await page.evaluate(() => (window as any).vaultWalletFixture.sends)).toEqual([]);
});
test('changing to another account clears redeem consent and requires reconnection', async ({ page }) => {
  await page.clock.install();
  await install(page, 'redeem-authorized'); await page.locator('#send').click();
  await page.clock.fastForward(3100); await page.locator('#consent').check();
  await page.evaluate(() => (window as any).vaultWalletFixture.emit('accountsChanged', ['0x' + '22'.repeat(20)]));
  await expect(page.locator('#consent')).not.toBeChecked();
  await expect(page.locator('#preview')).toBeEmpty();
  await expect(page.locator('#send')).toContainText('连接 OKX 钱包以继续');
  expect(await page.evaluate(() => (window as any).vaultWalletFixture.sends)).toEqual([]);
});
