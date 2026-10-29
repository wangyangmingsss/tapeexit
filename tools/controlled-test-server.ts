import http from 'node:http';
import { readFile } from 'node:fs/promises';
import type { ControlledTest } from './controlled-test-core';

export async function createControlledTestServer(bench: ControlledTest, port: number, sourceCommit: string,
  options: { readOnly?: boolean } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid test port');
  const origin = `http://127.0.0.1:${port}`;
  const headers = {
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
      "base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'",
  };
  const files = new Map();
  for (const [route, name, type] of [
    ['/', options.readOnly ? 'recovery.html' : 'index.html', 'text/html'],
    ['/client.js', options.readOnly ? 'recovery.js' : 'client.js', 'text/javascript'],
    ['/styles.css', '../publication-workbench/styles.css', 'text/css'],
  ]) files.set(route, { bytes: await readFile(new URL(`./controlled-test/${name}`, import.meta.url)), type });
  const server = http.createServer(async (req, res) => {
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { ...headers, 'content-type': 'application/json' }); res.end(JSON.stringify(value));
    };
    if (req.headers.host !== `127.0.0.1:${port}` || req.headers.origin && req.headers.origin !== origin ||
        req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])))
      return reply(403, { error: 'Foreign Host or origin blocked' });
    if (req.method === 'GET' && files.has(req.url)) {
      const { bytes, type } = files.get(req.url);
      res.writeHead(200, { ...headers, 'content-type': `${type}; charset=utf-8` }); return res.end(bytes);
    }
    if (req.method === 'GET' && req.url === '/api/context')
      return reply(200, { ...bench.context(), sourceCommit, readOnly: !!options.readOnly });
    if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    if (req.headers.origin !== origin || req.headers['x-tapeexit-client'] !== 'controlled-test' ||
        req.headers['content-type'] !== 'application/json')
      return reply(403, { error: 'Same-origin JSON required' });
    if (options.readOnly && req.url !== '/api/reconcile')
      return reply(405, { error: 'Read-only recovery: operation disabled' });
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) return reply(413, { error: 'Request too large' });
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const exact = (keys: string[]) => {
        if (!body || Array.isArray(body) || typeof body !== 'object' ||
            Object.keys(body).length !== keys.length || keys.some(k => !Object.hasOwn(body, k)))
          throw new Error('Unexpected request fields');
      };
      switch (req.url) {
        case '/api/preview': exact([]); return reply(200, await bench.preview());
        case '/api/reserve':
          exact(['previewId', 'consent', 'maximumGasCostWei']);
          return reply(200, await bench.reserve(body.previewId, body.consent, body.maximumGasCostWei));
        case '/api/hash':
          exact(['id', 'hash']); return reply(200, await bench.attachHash(body.id, body.hash));
        case '/api/reconcile': exact([]); return reply(200, await bench.reconcile());
        case '/api/cancel':
          exact(['id', 'acknowledgement']); return reply(200, await bench.cancel(body.id, body.acknowledgement));
        default: return reply(404, { error: 'Unknown test operation' });
      }
    } catch (error) {
      reply(409, { error: error instanceof Error ? error.message.slice(0, 240) : 'Test check failed' });
    }
  });
  server.headersTimeout = 10_000; server.requestTimeout = 15_000;
  await new Promise<void>((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  return server;
}
