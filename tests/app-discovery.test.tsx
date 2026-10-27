// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { discoverPositions, type PositionPage } from '../src/core/discovery';
const wallet = vi.hoisted(() => ({
  id: 'fixture', name: 'Fixture wallet', provider: { request: vi.fn() },
}));
vi.mock('../src/core/discovery', () => ({ discoverPositions: vi.fn() }));
vi.mock('../src/core/wallet', () => ({
  discoverWallets: (callback: (value: unknown) => void) => { callback(wallet); return () => {}; },
  connect: async () => '0x1000000000000000000000000000000000000001',
  observeWallet: () => () => {},
}));
vi.mock('../src/core/runtime', async original => ({
  ...await original<typeof import('../src/core/runtime')>(),
  runtimeStatus: async () => ({ mode: 'local', verified: false, label: 'Local' }),
}));
import App from '../src/App';
const page: PositionPage = { owner: '0x1000000000000000000000000000000000000001',
  block: { number: '0x10', hash: `0x${'12'.repeat(32)}`, timestamp: '0x1' },
  total: 12n, offset: 0n, next: 10n, tokenIds: [2n ** 200n] };
beforeEach(() => {
  localStorage.clear(); vi.mocked(discoverPositions).mockReset();
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function connected() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '连接钱包' }));
  await user.click(screen.getByRole('button', { name: 'Fixture wallet' }));
  await screen.findByRole('button', { name: '查找我的仓位' });
  return user;
}
it('selects exact IDs and paginates at the same block without triggering a transaction', async () => {
  vi.mocked(discoverPositions).mockResolvedValue(page);
  const user = await connected();
  await user.click(screen.getByRole('button', { name: '查找我的仓位' }));
  await user.selectOptions(await screen.findByLabelText('已发现的仓位'), page.tokenIds[0].toString());
  expect((screen.getByLabelText('仓位 Token ID') as HTMLInputElement).value).toBe(page.tokenIds[0].toString());
  await user.click(screen.getByRole('button', { name: '下一页' }));
  await waitFor(() => expect(discoverPositions).toHaveBeenCalledTimes(2));
  expect(vi.mocked(discoverPositions).mock.calls[1][2]).toMatchObject({ offset: 10n, block: page.block });
  expect(wallet.provider.request).not.toHaveBeenCalled();
});
it('drops late results after cancel while leaving manual ID input available', async () => {
  let finish!: (value: PositionPage) => void;
  vi.mocked(discoverPositions).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const user = await connected();
  await user.click(screen.getByRole('button', { name: '查找我的仓位' }));
  await user.click(screen.getByRole('button', { name: '取消查询' }));
  await act(async () => finish(page));
  expect(screen.queryByLabelText('已发现的仓位')).toBeNull();
  await user.type(screen.getByLabelText('仓位 Token ID'), '123');
  expect((screen.getByLabelText('仓位 Token ID') as HTMLInputElement).value).toBe('123');
});
