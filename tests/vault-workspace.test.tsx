// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VaultWorkspace from '../src/VaultWorkspace';
import { SparkVaultAdapter, type VaultSnapshot } from '../src/core/vault-adapter';
import { SPARK_USDC } from '../src/core/vault-config';
import { importVaultRecovery, inspectVaultRecovery, loadVaultRecovery, saveVaultRecovery, vaultRecoveryTask } from '../src/core/vault-recovery';
import { VAULT_HASH, VAULT_OTHER, VAULT_OWNER, vaultBlock } from './vault-fixture';

vi.mock('../src/core/vault-recovery', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/vault-recovery')>(), inspectVaultRecovery: vi.fn(),
}));
const snapshot: VaultSnapshot = { protocolId: 'spark-spusdc', vault: SPARK_USDC.vault,
  asset: SPARK_USDC.asset, owner: VAULT_OWNER, shares: 1_000000n, assets: 1_020000n,
  maxRedeem: 1_000000n, maxWithdraw: 1_020000n, totalAssets: 10_000000n,
  liquidAssets: 5_000000n, decimals: 6, block: vaultBlock() };
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(SparkVaultAdapter.prototype, 'snapshot').mockResolvedValue(snapshot);
  vi.spyOn(SparkVaultAdapter.prototype, 'simulate').mockResolvedValue({
    assets: 255000n, shares: 250000n, remainingShares: 750000n, gas: 120000n, gasPrice: 1n, block: snapshot.block,
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
it('reads a public address and previews shares without a wallet signing control', async () => {
  const user = userEvent.setup();
  render(<VaultWorkspace account={VAULT_OWNER} lang="zh" />);
  await user.click(screen.getByRole('button', { name: '读取金库份额' }));
  await screen.findAllByText('1.02 USDC');
  await user.click(screen.getByRole('button', { name: '25%' }));
  await user.click(screen.getByRole('button', { name: '预演金库赎回' }));
  await screen.findByText('0.255 USDC');
  expect(SparkVaultAdapter.prototype.simulate).toHaveBeenCalledWith(expect.objectContaining({
    owner: VAULT_OWNER, receiver: VAULT_OWNER, shares: 250000n,
  }));
  expect(screen.queryByRole('button', { name: /在钱包中确认/ })).toBeNull();
});
it('displays a successful zero balance without pretending an RPC failure is empty', async () => {
  vi.mocked(SparkVaultAdapter.prototype.snapshot).mockResolvedValue({ ...snapshot, shares: 0n, assets: 0n, maxRedeem: 0n, maxWithdraw: 0n });
  const user = userEvent.setup();
  render(<VaultWorkspace account={VAULT_OWNER} lang="zh" />);
  await user.click(screen.getByRole('button', { name: '读取金库份额' }));
  await screen.findByText('查询完成：该地址未持有 spUSDC 份额。');
  expect(screen.getByRole('button', { name: '预演金库赎回' }).hasAttribute('disabled')).toBe(true);
  vi.mocked(SparkVaultAdapter.prototype.snapshot).mockRejectedValue(new Error('RPC unavailable'));
  await user.click(screen.getByRole('button', { name: '读取金库份额' }));
  await screen.findByText('本次查询未完成：RPC unavailable');
  expect(screen.queryByText(/查询完成：该地址未持有/)).toBeNull();
});
it('prevents preview when liquidity limits are below the selected share amount', async () => {
  vi.mocked(SparkVaultAdapter.prototype.snapshot).mockResolvedValue({ ...snapshot, maxRedeem: 250000n });
  const user = userEvent.setup();
  render(<VaultWorkspace account={VAULT_OWNER} lang="zh" />);
  await user.click(screen.getByRole('button', { name: '读取金库份额' }));
  const button = await screen.findByRole('button', { name: '预演金库赎回' });
  expect(button.hasAttribute('disabled')).toBe(true);
  await user.click(screen.getByRole('button', { name: '25%' }));
  expect(button.hasAttribute('disabled')).toBe(false);
});
it('discards cancelled and previous-account read responses', async () => {
  let resolve!: (value: VaultSnapshot) => void;
  vi.mocked(SparkVaultAdapter.prototype.snapshot).mockImplementation(() => new Promise(done => { resolve = done; }));
  const user = userEvent.setup();
  const view = render(<VaultWorkspace account={VAULT_OWNER} lang="zh" />);
  await user.click(screen.getByRole('button', { name: '读取金库份额' }));
  await user.click(screen.getByRole('button', { name: '取消金库查询' }));
  await act(async () => resolve(snapshot));
  expect(screen.queryByText('1.02 USDC')).toBeNull();
  await user.click(screen.getByRole('button', { name: '读取金库份额' }));
  view.rerender(<VaultWorkspace account={VAULT_OTHER} lang="zh" />);
  await act(async () => resolve(snapshot));
  expect(screen.queryByText('1.02 USDC')).toBeNull();
  expect((screen.getByLabelText('持有人公开地址') as HTMLInputElement).value).toBe(VAULT_OTHER);
});
it('restores public recovery hints and rechecks instead of restoring claimed success', async () => {
  const task = vaultRecoveryTask(VAULT_OWNER, VAULT_HASH);
  expect(saveVaultRecovery(task)).toBe(true);
  expect(loadVaultRecovery()).toEqual(task);
  vi.mocked(inspectVaultRecovery).mockResolvedValue({ state: 'pending' });
  const user = userEvent.setup();
  render(<VaultWorkspace lang="zh" />);
  expect((screen.getByLabelText('金库赎回交易哈希') as HTMLInputElement).value).toBe(VAULT_HASH);
  await user.click(screen.getByRole('button', { name: '核验金库赎回' }));
  await screen.findByText('交易尚未确认，请保留哈希稍后核验。');
  expect(inspectVaultRecovery).toHaveBeenCalledWith(expect.anything(), task);
  expect(importVaultRecovery(localStorage.getItem('tapeexit:spark-vault:recovery:v1')!)).toEqual(task);
});
