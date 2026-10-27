import { getAddress } from 'viem';
import { CHAIN_ID, MANAGER, RELEASE } from '../config';
import { ExitError } from './rpc';
import { parseTokenId } from './protocol';
const KEY = 'tapeexit:history:v1';
export interface HistoryItem {
  tokenId: string; hash: string; time: string; environment: 'demo' | 'mainnet'; state: string;
}
export function loadHistory(): HistoryItem[] {
  try {
    const text = localStorage.getItem(KEY) || '[]';
    if (text.length > 128000) return [];
    const value = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    const states = new Set(['submitted', 'received-checked', 'included-unverified', 'pending-recheck', 'verification-pending', 'reverted']);
    return value.flatMap(v => {
      if (!v || typeof v.tokenId !== 'string' || typeof v.hash !== 'string' || !/^0x[\da-f]{64}$/i.test(v.hash) ||
          typeof v.time !== 'string' || v.time.length > 40 || !Number.isFinite(Date.parse(v.time)) ||
          !states.has(v.state) || !['demo', 'mainnet'].includes(v.environment)) return [];
      try { parseTokenId(v.tokenId); } catch { return []; }
      return [{ tokenId: v.tokenId, hash: v.hash.toLowerCase(), time: v.time, state: v.state,
        environment: v.environment } as HistoryItem];
    }).slice(0, 50);
  } catch { return []; }
}
export function saveHistory(item: HistoryItem) {
  const history = [{ ...item, hash: item.hash.toLowerCase() }, ...loadHistory().filter(i => i.hash !== item.hash.toLowerCase())].slice(0, 50);
  try { localStorage.setItem(KEY, JSON.stringify(history)); } catch { /* Storage failure must not alter transaction state. */ }
  return history;
}
export function clearHistory() { try { localStorage.removeItem(KEY); } catch { /* Storage may be unavailable. */ } }
export function downloadJson(name: string, data: unknown) {
  const text = JSON.stringify(data, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function importRecoveryCard(text: string): { tokenIds: string[] } {
  if (text.length > 16000) throw new ExitError('IMPORT', 'Recovery card too large');
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ExitError('IMPORT', 'Invalid recovery card');
  const allowed = new Set(['schemaVersion', 'app', 'chainId', 'releaseId', 'manifestSha256', 'tapeName', 'container', 'manager', 'tokenIds', 'gateways']);
  if (Object.keys(data).some(k => !allowed.has(k)) || data.schemaVersion !== 1 ||
      data.app !== 'TapeExit' || data.chainId !== CHAIN_ID ||
      typeof data.manager !== 'string' || getAddress(data.manager) !== MANAGER ||
      !Array.isArray(data.tokenIds) || data.tokenIds.length > 50 ||
      data.tokenIds.some((id: unknown) => typeof id !== 'string' || !/^(0|[1-9]\d{0,77})$/.test(id)))
    throw new ExitError('IMPORT', 'Recovery card contains invalid or unsafe fields');
  for (const id of data.tokenIds) parseTokenId(id);
  return { tokenIds: data.tokenIds };
}
export function recoveryCard(tokenId: string, identity?: Record<string, string>) {
  let tokenIds: string[] = [];
  try { tokenIds = [parseTokenId(tokenId).toString()]; } catch { /* Empty drafts contain no position hint. */ }
  return { schemaVersion: 1, app: 'TapeExit', chainId: CHAIN_ID, manager: MANAGER,
    releaseId: RELEASE, ...identity, tokenIds };
}
