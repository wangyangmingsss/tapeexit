import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { manifestDigest, runtimeStatus } from '../src/core/runtime';

let server: Server, url: string, destination = 0, path = '/ok';
let started: () => void;
const nativeFetch = globalThis.fetch;
beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(307, { location: '/destination' }); response.end(); }
    else if (request.url === '/destination') { destination++; response.end('{}'); }
    else if (request.url === '/stall') {
      response.writeHead(200, { 'content-type': 'application/json' }); response.write('{'); started();
    } else response.end('{"fixture":true}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback port');
  url = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function route() {
  vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => nativeFetch(url + path, init));
}
it('hashes actual HTTP bytes and blocks redirect destinations', async () => {
  route(); path = '/ok';
  expect(await manifestDigest()).toMatch(/^[a-f0-9]{64}$/);
  path = '/redirect';
  await expect(manifestDigest()).rejects.toMatchObject({ code: 'MANIFEST' });
  expect(destination).toBe(0);
});
it.each(['manifest', 'status'])('enforces the deadline during a real stalled %s HTTP body', async kind => {
  route(); path = '/stall';
  vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
  vi.stubGlobal('location', { hostname: 'gateway.example', host: 'gateway.example' });
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const headersSent = new Promise<void>(resolve => { started = resolve; });
  const result = kind === 'manifest' ?
    expect(manifestDigest()).rejects.toMatchObject({ code: 'MANIFEST' }) :
    expect(runtimeStatus()).resolves.toMatchObject({ mode: 'web', verified: false });
  await headersSent; controller.abort(new Error('Fixture deadline'));
  await result;
  expect(AbortSignal.timeout).toHaveBeenCalledWith(8000);
});
