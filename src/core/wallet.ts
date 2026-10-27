import { getAddress, type Address, type Hex } from 'viem';
import { ExitError } from './rpc';
import { validatePlan, type Plan } from './protocol';

export interface Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}
export interface Wallet { id: string; name: string; provider: Provider }
export function discoverWallets(onWallet: (wallet: Wallet) => void): () => void {
  const seen = new Set<string>();
  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (!detail?.info || typeof detail.info.uuid !== 'string' || !detail.provider?.request ||
        seen.has(detail.info.uuid)) return;
    seen.add(detail.info.uuid);
    onWallet({ id: detail.info.uuid, name: String(detail.info.name || 'Wallet').slice(0, 40), provider: detail.provider });
  };
  window.addEventListener('eip6963:announceProvider', listener);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const timer = setTimeout(() => {
    const provider = (window as unknown as { ethereum?: Provider }).ethereum;
    if (provider && seen.size === 0) onWallet({ id: 'injected', name: 'Browser wallet', provider });
  }, 400);
  return () => { clearTimeout(timer); window.removeEventListener('eip6963:announceProvider', listener); };
}
export async function connect(provider: Provider, chainId: number): Promise<Address> {
  const chain = await provider.request({ method: 'eth_chainId' });
  if (BigInt(chain as string) !== BigInt(chainId)) {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${chainId.toString(16)}` }] });
    const switched = await provider.request({ method: 'eth_chainId' });
    if (BigInt(switched as string) !== BigInt(chainId))
      throw new ExitError('WALLET_CHANGED', 'Wallet did not switch to the requested chain');
  }
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  if (!accounts?.[0]) throw new ExitError('WALLET', 'Wallet did not expose an account');
  return getAddress(accounts[0]);
}
export function observeWallet(provider: Provider, invalidate: () => void): () => void {
  const events = ['accountsChanged', 'chainChanged', 'disconnect'];
  events.forEach(e => provider.on?.(e, invalidate));
  return () => events.forEach(e => provider.removeListener?.(e, invalidate));
}
export async function assertWallet(provider: Provider, plan: Plan) {
  const [accounts, chain] = await Promise.all([
    provider.request({ method: 'eth_accounts' }) as Promise<string[]>,
    provider.request({ method: 'eth_chainId' }),
  ]);
  if (BigInt(chain as string) !== BigInt(plan.chainId) ||
      !accounts[0] || getAddress(accounts[0]) !== getAddress(plan.account))
    throw new ExitError('WALLET_CHANGED', 'Account or network changed');
  if (Date.now() - plan.createdAt > 30000)
    throw new ExitError('STALE', 'Preview expired; refresh before signing');
}
export async function send(provider: Provider, plan: Plan, gas: bigint): Promise<Hex> {
  validatePlan(plan);
  await assertWallet(provider, plan);
  const result = await provider.request({ method: 'eth_sendTransaction', params: [{
    from: plan.account, to: plan.manager, data: plan.data, value: '0x0',
    gas: `0x${gas.toString(16)}`, chainId: `0x${plan.chainId.toString(16)}`,
  }] });
  if (typeof result !== 'string' || !/^0x[0-9a-f]{64}$/i.test(result))
    throw new ExitError('SUBMISSION_UNKNOWN', 'Wallet returned no transaction hash');
  return result as Hex;
}
