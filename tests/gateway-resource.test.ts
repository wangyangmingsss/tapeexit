import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { readGatewayResource } from '../tools/gateway-resource';
afterEach(() => vi.unstubAllGlobals());
it('accepts exact-bound resources, omits credentials and refuses redirects', async () => {
  const fetcher = vi.fn(async () => new Response('123', { headers: { 'content-length': '3' } }));
  vi.stubGlobal('fetch', fetcher);
  expect((await readGatewayResource({ url: 'https://gateway.example/file', maxBytes: 3 })).bytes).toEqual([49, 50, 51]);
  expect(fetcher.mock.calls[0]).toEqual(['https://gateway.example/file', expect.objectContaining({
    credentials: 'omit', redirect: 'error', cache: 'no-store',
  })]);
});
it.each(['declared', 'streamed'])('rejects %s excess bytes and cancels the stream', async mode => {
  let cancelled = false;
  vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array([1, 2, 3, 4])); },
    cancel() { cancelled = true; },
  }), { headers: mode === 'declared' ? { 'content-length': '4' } : {} }));
  await expect(readGatewayResource({ url: 'https://gateway.example/file', maxBytes: 3 })).rejects.toThrow('limit');
  expect(cancelled).toBe(true);
});
it.each([-1, 0.5, 64 * 1024 * 1024 + 1])('rejects invalid byte limit %s before fetch', async maxBytes => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(readGatewayResource({ url: 'https://gateway.example/file', maxBytes })).rejects.toThrow('bound');
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects failed HTTP and releases its body', async () => {
  let cancelled = false;
  vi.stubGlobal('fetch', async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 503 }));
  await expect(readGatewayResource({ url: 'https://gateway.example/file', maxBytes: 3 })).rejects.toThrow('HTTP');
  expect(cancelled).toBe(true);
});
it('never follows a real redirect and times out while a real HTTP body stalls', async () => {
  let destinationHits = 0;
  const server = createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/destination' }); res.end(); }
    else if (req.url === '/stall') { res.writeHead(200); res.write('a'); }
    else { destinationHits++; res.end('unexpected'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await expect(readGatewayResource({ url: `${origin}/redirect`, maxBytes: 10 })).rejects.toThrow();
    expect(destinationHits).toBe(0);
    await expect(readGatewayResource({ url: `${origin}/stall`, maxBytes: 10, timeoutMs: 50 })).rejects.toThrow();
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
