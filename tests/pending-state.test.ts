import { describe, expect, it } from 'vitest';
import type { Address, Hex } from 'viem';
import { pendingState } from '../src/core/receipt';
import { StrictRpc } from '../src/core/rpc';

const account = '0x1000000000000000000000000000000000000001' as Address;
const hash = `0x${'ab'.repeat(32)}` as Hex, blockHash = `0x${'cd'.repeat(32)}` as Hex;
const transaction = { hash, from: account, nonce: '0x3', blockNumber: null,
  blockHash: null, transactionIndex: null };
const mined = { ...transaction, blockNumber: '0x10', blockHash, transactionIndex: '0x0' };
function fixture(first: unknown = transaction, count: unknown = '0x3') {
  const calls: { method: string; params: unknown[] }[] = [];
  const reads = new Map<string, number>();
  const state = { first, second: first, count, changed: false };
  const rpc = new StrictRpc([
    { url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' },
  ], async (source, method, params) => {
    calls.push({ method, params });
    if (method === 'eth_getTransactionByHash') {
      const n = (reads.get(source.operator) ?? 0) + 1;
      reads.set(source.operator, n);
      return n === 1 ? state.first : state.second;
    }
    if (method === 'eth_blockNumber') return '0x12';
    if (method === 'eth_getBlockByNumber') return { number: '0x10',
      hash: state.changed ? hash : blockHash, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` };
    if (method === 'eth_getTransactionCount') { state.changed = reorg; return state.count; }
    throw new Error(`Unexpected request ${method}`);
  });
  let reorg = false;
  return { rpc, state, calls, reorg: () => { reorg = true; } };
}
describe('pending transaction identity and consumed nonce evidence', () => {
  it('learns a nonce only from the requested transaction and pins the account count', async () => {
    const { rpc, calls } = fixture();
    expect(await pendingState(rpc, hash, account)).toEqual({ state: 'pending', nonce: 3n });
    expect(calls.filter(c => c.method === 'eth_getTransactionCount').map(c => c.params))
      .toEqual([[account, '0x10'], [account, '0x10']]);
    expect(calls.filter(c => c.method === 'eth_getBlockByNumber')).toHaveLength(4);
  });
  it('does not query a count without either a transaction or a saved nonce', async () => {
    const { rpc, calls } = fixture(null);
    expect(await pendingState(rpc, hash, account)).toEqual({ state: 'pending', nonce: undefined });
    expect(calls.every(c => c.method === 'eth_getTransactionByHash')).toBe(true);
  });
  it('requires the original to remain absent after a consumed nonce is observed', async () => {
    const { rpc, calls } = fixture(null, '0x4');
    expect(await pendingState(rpc, hash, account, 3n)).toEqual({ state: 'replaced-or-dropped', nonce: 3n });
    expect(calls.filter(c => c.method === 'eth_getTransactionByHash')).toHaveLength(4);
  });
  it('can classify a disappeared previously indexed transaction without changing its nonce', async () => {
    const { rpc, state } = fixture(transaction, '0x4');
    state.second = null;
    expect(await pendingState(rpc, hash, account)).toEqual({ state: 'replaced-or-dropped', nonce: 3n });
  });
  it.each([transaction, mined])('keeps an indexed original awaiting its receipt: %j', async second => {
    const { rpc, state } = fixture(null, '0x4');
    state.second = second;
    expect(await pendingState(rpc, hash, account, 3n)).toEqual({ state: 'pending', nonce: 3n });
  });
  it('does not label an already mined original as a replacement when its receipt lags', async () => {
    const { rpc, calls } = fixture(mined, '0x4');
    expect(await pendingState(rpc, hash, account, 3n)).toEqual({ state: 'pending', nonce: 3n });
    expect(calls.every(c => c.method === 'eth_getTransactionByHash')).toBe(true);
  });
  it('retains a pending original even when the count advanced', async () => {
    const { rpc } = fixture(transaction, '0x4');
    expect(await pendingState(rpc, hash, account, 3n)).toEqual({ state: 'pending', nonce: 3n });
  });
  it.each([false, 0, '', [], {}, undefined, { ...transaction, hash: '0x1234' },
    { ...transaction, from: 'bad' }, { ...transaction, nonce: '0x03' },
    { ...transaction, nonce: '-1' }, { ...transaction, nonce: '3' },
    { ...transaction, nonce: `0x1${'0'.repeat(64)}` },
    { ...transaction, blockHash }, { ...transaction, blockNumber: '0x10' },
    { ...mined, transactionIndex: null }, { ...mined, blockNumber: '0x010' },
  ])('rejects malformed transaction evidence %j instead of treating it as absent', async first => {
    const { rpc, state, calls } = fixture();
    state.first = first;
    await expect(pendingState(rpc, hash, account, 3n)).rejects.toMatchObject({ code: 'RPC_INVALID' });
    expect(calls.every(c => c.method === 'eth_getTransactionByHash')).toBe(true);
  });
  it.each([{ ...transaction, hash: blockHash }, { ...transaction, nonce: '0x4' },
    { ...transaction, from: '0x2000000000000000000000000000000000000002' },
  ])('rejects a substituted hash, account or saved nonce %j', async first => {
    const { rpc } = fixture(first);
    await expect(pendingState(rpc, hash, account, 3n)).rejects.toMatchObject({ code: 'TRANSACTION_MISMATCH' });
  });
  it.each(['0x00', '0x04', '4', 4, null, '-0x1', '0x', `0x1${'0'.repeat(64)}`])(
    'rejects malformed account count %j', async count => {
      const { rpc } = fixture(null, count);
      await expect(pendingState(rpc, hash, account, 3n)).rejects.toMatchObject({ code: 'RPC_INVALID' });
    });
  it.each([-1n, 1n << 256n])('rejects an out of range saved nonce %s before requesting RPC', async nonce => {
    const { rpc, calls } = fixture();
    await expect(pendingState(rpc, hash, account, nonce)).rejects.toMatchObject({ code: 'RPC_INVALID' });
    expect(calls).toEqual([]);
  });
  it.each(['0x3', '0x4'])('rejects a reorganized account-count block %s', async count => {
    const f = fixture(null, count); f.reorg();
    await expect(pendingState(f.rpc, hash, account, 3n)).rejects.toMatchObject({ code: 'REORG' });
  });
  it('binds a late transaction to the learned nonce too', async () => {
    const { rpc, state } = fixture(transaction, '0x4');
    state.second = { ...transaction, nonce: '0x4' };
    await expect(pendingState(rpc, hash, account)).rejects.toMatchObject({ code: 'TRANSACTION_MISMATCH' });
  });
  it('rejects disagreement between the two transaction sources', async () => {
    const rpc = new StrictRpc([
      { url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' },
    ], async source => source.operator === 'a' ? transaction : { ...transaction, nonce: '0x4' });
    await expect(pendingState(rpc, hash, account)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('retains uint256 precision and accepts uppercase hex digits', async () => {
    const max = (1n << 256n) - 1n;
    const { rpc } = fixture({ ...transaction, hash: hash.toUpperCase().replace('0X', '0x'),
      nonce: `0x${max.toString(16).toUpperCase()}` }, `0x${max.toString(16)}`);
    expect(await pendingState(rpc, hash, account)).toEqual({ state: 'pending', nonce: max });
  });
});
