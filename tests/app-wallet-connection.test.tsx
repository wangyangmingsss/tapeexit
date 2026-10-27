// @vitest-environment happy-dom
// Production UI with deferred fixture connection results; no real wallet access.
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { connect } from '../src/core/wallet';
const providerA = { request: async () => null }, providerB = { request: async () => null };
vi.mock('../src/core/wallet', async original => ({
  ...await original<typeof import('../src/core/wallet')>(),
  discoverWallets: (found: (w: unknown) => void) => {
    found({ id: 'A', name: 'Fixture A', provider: providerA });
    found({ id: 'B', name: 'Fixture B', provider: providerB });
    return () => {};
  }, connect: vi.fn(),
}));
let App: typeof import('../src/App').default;
beforeAll(async () => { vi.stubEnv('VITE_DEMO', 'false'); App = (await import('../src/App')).default; });
beforeEach(() => {
  localStorage.clear(); vi.mocked(connect).mockReset();
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function deferred() {
  let resolve!: (a: `0x${string}`) => void, reject!: (e: Error) => void;
  const promise = new Promise<`0x${string}`>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const accountA = '0x1000000000000000000000000000000000000001';
const accountB = '0x2000000000000000000000000000000000000002';
async function open() {
  const user = userEvent.setup(); render(<App />);
  await user.click(screen.getByRole('button', { name: '连接钱包' }));
  return user;
}
it('keeps the newest selected wallet when an older request resolves last', async () => {
  const a = deferred(), b = deferred();
  vi.mocked(connect).mockImplementation(provider => provider === providerA ? a.promise : b.promise);
  const user = await open();
  await user.click(screen.getByRole('button', { name: 'Fixture A' }));
  expect((screen.getByRole('button', { name: 'Fixture A' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Fixture B' }));
  expect(vi.mocked(connect).mock.calls[0][2]?.aborted).toBe(true);
  await act(async () => { b.resolve(accountB); });
  expect(screen.getByRole('button', { name: /0x2000/ })).toBeTruthy();
  await act(async () => { a.resolve(accountA); });
  expect(screen.queryByRole('button', { name: /0x1000/ })).toBeNull();
  expect(screen.getByRole('button', { name: /0x2000/ })).toBeTruthy();
});
it.each(['close', 'escape', 'backdrop'])('discards a pending connection after modal %s', async method => {
  const pending = deferred(); vi.mocked(connect).mockReturnValue(pending.promise);
  const user = await open();
  await user.click(screen.getByRole('button', { name: 'Fixture A' }));
  if (method === 'close') await user.click(screen.getByRole('button', { name: 'Close' }));
  else if (method === 'escape') await user.keyboard('{Escape}');
  else await user.click(screen.getByRole('dialog').parentElement!);
  expect(vi.mocked(connect).mock.calls[0][2]?.aborted).toBe(true);
  await act(async () => { pending.resolve(accountA); });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: '连接钱包' })).toBeTruthy();
});
it('ignores stale connection errors and cancels pending work on unmount', async () => {
  const a = deferred(), b = deferred();
  vi.mocked(connect).mockImplementation(provider => provider === providerA ? a.promise : b.promise);
  const user = await open();
  await user.click(screen.getByRole('button', { name: 'Fixture A' }));
  await user.click(screen.getByRole('button', { name: 'Fixture B' }));
  await act(async () => { a.reject(new Error('Old failure')); });
  expect(screen.queryByText('Old failure')).toBeNull();
  cleanup();
  expect(vi.mocked(connect).mock.calls[1][2]?.aborted).toBe(true);
  await act(async () => { b.resolve(accountB); });
});
