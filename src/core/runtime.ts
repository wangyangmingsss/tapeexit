import { ExitError } from './rpc';
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
        signal: AbortSignal.timeout(8000) };
      const r = await fetch('/.tape/status?json=1', options);
      if (!r.ok) throw new ExitError('ENTRY_CHANGED', 'Entry status unavailable');
      const status = await r.json();
      if (typeof status.name === 'string' && status.name.length > 0 && status.chainId === 196 &&
          typeof status.container === 'string' && /^0x[0-9a-f]{40}$/i.test(status.container)) {
        const page = await fetch('/index.html', options);
        if (!page.ok || navigator.serviceWorker?.controller !== controller)
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
  const response = await fetch('./release-manifest.json', { cache: 'no-store' });
  if (!response.ok) throw new ExitError('MANIFEST', 'Release manifest unavailable');
  const bytes = await response.arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
