import http from 'node:http';
import { readFile } from 'node:fs/promises';
import type { PublicationWorkbench } from './publication-workbench-core';

const headers = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; " +
    "connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'",
};
export async function createPublicationWorkbenchServer(workbench: PublicationWorkbench, port: number) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid publication workbench port');
  const origin = `http://127.0.0.1:${port}`;
  const staticFiles = new Map();
  for (const [route, file, type] of [
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/client.js', 'client.js', 'text/javascript; charset=utf-8'],
    ['/styles.css', 'styles.css', 'text/css; charset=utf-8'],
    ['/icon.png', '../../public/icon.png', 'image/png'],
  ]) {
    const bytes = await readFile(new URL(`./publication-workbench/${file}`, import.meta.url));
    staticFiles.set(route, { bytes, type });
  }
  const server = http.createServer(async (req, res) => {
    const reply = (status: number, value: unknown) => {
      const bytes = Buffer.from(JSON.stringify(value));
      res.writeHead(status, { ...headers, 'content-type': 'application/json', 'content-length': bytes.length });
      res.end(bytes);
    };
    if (req.headers.host !== `127.0.0.1:${port}`) return reply(403, { error: 'Open the exact 127.0.0.1 address' });
    if (req.headers.origin && req.headers.origin !== origin) return reply(403, { error: 'Foreign origin blocked' });
    if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin' &&
        req.headers['sec-fetch-site'] !== 'none') return reply(403, { error: 'Cross-site request blocked' });
    const path = req.url;
    if (req.method === 'GET' && staticFiles.has(path)) {
      const { bytes, type } = staticFiles.get(path);
      res.writeHead(200, { ...headers, 'content-type': type, 'content-length': bytes.length });
      return res.end(bytes);
    }
    if (req.method === 'GET' && path === '/api/context') return reply(200, workbench.context());
    if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    if (req.headers.origin !== origin || req.headers['x-tapeexit-client'] !== 'publication-workbench' ||
        req.headers['content-type'] !== 'application/json') return reply(403, { error: 'Same-origin JSON request required' });
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) return reply(413, { error: 'Request too large' });
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'JSON object required' });
      const exactKeys = (keys: string[]) => {
        if (Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key)))
          throw new Error('Unexpected request fields');
      };
      switch (path) {
        case '/api/preview':
          exactKeys([]); return reply(200, await workbench.prepareNext());
        case '/api/authorize':
          exactKeys(['contextId', 'maximumWei']); return reply(200, await workbench.authorize(body.contextId, body.maximumWei));
        case '/api/reserve':
          exactKeys(['previewId']); return reply(200, await workbench.reserve(body.previewId));
        case '/api/hash':
          exactKeys(['attemptId', 'hash']); return reply(200, await workbench.attachHash(body.attemptId, body.hash));
        case '/api/reconcile':
          exactKeys([]); return reply(200, await workbench.reconcile());
        case '/api/capabilities':
          exactKeys(['contextId', 'publisher', 'chainId', 'outcome', 'atomicStatus']);
          return reply(200, await workbench.recordCapabilities(body.contextId, body.publisher, body.chainId,
            body.outcome, body.atomicStatus));
        case '/api/cancel-request':
          exactKeys(['attemptId', 'acknowledgement']);
          return reply(200, await workbench.acknowledgeCancellation(body.attemptId, body.acknowledgement));
        default: return reply(404, { error: 'Unknown operation' });
      }
    } catch (error) {
      reply(409, { error: error instanceof Error ? error.message.slice(0, 240) : 'Publication check failed' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  return server;
}
