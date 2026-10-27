import { ExitError } from './rpc';
export interface RuntimeStatus {
  mode: 'local' | 'tape-client' | 'tape-server' | 'web';
  label: string; name?: string; container?: string; block?: string; verified: boolean;
}
export async function runtimeStatus(): Promise<RuntimeStatus> {
  if (['localhost', '127.0.0.1'].includes(location.hostname) && !navigator.serviceWorker?.controller)
    return { mode: 'local', label: 'Local application', verified: false };
  if (navigator.serviceWorker?.controller) {
    try {
      const r = await fetch('./.tape/status?json=1', { cache: 'no-store' });
      const status = await r.json();
      if (status.name && status.chainId === 196) {
        const page = await fetch('./index.html', { cache: 'no-store' });
        const client = page.headers.get('x-tape-mode') === 'client';
        return { mode: client ? 'tape-client' : 'tape-server', label: status.name,
          name: status.name, container: status.container, block: status.block,
          verified: client && status.status === 'ok' && page.headers.get('x-tape-verified') === '1' };
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
