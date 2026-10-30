// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RecoveryCheck from '../src/RecoveryCheck';
import { inspectRecoveryOutcome } from '../src/core/recovery-outcome';
import task from '../docs/gateway-recovery-task-67042.json';
import { RECOVERY_TASK_KEY, recoveryTask } from '../src/core/recovery-task';

vi.mock('../src/core/recovery-outcome', () => ({ inspectRecoveryOutcome: vi.fn() }));
beforeEach(() => localStorage.clear());
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
it('restores transaction hints after remount without restoring old success or reading the chain automatically', async () => {
  vi.mocked(inspectRecoveryOutcome).mockResolvedValue(outcome());
  const view = render(<RecoveryCheck lang="zh" />); fill();
  await screen.findByText('恢复核验完成：到账、剩余流动性及最终确认一致。');
  view.unmount(); vi.mocked(inspectRecoveryOutcome).mockClear();
  render(<RecoveryCheck lang="zh" />);
  expect(screen.getByLabelText('恢复仓位编号')).toHaveProperty('value', task.tokenId);
  expect(screen.getByLabelText('原钱包公开地址')).toHaveProperty('value', task.account);
  expect(screen.getByLabelText('已有交易完整哈希')).toHaveProperty('value', task.hash);
  expect(screen.getByText('已恢复上次填写的交易信息，请重新核验链上状态。')).toBeTruthy();
  expect(screen.queryByText(/恢复核验完成：/)).toBeNull();
  expect(inspectRecoveryOutcome).not.toHaveBeenCalled();
});
it('automatically progresses from pending through included to finalized using only read-only checks', async () => {
  vi.useFakeTimers();
  const included = outcome(); included.receipt.finalized = false;
  vi.mocked(inspectRecoveryOutcome).mockResolvedValueOnce({ state: 'pending' } as any)
    .mockResolvedValueOnce(included).mockResolvedValueOnce(outcome());
  render(<RecoveryCheck lang="zh" />);
  await act(async () => fill());
  expect(screen.getByText(/交易尚未确认/)).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(screen.getByText('到账与流动性匹配，仍等待最终确认。')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(screen.getByText('恢复核验完成：到账、剩余流动性及最终确认一致。')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(inspectRecoveryOutcome).toHaveBeenCalledTimes(3);
});
it('limits automatic checks and leaves the transaction hints available for manual recovery', async () => {
  vi.useFakeTimers();
  vi.mocked(inspectRecoveryOutcome).mockResolvedValue({ state: 'pending' } as any);
  render(<RecoveryCheck lang="zh" />);
  await act(async () => fill());
  for (let n = 0; n < 12; n++)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(inspectRecoveryOutcome).toHaveBeenCalledTimes(10);
  expect(screen.getByText(/自动核验已达到 10 次/)).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(RECOVERY_TASK_KEY)!)).toHaveProperty('hash', task.hash);
});
it.each(['cancel', 'edit', 'disable'])('stops scheduled checks after %s', async action => {
  vi.useFakeTimers();
  vi.mocked(inspectRecoveryOutcome).mockResolvedValue({ state: 'pending' } as any);
  render(<RecoveryCheck lang="zh" />);
  await act(async () => fill());
  if (action === 'cancel') fireEvent.click(screen.getByRole('button', { name: '取消恢复核验' }));
  if (action === 'edit') fireEvent.change(screen.getByLabelText('恢复仓位编号'), { target: { value: '123' } });
  if (action === 'disable') fireEvent.click(screen.getByRole('checkbox', { name: '自动核验' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(inspectRecoveryOutcome).toHaveBeenCalledTimes(1);
});
it.each(['block-state-mismatch', 'reverted', 'error'])('does not automatically retry %s evidence', async state => {
  vi.useFakeTimers();
  if (state === 'error') vi.mocked(inspectRecoveryOutcome).mockRejectedValue(new Error('RPC responses disagree'));
  else vi.mocked(inspectRecoveryOutcome).mockResolvedValue({ state } as any);
  render(<RecoveryCheck lang="zh" />);
  await act(async () => fill());
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(inspectRecoveryOutcome).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/恢复核验完成：/)).toBeNull();
});
it('imports a transaction record from another gateway without trusting its saved success', async () => {
  const report = { schemaVersion: 1, environment: 'MAINNET_READ_ONLY', signingApproved: false,
    task: recoveryTask(task.tokenId, task.account, task.hash), outcome: outcome(), observedAt: new Date().toISOString() };
  render(<RecoveryCheck lang="zh" />);
  fireEvent.change(screen.getByLabelText('交易恢复记录文件'), {
    target: { files: [new File([JSON.stringify(report)], 'recovery.json', { type: 'application/json' })] },
  });
  await screen.findByText('交易信息已导入，请重新核验到账和最终确认。');
  expect(screen.getByLabelText('已有交易完整哈希')).toHaveProperty('value', task.hash);
  expect(screen.queryByText('0.020016')).toBeNull();
  expect(inspectRecoveryOutcome).not.toHaveBeenCalled();
});
it('does not allow a late file import to overwrite a newer user input', async () => {
  let finish!: (value: string) => void;
  const file = new File([], 'recovery.json');
  vi.spyOn(file, 'text').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<RecoveryCheck lang="zh" />);
  fireEvent.change(screen.getByLabelText('交易恢复记录文件'), { target: { files: [file] } });
  fireEvent.change(screen.getByLabelText('恢复仓位编号'), { target: { value: '123' } });
  await act(async () => finish(JSON.stringify(recoveryTask(task.tokenId, task.account, task.hash))));
  expect(screen.getByLabelText('恢复仓位编号')).toHaveProperty('value', '123');
  expect(screen.queryByText('交易信息已导入，请重新核验到账和最终确认。')).toBeNull();
});
