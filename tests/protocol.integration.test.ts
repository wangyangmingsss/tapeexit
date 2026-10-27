import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi } from 'viem';
import { fixture, type Fixture } from './fixture';
import { makePlan } from '../src/core/protocol';
import { managerAbi } from '../src/config';
import { inspectReceipt } from '../src/core/receipt';
describe('official V3 contracts on isolated local EVM', () => {
  let f: Fixture;
  beforeAll(async () => { f = await fixture(); });
  afterAll(async () => {
    if (f?.child) {
      const closed = new Promise<void>(resolve => f.child.once('close', () => resolve()));
      f.child.kill('SIGTERM'); await closed;
    }
  });
  it('reads an actual position and executes owner multicall without new approval', async () => {
    const snapshot = await f.adapter.snapshot(f.tokenId);
    const plan = makePlan(snapshot, f.account, 5000, 50, false, f.deployment);
    const preview = await f.adapter.simulate(plan);
    expect(preview.amount0).toBeGreaterThan(0n);
    const approved = await f.client.readContract({ address: f.manager,
      abi: parseAbi(['function getApproved(uint256 tokenId) view returns (address)']), functionName: 'getApproved', args: [1n] });
    expect(approved).toBe('0x0000000000000000000000000000000000000000');
    const hash = await f.wallet.sendTransaction({ account: f.account, chain: f.wallet.chain, to: f.manager, data: plan.data, value: 0n });
    expect((await f.client.waitForTransactionReceipt({ hash })).status).toBe('success');
    expect(await inspectReceipt(f.adapter.rpc, hash, plan)).toMatchObject({
      state: 'received-checked',
    });
    const p = await f.client.readContract({ address: f.manager, abi: managerAbi, functionName: 'positions', args: [1n] });
    expect(p[7]).toBe(snapshot.liquidity - plan.liquidity);
  });
  it('rejects a non-owner using actual protocol checks', async () => {
    const data = encodeFunctionData({ abi: managerAbi, functionName: 'collect', args: [{ tokenId: 1n, recipient: f.other, amount0Max: 2n ** 128n - 1n, amount1Max: 2n ** 128n - 1n }] });
    await expect(f.client.call({ account: f.other, to: f.manager, data })).rejects.toThrow();
  });
  it('rolls back liquidity removal when collection transfer fails', async () => {
    const positions = await f.client.readContract({ address: f.manager, abi: managerAbi, functionName: 'positions', args: [1n] });
    const block = await f.client.getBlock();
    const data = encodeFunctionData({ abi: managerAbi, functionName: 'multicall', args: [[
      encodeFunctionData({ abi: managerAbi, functionName: 'decreaseLiquidity', args: [{
        tokenId: 1n, liquidity: positions[7] / 2n, amount0Min: 0n, amount1Min: 0n, deadline: block.timestamp + 300n,
      }] }),
      encodeFunctionData({ abi: managerAbi, functionName: 'collect', args: [{
        tokenId: 1n, recipient: f.account, amount0Max: 2n ** 128n - 1n, amount1Max: 2n ** 128n - 1n,
      }] }),
    ]] });
    const tokenAbi = parseAbi(['function setBlocked(bool value)']);
    const blockedHash = await f.wallet.writeContract({ account: f.account, chain: f.wallet.chain, address: f.token0, abi: tokenAbi, functionName: 'setBlocked', args: [true] });
    await f.client.waitForTransactionReceipt({ hash: blockedHash });
    const hash = await f.wallet.sendTransaction({ account: f.account, chain: f.wallet.chain, to: f.manager, data, gas: 600000n });
    expect((await f.client.waitForTransactionReceipt({ hash })).status).toBe('reverted');
    const after = await f.client.readContract({ address: f.manager, abi: managerAbi, functionName: 'positions', args: [1n] });
    expect(after[7]).toBe(positions[7]);
  });
});
