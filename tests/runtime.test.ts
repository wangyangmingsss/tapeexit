// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSigningRuntime, canSignRuntime, runtimeStatus, type RuntimeStatus } from '../src/core/runtime';

const container = '0x1000000000000000000000000000000000000001';
const name = '1.2.0.tape';
const identity = { name, chainId: 196, container, block: '0x10', status: 'ok' };
const headers = { 'x-tape-mode': 'client', 'x-tape-verified': '1', 'x-tape-status': 'ok',
  'x-tape-name': name, 'x-tape-container': container };
let serviceWorker: { controller: object | null };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  serviceWorker = { controller: {} };
  vi.stubGlobal('navigator', { serviceWorker });
  vi.stubGlobal('location', { hostname: 'gateway.example', host: 'gateway.example' });
  fetchMock = vi.fn(async (path: string) => path.startsWith('/.tape/status') ?
    new Response(JSON.stringify(identity)) : new Response('', { headers }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });
describe('entry classification and signing permission', () => {
  it('accepts a consistent client-verified live entry', async () => {
    expect(await runtimeStatus()).toMatchObject({
      mode: 'tape-client', name, container, verified: true,
    });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/.tape/status?json=1', '/index.html']);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  });
  it('uses local mode only on loopback without a controlling service worker', async () => {
    vi.stubGlobal('location', { hostname: 'localhost', host: 'localhost:4173' });
    expect(await runtimeStatus()).toMatchObject({ mode: 'tape-client' });
    serviceWorker.controller = null;
    expect(await runtimeStatus()).toEqual({ mode: 'local', label: 'Local application', verified: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('keeps a static remote origin read-only', async () => {
    serviceWorker.controller = null;
    const entry = await runtimeStatus();
    expect(entry.mode).toBe('web');
    expect(canSignRuntime(entry)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { 'x-tape-mode': 'server' },
    { 'x-tape-verified': '0' },
    { 'x-tape-status': 'unpaid' },
    { 'x-tape-name': '2.2.0.tape' },
    { 'x-tape-container': '0x2000000000000000000000000000000000000002' },
  ])('does not grant signing for inconsistent page headers %j', async change => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(identity)))
      .mockResolvedValueOnce(new Response('', { headers: { ...headers, ...change } }));
    const entry = await runtimeStatus();
    expect(entry.verified).toBe(false);
    expect(canSignRuntime(entry)).toBe(false);
  });
  it.each([
    { ...identity, chainId: 1 },
    { ...identity, container: 'invalid' },
    { ...identity, name: '' },
    null,
  ])('rejects invalid status identities %j', async status => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(status)));
    expect(await runtimeStatus()).toMatchObject({ mode: 'web', verified: false });
  });
  it('keeps unpaid client content read-only even if page headers claim verification', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...identity, status: 'unpaid' })));
    expect(canSignRuntime(await runtimeStatus())).toBe(false);
  });
  it.each([0, 1])('rejects failed HTTP response at request %s', async failed => {
    if (failed === 0) fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    else fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(identity)))
      .mockResolvedValueOnce(new Response('', { status: 404, headers }));
    expect(await runtimeStatus()).toMatchObject({ mode: 'web', verified: false });
  });
  it('rejects a controller change while awaiting the entry response', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(identity))).mockImplementationOnce(async () => {
      serviceWorker.controller = {};
      return new Response('', { headers });
    });
    expect(await runtimeStatus()).toMatchObject({ mode: 'web', verified: false });
  });
  it('treats an unavailable status endpoint as unverified', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Timed out'));
    expect(await runtimeStatus()).toMatchObject({ mode: 'web', verified: false });
  });
  it('allows a stable local runtime or verified client identity, including an advancing block', () => {
    const local: RuntimeStatus = { mode: 'local', label: 'Local', verified: false };
    const client: RuntimeStatus = { mode: 'tape-client', label: name, name, container, verified: true, block: '0x10' };
    expect(() => assertSigningRuntime(local, local)).not.toThrow();
    expect(() => assertSigningRuntime(client, { ...client, block: '0x11' })).not.toThrow();
    for (const change of [
      { mode: 'local' }, { mode: 'tape-server' }, { verified: false },
      { name: '2.2.0.tape' }, { container: '0x2000000000000000000000000000000000000002' },
    ] as Partial<RuntimeStatus>[]) {
      expect(() => assertSigningRuntime(client, { ...client, ...change })).toThrow('Entry changed');
    }
  });
});
