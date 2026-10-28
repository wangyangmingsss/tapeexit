// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSigningRuntime, canSignRuntime, manifestDigest, runtimeStatus, type RuntimeStatus } from '../src/core/runtime';

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
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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
  it.each([[], { ...identity, name: 'x'.repeat(254) }, { ...identity, name: ' bad.tape' },
    { ...identity, name: 'bad\nname' }, { ...identity, container: `0x${'0'.repeat(40)}` }])(
    'rejects unbounded or invalid identity %j', async value => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(value)));
      expect(await runtimeStatus()).toMatchObject({ mode: 'web', verified: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  it.each(['{', '{"name":"\ufffd"}'])('rejects malformed JSON or invalid identity %s', async text => {
    fetchMock.mockResolvedValueOnce(new Response(text));
    expect(canSignRuntime(await runtimeStatus())).toBe(false);
  });
  it('rejects invalid UTF-8 even inside an otherwise unused property', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ ...identity, unused: 'x' }));
    bytes[bytes.length - 3] = 255;
    fetchMock.mockResolvedValueOnce(new Response(bytes));
    expect(canSignRuntime(await runtimeStatus())).toBe(false);
  });
  it.each(['65537', '-1', 'unknown'])('rejects invalid or excessive status content-length %s', async length => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), {
      headers: { 'content-length': length },
    }));
    expect(canSignRuntime(await runtimeStatus())).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, '1'])('caps actual streamed status bytes with declared length %s', async length => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(65536)); c.enqueue(new Uint8Array(1)); }, cancel,
    }), { headers: length ? { 'content-length': length } : {} }));
    expect(canSignRuntime(await runtimeStatus())).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('accepts an exact-limit status split across stream chunks', async () => {
    const text = JSON.stringify(identity).padEnd(65536, ' ');
    const bytes = new TextEncoder().encode(text);
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      start(c) { c.enqueue(bytes.slice(0, 10)); c.enqueue(bytes.slice(10)); c.close(); },
    })));
    expect(canSignRuntime(await runtimeStatus())).toBe(true);
  });
  it('cancels page content after inspecting its headers', async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(identity))).mockResolvedValueOnce(
      new Response(new ReadableStream({ cancel }), { headers }));
    expect(canSignRuntime(await runtimeStatus())).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[1][1].signal).toBe(fetchMock.mock.calls[0][1].signal);
    expect(fetchMock.mock.calls[1][1].redirect).toBe('error');
  });
  it('stops before fetching the page if the controller changes during status reading', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(new ReadableStream({
      start(c) { serviceWorker.controller = {}; c.enqueue(new TextEncoder().encode(JSON.stringify(identity))); c.close(); },
    })));
    expect(canSignRuntime(await runtimeStatus())).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([0, 1])('rejects a redirected response at request %s', async index => {
    const redirected = new Response(index ? '' : JSON.stringify(identity), { headers });
    Object.defineProperty(redirected, 'redirected', { value: true });
    if (index) fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(identity)));
    fetchMock.mockResolvedValueOnce(redirected);
    expect(canSignRuntime(await runtimeStatus())).toBe(false);
  });
  it('aborts a stalled status stream and cancels its reader', async () => {
    const controller = new AbortController(), cancel = vi.fn();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      pull() { started(); }, cancel,
    })));
    const result = runtimeStatus();
    await reading; controller.abort();
    expect(await result).toMatchObject({ mode: 'web', verified: false });
    expect(cancel).toHaveBeenCalledOnce();
    expect(AbortSignal.timeout).toHaveBeenCalledWith(8000);
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
    expect(canSignRuntime(await runtimeStatus())).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(2);
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
describe('bounded recovery manifest digest', () => {
  it('accepts an exact-limit manifest stream', async () => {
    const bytes = new Uint8Array(262144);
    fetchMock.mockResolvedValueOnce(new Response(bytes));
    expect(await manifestDigest()).toMatch(/^[a-f0-9]{64}$/);
  });
  it('hashes exact bytes with credentials omitted, no redirects and a deadline', async () => {
    const bytes = new TextEncoder().encode('{\n "fixture": true\n}\n');
    fetchMock.mockResolvedValueOnce(new Response(bytes));
    const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      n => n.toString(16).padStart(2, '0')).join('');
    expect(await manifestDigest()).toBe(expected);
    expect(fetchMock.mock.calls[0]).toEqual(['./release-manifest.json', expect.objectContaining({
      cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      signal: expect.any(AbortSignal),
    })]);
  });
  it.each(['262145', 'invalid'])('rejects invalid or excessive manifest length %s', async length => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), {
      headers: { 'content-length': length },
    }));
    await expect(manifestDigest()).rejects.toMatchObject({ code: 'MANIFEST' });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('caps the actual manifest stream', async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(262144)); c.enqueue(new Uint8Array(1)); }, cancel,
    })));
    await expect(manifestDigest()).rejects.toMatchObject({ code: 'MANIFEST' });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([404, 503])('cancels failed HTTP %s without hashing it', async status => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status }));
    await expect(manifestDigest()).rejects.toMatchObject({ code: 'MANIFEST' });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects a redirected manifest response', async () => {
    const response = new Response('{}'); Object.defineProperty(response, 'redirected', { value: true });
    fetchMock.mockResolvedValueOnce(response);
    await expect(manifestDigest()).rejects.toMatchObject({ code: 'MANIFEST' });
  });
  it('aborts a stalled manifest and preserves the stable error code', async () => {
    const controller = new AbortController(), cancel = vi.fn();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ pull() { started(); }, cancel })));
    const result = expect(manifestDigest()).rejects.toMatchObject({ code: 'MANIFEST' });
    await reading; controller.abort(); await result;
    expect(cancel).toHaveBeenCalledOnce();
  });
});
