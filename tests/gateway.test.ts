import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
// @ts-expect-error Zero-dependency gateway bootstrap server is JavaScript.
import { createGatewayServer } from '../tools/gateway.mjs';
describe('gateway bootstrap routing (not a deployed TapeOut site)', () => {
  let root: string, server: http.Server;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'tapeexit-gateway-'));
    await mkdir(join(root, '.tape/kernel'), { recursive: true });
    await writeFile(join(root, 'index.html'), 'bootstrap');
    await writeFile(join(root, 'sw.js'), 'service worker');
    await writeFile(join(root, '.tape/kernel/index.js'), 'kernel');
    server = await createGatewayServer(root, 18096);
  });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (root) await rm(root, { recursive: true, force: true });
  });
  async function request(path: string, host = '1-2-344.localhost:18096') {
    return new Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port: 18096, path, headers: { host } }, res => {
        let text = '';
        res.on('data', bytes => { text += bytes; });
        res.on('end', () => resolve({ status: res.statusCode!, text, headers: res.headers }));
      }).on('error', reject);
    });
  }
  it('preserves multi-chain host label and reserved bootstrap paths', async () => {
    expect((await request('/arbitrary/site/path')).text).toBe('bootstrap');
    const sw = await request('/sw.js');
    expect(sw.text).toBe('service worker');
    expect(sw.headers['service-worker-allowed']).toBe('/');
    expect((await request('/.tape/kernel/index.js')).text).toBe('kernel');
    expect((await request('/.tape/missing')).status).toBe(404);
  });
  it('rejects hostile hosts and traversal before filesystem access', async () => {
    expect((await request('/', 'evil.example:18096')).status).toBe(403);
    expect((await request('/.tape/%2e%2e/secret')).status).toBe(400);
  });
});
