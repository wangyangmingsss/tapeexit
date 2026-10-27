// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keccak256 } from 'viem';
import { makePlan } from '../src/core/protocol';
import { demoSnapshot, DEMO_OWNER } from '../src/demo/engine';
import { sendGuarded, reconcileSubmission, submissionState, SUBMISSION_KEY } from '../src/core/submission';
import { clearHistory } from '../src/core/storage';
import { recheckHistory } from '../src/core/history';
import { StrictRpc } from '../src/core/rpc';
import { MANAGER } from '../src/config';
vi.mock('../src/core/history', () => ({ recheckHistory: vi.fn() }));
const hash = `0x${'ab'.repeat(32)}` as const;
const blockHash = `0x${'cd'.repeat(32)}` as const;
let locked = false;
beforeEach(() => {
  localStorage.clear();
  locked = false;
  vi.mocked(recheckHistory).mockReset();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (_name: string, _options: unknown, action: (lock: unknown) => Promise<unknown>) => {
      if (locked) return action(null);
      locked = true;
      try { return await action({ name: 'test-exclusive' }); } finally { locked = false; }
    },
  } });
});
afterEach(() => { vi.restoreAllMocks(); });
async function plan() { return makePlan(await demoSnapshot(12n, 'none'), DEMO_OWNER, 5000, 50); }
function provider(send: () => Promise<unknown>) {
  return { request: vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_accounts') return [DEMO_OWNER];
    if (method === 'eth_chainId') return '0xc4';
    if (method === 'eth_sendTransaction') return send();
    throw new Error(`Unexpected ${method}`);
  }) };
}
async function sent() {
  const p = await plan();
  await sendGuarded(provider(async () => hash), p, 100000n);
  return p;
}
function rpc(data: `0x${string}`, fault?: 'mismatch' | 'missing' | 'confirming' | 'reorg' | 'finality') {
  return new StrictRpc([
    { url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' },
  ], async (_source, method, params) => {
    if (method === 'eth_chainId') return '0xc4';
    if (method === 'eth_getTransactionByHash') return fault === 'missing' ? null : {
      from: DEMO_OWNER, to: MANAGER, input: fault === 'mismatch' ? '0x1234' : data, value: '0x0',
    };
    if (method === 'eth_getTransactionReceipt') return { blockNumber: '0x10', blockHash };
    if (method === 'eth_getBlockByNumber') {
      if (fault === 'finality') throw new Error('Unsupported');
      const finalized = params[0] === 'finalized';
      return { number: finalized && fault === 'confirming' ? '0xf' : '0x10',
        hash: fault === 'reorg' ? hash : blockHash, timestamp: '0x1' };
    }
    throw new Error(`Unexpected ${method}`);
  });
}
function checked() {
  vi.mocked(recheckHistory).mockResolvedValue({ state: 'checked', result: {
    hash, blockNumber: '16', blockHash, amount0: '1', amount1: '1',
    state: 'received-checked', safe: true, finalized: false,
  } });
}
describe('durable same-origin submission guard', () => {
  it('preserves public intent before wallet send and blocks another submission after reload', async () => {
    const p = await plan();
    const wallet = provider(async () => {
      expect(submissionState()).toMatchObject({ state: 'blocked', submission: {
        tokenId: '12', account: DEMO_OWNER, inputHash: keccak256(p.data),
      } });
      return hash;
    });
    await expect(sendGuarded(wallet, p, 100000n)).resolves.toBe(hash);
    expect(submissionState()).toMatchObject({ state: 'blocked', submission: { hash } });
    const second = provider(async () => hash);
    await expect(sendGuarded(second, p, 100000n)).rejects.toMatchObject({ code: 'SUBMISSION_BLOCKED' });
    expect(second.request).not.toHaveBeenCalled();
    expect(localStorage.getItem(SUBMISSION_KEY)).not.toContain(p.data);
    clearHistory();
    expect(submissionState().state).toBe('blocked');
  });
  it('coordinates simultaneous tabs before the first wallet promise resolves', async () => {
    let finish!: (value: unknown) => void;
    const p = await plan();
    const first = sendGuarded(provider(() => new Promise(resolve => { finish = resolve; })), p, 100000n);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const other = provider(async () => hash);
    await expect(sendGuarded(other, p, 100000n)).rejects.toMatchObject({ code: 'SUBMISSION_LOCK' });
    expect(other.request).not.toHaveBeenCalled();
    finish(hash); await first;
  });
  it('keeps unknown submissions blocked and releases only explicit cancellation', async () => {
    const p = await plan();
    await expect(sendGuarded(provider(async () => { throw { code: 4001 }; }), p, 100000n)).rejects.toMatchObject({ code: 4001 });
    expect(submissionState().state).toBe('empty');
    await expect(sendGuarded(provider(async () => { throw new Error('Disconnected after send'); }), p, 100000n)).rejects.toThrow();
    expect(submissionState()).toMatchObject({ state: 'blocked' });
    await expect(reconcileSubmission(rpc(p.data))).rejects.toMatchObject({ code: 'SUBMISSION_UNKNOWN' });
  });
  it('does not call wallet send if storage or browser locking is unavailable', async () => {
    const p = await plan(), wallet = provider(async () => hash);
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Denied'); });
    await expect(sendGuarded(wallet, p, 100000n)).rejects.toMatchObject({ code: 'SUBMISSION_STORAGE' });
    expect(wallet.request.mock.calls.some(([call]) => call.method === 'eth_sendTransaction')).toBe(false);
    set.mockRestore();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    await expect(sendGuarded(wallet, p, 100000n)).rejects.toMatchObject({ code: 'SUBMISSION_LOCK' });
  });
  it('treats malformed storage as blocked rather than as an empty journal', async () => {
    localStorage.setItem(SUBMISSION_KEY, '{"hash":"invalid"}');
    expect(submissionState().state).toBe('unavailable');
    const wallet = provider(async () => hash);
    await expect(sendGuarded(wallet, await plan(), 100000n)).rejects.toMatchObject({ code: 'SUBMISSION_BLOCKED' });
    expect(wallet.request).not.toHaveBeenCalled();
  });
  it('retains the unknown marker if saving the returned hash fails', async () => {
    const original = localStorage.setItem.bind(localStorage);
    let writes = 0;
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (++writes === 2) throw new Error('Quota');
      original(key, value);
    });
    await sent();
    const state = submissionState();
    expect(state.state).toBe('blocked');
    if (state.state !== 'blocked') throw new Error();
    expect(state.submission.hash).toBeUndefined();
  });
  it('leaves no pending marker if the plan expires before the wallet request', async () => {
    const p = await plan();
    const wallet = provider(async () => hash);
    await expect(sendGuarded(wallet, { ...p, createdAt: Date.now() - 31000 }, 100000n))
      .rejects.toMatchObject({ code: 'STALE' });
    expect(submissionState().state).toBe('empty');
    expect(wallet.request.mock.calls.some(([call]) => call.method === 'eth_sendTransaction')).toBe(false);
  });
  it('keeps the marker when the wallet returns an invalid submission response', async () => {
    await expect(sendGuarded(provider(async () => undefined), await plan(), 100000n))
      .rejects.toMatchObject({ code: 'SUBMISSION_UNKNOWN' });
    expect(submissionState().state).toBe('blocked');
  });
  it('preserves the marker while the matching transaction has no receipt', async () => {
    const p = await sent();
    vi.mocked(recheckHistory).mockResolvedValue({ state: 'pending' });
    await expect(reconcileSubmission(rpc(p.data))).resolves.toEqual({ state: 'pending' });
    expect(submissionState().state).toBe('blocked');
  });
  it('retains a reverted marker if its canonical block changes during recovery', async () => {
    const p = await sent();
    vi.mocked(recheckHistory).mockResolvedValue({ state: 'reverted', blockNumber: '16', blockHash: hash });
    await expect(reconcileSubmission(rpc(p.data))).rejects.toMatchObject({ code: 'REORG' });
    expect(submissionState().state).toBe('blocked');
  });
  it('clears a matching canonical finalized receipt after rechecking the actual intent', async () => {
    const p = await sent(); checked();
    await expect(reconcileSubmission(rpc(p.data))).resolves.toMatchObject({ state: 'resolved' });
    expect(submissionState().state).toBe('empty');
  });
  it.each(['mismatch', 'missing', 'confirming', 'reorg', 'finality'] as const)('retains the durable block for %s', async fault => {
    const p = await sent(); checked();
    try { await reconcileSubmission(rpc(p.data, fault)); } catch { /* Failure must preserve the marker. */ }
    expect(submissionState().state).toBe('blocked');
  });
  it('can resolve a finalized reverted transaction without treating it as collection success', async () => {
    const p = await sent();
    vi.mocked(recheckHistory).mockResolvedValue({ state: 'reverted', blockNumber: '16', blockHash });
    await expect(reconcileSubmission(rpc(p.data))).resolves.toMatchObject({
      state: 'resolved', verification: { state: 'reverted' },
    });
  });
  it('recovers an unknown submission with a matching wallet hash after refresh', async () => {
    const p = await sent();
    const state = submissionState();
    if (state.state !== 'blocked') throw new Error();
    const { hash: _savedHash, ...unknown } = state.submission;
    localStorage.setItem(SUBMISSION_KEY, JSON.stringify(unknown));
    checked();
    await expect(reconcileSubmission(rpc(p.data), hash)).resolves.toMatchObject({
      state: 'resolved', submission: { ...unknown, hash },
    });
    expect(submissionState().state).toBe('empty');
  });
  it.each([false, true])('retains the block for an unconfirmed candidate, transaction missing=%s', async missing => {
    const p = await sent();
    const state = submissionState();
    if (state.state !== 'blocked') throw new Error();
    const { hash: _savedHash, ...unknown } = state.submission;
    localStorage.setItem(SUBMISSION_KEY, JSON.stringify(unknown));
    vi.mocked(recheckHistory).mockResolvedValue({ state: 'pending' });
    await expect(reconcileSubmission(rpc(p.data, missing ? 'missing' : undefined), hash))
      .resolves.toEqual({ state: 'pending' });
    expect(submissionState()).toEqual({
      state: 'blocked', submission: missing ? unknown : { ...unknown, hash },
    });
  });
  it.each([
    { from: '0x2000000000000000000000000000000000000002' },
    { to: '0x2000000000000000000000000000000000000002' },
    { value: '0x1' },
    { input: '0x1234' },
  ])('rejects a candidate hash whose transaction differs by %j', async change => {
    const p = await sent();
    const state = submissionState();
    if (state.state !== 'blocked') throw new Error();
    const { hash: _savedHash, ...unknown } = state.submission;
    localStorage.setItem(SUBMISSION_KEY, JSON.stringify(unknown));
    const source = rpc(p.data);
    vi.spyOn(source, 'request').mockImplementation(async method => {
      if (method === 'eth_chainId') return '0xc4' as never;
      if (method === 'eth_getTransactionByHash') return {
        from: DEMO_OWNER, to: MANAGER, input: p.data, value: '0x0', ...change,
      } as never;
      throw new Error(`Unexpected ${method}`);
    });
    await expect(reconcileSubmission(source, hash)).rejects.toMatchObject({ code: 'SUBMISSION_MISMATCH' });
    expect(submissionState()).toEqual({ state: 'blocked', submission: unknown });
    expect(recheckHistory).not.toHaveBeenCalled();
  });
  it('rejects malformed recovery hashes before any RPC access', async () => {
    const p = await sent();
    const state = submissionState();
    if (state.state !== 'blocked') throw new Error();
    const { hash: _savedHash, ...unknown } = state.submission;
    localStorage.setItem(SUBMISSION_KEY, JSON.stringify(unknown));
    const source = rpc(p.data);
    const request = vi.spyOn(source, 'request');
    await expect(reconcileSubmission(source, '0x1234')).rejects.toMatchObject({ code: 'SUBMISSION_UNKNOWN' });
    expect(request).not.toHaveBeenCalled();
    expect(submissionState()).toEqual({ state: 'blocked', submission: unknown });
  });
});
