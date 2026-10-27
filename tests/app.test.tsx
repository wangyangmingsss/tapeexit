// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../src/core/runtime', () => ({
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
  await waitFor(() => expect(screen.getByRole('button', { name: '核对交易' }).hasAttribute('disabled')).toBe(false));
  return user;
}
describe('isolated demo DOM interactions (not browser rendering evidence)', () => {
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
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('invalid or unsafe'));
  });
});
