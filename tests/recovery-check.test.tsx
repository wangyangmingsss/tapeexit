// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import RecoveryCheck from '../src/RecoveryCheck';
import { inspectRecoveryOutcome } from '../src/core/recovery-outcome';
import task from '../docs/gateway-recovery-task-67042.json';

vi.mock('../src/core/recovery-outcome', () => ({ inspectRecoveryOutcome: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });
function fill() {
  fireEvent.change(screen.getByLabelText('恢复仓位编号'), { target: { value: task.tokenId } });
  fireEvent.change(screen.getByLabelText('原钱包公开地址'), { target: { value: task.account } });
  fireEvent.change(screen.getByLabelText('已有交易完整哈希'), { target: { value: task.hash } });
  fireEvent.click(screen.getByRole('button', { name: '核验已有交易' }));
}
const outcome = () => ({ state: 'block-state-matched', hash: task.hash,
  account: task.account, tokenId: task.tokenId, receipt: { finalized: true },
  liquidity: { after: task.remainingLiquidity }, balances: [
    { symbol: 'USDt0', decimals: 6, delta: '20016', address: task.assets[0].address },
    { symbol: 'USDC', decimals: 6, delta: '19999', address: task.assets[1].address },
  ] }) as any;
it('verifies an existing transaction without any wallet and invalidates results when input changes', async () => {
  vi.mocked(inspectRecoveryOutcome).mockResolvedValue(outcome());
  render(<RecoveryCheck lang="zh" />); fill();
  await screen.findByText('恢复核验完成：到账、剩余流动性及最终确认一致。');
  expect(screen.getByText('0.020016')).toBeTruthy();
  expect(inspectRecoveryOutcome).toHaveBeenCalledWith(expect.anything(), task.hash, 67042n, task.account);
  fireEvent.change(screen.getByLabelText('恢复仓位编号'), { target: { value: '123' } });
  expect(screen.queryByText('0.020016')).toBeNull();
  expect(screen.queryByRole('button', { name: '导出核验结果' })).toBeNull();
});
it('retains finality pending and never claims success on mismatched chain evidence', async () => {
  const pending = outcome(); pending.receipt.finalized = false;
  vi.mocked(inspectRecoveryOutcome).mockResolvedValue(pending);
  render(<RecoveryCheck lang="zh" />); fill();
  await screen.findByText('到账与流动性匹配，仍等待最终确认。');
  expect(screen.queryByText(/恢复核验完成：/)).toBeNull();
});
it('ignores an old success after cancellation and after starting a new check', async () => {
  let finish!: (v: any) => void;
  vi.mocked(inspectRecoveryOutcome).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<RecoveryCheck lang="zh" />); fill();
  await waitFor(() => expect(inspectRecoveryOutcome).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '取消恢复核验' }));
  vi.mocked(inspectRecoveryOutcome).mockRejectedValueOnce(new Error('RPC responses disagree'));
  fireEvent.click(screen.getByRole('button', { name: '核验已有交易' }));
  await screen.findByText('本次核验未完成：RPC responses disagree');
  await act(async () => finish(outcome()));
  expect(screen.queryByText(/恢复核验完成：/)).toBeNull();
  expect(screen.queryByText('0.020016')).toBeNull();
});
it('rejects invalid input before reading the chain', async () => {
  render(<RecoveryCheck lang="zh" />);
  fireEvent.change(screen.getByLabelText('恢复仓位编号'), { target: { value: '01' } });
  fireEvent.change(screen.getByLabelText('原钱包公开地址'), { target: { value: task.account } });
  fireEvent.change(screen.getByLabelText('已有交易完整哈希'), { target: { value: task.hash } });
  fireEvent.click(screen.getByRole('button', { name: '核验已有交易' }));
  await screen.findByText('请填写有效的仓位编号、原钱包地址和完整交易哈希。');
  expect(inspectRecoveryOutcome).not.toHaveBeenCalled();
});
it('times out without accepting a later success or leaving a stale export', async () => {
  vi.useFakeTimers();
  let finish!: (v: any) => void;
  vi.mocked(inspectRecoveryOutcome).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<RecoveryCheck lang="zh" />);
  await act(async () => fill());
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
  expect(screen.getByText('本次核验超时，请稍后重试。')).toBeTruthy();
  await act(async () => finish(outcome()));
  expect(screen.queryByText(/恢复核验完成：/)).toBeNull();
  expect(screen.queryByRole('button', { name: '导出核验结果' })).toBeNull();
});
