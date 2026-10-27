import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi } from 'viem';
import { fixture, type Fixture } from './fixture';
import { makePlan } from '../src/core/protocol';
import { managerAbi, tokenAbi } from '../src/config';
import { inspectReceipt } from '../src/core/receipt';
import { recheckHistory } from '../src/core/history';
describe('official V3 contracts on isolated local EVM', () => {
  let f: Fixture;
  let checkpoint: `0x${string}`;
  beforeAll(async () => { f = await fixture(); });
  beforeEach(async () => { checkpoint = await f.client.request({ method: 'evm_snapshot' as never }) as `0x${string}`; });
  afterEach(async () => { await f.client.request({ method: 'evm_revert' as never, params: [checkpoint] as never }); });
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
    const item = { hash, tokenId: f.tokenId.toString(), time: new Date().toISOString(),
      environment: 'mainnet' as const, state: 'submitted' };
    expect(await recheckHistory(f.adapter.rpc, item, f.deployment)).toMatchObject({
      state: 'checked', result: { state: 'received-checked' },
    });
    await expect(recheckHistory(f.adapter.rpc, { ...item, tokenId: '999' }, f.deployment))
      .rejects.toMatchObject({ code: 'HISTORY' });
    const p = await f.client.readContract({ address: f.manager, abi: managerAbi, functionName: 'positions', args: [1n] });
    expect(p[7]).toBe(snapshot.liquidity - plan.liquidity);
  });
  it('rejects a non-owner using actual protocol checks', async () => {
    const data = encodeFunctionData({ abi: managerAbi, functionName: 'collect', args: [{ tokenId: 1n, recipient: f.other, amount0Max: 2n ** 128n - 1n, amount1Max: 2n ** 128n - 1n }] });
    await expect(f.client.call({ account: f.other, to: f.manager, data })).rejects.toThrow();
  });
  async function balances() {
    return Promise.all([f.token0, f.token1].map(address => f.client.readContract({
      address, abi: tokenAbi, functionName: 'balanceOf', args: [f.account],
    })));
  }
  async function remaining() {
    return f.client.readContract({ address: f.manager, abi: managerAbi, functionName: 'positions', args: [f.tokenId] });
  }
  async function execute(data: `0x${string}`) {
    const hash = await f.wallet.sendTransaction({
      account: f.account, chain: f.wallet.chain, to: f.manager, data, value: 0n, gas: 1000000n,
    });
    return { hash, receipt: await f.client.waitForTransactionReceipt({ hash }) };
  }
  async function mineForPin() {
    await f.client.request({ method: 'evm_mine' as never });
    await f.client.request({ method: 'evm_mine' as never });
  }
  it('removes all liquidity, checks both actual balance deltas and keeps the NFT', async () => {
    const snapshot = await f.adapter.snapshot(f.tokenId);
    const plan = makePlan(snapshot, f.account, 10000, 50, false, f.deployment);
    const preview = await f.adapter.simulate(plan);
    const before = await balances();
    const { hash, receipt } = await execute(plan.data);
    expect(receipt.status).toBe('success');
    const result = await inspectReceipt(f.adapter.rpc, hash, plan);
    expect(result?.state).toBe('received-checked');
    const after = await balances();
    expect(after.map((value, i) => value - before[i])).toEqual([preview.amount0, preview.amount1]);
    expect([BigInt(result!.amount0), BigInt(result!.amount1)]).toEqual([preview.amount0, preview.amount1]);
    const position = await remaining();
    expect(position[7]).toBe(0n);
    expect(position[10]).toBe(0n);
    expect(position[11]).toBe(0n);
    expect(await f.client.readContract({ address: f.manager, abi: managerAbi,
      functionName: 'ownerOf', args: [f.tokenId] })).toBe(f.account);
    await mineForPin();
    const empty = makePlan(await f.adapter.snapshot(f.tokenId), f.account, 10000, 50, true, f.deployment);
    await expect(f.adapter.simulate(empty)).rejects.toMatchObject({ code: 'EMPTY' });
  });
  it.each([false, true])('collects already owed assets without removing liquidity, empty liquidity=%s', async full => {
    const initial = await remaining();
    const block = await f.client.getBlock();
    const decrease = encodeFunctionData({ abi: managerAbi, functionName: 'decreaseLiquidity', args: [{
      tokenId: f.tokenId, liquidity: full ? initial[7] : initial[7] / 2n,
      amount0Min: 0n, amount1Min: 0n, deadline: block.timestamp + 300n,
    }] });
    expect((await execute(decrease)).receipt.status).toBe('success');
    await mineForPin();
    const snapshot = await f.adapter.snapshot(f.tokenId);
    expect(snapshot.owed0).toBeGreaterThan(0n);
    expect(snapshot.owed1).toBeGreaterThan(0n);
    const plan = makePlan(snapshot, f.account, 10000, 50, true, f.deployment);
    const preview = await f.adapter.simulate(plan);
    expect(plan.mode).toBe('collect-only');
    expect(plan.deadline).toBeNull();
    const before = await balances();
    const { hash, receipt } = await execute(plan.data);
    expect(receipt.status).toBe('success');
    expect(await inspectReceipt(f.adapter.rpc, hash, plan)).toMatchObject({
      state: 'received-checked', amount0: preview.amount0.toString(), amount1: preview.amount1.toString(),
    });
    const after = await balances();
    expect(after.map((value, i) => value - before[i])).toEqual([preview.amount0, preview.amount1]);
    const position = await remaining();
    expect(position[7]).toBe(snapshot.liquidity);
    expect(position[10]).toBe(0n);
    expect(position[11]).toBe(0n);
  });
  it.each(['minimum', 'deadline'] as const)('reverts the entire exit on an invalid %s', async fault => {
    const position = await remaining();
    const before = await balances();
    const block = await f.client.getBlock();
    const data = encodeFunctionData({ abi: managerAbi, functionName: 'multicall', args: [[
      encodeFunctionData({ abi: managerAbi, functionName: 'decreaseLiquidity', args: [{
        tokenId: f.tokenId, liquidity: position[7] / 2n,
        amount0Min: fault === 'minimum' ? 2n ** 256n - 1n : 0n,
        amount1Min: 0n, deadline: fault === 'deadline' ? block.timestamp - 1n : block.timestamp + 300n,
      }] }),
      encodeFunctionData({ abi: managerAbi, functionName: 'collect', args: [{
        tokenId: f.tokenId, recipient: f.account, amount0Max: 2n ** 128n - 1n, amount1Max: 2n ** 128n - 1n,
      }] }),
    ]] });
    const { hash, receipt } = await execute(data);
    expect(receipt.status).toBe('reverted');
    expect(receipt.logs).toHaveLength(0);
    expect(await remaining()).toEqual(position);
    expect(await balances()).toEqual(before);
    expect(await recheckHistory(f.adapter.rpc, { hash, tokenId: f.tokenId.toString(),
      time: new Date().toISOString(), environment: 'mainnet', state: 'submitted' }, f.deployment))
      .toMatchObject({ state: 'reverted' });
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
    expect(await recheckHistory(f.adapter.rpc, { hash, tokenId: f.tokenId.toString(),
      time: new Date().toISOString(), environment: 'mainnet', state: 'submitted' }, f.deployment))
      .toMatchObject({ state: 'reverted' });
    const after = await f.client.readContract({ address: f.manager, abi: managerAbi, functionName: 'positions', args: [1n] });
    expect(after[7]).toBe(positions[7]);
  });
});
