import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import http from 'node:http';
import { createControlledTestServer } from '../tools/controlled-test-server';
import type { ControlledTest } from '../tools/controlled-test-core';

const bench = { context: vi.fn(() => ({ policy: {}, attempts: [] })),
  preview: vi.fn(async () => ({})), reserve: vi.fn(async () => ({})), attachHash: vi.fn(async () => ({})),
  reconcile: vi.fn(async () => ({})), cancel: vi.fn(async () => ({})) };
const port = 14735, origin = `http://127.0.0.1:${port}`;
const headers = { origin, 'content-type': 'application/json', 'x-tapeexit-client': 'controlled-test' };
let server: http.Server;
beforeAll(async () => { server = await createControlledTestServer(bench as unknown as ControlledTest, port, 'ab'.repeat(20)); });
afterAll(async () => {
  await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
});
it('serves only pinned static routes and loopback origin with no remote executable resources', async () => {
  const page = await fetch(origin);
  expect(await page.text()).toContain('退出 1%');
  expect(page.headers.get('content-security-policy')).toContain("connect-src 'self'");
  expect((await fetch(origin + '/client.js')).status).toBe(200);
  expect((await fetch(origin + '/api/context')).status).toBe(200);
  expect((await fetch(origin + '/package.json')).status).toBe(405);
});
it('rejects foreign origins, extra parameters, large bodies and arbitrary broadcast routes', async () => {
  const post = (path: string, body: object, h = headers) =>
    fetch(origin + '/api/' + path, { method: 'POST', headers: h, body: JSON.stringify(body) });
  expect((await post('preview', {}, { ...headers, origin: 'https://evil.example' })).status).toBe(403);
  expect((await post('reserve', { previewId: 'q', consent: 'c', maximumGasCostWei: '1', data: '0x' })).status).toBe(409);
  expect(bench.reserve).not.toHaveBeenCalled();
  expect((await post('broadcast', { raw: '0x' })).status).toBe(404);
  expect((await post('preview', { extra: 'x'.repeat(5000) })).status).toBe(413);
  expect((await post('reserve', { previewId: 'q', consent: 'c', maximumGasCostWei: '1' })).status).toBe(200);
  expect(bench.reserve).toHaveBeenCalledWith('q', 'c', '1');
});
