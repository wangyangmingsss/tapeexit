import { expect, test } from '@playwright/test';
import { encodeFunctionData, keccak256, maxUint128 } from 'viem';
import { MANAGER, managerAbi } from '../../src/config';

// Read-only RPC fixtures on the production build; no wallet, signature or live-chain operation.
const origin = 'http://127.0.0.1:4175', key = 'tapeexit:submission:v1';
const account = '0x1000000000000000000000000000000000000001';
const hash = `0x${'ab'.repeat(32)}`, blockHash = `0x${'cd'.repeat(32)}`;
const input = encodeFunctionData({ abi: managerAbi, functionName: 'collect', args: [{
  tokenId: 12n, recipient: account, amount0Max: maxUint128, amount1Max: maxUint128,
}] });
const entry = { schemaVersion: 1, id: '11111111-1111-4111-8111-111111111111', chainId: 196,
  account, tokenId: '12', inputHash: keccak256(input), hash, startedAt: '2026-10-27T12:00:00Z' };
for (const fault of ['none', 'status-changed', 'hash-changed'] as const)
  test(`production recovery verifies the last failed receipt before unlocking: ${fault}`, async ({ page }) => {
    await page.addInitScript(({ key, entry }) => localStorage.setItem(key, JSON.stringify(entry)), { key, entry });
    const methods: string[] = [], receipts = new Map<string, number>();
    await page.route(/^https:\/\/(?:rpc\.xlayer\.tech|xlayer\.drpc\.org)\/?$/, async route => {
      const request = route.request().postDataJSON(), source = new URL(route.request().url()).hostname;
      methods.push(request.method);
      let result: unknown;
      if (request.method === 'eth_chainId') result = '0xc4';
      else if (request.method === 'eth_getTransactionByHash') result = {
        hash, blockHash, blockNumber: '0x10', transactionIndex: '0x0',
        from: account, to: MANAGER, input, value: '0x0',
      };
      else if (request.method === 'eth_getBlockByNumber') result = {
        number: '0x10', hash: blockHash, timestamp: '0x1',
      };
      else if (request.method === 'eth_getTransactionReceipt') {
        const count = (receipts.get(source) ?? 0) + 1;
        receipts.set(source, count);
        result = { status: count > 1 && fault === 'status-changed' ? '0x1' : '0x0',
          transactionHash: count > 1 && fault === 'hash-changed' ? blockHash : hash,
          blockHash, blockNumber: '0x10', transactionIndex: '0x0', from: account, to: MANAGER, logs: [] };
      } else throw new Error(`Unexpected fixture request: ${request.method}`);
      await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': origin },
        body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) });
    });
    await page.goto(origin);
    await page.getByRole('button', { name: '核对待处理交易' }).click();
    if (fault === 'none') {
      await expect(page.getByText('交易已回滚并最终确认，已解除待处理锁定。')).toBeVisible();
      expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
    } else {
      await expect(page.getByRole('alert')).toContainText('实际交易与待处理记录不匹配');
      await expect(page.getByText('存在未解决的提交，已锁定发送')).toBeVisible();
      expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)).toEqual(entry);
    }
    expect([...receipts.values()]).toEqual([2, 2]);
    expect(methods.some(method => /sign|send/i.test(method))).toBe(false);
  });
