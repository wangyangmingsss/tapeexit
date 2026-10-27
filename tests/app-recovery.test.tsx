// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { downloadJson, recoveryCard } from '../src/core/storage';
vi.mock('../src/core/storage', async original => ({
  ...await original<typeof import('../src/core/storage')>(), downloadJson: vi.fn(),
}));
vi.mock('../src/core/runtime', async original => ({
  ...await original<typeof import('../src/core/runtime')>(),
  runtimeStatus: async () => ({ mode: 'local', verified: false, label: 'Local' }),
  manifestDigest: async () => 'ab'.repeat(32),
}));
import App from '../src/App';
const large = (2n ** 256n - 1n).toString();
beforeEach(() => {
  localStorage.clear(); vi.mocked(downloadJson).mockReset();
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function file(ids = ['12', large]) {
  return new File([JSON.stringify(recoveryCard(ids))], 'recovery.json', { type: 'application/json' });
}
function input() { return document.querySelector<HTMLInputElement>('input[type=file]')!; }
function deferredFile() {
  const value = file();
  let resolve!: (text: string) => void, reject!: (error: Error) => void;
  vi.spyOn(value, 'text').mockReturnValue(new Promise<string>((yes, no) => { resolve = yes; reject = no; }));
  return { file: value, resolve, reject };
}
it('restores every ID, switches exact positions and exports the full set without RPC or wallet access', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  try {
    const user = userEvent.setup(); render(<App />);
    await user.upload(input(), file());
    await screen.findByLabelText('恢复卡仓位');
    expect((screen.getByLabelText('仓位 Token ID') as HTMLInputElement).value).toBe('12');
    await user.selectOptions(screen.getByLabelText('恢复卡仓位'), large);
    expect((screen.getByLabelText('仓位 Token ID') as HTMLInputElement).value).toBe(large);
    await user.click(screen.getByRole('button', { name: '保存恢复卡' }));
    expect(downloadJson).toHaveBeenCalledWith('tapeexit-recovery-card.json',
      expect.objectContaining({ tokenIds: ['12', large], manifestSha256: 'ab'.repeat(32) }));
    expect(fetch).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
it('leaves manual IDs available and exports a manual position outside the imported set alone', async () => {
  const user = userEvent.setup(); render(<App />);
  await user.upload(input(), file());
  const position = screen.getByLabelText('仓位 Token ID');
  await user.clear(position); await user.type(position, '99');
  expect((screen.getByLabelText('恢复卡仓位') as HTMLSelectElement).value).toBe('');
  await user.click(screen.getByRole('button', { name: '保存恢复卡' }));
  expect(downloadJson).toHaveBeenCalledWith('tapeexit-recovery-card.json', expect.objectContaining({ tokenIds: ['99'] }));
});
it('clears prior hints for a valid empty draft and keeps prior hints for an invalid file', async () => {
  const user = userEvent.setup(); render(<App />);
  await user.upload(input(), file());
  await user.upload(input(), new File(['{"app":"Other"}'], 'bad.json', { type: 'application/json' }));
  await screen.findByText('恢复卡格式或字段无效，请检查文件。');
  expect((screen.getByLabelText('仓位 Token ID') as HTMLInputElement).value).toBe('12');
  await user.upload(input(), file([]));
  expect(screen.queryByLabelText('恢复卡仓位')).toBeNull();
  expect((screen.getByLabelText('仓位 Token ID') as HTMLInputElement).value).toBe('');
  expect(screen.queryByRole('alert')).toBeNull();
});
it('never fetches or navigates to imported gateway identity hints', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  try {
    const user = userEvent.setup(); render(<App />);
    await user.upload(input(), new File([JSON.stringify(recoveryCard(['12'], {
      gateways: ['https://untrusted.example/path'], tapeName: '12.2.0.tape',
      container: '0x1000000000000000000000000000000000000001',
    }))], 'hints.json', { type: 'application/json' }));
    expect((screen.getByLabelText('仓位 Token ID') as HTMLInputElement).value).toBe('12');
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector('a[href*="untrusted.example"]')).toBeNull();
  } finally { vi.unstubAllGlobals(); }
});
it('rejects an oversized file before reading its contents', async () => {
  const oversized = new File(['x'.repeat(16001)], 'large.json', { type: 'application/json' });
  const read = vi.spyOn(oversized, 'text');
  const user = userEvent.setup(); render(<App />);
  await user.upload(input(), oversized);
  await screen.findByText('恢复卡格式或字段无效，请检查文件。');
  expect(read).not.toHaveBeenCalled();
});
it('keeps a newer imported file when an older file completes or fails later', async () => {
  const user = userEvent.setup(); render(<App />);
  for (const fail of [false, true]) {
    const pending = deferredFile();
    await user.upload(input(), pending.file);
    await user.upload(input(), file(['99']));
    await act(async () => fail ? pending.reject(new Error('Old read error')) :
      pending.resolve(JSON.stringify(recoveryCard(['12', large]))));
    expect((screen.getByLabelText('仓位 Token ID') as HTMLInputElement).value).toBe('99');
    expect(screen.queryByText('Old read error')).toBeNull();
  }
});
it('discards a delayed import after the user manually changes the workspace', async () => {
  const pending = deferredFile(), user = userEvent.setup(); render(<App />);
  await user.upload(input(), pending.file);
  fireEvent.change(screen.getByLabelText('仓位 Token ID'), { target: { value: '88' } });
  await act(async () => pending.resolve(JSON.stringify(recoveryCard(['12', large]))));
  expect((screen.getByLabelText('仓位 Token ID') as HTMLInputElement).value).toBe('88');
  expect(screen.queryByLabelText('恢复卡仓位')).toBeNull();
});
it('discards file completions after unmount', async () => {
  const pending = deferredFile(), user = userEvent.setup();
  const view = render(<App />);
  await user.upload(input(), pending.file); view.unmount();
  await act(async () => pending.resolve(JSON.stringify(recoveryCard(['12', large]))));
  expect(document.querySelector('#position-id')).toBeNull();
});
