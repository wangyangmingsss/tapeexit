// @vitest-environment happy-dom
// Production UI with a test-only release gate and mocked providers; no transaction is broadcast.
import React from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { V3Adapter, type Plan } from '../src/core/protocol';
import { ExitError } from '../src/core/rpc';
import { inspectReceipt, pendingState } from '../src/core/receipt';
import { reconcileSubmission, sendGuarded, SUBMISSION_KEY } from '../src/core/submission';
import { loadHistory } from '../src/core/storage';
import { DEMO_OWNER, demoSnapshot } from '../src/demo/engine';
import { runtimeStatus, type RuntimeStatus } from '../src/core/runtime';
import { inspectRecoveryOutcome } from '../src/core/recovery-outcome';
vi.mock('../src/core/recovery-outcome', () => ({ inspectRecoveryOutcome: vi.fn() }));
vi.mock('../src/config', async importOriginal => ({
  ...await importOriginal<typeof import('../src/config')>(), RELEASE_APPROVED: true,
}));
vi.mock('../src/core/wallet', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/wallet')>(),
  discoverWallets: (onWallet: (wallet: unknown) => void) => {
    onWallet({ id: 'test', name: 'Test wallet', provider: { request: async () => null } });
    return () => {};
  },
  connect: async () => '0x1000000000000000000000000000000000000001',
  assertWallet: async () => {},
}));
vi.mock('../src/core/runtime', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/runtime')>(),
  runtimeStatus: vi.fn(),
}));
vi.mock('../src/core/receipt', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/receipt')>(), inspectReceipt: vi.fn(), pendingState: vi.fn(),
}));
vi.mock('../src/core/submission', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/submission')>(),
  sendGuarded: vi.fn(), reconcileSubmission: vi.fn(),
}));
let App: typeof import('../src/App').default;
const hash = `0x${'ab'.repeat(32)}` as const;
const blockHash = `0x${'cd'.repeat(32)}` as const;
const submission = { schemaVersion: 1, id: '11111111-1111-1111-1111-111111111111',
  chainId: 196, account: DEMO_OWNER, tokenId: '12', inputHash: hash, hash, startedAt: '2026-10-27T12:00:00Z' } as const;
const result = { hash, blockHash, blockNumber: '16', amount0: '100', amount1: '200',
  state: 'received-checked', safe: true, finalized: true } as const;
