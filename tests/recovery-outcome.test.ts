import { beforeEach, expect, it, vi } from 'vitest';
import { encodeFunctionData, maxUint128 } from 'viem';
import { DEMO_OWNER, demoSnapshot } from '../src/demo/engine';
import { DEPLOYMENT, managerAbi } from '../src/config';
import { V3Adapter } from '../src/core/adapter';
import { recheckHistory } from '../src/core/history';
import { StrictRpc } from '../src/core/rpc';
import { inspectRecoveryOutcome } from '../src/core/recovery-outcome';

vi.mock('../src/core/history', async original => ({
  ...await original<typeof import('../src/core/history')>(), recheckHistory: vi.fn(),
}));
const hash = `0x${'ab'.repeat(32)}` as const, blockHash = `0x${'cd'.repeat(32)}` as const;
const input = encodeFunctionData({ abi: managerAbi, functionName: 'collect', args: [{
  tokenId: 1n, recipient: DEMO_OWNER, amount0Max: maxUint128, amount1Max: maxUint128,
}] });
const result = { hash, blockHash, blockNumber: '16', amount0: '10', amount1: '20',
  state: 'received-checked', safe: true, finalized: true } as const;
beforeEach(() => vi.restoreAllMocks());
async function context() {
  vi.mocked(recheckHistory).mockReset().mockResolvedValue({ state: 'checked', result });
  const before = { ...await demoSnapshot(1n, 'none'), owner: DEMO_OWNER, liquidity: 100n, owed0: 10n, owed1: 20n };
  const after = { ...before, owed0: 0n, owed1: 0n };
  const tx = { hash, from: DEMO_OWNER, to: DEPLOYMENT.manager, input, value: '0x0',
    blockNumber: '0x10', blockHash, transactionIndex: '0x0' };
  const rpc = new StrictRpc([{ url: 'https://a.example', operator: 'a' },
    { url: 'https://b.example', operator: 'b' }], async (_source, method, params) => {
    if (method === 'eth_getTransactionByHash') return tx;
    if (method === 'eth_getBlockByNumber') return { number: params[0], hash: blockHash, timestamp: '0x1' };
    throw new Error(method);
  });
  vi.spyOn(V3Adapter.prototype, 'snapshotAt').mockImplementation(async (_id, block) =>
    block.number === '0xf' ? before : after);
  vi.spyOn(V3Adapter.prototype, 'read').mockImplementation(async (_abi, to, _fn, _args, block) =>
    (block.number === '0xf' ? 100n : to === before.token0.address ? 110n : 120n) as never);
  return { before, after, tx, rpc };
}
it('corroborates block balances and collect-only remaining liquidity without approving signing', async () => {
  const { rpc } = await context();
  const report = await inspectRecoveryOutcome(rpc, hash, 1n, DEMO_OWNER);
  expect(report).toMatchObject({ state: 'block-state-matched', identityMatches: true,
    liquidity: { before: '100', after: '100', removed: '0', matches: true },
    balances: [{ delta: '10', matches: true }, { delta: '20', matches: true }] });
  expect(report).not.toHaveProperty('signingApproved', true);
});
it.each(['owner', 'liquidity', 'owed', 'balance', 'events'] as const)('does not pass mismatched %s', async field => {
  const { rpc, after } = await context();
  if (field === 'owner') after.owner = DEPLOYMENT.manager;
  if (field === 'liquidity') after.liquidity = 90n;
  if (field === 'owed') after.owed0 = 1n;
  if (field === 'balance') vi.mocked(V3Adapter.prototype.read).mockResolvedValue(100n as never);
  if (field === 'events') vi.mocked(recheckHistory).mockResolvedValue({
    state: 'checked', result: { ...result, state: 'included-unverified' },
  });
  expect(await inspectRecoveryOutcome(rpc, hash, 1n, DEMO_OWNER))
    .toMatchObject({ state: 'block-state-mismatch' });
});
it.each(['pending', 'reverted'] as const)('preserves %s without attempting archive reads', async state => {
  const { rpc } = await context();
  vi.mocked(recheckHistory).mockResolvedValue(state === 'pending' ? { state } :
    { state, blockNumber: '16', blockHash });
  expect(await inspectRecoveryOutcome(rpc, hash, 1n, DEMO_OWNER)).toEqual({ state });
  expect(V3Adapter.prototype.snapshotAt).not.toHaveBeenCalled();
});
it('fails on unavailable historical state rather than manufacturing zero balances', async () => {
  const { rpc } = await context();
  vi.mocked(V3Adapter.prototype.read).mockRejectedValue(new Error('Archive unavailable'));
  await expect(inspectRecoveryOutcome(rpc, hash, 1n, DEMO_OWNER)).rejects.toThrow('Archive unavailable');
});
it('checks the receipt again after historical state reads', async () => {
  const { rpc } = await context();
  vi.mocked(recheckHistory).mockResolvedValueOnce({ state: 'checked', result })
    .mockResolvedValueOnce({ state: 'pending' });
  await expect(inspectRecoveryOutcome(rpc, hash, 1n, DEMO_OWNER)).rejects.toMatchObject({ code: 'REORG' });
});
it('rejects a transaction substituted between receipt and historical checks', async () => {
  const { rpc, tx } = await context();
  tx.value = '0x1';
  await expect(inspectRecoveryOutcome(rpc, hash, 1n, DEMO_OWNER))
    .rejects.toMatchObject({ code: 'TRANSACTION_MISMATCH' });
});
