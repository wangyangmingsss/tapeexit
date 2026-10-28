// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { recheckHistory, type HistoryVerification } from '../src/core/history';
import { loadHistory } from '../src/core/storage';
vi.mock('../src/core/history', () => ({ recheckHistory: vi.fn() }));
vi.mock('../src/core/runtime', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/runtime')>(),
  runtimeStatus: async () => ({ mode: 'local', label: 'Local application', verified: false }),
  manifestDigest: async () => { throw new Error('No manifest in DOM tests'); },
}));
let App: typeof import('../src/App').default;
beforeAll(async () => {
  vi.stubEnv('VITE_DEMO', 'true');
  App = (await import('../src/App')).default;
});
beforeEach(() => {
  localStorage.clear();
  vi.mocked(recheckHistory).mockReset();
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function readAndPreview() {
  const user = userEvent.setup();
  render(<App />);
  const read = screen.getByRole('button', { name: '读取仓位' });
  await waitFor(() => expect(read.hasAttribute('disabled')).toBe(false));
  await user.click(read);
  await screen.findByText('TEST-USDC / TEST-USDT');
  await user.click(screen.getByRole('button', { name: '预演退出' }));
  const review = await screen.findByRole('button', { name: '核对交易' }, { timeout: 3000 });
  expect(review.hasAttribute('disabled')).toBe(false);
  return user;
}
describe('isolated demo DOM interactions (not browser rendering evidence)', () => {
  const savedItem = { hash: `0x${'ab'.repeat(32)}`, tokenId: '12', time: '2026-10-26T12:00:00Z',
    environment: 'mainnet', state: 'received-checked' };
  it('rechecks saved history without trusting its previous success state', async () => {
    localStorage.setItem('tapeexit:history:v1', JSON.stringify([savedItem]));
    vi.mocked(recheckHistory).mockResolvedValue({ state: 'pending' });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '操作记录' }));
    expect(screen.getByText('已保存，尚未重新核对')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '重新核对交易' }));
    await screen.findByText('暂无收据，结果未确认');
    expect(loadHistory()[0].state).toBe('pending-recheck');
  });
  it('does not resurrect cleared history when a pending recheck finishes', async () => {
    localStorage.setItem('tapeexit:history:v1', JSON.stringify([savedItem]));
    let finish!: (value: HistoryVerification) => void;
    vi.mocked(recheckHistory).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '操作记录' }));
    await user.click(screen.getByRole('button', { name: '重新核对交易' }));
    await user.click(screen.getByRole('button', { name: '清除本地记录' }));
    finish({ state: 'pending' });
    await waitFor(() => expect(screen.queryByText('#12')).toBeNull());
    expect(localStorage.getItem('tapeexit:history:v1')).toBeNull();
  });
  it('revokes saved success when historical verification fails', async () => {
    localStorage.setItem('tapeexit:history:v1', JSON.stringify([savedItem]));
    vi.mocked(recheckHistory).mockRejectedValue(new Error('Historical state unavailable'));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '操作记录' }));
    await user.click(screen.getByRole('button', { name: '重新核对交易' }));
    await screen.findByText('复核失败，结果未确认');
    expect(loadHistory()[0].state).toBe('verification-pending');
    expect(screen.queryByText('received-checked')).toBeNull();
  });
  it('loads only valid public history fields and uint256 position hints', () => {
    localStorage.setItem('tapeexit:history:v1', JSON.stringify([
      { ...savedItem, calldata: '0x1234', recipient: 'evil' },
      { ...savedItem, state: 'invented' }, { ...savedItem, time: 'invalid' },
      { ...savedItem, tokenId: (2n ** 256n).toString() },
    ]));
    expect(loadHistory()).toEqual([savedItem]);
  });
  it('requires explicit review and persists only labelled history', async () => {
    const user = await readAndPreview();
    await user.click(screen.getByRole('button', { name: '核对交易' }));
    const confirm = screen.getByRole('button', { name: '确认模拟退出' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: /我已核对目标/ }));
    await user.click(confirm);
    await screen.findByText('领取证据已核对');
    expect(screen.getByText('模拟结果，不代表真实链上交易。')).toBeTruthy();
    const saved = JSON.parse(localStorage.getItem('tapeexit:history:v1')!);
    expect(saved[0]).toMatchObject({ environment: 'demo', state: 'received-checked', tokenId: '28491' });
    expect(JSON.stringify(saved)).not.toMatch(/calldata|privateKey|recipient/);
  });
  it('discards the previous preview when exit percentage changes', async () => {
    const user = await readAndPreview();
    await user.click(screen.getByRole('button', { name: '50%' }));
    expect(screen.queryByRole('button', { name: '核对交易' })).toBeNull();
    expect(screen.getByText('读取仓位后，查看退出预览')).toBeTruthy();
  });
  it('traps modal focus and returns focus after Escape', async () => {
    const user = await readAndPreview();
    const review = screen.getByRole('button', { name: '核对交易' });
    await user.click(review);
    const close = screen.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(review);
  });
  it('blocks conflicting reads and hostile recovery cards', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText('故障演练'), 'conflict');
    await waitFor(() => expect(screen.getByRole('button', { name: '读取仓位' }).hasAttribute('disabled')).toBe(false));
    await user.click(screen.getByRole('button', { name: '读取仓位' }));
    await screen.findByText('读取结果不一致，已停止生成交易。');
    expect(screen.queryByRole('button', { name: '预演退出' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '恢复入口' }));
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    await user.upload(input, new File(['{"app":"TapeExit","schemaVersion":1,"chainId":196,"calldata":"0x1234"}'], 'unsafe.json', { type: 'application/json' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('恢复卡格式或字段无效'));
  });
});