beforeAll(async () => { vi.stubEnv('VITE_DEMO', 'false'); App = (await import('../src/App')).default; });
beforeEach(async () => {
  localStorage.clear();
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
  vi.mocked(runtimeStatus).mockReset().mockResolvedValue({ mode: 'local', label: 'Test local runtime', verified: false });
  vi.mocked(inspectReceipt).mockReset().mockResolvedValue(result);
  vi.mocked(pendingState).mockReset().mockResolvedValue({ state: 'pending', nonce: 3n });
  vi.mocked(reconcileSubmission).mockReset();
  vi.mocked(sendGuarded).mockReset().mockImplementation(async () => {
    localStorage.setItem(SUBMISSION_KEY, JSON.stringify(submission));
    return hash;
  });
  vi.mocked(inspectRecoveryOutcome).mockReset();
  const snapshot = await demoSnapshot(12n, 'none');
  vi.spyOn(V3Adapter.prototype, 'snapshot').mockImplementation(async tokenId => ({ ...snapshot, tokenId }));
  vi.spyOn(V3Adapter.prototype, 'simulate').mockImplementation(async (plan: Plan) => ({
    amount0: plan.amount0Min + 1n, amount1: plan.amount1Min + 1n, gas: 100000n, gasPrice: 1n,
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function confirm() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '连接钱包' }));
  await user.click(screen.getByRole('button', { name: 'Test wallet' }));
  await user.type(screen.getByLabelText('仓位 Token ID'), '12');
  await user.click(screen.getByRole('button', { name: '读取仓位' }));
  await screen.findByText('TEST-USDC / TEST-USDT');
  await user.click(screen.getByRole('button', { name: '预演退出' }));
  await user.click(await screen.findByRole('button', { name: '核对交易' }));
  await user.click(screen.getByRole('checkbox', { name: /我已核对目标/ }));
  await user.click(screen.getByRole('button', { name: '在钱包中确认' }));
  return user;
}
it('shows progress and state corroboration without making another wallet request', async () => {
  vi.mocked(reconcileSubmission).mockImplementation(async () => {
    localStorage.removeItem(SUBMISSION_KEY);
    return { state: 'resolved', submission, verification: { state: 'checked', result } };
  });
  let finish!: (value: any) => void;
  vi.mocked(inspectRecoveryOutcome).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const user = await confirm();
  await screen.findByText('领取证据已核对');
  await user.click(screen.getByRole('button', { name: '核对余额与流动性' }));
  const pending = await screen.findByRole('button', { name: '正在核对余额与流动性…' });
  expect(pending.hasAttribute('disabled')).toBe(true);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await act(async () => finish({ state: 'block-state-matched', hash, receipt: result,
    liquidity: { after: '42' }, balances: [] }));
  await screen.findByText('区块状态与收据一致');
  await screen.findByText('剩余流动性: 42');
  expect(sendGuarded).toHaveBeenCalledTimes(1);
});
it('does not restore a late state report after switching positions', async () => {
  vi.mocked(reconcileSubmission).mockImplementation(async () => {
    localStorage.removeItem(SUBMISSION_KEY);
    return { state: 'resolved', submission, verification: { state: 'checked', result } };
  });
  let finish!: (value: any) => void;
  vi.mocked(inspectRecoveryOutcome).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const user = await confirm();
  await user.click(await screen.findByRole('button', { name: '核对余额与流动性' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await user.clear(screen.getByLabelText('仓位 Token ID'));
  await user.type(screen.getByLabelText('仓位 Token ID'), '33');
  await user.click(screen.getByRole('button', { name: '读取仓位' }));
  await act(async () => finish({ state: 'block-state-matched', hash, receipt: result,
    liquidity: { after: '42' }, balances: [] }));
  expect(screen.queryByText('区块状态与收据一致')).toBeNull();
});
it('retains receipt and send state when historical balance queries fail', async () => {
  vi.mocked(reconcileSubmission).mockImplementation(async () => {
    localStorage.removeItem(SUBMISSION_KEY);
    return { state: 'resolved', submission, verification: { state: 'checked', result } };
  });
  vi.mocked(inspectRecoveryOutcome).mockRejectedValue(new Error('Historical state unavailable'));
  const user = await confirm();
  await user.click(await screen.findByRole('button', { name: '核对余额与流动性' }));
  await screen.findByText('Historical state unavailable');
  expect(screen.getByText('领取证据已核对')).toBeTruthy();
  expect(sendGuarded).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '核对余额与流动性' }).hasAttribute('disabled')).toBe(false);
});
it('revokes an initial success immediately if finalization recheck detects a reorg', async () => {
  vi.mocked(reconcileSubmission).mockRejectedValue(new ExitError('REORG', 'Receipt changed during finality check'));
  await confirm();
  await screen.findByText('Receipt changed during finality check');
  expect(screen.queryByText('领取证据已核对')).toBeNull();
  expect(loadHistory()[0].state).toBe('verification-pending');
  expect(screen.getByRole('button', { name: '读取仓位' }).hasAttribute('disabled')).toBe(true);
  expect(sendGuarded).toHaveBeenCalledTimes(1);
});
it('replaces an initial success with the final reverted outcome', async () => {
  vi.mocked(reconcileSubmission).mockImplementation(async () => {
    localStorage.removeItem(SUBMISSION_KEY);
    return { state: 'resolved', submission, verification: { state: 'reverted', blockNumber: '16', blockHash } };
  });
  await confirm();
  await screen.findByText('Transaction reverted');
  expect(screen.queryByText('领取证据已核对')).toBeNull();
  expect(loadHistory()[0].state).toBe('reverted');
  expect(sendGuarded).toHaveBeenCalledTimes(1);
});
it('keeps success withdrawn if the second check can only establish pending state', async () => {
  vi.mocked(reconcileSubmission).mockResolvedValue({ state: 'pending' });
  await confirm();
  await screen.findByText('交易已提交');
  expect(screen.queryByText('领取证据已核对')).toBeNull();
  expect(loadHistory()[0].state).toBe('verification-pending');
});
it.each(['RPC_INVALID', 'TRANSACTION_MISMATCH', 'REORG'])(
  'preserves the durable intent and send lock on pending evidence failure %s', async code => {
    vi.mocked(inspectReceipt).mockResolvedValue(null);
    vi.mocked(pendingState).mockRejectedValue(new ExitError(code, 'Pending evidence rejected'));
    await confirm();
    await screen.findByRole('alert');
    expect(screen.queryByText('领取证据已核对')).toBeNull();
    expect(screen.getByRole('button', { name: '读取仓位' }).hasAttribute('disabled')).toBe(true);
    expect(JSON.parse(localStorage.getItem(SUBMISSION_KEY)!)).toEqual(submission);
    expect(sendGuarded).toHaveBeenCalledTimes(1);
    expect(reconcileSubmission).not.toHaveBeenCalled();
  });
it('keeps a transaction with a lagging receipt pending without suggesting a replacement', async () => {
  vi.mocked(inspectReceipt).mockResolvedValue(null);
  await confirm();
  await waitFor(() => expect(pendingState).toHaveBeenCalledTimes(1));
  await screen.findByText('交易已提交');
  expect(screen.queryByText(/原交易的 nonce 已被消耗/)).toBeNull();
  expect(screen.getByRole('button', { name: '读取仓位' }).hasAttribute('disabled')).toBe(true);
  expect(JSON.parse(localStorage.getItem(SUBMISSION_KEY)!)).toEqual(submission);
  expect(sendGuarded).toHaveBeenCalledTimes(1);
});
it('keeps the durable send lock when the original is absent and its nonce is consumed', async () => {
  vi.mocked(inspectReceipt).mockResolvedValue(null);
  vi.mocked(pendingState).mockResolvedValue({ state: 'replaced-or-dropped', nonce: 3n });
  await confirm();
  await screen.findByText(/原交易的 nonce 已被消耗/);
  expect(screen.getByRole('button', { name: '读取仓位' }).hasAttribute('disabled')).toBe(true);
  expect(JSON.parse(localStorage.getItem(SUBMISSION_KEY)!)).toEqual(submission);
  expect(sendGuarded).toHaveBeenCalledTimes(1);
  expect(reconcileSubmission).not.toHaveBeenCalled();
});
it('shows the latest collection evidence instead of the earlier success if final recheck differs', async () => {
  vi.mocked(reconcileSubmission).mockImplementation(async () => {
    localStorage.removeItem(SUBMISSION_KEY);
    return { state: 'resolved', submission, verification: {
      state: 'checked', result: { ...result, state: 'included-unverified' },
    } };
  });
  await confirm();
  await screen.findByText('交易已执行，领取证据待核对');
  expect(screen.queryByText('领取证据已核对')).toBeNull();
  expect(loadHistory()[0].state).toBe('included-unverified');
});
it('does not restore an old result if a finality response arrives after another position was read', async () => {
  let finish!: (value: Awaited<ReturnType<typeof reconcileSubmission>>) => void;
  vi.mocked(reconcileSubmission).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const user = await confirm();
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  const input = screen.getByLabelText('仓位 Token ID');
  await user.clear(input); await user.type(input, '33');
  await user.click(screen.getByRole('button', { name: '读取仓位' }));
  await screen.findByText(/#33/);
  await act(async () => {
    finish({ state: 'resolved', submission, verification: { state: 'checked', result } });
  });
  expect(screen.queryByText('领取证据已核对')).toBeNull();
  expect(screen.getByText(/#33/)).toBeTruthy();
});
it.each([
  { mode: 'tape-client', verified: false },
  { mode: 'tape-server', verified: true },
  { mode: 'web', verified: false },
] as const)('does not send from an unapproved entry %j', async entry => {
  vi.mocked(runtimeStatus).mockResolvedValue({ ...entry, label: 'Unapproved entry' });
  await confirm();
  await screen.findByRole('alert');
  expect(sendGuarded).not.toHaveBeenCalled();
  expect(localStorage.getItem(SUBMISSION_KEY)).toBeNull();
});
it('invalidates the workspace at the last wallet boundary when the controller changes', async () => {
  const worker = Object.assign(new EventTarget(), { controller: {} });
  vi.stubGlobal('navigator', Object.create(navigator, { serviceWorker: { value: worker } }));
  vi.mocked(sendGuarded).mockImplementation(async (_provider, _plan, _gas, beforeRequest) => {
    worker.controller = {};
    worker.dispatchEvent(new Event('controllerchange'));
    beforeRequest?.();
    throw new Error('The stale workspace must stop before this point');
  });
  await confirm();
  await screen.findByText('快照或预览已过期，请重新读取。');
  expect(localStorage.getItem(SUBMISSION_KEY)).toBeNull();
  expect(inspectReceipt).not.toHaveBeenCalled();
});
it('does not restore an old runtime result after a controller refresh', async () => {
  const worker = Object.assign(new EventTarget(), { controller: {} });
  vi.stubGlobal('navigator', Object.create(navigator, { serviceWorker: { value: worker } }));
  let finish!: (entry: RuntimeStatus) => void;
  vi.mocked(runtimeStatus).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ mode: 'tape-server', label: 'Latest server entry', verified: false });
  render(<App />);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await act(async () => { worker.controller = {}; worker.dispatchEvent(new Event('controllerchange')); });
  await screen.findByText('Latest server entry');
  await act(async () => { finish({ mode: 'local', label: 'Outdated local entry', verified: false }); });
  expect(screen.queryByText('Outdated local entry')).toBeNull();
  expect(screen.getByText('Latest server entry')).toBeTruthy();
});
it.each([
  { mode: 'tape-client', verified: false, container: '0x1000000000000000000000000000000000000001' },
  { mode: 'tape-server', verified: false, container: '0x1000000000000000000000000000000000000001' },
  { mode: 'tape-client', verified: true, container: '0x2000000000000000000000000000000000000002' },
] as const)('stops before sending when preflight entry changes to %j', async change => {
  const initial: RuntimeStatus = { mode: 'tape-client', label: '1.2.0.tape', name: '1.2.0.tape',
    container: '0x1000000000000000000000000000000000000001', verified: true };
  vi.mocked(runtimeStatus).mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, ...change });
  await confirm();
  await screen.findByText('入口已变化或未通过验证，请重新读取和核对。');
  expect(sendGuarded).not.toHaveBeenCalled();
  expect(localStorage.getItem(SUBMISSION_KEY)).toBeNull();
});
