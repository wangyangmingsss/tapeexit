import { describe, expect, it, vi } from 'vitest';
import { assertWallet, connect, observeWallet, send, type Provider } from '../src/core/wallet';
import { makePlan } from '../src/core/protocol';
import { DEMO_OWNER, demoSnapshot } from '../src/demo/engine';
import { CHAIN_ID } from '../src/config';
import { pendingState } from '../src/core/receipt';
import { StrictRpc } from '../src/core/rpc';
describe('wallet signing boundary', () => {
  it('switches chain before requesting accounts', async () => {
    let chain = '0x1';
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'wallet_switchEthereumChain') { chain = '0xc4'; return null; }
      return method === 'eth_chainId' ? chain : ['eth_requestAccounts', 'eth_accounts'].includes(method) ? [DEMO_OWNER] : null;
    });
    expect(await connect({ request }, CHAIN_ID)).toBe(DEMO_OWNER);
    expect(request.mock.calls.map(([p]) => p.method)).toEqual([
      'eth_chainId', 'wallet_switchEthereumChain', 'eth_chainId', 'eth_requestAccounts', 'eth_chainId', 'eth_accounts', 'eth_chainId',
    ]);
  });
  it('rejects a network change while account access is being requested', async () => {
    let chain = '0xc4';
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') { chain = '0x1'; return [DEMO_OWNER]; }
      return method === 'eth_accounts' ? [DEMO_OWNER] : chain;
    });
    await expect(connect({ request }, CHAIN_ID)).rejects.toMatchObject({ code: 'WALLET_CHANGED' });
  });
  it('never sends on stale preview, account or network changes', async () => {
    const p = makePlan(await demoSnapshot(1n, 'none'), DEMO_OWNER, 10000, 50);
    let chain = '0xc4', accounts = [DEMO_OWNER];
    const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_chainId' ? chain : accounts);
    const provider: Provider = { request };
    await expect(assertWallet(provider, p)).resolves.toBeUndefined();
    chain = '0x1';
    await expect(send(provider, p, 100000n)).rejects.toMatchObject({ code: 'WALLET_CHANGED' });
    chain = '0xc4'; accounts = [];
    await expect(send(provider, p, 100000n)).rejects.toMatchObject({ code: 'WALLET_CHANGED' });
    accounts = [DEMO_OWNER];
    await expect(send(provider, { ...p, createdAt: Date.now() - 31000 }, 100000n)).rejects.toMatchObject({ code: 'STALE' });
    expect(request.mock.calls.some(([args]) => args.method === 'eth_sendTransaction')).toBe(false);
  });
  it('removes every provider event listener on disconnect', () => {
    const on = vi.fn(), removeListener = vi.fn(), invalidate = vi.fn();
    const cleanup = observeWallet({ request: async () => null, on, removeListener }, invalidate);
    cleanup();
    expect(on.mock.calls).toEqual(removeListener.mock.calls);
    expect(on.mock.calls.map(([event]) => event)).toEqual(['accountsChanged', 'chainChanged', 'disconnect']);
  });
  it('identifies consumed nonce without resending or inventing a replacement hash', async () => {
    const rpc = new StrictRpc([
      { url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' },
    ], async (_source, method) => {
      if (method === 'eth_getTransactionByHash') return null;
      if (method === 'eth_getBlockByNumber') return { number: '0x2',
        hash: `0x${'cd'.repeat(32)}`, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` };
      return '0x4';
    });
    expect(await pendingState(rpc, `0x${'ab'.repeat(32)}`, DEMO_OWNER, 3n)).toEqual({
      state: 'replaced-or-dropped', nonce: 3n,
    });
    expect(await pendingState(rpc, `0x${'ab'.repeat(32)}`, DEMO_OWNER)).toEqual({ state: 'pending', nonce: undefined });
  });
});
