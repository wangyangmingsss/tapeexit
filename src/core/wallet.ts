import { getAddress, zeroAddress, type Address, type Hex } from 'viem';
import { ExitError } from './rpc';
import type { Plan } from './protocol';
import { loadPlan } from './plan-loader';

export interface Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}
export interface Wallet { id: string; name: string; provider: Provider }
function providerValid(value: unknown): value is Provider {
  return !!value && typeof (value as Provider).request === 'function';
}
function walletChain(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][a-f0-9]{0,63})$/i.test(value))
    throw new ExitError('WALLET_RESPONSE', 'Wallet returned an invalid chain ID');
  return BigInt(value);
}
function walletAccounts(value: unknown): Address[] {
  if (!Array.isArray(value) || value.length > 100 ||
      value.some(a => typeof a !== 'string' || !/^0x[a-f0-9]{40}$/i.test(a)))
    throw new ExitError('WALLET_RESPONSE', 'Wallet returned invalid accounts');
  try {
    const accounts = value.map(a => getAddress(a));
    if (accounts.some(a => a === zeroAddress) || new Set(accounts).size !== accounts.length) throw new Error();
    return accounts;
  } catch { throw new ExitError('WALLET_RESPONSE', 'Wallet returned invalid accounts'); }
}
export function discoverWallets(onWallet: (wallet: Wallet) => void): () => void {
  const seen = new Set<string>();
  const listener = (event: Event) => {
    let wallet: Wallet;
    try {
      const detail = (event as CustomEvent).detail, info = detail?.info;
      if (!info || typeof info.uuid !== 'string' ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(info.uuid) ||
          typeof info.name !== 'string' || !info.name.trim() || !providerValid(detail.provider) ||
          seen.has(info.uuid.toLowerCase()) || seen.size >= 20) return;
      wallet = { id: info.uuid.toLowerCase(), name: info.name.slice(0, 40), provider: detail.provider };
    } catch { return; /* Untrusted extension metadata can include throwing getters. */ }
    seen.add(wallet.id);
    onWallet(wallet);
  };
  window.addEventListener('eip6963:announceProvider', listener);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const timer = setTimeout(() => {
    try {
      const provider = (window as unknown as { ethereum?: Provider }).ethereum;
      if (providerValid(provider) && seen.size === 0) onWallet({ id: 'injected', name: 'Browser wallet', provider });
    } catch { /* A legacy injected getter is not trusted. */ }
  }, 400);
  return () => { clearTimeout(timer); window.removeEventListener('eip6963:announceProvider', listener); };
}
export async function connect(provider: Provider, chainId: number, signal?: AbortSignal): Promise<Address> {
  const active = () => { if (signal?.aborted) throw new ExitError('WALLET_CANCELLED', 'Wallet connection cancelled'); };
  const request = async (method: string, params?: unknown[]) => {
    active();
    const value = await new Promise<unknown>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const abort = () => {
        cleanup();
        reject(new ExitError('WALLET_CANCELLED', 'Wallet connection cancelled'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        Promise.resolve(provider.request({ method, ...(params ? { params } : {}) })).then(
          result => { cleanup(); resolve(result); }, error => { cleanup(); reject(error); });
      } catch (error) { cleanup(); reject(error); }
    });
    active();
    return value;
  };
  const chain = walletChain(await request('eth_chainId'));
  if (chain !== BigInt(chainId)) {
    await request('wallet_switchEthereumChain', [{ chainId: `0x${chainId.toString(16)}` }]);
    const switched = walletChain(await request('eth_chainId'));
    if (switched !== BigInt(chainId))
      throw new ExitError('WALLET_CHANGED', 'Wallet did not switch to the requested chain');
  }
  let eventAccount: Address | undefined, changed = false;
  const accountsChanged = (value: unknown) => {
    try { eventAccount = walletAccounts(value)[0]; if (!eventAccount) changed = true; } catch { changed = true; }
  };
  const chainChanged = (value: unknown) => {
    try { if (walletChain(value) !== BigInt(chainId)) changed = true; } catch { changed = true; }
  };
  const disconnected = () => { changed = true; };
  const listeners: [string, (...args: unknown[]) => void][] = [
    ['accountsChanged', accountsChanged], ['chainChanged', chainChanged], ['disconnect', disconnected],
  ];
  const registered: typeof listeners = [];
  try {
    if (typeof provider.on === 'function' && typeof provider.removeListener === 'function')
      for (const entry of listeners) { provider.on(...entry); registered.push(entry); }
    const accounts = walletAccounts(await request('eth_requestAccounts'));
    if (!accounts[0]) throw new ExitError('WALLET', 'Wallet did not expose an account');
    const after = walletChain(await request('eth_chainId'));
    const current = walletAccounts(await request('eth_accounts'));
    const finalChain = walletChain(await request('eth_chainId'));
    if (changed || after !== BigInt(chainId) || finalChain !== BigInt(chainId) || current[0] !== accounts[0] ||
        eventAccount !== undefined && eventAccount !== current[0])
      throw new ExitError('WALLET_CHANGED', 'Wallet changed while requesting access');
    return current[0];
  } finally { registered.forEach(entry => provider.removeListener!(...entry)); }
}
export function observeWallet(provider: Provider, invalidate: () => void): () => void {
  const events = ['accountsChanged', 'chainChanged', 'disconnect'];
  events.forEach(e => provider.on?.(e, invalidate));
  return () => events.forEach(e => provider.removeListener?.(e, invalidate));
}
export async function assertWallet(provider: Provider, plan: Plan) {
  const [accounts, chain] = await Promise.all([
    provider.request({ method: 'eth_accounts' }),
    provider.request({ method: 'eth_chainId' }),
  ]);
  const current = walletAccounts(accounts);
  if (walletChain(chain) !== BigInt(plan.chainId) ||
      !current[0] || current[0] !== getAddress(plan.account))
    throw new ExitError('WALLET_CHANGED', 'Account or network changed');
  if (Date.now() - plan.createdAt > 30000)
    throw new ExitError('STALE', 'Preview expired; refresh before signing');
}
export async function send(provider: Provider, plan: Plan, gas: bigint, beforeRequest?: () => void): Promise<Hex> {
  const { validatePlan } = await loadPlan();
  validatePlan(plan);
  await assertWallet(provider, plan);
  beforeRequest?.();
  const result = await provider.request({ method: 'eth_sendTransaction', params: [{
    from: plan.account, to: plan.manager, data: plan.data, value: '0x0',
    gas: `0x${gas.toString(16)}`, chainId: `0x${plan.chainId.toString(16)}`,
  }] });
  if (typeof result !== 'string' || !/^0x[0-9a-f]{64}$/i.test(result))
    throw new ExitError('SUBMISSION_UNKNOWN', 'Wallet returned no transaction hash');
  return result as Hex;
}
