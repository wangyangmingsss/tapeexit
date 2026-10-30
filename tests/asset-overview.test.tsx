// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssetOverview from '../src/AssetOverview';
import { readPortfolio, type PortfolioPage } from '../src/core/portfolio';
import type { V3Adapter } from '../src/core/adapter';
import type { Snapshot } from '../src/core/protocol';
vi.mock('../src/core/portfolio', () => ({ readPortfolio: vi.fn() }));
const owner = '0x1000000000000000000000000000000000000001';
const adapter = {} as V3Adapter;
const snapshot: Snapshot = { tokenId: 2n ** 200n, owner, pool: owner,
  token0: { address: owner, symbol: 'USDt0', decimals: 6, verified: false },
  token1: { address: owner, symbol: 'USDC', decimals: 6, verified: false },
  liquidity: 8n, tick: 0, tickLower: -10, tickUpper: 10, fee: 500, sqrtPriceX96: 2n ** 96n,
  poolLiquidity: 80n, owed0: 0n, owed1: 0n,
  block: { number: '0x10', hash: `0x${'12'.repeat(32)}`, timestamp: '0x1' } };
const page: PortfolioPage = { owner, block: { number: '0x10', hash: `0x${'12'.repeat(32)}`, timestamp: '0x1' },
  total: 8n, offset: 0n, next: 5n, tokenIds: [snapshot.tokenId], entries: [{ tokenId: snapshot.tokenId, state: 'ready', snapshot }] };
const props = { account: owner, adapter, simulated: false, fault: 'none', lang: 'zh',
  locked: false, onSelect: vi.fn(), onConnect: vi.fn() } as const;
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('distinguishes failure from an empty account and allows manual input', async () => {
  vi.mocked(readPortfolio).mockRejectedValue(new Error('RPC down'));
  const user = userEvent.setup();
  render(<AssetOverview {...props} />);
  await screen.findByRole('alert');
  expect(screen.queryByText(/未发现直接持有/)).toBeNull();
  await user.click(screen.getByRole('button', { name: '输入仓位编号' }));
  expect(props.onSelect).toHaveBeenCalledWith('');
});
it('opens exact large IDs, labels unsupported protocols, and pins next page', async () => {
  vi.mocked(readPortfolio).mockResolvedValue(page);
  const user = userEvent.setup();
  render(<AssetOverview {...props} />);
  await screen.findByText('USDt0 / USDC');
  expect(screen.getAllByText('规划中')).toHaveLength(3);
  await user.click(screen.getByRole('button', { name: `打开仓位 ${snapshot.tokenId}` }));
  expect(props.onSelect).toHaveBeenCalledWith(snapshot.tokenId.toString());
  await user.click(screen.getByRole('button', { name: '下一页资产' }));
  await waitFor(() => expect(readPortfolio).toHaveBeenCalledTimes(2));
  expect(vi.mocked(readPortfolio).mock.calls[1][2]).toMatchObject({ offset: 5n, block: page.block });
});
it('discards cancelled responses and late results from a different wallet', async () => {
  const finishes: ((result: PortfolioPage) => void)[] = [];
  vi.mocked(readPortfolio).mockImplementation(() => new Promise(resolve => finishes.push(resolve)));
  const user = userEvent.setup();
  const view = render(<AssetOverview {...props} />);
  await user.click(screen.getByRole('button', { name: '取消扫描' }));
  await act(async () => finishes[0](page));
  expect(screen.queryByText('USDt0 / USDC')).toBeNull();
  await user.click(screen.getByRole('button', { name: '刷新资产' }));
  view.rerender(<AssetOverview {...props} account="0x2000000000000000000000000000000000000002" />);
  await act(async () => finishes[1](page));
  expect(screen.queryByText('USDt0 / USDC')).toBeNull();
});
it('never enables position selection while a submission is locked', async () => {
  vi.mocked(readPortfolio).mockResolvedValue(page);
  render(<AssetOverview {...props} locked />);
  expect((await screen.findByRole('button', { name: `打开仓位 ${snapshot.tokenId}` })).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: '输入仓位编号' }).hasAttribute('disabled')).toBe(true);
});
