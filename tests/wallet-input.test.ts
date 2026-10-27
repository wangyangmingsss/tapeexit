// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertWallet, connect, discoverWallets, type Provider } from '../src/core/wallet';
import { CHAIN_ID } from '../src/config';
import { DEMO_OWNER, demoSnapshot } from '../src/demo/engine';
import { makePlan } from '../src/core/protocol';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const other = '0x2000000000000000000000000000000000000002';
function fixture() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const request = vi.fn(async ({ method }: { method: string }): Promise<unknown> =>
    method === 'eth_chainId' ? '0xc4' : [DEMO_OWNER]);
  const provider: Provider = { request, on: (name, handler) => { handlers.set(name, handler); },
    removeListener: (name, handler) => { if (handlers.get(name) === handler) handlers.delete(name); } };
  return { provider, request, handlers };
}
describe('wallet connection responses and cancellation', () => {
  it.each([196, '196', '0xc4 ', '0x00c4', '0x', {}, null])('rejects malformed chain data %# before account access', async value => {
    const f = fixture(); f.request.mockResolvedValue(value);
    await expect(connect(f.provider, CHAIN_ID)).rejects.toMatchObject({ code: 'WALLET_RESPONSE' });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each([DEMO_OWNER, null, {}, [null], ['0x1'], ['0x0000000000000000000000000000000000000000'],
    [DEMO_OWNER, DEMO_OWNER], Array(101).fill(DEMO_OWNER)])('rejects malformed account data %# and removes listeners', async value => {
    const f = fixture();
    f.request.mockImplementation(async ({ method }) => method === 'eth_chainId' ? '0xc4' : value);
    await expect(connect(f.provider, CHAIN_ID)).rejects.toMatchObject({ code: 'WALLET_RESPONSE' });
    expect(f.handlers.size).toBe(0);
  });
  it('checks live accounts after permission response even without an event', async () => {
    const f = fixture();
    f.request.mockImplementation(async ({ method }) =>
      method === 'eth_chainId' ? '0xc4' : method === 'eth_requestAccounts' ? [DEMO_OWNER] : [other]);
    await expect(connect(f.provider, CHAIN_ID)).rejects.toMatchObject({ code: 'WALLET_CHANGED' });
    expect(f.handlers.size).toBe(0);
  });
  it('checks chain again after reading live accounts', async () => {
    const f = fixture(); let chain = '0xc4';
    f.request.mockImplementation(async ({ method }) => {
      if (method === 'eth_chainId') return chain;
      if (method === 'eth_accounts') chain = '0x1';
      return [DEMO_OWNER];
    });
    await expect(connect(f.provider, CHAIN_ID)).rejects.toMatchObject({ code: 'WALLET_CHANGED' });
  });
  it('accepts the normal authorization event but rejects disconnect or inconsistent events', async () => {
    for (const [name, value, valid] of [
      ['accountsChanged', [DEMO_OWNER], true], ['accountsChanged', [other], false],
      ['accountsChanged', [], false], ['accountsChanged', 'invalid', false],
      ['chainChanged', '0x1', false], ['chainChanged', null, false], ['disconnect', {}, false],
    ] as const) {
      const f = fixture();
      f.request.mockImplementation(async ({ method }) => {
        if (method === 'eth_requestAccounts') f.handlers.get(name)?.(value);
        return method === 'eth_chainId' ? '0xc4' : [DEMO_OWNER];
      });
      if (valid) await expect(connect(f.provider, CHAIN_ID)).resolves.toBe(DEMO_OWNER);
      else await expect(connect(f.provider, CHAIN_ID)).rejects.toMatchObject({ code: 'WALLET_CHANGED' });
      expect(f.handlers.size).toBe(0);
    }
  });
  it('never requests a chain or accounts when already cancelled', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(connect(f.provider, CHAIN_ID, controller.signal)).rejects.toMatchObject({ code: 'WALLET_CANCELLED' });
    expect(f.request).not.toHaveBeenCalled();
  });
  it('discards an in-flight authorization and issues no follow-up requests after cancellation', async () => {
    const f = fixture(), controller = new AbortController();
    let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    f.request.mockImplementation(async ({ method }) => method === 'eth_requestAccounts' ? pending : '0xc4');
    const connection = connect(f.provider, CHAIN_ID, controller.signal);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(connection).rejects.toMatchObject({ code: 'WALLET_CANCELLED' });
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.handlers.size).toBe(0);
    finish([DEMO_OWNER]);
  });
  it.each([4001, 4100, 4200, 4900, 4901])('preserves provider error %s without another permission request', async code => {
    const f = fixture();
    f.request.mockImplementation(async ({ method }) => {
      if (method === 'eth_requestAccounts') throw Object.assign(new Error('Provider error'), { code });
      return '0xc4';
    });
    await expect(connect(f.provider, CHAIN_ID)).rejects.toMatchObject({ code });
    expect(f.request.mock.calls.filter(([arg]) => arg.method === 'eth_requestAccounts')).toHaveLength(1);
    expect(f.handlers.size).toBe(0);
  });
  it('uses strict response validation at the pre-send check too', async () => {
    const plan = makePlan(await demoSnapshot(1n, 'none'), DEMO_OWNER, 10000, 50);
    const f = fixture();
    f.request.mockImplementation(async ({ method }) => method === 'eth_chainId' ? 196 : [DEMO_OWNER]);
    await expect(assertWallet(f.provider, plan)).rejects.toMatchObject({ code: 'WALLET_RESPONSE' });
  });
});
describe('bounded untrusted wallet discovery', () => {
  const announce = (info: unknown, provider: unknown) => window.dispatchEvent(new CustomEvent('eip6963:announceProvider',
    { detail: { info, provider } }));
  const info = (i: number) => ({ uuid: `${i.toString(16).padStart(8, '0')}-abcd-4abc-8abc-abcdefabcdef`,
    name: '<img src=x onerror=alert(1)>', rdns: 'fixture.wallet' });
  it('bounds announcements and ignores malformed, duplicate and noncallable providers', () => {
    const found = vi.fn(), provider = fixture().provider, stop = discoverWallets(found);
    try {
      announce({ uuid: 'bad', name: 'bad' }, provider);
      announce(info(1), { request: true });
      announce({ ...info(1), name: {} }, provider);
      for (let i = 1; i <= 25; i++) announce(info(i), provider);
      announce({ ...info(1), uuid: info(1).uuid.toUpperCase() }, provider);
      expect(found).toHaveBeenCalledTimes(20);
      expect(found.mock.calls[0][0].name).toBe(info(1).name);
    } finally { stop(); }
    announce(info(30), provider);
    expect(found).toHaveBeenCalledTimes(20);
  });
  it('ignores throwing metadata getters', () => {
    const found = vi.fn(), stop = discoverWallets(found);
    try {
      announce({ get uuid() { throw new Error('untrusted getter'); } }, fixture().provider);
      expect(found).not.toHaveBeenCalled();
    } finally { stop(); }
  });
  it('validates legacy fallback and cancels its timer on cleanup', () => {
    vi.useFakeTimers(); const found = vi.fn();
    vi.stubGlobal('ethereum', { request: true });
    let stop = discoverWallets(found); vi.advanceTimersByTime(401); stop();
    expect(found).not.toHaveBeenCalled();
    vi.stubGlobal('ethereum', fixture().provider);
    stop = discoverWallets(found); stop(); vi.advanceTimersByTime(401);
    expect(found).not.toHaveBeenCalled();
    stop = discoverWallets(found); vi.advanceTimersByTime(401); stop();
    expect(found).toHaveBeenCalledWith(expect.objectContaining({ id: 'injected' }));
  });
});
