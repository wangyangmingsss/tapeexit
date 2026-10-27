// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SUBMISSION_KEY, reconcileSubmission } from '../src/core/submission';
vi.mock('../src/core/submission', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/submission')>(),
  reconcileSubmission: vi.fn(),
}));
vi.mock('../src/core/runtime', () => ({
  runtimeStatus: async () => ({ mode: 'local', label: 'Local application', verified: false }),
}));
let App: typeof import('../src/App').default;
const hash = `0x${'ab'.repeat(32)}`;
const entry = { schemaVersion: 1, id: '11111111-1111-1111-1111-111111111111',
  chainId: 196, account: '0x1000000000000000000000000000000000000001', tokenId: '12',
  inputHash: hash, hash, startedAt: '2026-10-27T12:00:00Z' };
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
it('blocks when the durable marker is unreadable', () => {
  localStorage.setItem(SUBMISSION_KEY, 'invalid');
  render(<App />);
  expect(screen.getByText('待处理记录无法读取，请检查当前浏览器的存储状态。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '核对待处理交易' }).hasAttribute('disabled')).toBe(true);
});
