import { beforeEach, expect, it, vi } from 'vitest';
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, type Hex } from 'viem';
import { ControlledTest, type TestJournal } from '../tools/controlled-test-core';
import { TEST_POLICY, assertTestPosition, controlledTestData, validateTestData } from '../tools/controlled-test-policy';
import { checkTestAssets } from '../tools/controlled-test-policy';
import { StrictRpc } from '../src/core/rpc';
import { V3Adapter } from '../src/core/adapter';
import { inspectRecoveryOutcome } from '../src/core/recovery-outcome';
import { historicalExitToken } from '../src/core/history';
import { MANAGER, managerAbi } from '../src/config';
import type { Snapshot } from '../src/core/protocol';

vi.mock('../tools/controlled-test-policy', async original => ({
  ...await original<typeof import('../tools/controlled-test-policy')>(),
  checkTestAssets: vi.fn(async () => {}),
}));
vi.mock('../src/core/recovery-outcome', () => ({ inspectRecoveryOutcome: vi.fn() }));
const p = TEST_POLICY, txHash = `0x${'ab'.repeat(32)}` as Hex;
const block = { number: '0x10' as Hex, hash: `0x${'cd'.repeat(32)}` as Hex, timestamp: '0x3e8' as Hex };
const snapshot: Snapshot = {
  tokenId: 67042n, owner: p.account, pool: p.pool, token0: { address: p.token0, decimals: 6, symbol: 'USDt0', verified: false },
  token1: { address: p.token1, decimals: 6, symbol: 'USDC', verified: false }, fee: 100,
  tickLower: -887272, tickUpper: 887272, liquidity: 2000862n, owed0: 0n, owed1: 0n,
  sqrtPriceX96: 2n ** 96n, tick: 0, poolLiquidity: 100000000n, block,
};
beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
function fixture(saved?: TestJournal) {
  let time = 10_000, nonce = '0x0', pending = nonce, price = 21_000_000n, gas = 200_000n, failure = false;
  let receipt: any = null, actual: any = null;
  const rpc = new StrictRpc([{ url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' }]);
  vi.spyOn(V3Adapter.prototype, 'snapshot').mockResolvedValue(structuredClone(snapshot));
  vi.spyOn(rpc, 'checkChain').mockResolvedValue();
  vi.spyOn(rpc, 'block').mockResolvedValue(block);
  vi.spyOn(rpc, 'assertBlock').mockResolvedValue();
  vi.spyOn(rpc, 'gasPrice').mockImplementation(async () => price);
  vi.spyOn(rpc, 'estimate').mockImplementation(async () => gas);
  const methods: string[] = [];
  vi.spyOn(rpc, 'request').mockImplementation(async <T>(method: string, params: unknown[]): Promise<T> => {
    methods.push(method);
    if (method === 'eth_getTransactionReceipt') return receipt;
    if (method === 'eth_getTransactionByHash') return actual;
    if (method === 'eth_getTransactionCount') return (params[1] === 'pending' ? pending : nonce) as T;
    if (method === 'eth_call') return encodeFunctionResult({ abi: managerAbi, functionName: 'multicall',
      result: [
        encodeFunctionResult({ abi: managerAbi, functionName: 'decreaseLiquidity', result: [20007n, 20007n] }),
        encodeFunctionResult({ abi: managerAbi, functionName: 'collect', result: [20007n, 20007n] }),
      ] }) as T;
    throw new Error(`Unexpected RPC: ${method}`);
  });
  const journal = saved ?? { schemaVersion: 1 as const, contextId: ControlledTest.contextId, attempts: [] };
  const writes: TestJournal[] = [];
  const store = { save: vi.fn(async (j: TestJournal) => {
    if (failure) throw new Error('disk full');
    writes.push(structuredClone(j));
  }) };
  const bench = new ControlledTest(rpc, journal, store, () => time);
  const reserve = async () => {
    const q = await bench.preview();
    return bench.reserve(q.id, p.consent, q.maximumGasCostWei);
  };
  return { bench, rpc, journal, writes, methods, reserve, store,
    price: (v: bigint) => { price = v; }, gas: (v: bigint) => { gas = v; },
    nonce: () => { nonce = pending = '0x1'; }, pending: () => { pending = '0x1'; },
    expire: () => { time += 90_001; }, fail: () => { failure = true; },
    mine(a: Awaited<ReturnType<typeof reserve>>, status = '0x1') {
      const tx = a.quote.transaction;
      receipt = { status, transactionHash: txHash, from: p.account, to: MANAGER, blockHash: block.hash,
        blockNumber: block.number, gasUsed: '0x30d40', effectiveGasPrice: tx.gasPrice };
      actual = { ...tx, input: tx.data, hash: txHash, blockHash: block.hash, blockNumber: block.number };
      const outcome = { state: 'block-state-matched', hash: txHash, receipt: { finalized: true, blockHash: block.hash },
        liquidity: { before: p.baselineLiquidity, removed: p.removeLiquidity, after: '1980854' },
        balances: [{ delta: '20007' }, { delta: '20007' }] };
      vi.mocked(inspectRecoveryOutcome).mockResolvedValue(outcome as any);
      return { receipt, actual, outcome };
    },
  };
}
it('prepares a bounded direct decrease-and-collect without signing or approving the assets', async () => {
  const f = fixture(), q = await f.bench.preview();
  const d = validateTestData(q.transaction.data);
  expect(d.liquidity).toBe(20008n);
  expect(d.amount0Min).toBeGreaterThan(0n);
  expect(d.amount1Min).toBeGreaterThan(0n);
  expect(historicalExitToken(q.transaction.data, p.account)).toBe(67042n);
  expect(f.bench.context().productionSigningApproved).toBe(false);
  expect(f.methods.some(m => /send|sign/i.test(m))).toBe(false);
  expect(f.journal.attempts).toEqual([]);
  expect(checkTestAssets).toHaveBeenCalled();
});
it.each(['owner', 'tokenId', 'liquidity', 'pool', 'fee', 'owed0'])('rejects changed position %s', field => {
  const changed = { ...snapshot, [field]: field === 'owner' || field === 'pool' ? p.token0 : field === 'fee' ? 500 : 1n };
  expect(() => assertTestPosition(changed)).toThrow('changed');
});
it('rejects wider collection caps or a changed recipient without allowing V3 approval metadata', () => {
  const data = controlledTestData(snapshot).data;
  const outer = decodeFunctionData({ abi: managerAbi, data });
  if (outer.functionName !== 'multicall') throw new Error('Bad test');
  for (const changed of [{ amount0Max: 50001n }, { recipient: p.token0 }]) {
    const collect = encodeFunctionData({ abi: managerAbi, functionName: 'collect', args: [{
      tokenId: 67042n, recipient: p.account, amount0Max: 50000n, amount1Max: 50000n, ...changed,
    }] });
    const altered = encodeFunctionData({ abi: managerAbi, functionName: 'multicall', args: [[outer.args[0][0], collect]] });
    expect(() => validateTestData(altered)).toThrow('exceeds');
  }
});
it('requires explicit risk and fee consent and persists the reservation before returning', async () => {
  const f = fixture(), q = await f.bench.preview();
  await expect(f.bench.reserve(q.id, 'yes', q.maximumGasCostWei)).rejects.toThrow('Explicit');
  const a = await f.reserve();
  expect(f.writes.at(-1)?.attempts[0]).toEqual(a);
  const restarted = fixture(structuredClone(f.writes.at(-1)!));
  await expect(restarted.bench.preview()).rejects.toThrow('unresolved');
  expect(restarted.bench.context().unresolved).toBe(a.id);
});
it.each(['price', 'gas', 'nonce', 'expiry'])('rejects changed %s before calling the wallet', async mode => {
  const f = fixture(), q = await f.bench.preview();
  if (mode === 'price') f.price(22_000_000n);
  if (mode === 'gas') f.gas(200_100n);
  if (mode === 'nonce') f.nonce();
  if (mode === 'expiry') f.expire();
  await expect(f.bench.reserve(q.id, p.consent, q.maximumGasCostWei)).rejects.toThrow();
  expect(f.journal.attempts).toHaveLength(0);
});
it('retains a transaction with missing receipt and a bad hash without permitting resubmission', async () => {
  const f = fixture(), a = await f.reserve();
  await expect(f.bench.attachHash(a.id, '0x01')).rejects.toThrow();
  await f.bench.attachHash(a.id, txHash);
  await expect(f.bench.reconcile()).rejects.toThrow('pending');
  await expect(f.bench.preview()).rejects.toThrow('unresolved');
  const { actual } = f.mine(a); actual.input = '0x1234';
  await expect(f.bench.reconcile()).rejects.toThrow('differs');
  expect(f.bench.context().unresolved).toBe(a.id);
});
it('checks actual arrival and remaining liquidity and can recheck after restarting without another send', async () => {
  const f = fixture(), a = await f.reserve();
  await f.bench.attachHash(a.id, txHash); const mined = f.mine(a);
  mined.actual.gas = '0x100000'; // The wallet may enlarge its unused envelope.
  const result = await f.bench.reconcile();
  expect(result.complete).toBe(true);
  expect(result.freshlyVerified).toBe(true);
  expect(result.attempts[0].outcome?.state).toBe('block-state-matched');
  const restarted = fixture(structuredClone(f.writes.at(-1)!));
  expect(restarted.bench.context().freshlyVerified).toBe(false);
  restarted.mine(a);
  expect((await restarted.bench.reconcile()).complete).toBe(true);
  await expect(restarted.bench.preview()).rejects.toThrow('completed');
});
it('withdraws the fresh success label after a failed recheck and still blocks another exit', async () => {
  const f = fixture(), a = await f.reserve();
  await f.bench.attachHash(a.id, txHash); f.mine(a);
  await f.bench.reconcile();
  expect(f.bench.context().freshlyVerified).toBe(true);
  vi.mocked(f.rpc.request).mockRejectedValue(new Error('RPC unavailable'));
  await expect(f.bench.reconcile()).rejects.toThrow('RPC unavailable');
  expect(f.bench.context().freshlyVerified).toBe(false);
  expect(f.bench.context().complete).toBe(true);
  await expect(f.bench.preview()).rejects.toThrow('completed');
});
it('does not retain an unverified arrival if the receipt changes during reconciliation', async () => {
  const f = fixture(), a = await f.reserve();
  await f.bench.attachHash(a.id, txHash); f.mine(a);
  const request = vi.mocked(f.rpc.request).getMockImplementation()!;
  let receipts = 0;
  vi.mocked(f.rpc.request).mockImplementation(async (method, params, normalize) => {
    const value = await request(method, params, normalize);
    return method === 'eth_getTransactionReceipt' && ++receipts === 2
      ? { ...value as object, gasUsed: '0x30d41' } as any : value;
  });
  await expect(f.bench.reconcile()).rejects.toThrow('changed during');
  expect(f.bench.context().attempts[0].outcome).toBeUndefined();
  expect(f.bench.context().complete).toBe(false);
  expect(f.bench.context().unresolved).toBe(a.id);
});
it('clears historical arrival data if a previously confirmed transaction is now canonically reverted', async () => {
  const f = fixture(), a = await f.reserve();
  await f.bench.attachHash(a.id, txHash); f.mine(a); await f.bench.reconcile();
  f.mine(a, '0x0');
  const result = await f.bench.reconcile();
  expect(result.complete).toBe(false);
  expect(result.freshlyVerified).toBe(false);
  expect(result.attempts[0].status).toBe('reverted');
  expect(result.attempts[0].outcome).toBeUndefined();
  expect(f.writes.at(-1)?.attempts[0].outcome).toBeUndefined();
});
it.each(['arrival', 'fee', 'finality'])('keeps %s failure unresolved', async mode => {
  const f = fixture(), a = await f.reserve();
  await f.bench.attachHash(a.id, txHash); const mined = f.mine(a);
  if (mode === 'arrival') vi.mocked(inspectRecoveryOutcome).mockResolvedValue({ state: 'block-state-mismatch' } as any);
  if (mode === 'fee') mined.receipt.effectiveGasPrice = '0x1c9c381';
  if (mode === 'finality') vi.mocked(f.rpc.block).mockImplementation(async tag => tag === 'finalized' ? { ...block, number: '0xf' } : block);
  await expect(f.bench.reconcile()).rejects.toThrow();
  expect(f.bench.context().unresolved).toBe(a.id);
});
it('records a revert, requires cancellation evidence, and stops after journal failure', async () => {
  const f = fixture(), a = await f.reserve();
  await expect(f.bench.cancel(a.id, 'assume')).rejects.toThrow('Explicit');
  await f.bench.cancel(a.id, 'WALLET_CANCELLED_NO_PENDING_SIGNATURE');
  const b = await f.reserve(); await f.bench.attachHash(b.id, txHash); f.mine(b, '0x0');
  expect((await f.bench.reconcile()).attempts[1].status).toBe('reverted');
  const broken = fixture(); const q = await broken.bench.preview(); broken.fail();
  await expect(broken.bench.reserve(q.id, p.consent, q.maximumGasCostWei)).rejects.toThrow('disk full');
  await expect(broken.bench.preview()).rejects.toThrow('Journal write failed');
});
it('rejects corrupt restored calldata and fee evidence', async () => {
  const f = fixture(), a = await f.reserve();
  const saved = structuredClone(f.writes.at(-1)!);
  saved.attempts[0].quote.transaction.data = '0x1234';
  expect(() => fixture(saved)).toThrow();
  const second = structuredClone(f.writes.at(-1)!);
  second.attempts[0].quote.maximumGasCostWei = '1';
  expect(() => fixture(second)).toThrow();
  expect(a.quote.transaction.value).toBe('0x0');
});
