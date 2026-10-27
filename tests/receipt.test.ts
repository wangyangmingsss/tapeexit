import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type Hex } from 'viem';
import { poolAbi, tokenAbi } from '../src/config';
import { makePlan } from '../src/core/protocol';
import { StrictRpc } from '../src/core/rpc';
import { inspectReceipt } from '../src/core/receipt';
import { demoSnapshot, DEMO_OWNER } from '../src/demo/engine';

const hash = `0x${'ab'.repeat(32)}` as Hex;
const blockHash = `0x${'cd'.repeat(32)}` as Hex;
async function context() {
  const snapshot = await demoSnapshot(1n, 'none');
  const plan = makePlan(snapshot, DEMO_OWNER, 5000, 50);
  const logs = [
    { address: snapshot.pool, logIndex: '0x0',
      topics: encodeEventTopics({ abi: poolAbi, eventName: 'Collect', args: {
        owner: plan.manager, tickLower: snapshot.tickLower, tickUpper: snapshot.tickUpper,
      } }),
      data: encodeAbiParameters(parseAbiParameters('address,uint128,uint128'), [DEMO_OWNER, 10n, 20n]) },
    ...[snapshot.token0, snapshot.token1].map((token, i) => ({
      address: token.address, logIndex: `0x${i + 1}`,
      topics: encodeEventTopics({ abi: tokenAbi, eventName: 'Transfer', args: { from: snapshot.pool, to: DEMO_OWNER } }),
      data: encodeAbiParameters(parseAbiParameters('uint256'), [i === 0 ? 10n : 20n]),
    })),
  ];
  const receipt = { status: '0x1', blockNumber: '0x10', blockHash, transactionHash: hash,
    from: DEMO_OWNER, to: plan.manager, logs };
  const tx = { from: DEMO_OWNER, to: plan.manager, input: plan.data, value: '0x0' };
  const state = { receipt: receipt as typeof receipt | null, tx, canonicalHash: blockHash,
    canonicalNumber: '0x10', finality: false };
  const rpc = new StrictRpc([
    { url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' },
  ], async (_source, method, params) => {
    if (method === 'eth_getTransactionReceipt') return state.receipt;
    if (method === 'eth_getTransactionByHash') return state.tx;
    if (method === 'eth_getBlockByNumber') {
      if (params[0] === 'safe' || params[0] === 'finalized') {
        if (!state.finality) throw new Error('Unsupported');
      }
      return { number: state.canonicalNumber, hash: state.canonicalHash, timestamp: '0x1' };
    }
    throw new Error(method);
  });
  return { rpc, state, plan };
}
describe('actual collection evidence', () => {
  it('requires matching pool Collect and both ERC20 transfers', async () => {
    const { rpc, state, plan } = await context();
    expect(await inspectReceipt(rpc, hash, plan)).toMatchObject({
      state: 'received-checked', amount0: '10', amount1: '20', safe: false, finalized: false,
    });
    state.receipt!.logs.pop();
    expect(await inspectReceipt(rpc, hash, plan)).toMatchObject({ state: 'included-unverified' });
  });
  it('does not treat unrelated token transfers as evidence', async () => {
    const { rpc, state, plan } = await context();
    state.receipt!.logs[1].address = plan.manager;
    expect(await inspectReceipt(rpc, hash, plan)).toMatchObject({ state: 'included-unverified' });
  });
  it('rejects changed transaction inputs and receipt identity', async () => {
    const { rpc, state, plan } = await context();
    state.tx.input = '0x1234';
    await expect(inspectReceipt(rpc, hash, plan)).rejects.toMatchObject({ code: 'TRANSACTION_MISMATCH' });
    state.tx.input = plan.data;
    state.receipt!.transactionHash = blockHash;
    await expect(inspectReceipt(rpc, hash, plan)).rejects.toMatchObject({ code: 'TRANSACTION_MISMATCH' });
  });
  it('separates pending, revert, reorg and finality', async () => {
    const { rpc, state, plan } = await context();
    state.canonicalHash = hash;
    await expect(inspectReceipt(rpc, hash, plan)).rejects.toMatchObject({ code: 'REORG' });
    state.canonicalHash = blockHash;
    state.finality = true;
    expect(await inspectReceipt(rpc, hash, plan)).toMatchObject({ safe: true, finalized: true });
    state.receipt!.status = '0x0';
    await expect(inspectReceipt(rpc, hash, plan)).rejects.toMatchObject({ code: 'REVERTED' });
    state.receipt = null;
    expect(await inspectReceipt(rpc, hash, plan)).toBeNull();
  });
  it('does not confirm collection when both sources substitute the requested receipt height', async () => {
    const { rpc, state, plan } = await context();
    state.finality = true;
    state.canonicalNumber = '0x11';
    await expect(inspectReceipt(rpc, hash, plan)).rejects.toMatchObject({ code: 'RPC_INVALID' });
  });
});
