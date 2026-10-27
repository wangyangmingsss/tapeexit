// @vitest-environment happy-dom
// Production UI with a test-only release gate and mocked providers; no transaction is broadcast.
import React from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { V3Adapter, type Plan } from '../src/core/protocol';
import { ExitError } from '../src/core/rpc';
import { inspectReceipt } from '../src/core/receipt';
import { reconcileSubmission, sendGuarded, SUBMISSION_KEY } from '../src/core/submission';
import { loadHistory } from '../src/core/storage';
import { DEMO_OWNER, demoSnapshot } from '../src/demo/engine';
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
vi.mock('../src/core/runtime', () => ({
  runtimeStatus: async () => ({ mode: 'local', label: 'Test local runtime', verified: false }),
}));
vi.mock('../src/core/receipt', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/receipt')>(), inspectReceipt: vi.fn(),
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
  vi.mocked(inspectReceipt).mockReset().mockResolvedValue(result);
  vi.mocked(reconcileSubmission).mockReset();
  vi.mocked(sendGuarded).mockReset().mockImplementation(async () => {
    localStorage.setItem(SUBMISSION_KEY, JSON.stringify(submission));
    return hash;
  });
  const snapshot = await demoSnapshot(12n, 'none');
  vi.spyOn(V3Adapter.prototype, 'snapshot').mockImplementation(async tokenId => ({ ...snapshot, tokenId }));
  vi.spyOn(V3Adapter.prototype, 'simulate').mockImplementation(async (plan: Plan) => ({
    amount0: plan.amount0Min + 1n, amount1: plan.amount1Min + 1n, gas: 100000n, gasPrice: 1n,
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
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
