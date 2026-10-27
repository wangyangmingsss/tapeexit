import { getAddress, zeroAddress } from 'viem';
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
export interface RecoveryIdentity {
  manifestSha256?: string; tapeName?: string; container?: string; gateways?: string[];
}
export interface RecoveryCard extends RecoveryIdentity {
  schemaVersion: 1; app: 'TapeExit'; chainId: number; manager: string; releaseId?: string; tokenIds: string[];
}
function invalidCard(): never {
  throw new ExitError('IMPORT', 'Recovery card contains invalid or unsafe fields');
}
function publicText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit &&
    value === value.trim() && /^[\x20-\x7e]+$/.test(value);
}
export function importRecoveryCard(text: string): RecoveryCard {
  if (text.length > 16000) throw new ExitError('IMPORT', 'Recovery card too large');
  let data;
  try { data = JSON.parse(text); } catch { return invalidCard(); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return invalidCard();
  const allowed = new Set(['schemaVersion', 'app', 'chainId', 'releaseId', 'manifestSha256', 'tapeName', 'container', 'manager', 'tokenIds', 'gateways']);
  if (Object.keys(data).some(k => !allowed.has(k)) || data.schemaVersion !== 1 ||
      data.app !== 'TapeExit' || data.chainId !== CHAIN_ID ||
      typeof data.manager !== 'string' ||
      !Array.isArray(data.tokenIds) || data.tokenIds.length > 50 ||
      data.tokenIds.some((id: unknown) => typeof id !== 'string' || !/^(0|[1-9]\d{0,77})$/.test(id)))
    return invalidCard();
  try {
    if (getAddress(data.manager) !== MANAGER || new Set(data.tokenIds).size !== data.tokenIds.length)
      return invalidCard();
    for (const id of data.tokenIds) parseTokenId(id);
    if (Object.hasOwn(data, 'releaseId') && !publicText(data.releaseId, 96)) return invalidCard();
    if (Object.hasOwn(data, 'manifestSha256') &&
        (typeof data.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.manifestSha256))) return invalidCard();
    if (Object.hasOwn(data, 'tapeName') &&
        (!publicText(data.tapeName, 253) || !/^[a-z0-9.-]+$/i.test(data.tapeName))) return invalidCard();
    if (Object.hasOwn(data, 'container') &&
        (typeof data.container !== 'string' || getAddress(data.container) === zeroAddress)) return invalidCard();
    if (Object.hasOwn(data, 'gateways')) {
      if (!Array.isArray(data.gateways) || data.gateways.length > 4) return invalidCard();
      const urls = data.gateways.map((value: unknown) => {
        if (!publicText(value, 2048)) return invalidCard();
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.hash) return invalidCard();
        return url.href;
      });
      if (new Set(urls).size !== urls.length) return invalidCard();
    }
  } catch { return invalidCard(); }
  return { schemaVersion: 1, app: 'TapeExit', chainId: CHAIN_ID, manager: MANAGER,
    tokenIds: [...data.tokenIds],
    ...(Object.hasOwn(data, 'releaseId') ? { releaseId: data.releaseId } : {}),
    ...(Object.hasOwn(data, 'manifestSha256') ? { manifestSha256: data.manifestSha256 } : {}),
    ...(Object.hasOwn(data, 'tapeName') ? { tapeName: data.tapeName } : {}),
    ...(Object.hasOwn(data, 'container') ? { container: getAddress(data.container) } : {}),
    ...(Object.hasOwn(data, 'gateways') ? { gateways: [...data.gateways] } : {}) };
}
export function recoveryCard(tokenId: string | readonly string[], identity: RecoveryIdentity = {}): RecoveryCard {
  let tokenIds: string[] = [];
  if (typeof tokenId === 'string') {
    try { tokenIds = [parseTokenId(tokenId).toString()]; } catch { /* Empty drafts contain no position hint. */ }
  } else tokenIds = [...tokenId];
  if (Object.keys(identity).some(key => !['manifestSha256', 'tapeName', 'container', 'gateways'].includes(key)))
    return invalidCard();
  return importRecoveryCard(JSON.stringify({ ...identity, schemaVersion: 1, app: 'TapeExit',
    chainId: CHAIN_ID, manager: MANAGER, releaseId: RELEASE, tokenIds }));
}
