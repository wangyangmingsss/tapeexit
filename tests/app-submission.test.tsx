// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SUBMISSION_KEY, reconcileSubmission } from '../src/core/submission';
import { loadHistory } from '../src/core/storage';
import { V3Adapter } from '../src/core/protocol';
import { demoSnapshot } from '../src/demo/engine';
vi.mock('../src/core/submission', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/submission')>(),
  reconcileSubmission: vi.fn(),
}));
vi.mock('../src/core/runtime', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/runtime')>(),
  runtimeStatus: async () => ({ mode: 'local', label: 'Local application', verified: false }),
}));
let App: typeof import('../src/App').default;
const hash = `0x${'ab'.repeat(32)}` as const;
const entry = { schemaVersion: 1, id: '11111111-1111-1111-1111-111111111111',
  chainId: 196, account: '0x1000000000000000000000000000000000000001', tokenId: '12',
  inputHash: hash, hash, startedAt: '2026-10-27T12:00:00Z' } as const;
beforeAll(async () => { vi.stubEnv('VITE_DEMO', 'false'); App = (await import('../src/App')).default; });
beforeEach(() => {
  localStorage.clear();
  vi.mocked(reconcileSubmission).mockReset();
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('restores pending state on mount and clearing activity does not clear the send block', async () => {
  localStorage.setItem(SUBMISSION_KEY, JSON.stringify(entry));
  const user = userEvent.setup();
  render(<App />);
  expect(screen.getByText('存在未解决的提交，已锁定发送')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '操作记录' }));
  await user.click(screen.getByRole('button', { name: '清除本地记录' }));
  expect(localStorage.getItem(SUBMISSION_KEY)).not.toBeNull();
  expect(screen.getByText('存在未解决的提交，已锁定发送')).toBeTruthy();
});
it('keeps unknown submissions visibly blocked without offering an automatic reset', () => {
  const { hash: _hash, ...unknown } = entry;
  localStorage.setItem(SUBMISSION_KEY, JSON.stringify(unknown));
  render(<App />);
  expect(screen.getByText('未保存交易哈希，请先检查钱包交易记录；不会自动解除锁定。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '核对待处理交易' }).hasAttribute('disabled')).toBe(true);
});
it('updates pending recovery when another tab changes the durable marker', async () => {
  const user = userEvent.setup();
  render(<App />);
  localStorage.setItem(SUBMISSION_KEY, JSON.stringify(entry));
  window.dispatchEvent(new StorageEvent('storage', { key: SUBMISSION_KEY }));
  await screen.findByText('存在未解决的提交，已锁定发送');
  vi.mocked(reconcileSubmission).mockResolvedValue({ state: 'confirming' });
  await user.click(screen.getByRole('button', { name: '核对待处理交易' }));
  await screen.findByText('交易已纳入区块，等待最终确认。');
  expect(localStorage.getItem(SUBMISSION_KEY)).not.toBeNull();
});
it('accepts a well-formed wallet hash for an unknown submission without clearing the block on failure', async () => {
  const { hash: _hash, ...unknown } = entry;
  localStorage.setItem(SUBMISSION_KEY, JSON.stringify(unknown));
  vi.mocked(reconcileSubmission).mockRejectedValue(new Error('Actual transaction does not match the pending intent'));
  const user = userEvent.setup();
  render(<App />);
  const input = screen.getByLabelText('钱包交易哈希');
  const check = screen.getByRole('button', { name: '核对待处理交易' });
  await user.type(input, '0x1234');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(check.hasAttribute('disabled')).toBe(true);
  expect(reconcileSubmission).not.toHaveBeenCalled();
  await user.clear(input);
  await user.type(input, hash);
  expect(check.hasAttribute('disabled')).toBe(false);
  await user.click(check);
  await screen.findByRole('alert');
  expect(reconcileSubmission).toHaveBeenCalledWith(expect.anything(), hash);
  expect(JSON.parse(localStorage.getItem(SUBMISSION_KEY)!)).toEqual(unknown);
  expect(screen.getByText('存在未解决的提交，已锁定发送')).toBeTruthy();
});
it('does not reuse a candidate hash when another tab replaces the pending intent', async () => {
  const { hash: _hash, ...unknown } = entry;
  localStorage.setItem(SUBMISSION_KEY, JSON.stringify(unknown));
  const user = userEvent.setup();
  render(<App />);
  await user.type(screen.getByLabelText('钱包交易哈希'), hash);
  localStorage.setItem(SUBMISSION_KEY, JSON.stringify({ ...unknown, id: '22222222-2222-2222-2222-222222222222' }));
  window.dispatchEvent(new StorageEvent('storage', { key: SUBMISSION_KEY }));
  await vi.waitFor(() => expect((screen.getByLabelText('钱包交易哈希') as HTMLInputElement).value).toBe(''));
  expect(screen.getByRole('button', { name: '核对待处理交易' }).hasAttribute('disabled')).toBe(true);
  expect(reconcileSubmission).not.toHaveBeenCalled();
});
it('saves the verified outcome when a manually supplied wallet hash resolves an unknown intent', async () => {
  const { hash: _hash, ...unknown } = entry;
  localStorage.setItem(SUBMISSION_KEY, JSON.stringify(unknown));
  vi.mocked(reconcileSubmission).mockImplementation(async () => {
    localStorage.removeItem(SUBMISSION_KEY);
    return { state: 'resolved', submission: entry, verification: {
      state: 'reverted', blockNumber: '16', blockHash: hash,
    } };
  });
  const user = userEvent.setup();
  render(<App />);
  await user.type(screen.getByLabelText('钱包交易哈希'), hash);
  await user.click(screen.getByRole('button', { name: '核对待处理交易' }));
  await screen.findByText(/交易已回滚并最终确认/);
  expect(reconcileSubmission).toHaveBeenCalledWith(expect.anything(), hash);
  expect(screen.queryByLabelText('钱包交易哈希')).toBeNull();
  expect(loadHistory()[0]).toMatchObject({ hash, tokenId: '12', state: 'reverted' });
});
it('blocks when the durable marker is unreadable', () => {
  localStorage.setItem(SUBMISSION_KEY, 'invalid');
  render(<App />);
  expect(screen.getByText('待处理记录无法读取，请检查当前浏览器的存储状态。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '核对待处理交易' }).hasAttribute('disabled')).toBe(true);
});
it.each(['received-checked', 'included-unverified', 'reverted'] as const)(
  'saves finalized recovery as %s without showing stale position results', async state => {
    const snapshot = await demoSnapshot(33n, 'none');
    vi.spyOn(V3Adapter.prototype, 'snapshot').mockResolvedValue(snapshot);
    localStorage.setItem(SUBMISSION_KEY, JSON.stringify(entry));
    const verification = state === 'reverted' ? { state: 'reverted' as const, blockNumber: '16', blockHash: hash } :
      { state: 'checked' as const, result: { hash, blockHash: hash, blockNumber: '16', amount0: '1', amount1: '2',
        state, finalized: true, safe: true } };
    vi.mocked(reconcileSubmission).mockImplementation(async () => {
      localStorage.removeItem(SUBMISSION_KEY);
      return { state: 'resolved', submission: entry, verification };
    });
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('仓位 Token ID'), '33');
    await user.click(screen.getByRole('button', { name: '读取仓位' }));
    await screen.findByText('TEST-USDC / TEST-USDT');
    await user.click(screen.getByRole('button', { name: '核对待处理交易' }));
    await screen.findByText(/已解除待处理锁定/);
    expect(screen.queryByText('TEST-USDC / TEST-USDT')).toBeNull();
    expect(screen.queryByText('领取证据已核对')).toBeNull();
    expect(loadHistory()[0]).toMatchObject({ tokenId: '12', hash, state, time: entry.startedAt });
    expect(screen.queryByText('存在未解决的提交，已锁定发送')).toBeNull();
    expect(reconcileSubmission).toHaveBeenCalledWith(expect.anything(), undefined);
    if (state === 'included-unverified') expect(screen.getByText(/领取证据仍待核对/)).toBeTruthy();
    if (state === 'reverted') expect(screen.getByText(/交易已回滚并最终确认/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '操作记录' }));
    expect(screen.queryByText('已保存，尚未重新核对')).toBeNull();
  });
it('rejects stale post-recovery snapshots repeatedly and accepts a sufficiently recent block', async () => {
  const snapshot = await demoSnapshot(33n, 'none');
  const read = vi.spyOn(V3Adapter.prototype, 'snapshot').mockResolvedValue({
    ...snapshot, block: { ...snapshot.block, number: '0xf' },
  });
  localStorage.setItem(SUBMISSION_KEY, JSON.stringify(entry));
  vi.mocked(reconcileSubmission).mockImplementation(async () => {
    localStorage.removeItem(SUBMISSION_KEY);
    return { state: 'resolved', submission: entry, verification: {
      state: 'reverted', blockNumber: '16', blockHash: hash,
    } };
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '核对待处理交易' }));
  await screen.findByText(/已解除待处理锁定/);
  await user.type(screen.getByLabelText('仓位 Token ID'), '33');
  for (let attempt = 0; attempt < 2; attempt++) {
    await user.click(screen.getByRole('button', { name: '读取仓位' }));
    await screen.findByText('快照或预览已过期，请重新读取。');
    expect(screen.queryByText('TEST-USDC / TEST-USDT')).toBeNull();
  }
  read.mockResolvedValue({ ...snapshot, block: { ...snapshot.block, number: '0x10' } });
  await user.click(screen.getByRole('button', { name: '读取仓位' }));
  await screen.findByText('TEST-USDC / TEST-USDT');
});
