import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { createPublicationWorkbenchServer } from '../tools/publication-workbench-server';
import type { PublicationWorkbench } from '../tools/publication-workbench-core';
import type { PublicationActivation } from '../tools/publication-activation';

describe('loopback-only publication server', () => {
  let server: http.Server;
  const port = 14734, origin = `http://127.0.0.1:${port}`;
  const bench = {
    context: vi.fn(() => ({ schemaVersion: 1, attempts: [] })),
    authorize: vi.fn(async () => ({ accepted: true })),
    prepareNext: vi.fn(async () => ({ operation: 0 })),
    reserve: vi.fn(async () => ({ status: 'reserved' })),
    attachHash: vi.fn(async () => ({})), reconcile: vi.fn(async () => ({})),
    recordCapabilities: vi.fn(async () => ({ recorded: true })),
    reserveBatch: vi.fn(async () => ({ attempt: {}, request: {} })),
    recordBundle: vi.fn(async () => ({})), recordBatchFailure: vi.fn(async () => ({})),
  };
  const headers = { origin, 'content-type': 'application/json', 'x-tapeexit-client': 'publication-workbench' };
  const activation = { context: vi.fn(() => ({ months: 1, unresolved: null as string | null })), refresh: vi.fn(async () => ({})),
    previewActivation: vi.fn(async () => ({})), reserve: vi.fn(async () => ({})),
    attachHash: vi.fn(async () => ({})), reconcile: vi.fn(async () => ({})), cancel: vi.fn(async () => ({})) };
  beforeAll(async () => { server = await createPublicationWorkbenchServer(bench as unknown as PublicationWorkbench, port,
    activation as unknown as PublicationActivation); });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  });
  it('serves only known assets with restrictive CSP and no CORS', async () => {
    const page = await fetch(origin);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('发行文件上传');
    expect(page.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(page.headers.get('access-control-allow-origin')).toBeNull();
    expect((await fetch(`${origin}/api/context`)).status).toBe(200);
    expect((await fetch(`${origin}/icon.png`)).status).toBe(200);
    expect((await fetch(`${origin}/../../package.json`)).status).toBe(405);
  });
  it('blocks cross-origin, simple-form, hostile Host and missing client headers', async () => {
    for (const values of [
      { ...headers, origin: 'https://evil.example' },
      { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      { origin, 'content-type': 'application/json' },
      { ...headers, 'sec-fetch-site': 'cross-site' },
    ]) {
      expect((await fetch(`${origin}/api/authorize`, { method: 'POST', headers: values, body: '{}' })).status).toBe(403);
    }
    const hostile = await new Promise(resolve => {
      const req = http.get(origin, { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', resolve);
    });
    expect(hostile).toBe(403);
    expect(bench.authorize).not.toHaveBeenCalled();
  });
  it('accepts only exact action fields and rejects arbitrary transaction/broadcast routes', async () => {
    const post = (path: string, body: object) => fetch(origin + path, { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await post('/api/preview', {})).status).toBe(200);
    expect((await post('/api/authorize', { contextId: 'context', maximumWei: '7' })).status).toBe(200);
    expect(bench.authorize).toHaveBeenCalledWith('context', '7');
    expect((await post('/api/reserve', { previewId: 'id', to: 'arbitrary' })).status).toBe(409);
    expect(bench.reserve).not.toHaveBeenCalled();
    expect((await post('/api/broadcast', { raw: '0x01' })).status).toBe(404);
    expect((await post('/api/hash', { attemptId: 'a', hash: 'hash' })).status).toBe(200);
    expect(bench.attachHash).toHaveBeenCalledWith('a', 'hash');
    expect((await post('/api/preview', { extra: 'x'.repeat(5000) })).status).toBe(413);
  });
  it('records only scoped capability observations and never accepts a batch submission', async () => {
    const post = (path: string, body: object) => fetch(origin + path, { method: 'POST', headers, body: JSON.stringify(body) });
    const report = { contextId: 'release', publisher: 'publisher', chainId: 196, outcome: 'reported', atomicStatus: 'supported' };
    expect((await post('/api/capabilities', report)).status).toBe(200);
    expect(bench.recordCapabilities).toHaveBeenCalledWith('release', 'publisher', 196, 'reported', 'supported');
    expect((await post('/api/capabilities', { ...report, calls: [] })).status).toBe(409);
    expect((await post('/api/sendCalls', { calls: [] })).status).toBe(404);
  });
  it('accepts exact batch preview, reservation and recovery fields without a broadcast endpoint', async () => {
    const post = (path: string, body: object) => fetch(origin + path, { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await post('/api/batch-preview', {})).status).toBe(200);
    expect(bench.prepareNext).toHaveBeenCalledWith(true);
    expect((await post('/api/batch-reserve', { previewId: 'p', consent: 'c' })).status).toBe(200);
    expect(bench.reserveBatch).toHaveBeenCalledWith('p', 'c');
    expect((await post('/api/bundle', { attemptId: 'a', bundleId: 'b' })).status).toBe(200);
    expect(bench.recordBundle).toHaveBeenCalledWith('a', 'b');
    expect((await post('/api/batch-failure', { attemptId: 'a', reason: 'USER_REJECTED_4001' })).status).toBe(200);
    expect((await post('/api/batch-reserve', { previewId: 'p', consent: 'c', calls: [] })).status).toBe(409);
  });
  it('requires exact activation fields and the same origin without accepting supplied calldata', async () => {
    const post = (path: string, body: object, custom = headers) =>
      fetch(origin + '/api/activation/' + path, { method: 'POST', headers: custom, body: JSON.stringify(body) });
    expect((await post('preview', {})).status).toBe(200);
    expect(activation.previewActivation).toHaveBeenCalledOnce();
    expect((await post('reserve', { previewId: 'q', consent: 'c', maximumTotalWei: '4' })).status).toBe(200);
    expect(activation.reserve).toHaveBeenCalledWith('q', 'c', '4');
    expect((await post('reserve', { previewId: 'q', consent: 'c', maximumTotalWei: '4', transaction: {} })).status).toBe(409);
    expect((await post('reserve', {}, { ...headers, origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('hash', { attemptId: 'a', hash: 'h' })).status).toBe(200);
    expect(activation.attachHash).toHaveBeenCalledWith('a', 'h');
    expect((await post('reconcile', {})).status).toBe(200);
    expect((await post('refresh', {})).status).toBe(200);
    expect((await post('cancel', { attemptId: 'a', acknowledgement: 'c' })).status).toBe(200);
    expect((await post('broadcast', { raw: '0x' })).status).toBe(404);
  });
  it('blocks another upload reservation while activation is unresolved', async () => {
    activation.context.mockReturnValueOnce({ months: 1, unresolved: 'activation-attempt' });
    const before = bench.reserve.mock.calls.length;
    const result = await fetch(origin + '/api/reserve', { method: 'POST', headers, body: JSON.stringify({ previewId: 'p' }) });
    expect(result.status).toBe(409);
    expect((await result.json()).error).toContain('pending activation');
    expect(bench.reserve.mock.calls).toHaveLength(before);
  });
});
