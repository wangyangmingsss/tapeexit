import { ExitError } from './rpc';
const READ_TIMEOUT = 8000;
function discard(response: Response) { void response.body?.cancel().catch(() => {}); }
async function boundedBytes(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const invalid = () => new ExitError('ENTRY_CHANGED', 'Entry response unavailable or exceeds the size limit');
  const length = response.headers.get('content-length');
  if (!response.ok || response.redirected || !response.body ||
      (length !== null && (!/^\d+$/.test(length) || BigInt(length) > BigInt(limit)))) {
    discard(response); throw invalid();
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  let size = 0;
  try {
    if (signal.aborted) abort();
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { abort(); throw invalid(); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export interface RuntimeStatus {
  mode: 'local' | 'tape-client' | 'tape-server' | 'web';
  label: string; name?: string; container?: string; block?: string; verified: boolean;
}
export function canSignRuntime(status: RuntimeStatus): boolean {
  return status.mode === 'local' || (status.mode === 'tape-client' && status.verified);
}
export function assertSigningRuntime(expected: RuntimeStatus, current: RuntimeStatus) {
  if (!canSignRuntime(expected) || !canSignRuntime(current) || expected.mode !== current.mode ||
      expected.name !== current.name || expected.container?.toLowerCase() !== current.container?.toLowerCase())
    throw new ExitError('ENTRY_CHANGED', 'Entry changed or is unverified; read and review again');
}
export async function runtimeStatus(): Promise<RuntimeStatus> {
  const controller = navigator.serviceWorker?.controller;
  if (['localhost', '127.0.0.1'].includes(location.hostname) && !controller)
    return { mode: 'local', label: 'Local application', verified: false };
  if (controller) {
    try {
      const options: RequestInit = { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        redirect: 'error', signal: AbortSignal.timeout(READ_TIMEOUT) };
      const r = await fetch('/.tape/status?json=1', options);
      const status = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
        await boundedBytes(r, 64 * 1024, options.signal!)));
      if (status && typeof status === 'object' && !Array.isArray(status) &&
          typeof status.name === 'string' && status.name.length > 0 && status.name.length <= 253 &&
          /^[a-z0-9.-]+$/i.test(status.name) && status.chainId === 196 &&
          typeof status.container === 'string' && /^0x[0-9a-f]{40}$/i.test(status.container) &&
          !/^0x0{40}$/i.test(status.container)) {
        if (navigator.serviceWorker?.controller !== controller) throw new ExitError('ENTRY_CHANGED', 'Controller changed');
        const page = await fetch('/index.html', options);
        discard(page);
        if (!page.ok || page.redirected || options.signal!.aborted || navigator.serviceWorker?.controller !== controller)
          throw new ExitError('ENTRY_CHANGED', 'Entry response or controller changed');
        const client = page.headers.get('x-tape-mode') === 'client';
        return { mode: client ? 'tape-client' : 'tape-server', label: status.name,
          name: status.name, container: status.container, block: status.block,
          verified: client && status.status === 'ok' && page.headers.get('x-tape-status') === 'ok' &&
            page.headers.get('x-tape-name') === status.name &&
            page.headers.get('x-tape-container')?.toLowerCase() === status.container.toLowerCase() &&
            page.headers.get('x-tape-verified') === '1' };
      }
    } catch { /* A normal static origin is not a verified TapeOut origin. */ }
  }
  return { mode: 'web', label: location.host, verified: false };
}
export async function manifestDigest(): Promise<string> {
  try {
    const signal = AbortSignal.timeout(READ_TIMEOUT);
    const response = await fetch('./release-manifest.json', { cache: 'no-store', credentials: 'omit',
      referrerPolicy: 'no-referrer', redirect: 'error', signal });
    const bytes = await boundedBytes(response, 256 * 1024, signal);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { throw new ExitError('MANIFEST', 'Release manifest unavailable or invalid'); }
}
