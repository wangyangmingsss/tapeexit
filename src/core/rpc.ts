import type { Hex } from 'viem';

export class ExitError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export interface Source { url: string; operator: string }
export type Requester = (source: Source, method: string, params: unknown[]) => Promise<unknown>;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
async function responseJson(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && BigInt(length) > BigInt(MAX_RESPONSE_BYTES)) {
    await response.body?.cancel();
    throw new ExitError('RPC_INVALID', 'RPC response exceeds the size limit');
  }
  if (!response.body) throw new ExitError('RPC_INVALID', 'Missing RPC response body');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ExitError('RPC_INVALID', 'RPC response exceeds the size limit');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ExitError('RPC_INVALID', 'Invalid RPC JSON response'); }
}
function rpcResult(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ExitError('RPC_INVALID', 'Invalid RPC response envelope');
  const body = value as Record<string, unknown>;
  const result = Object.hasOwn(body, 'result'), error = Object.hasOwn(body, 'error');
  if (body.jsonrpc !== '2.0' || body.id !== 1 || result === error)
    throw new ExitError('RPC_INVALID', 'RPC response version, ID or result is invalid');
  if (error) {
    const detail = body.error as Record<string, unknown> | null;
    if (!detail || typeof detail !== 'object' || Array.isArray(detail) ||
        !Number.isSafeInteger(detail.code) || typeof detail.message !== 'string')
      throw new ExitError('RPC_INVALID', 'Invalid RPC error response');
    throw new ExitError('RPC_REVERT', detail.message.slice(0, 180));
  }
  return body.result;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(typeof value === 'string' && /^0x[\da-f]+$/i.test(value) ? value.toLowerCase() : value);
}
export const httpRequest: Requester = async (source, method, params) => {
  const response = await fetch(source.url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
    credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ExitError('RPC_UNAVAILABLE', `RPC HTTP ${response.status}`);
  }
  return rpcResult(await responseJson(response));
};
export interface Block { number: Hex; hash: Hex; timestamp: Hex }
function isQuantity(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value);
}
export class StrictRpc {
  constructor(public sources: readonly Source[], private requestOne: Requester = httpRequest) {
    if (new Set(sources.map(s => s.operator)).size < 2)
      throw new ExitError('QUORUM', 'Two independent operator labels are required');
    for (const source of sources) {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
        throw new ExitError('RPC_INVALID', 'RPC requires HTTPS');
    }
  }
  async request<T>(method: string, params: unknown[], normalize: (v: T) => unknown = v => v): Promise<T> {
    const answers = await Promise.allSettled(this.sources.map(async s => ({
      operator: s.operator, value: await this.requestOne(s, method, params) as T,
    })));
    const good = answers.flatMap(a => a.status === 'fulfilled' ? [a.value] : []);
    if (new Set(good.map(a => a.operator)).size < 2)
      throw new ExitError('QUORUM', 'Independent RPC responses unavailable; signing stopped');
    if (new Set(good.map(a => canonical(normalize(a.value)))).size !== 1)
      throw new ExitError('CONFLICT', 'RPC responses disagree; signing stopped');
    return good[0].value;
  }
  async checkChain(chainId: number) {
    const id = await this.request<Hex>('eth_chainId', []);
    if (!isQuantity(id)) throw new ExitError('RPC_INVALID', 'Invalid RPC chain ID');
    if (BigInt(id) !== BigInt(chainId)) throw new ExitError('WRONG_CHAIN', 'RPC chain mismatch');
  }
  async pin(): Promise<Block> {
    const heads = await Promise.all(this.sources.map(s => this.requestOne(s, 'eth_blockNumber', [])));
    if (!heads.every(isQuantity)) throw new ExitError('RPC_INVALID', 'Invalid RPC head height');
    const heights = heads.map(h => BigInt(h));
    const min = heights.reduce((a, b) => a < b ? a : b);
    const max = heights.reduce((a, b) => a > b ? a : b);
    if (max - min > 300n) throw new ExitError('STALE', 'RPC heads are too far apart');
    const height = min > 2n ? min - 2n : min;
    const block = await this.block(`0x${height.toString(16)}`);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const timestamp = BigInt(block.timestamp);
    if (now - timestamp > 300n || timestamp - now > 30n)
      throw new ExitError('STALE', 'Chain snapshot timestamp is stale or ahead of the local clock');
    return { number: block.number, hash: block.hash, timestamp: block.timestamp };
  }
  async block(tag: Hex | 'safe' | 'finalized'): Promise<Block> {
    if (tag !== 'safe' && tag !== 'finalized' && !isQuantity(tag))
      throw new ExitError('RPC_INVALID', 'Invalid requested block height');
    const block = await this.request<Block>('eth_getBlockByNumber', [tag, false],
      b => b ? ({ number: b.number, hash: b.hash, timestamp: b.timestamp }) : null);
    if (!block || !isQuantity(block.number) || !isQuantity(block.timestamp) ||
        typeof block.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(block.hash))
      throw new ExitError('RPC_INVALID', 'Invalid or unavailable block');
    if (tag !== 'safe' && tag !== 'finalized' && BigInt(block.number) !== BigInt(tag))
      throw new ExitError('RPC_INVALID', 'RPC returned a different block height');
    return { number: block.number, hash: block.hash, timestamp: block.timestamp };
  }
  async assertBlock(block: Block) {
    const current = await this.block(block.number);
    if (current.hash.toLowerCase() !== block.hash.toLowerCase())
      throw new ExitError('REORG', 'Snapshot block changed');
  }
  async estimate(tx: object): Promise<bigint> {
    const estimates = await Promise.all(this.sources.map(s => this.requestOne(s, 'eth_estimateGas', [tx])));
    if (!estimates.every(isQuantity) || estimates.some(e => BigInt(e) === 0n))
      throw new ExitError('RPC_INVALID', 'Invalid RPC gas estimate');
    return estimates.map(e => BigInt(e)).reduce((a, b) => a > b ? a : b);
  }
  async gasPrice(): Promise<bigint> {
    const prices = await Promise.all(this.sources.map(s => this.requestOne(s, 'eth_gasPrice', [])));
    if (!prices.every(isQuantity)) throw new ExitError('RPC_INVALID', 'Invalid RPC gas price');
    return prices.map(price => BigInt(price)).reduce((a, b) => a > b ? a : b);
  }
}
