import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { httpRequest, StrictRpc } from '../src/core/rpc';

const sources = [
  { url: 'https://a.example', operator: 'a' },
  { url: 'https://b.example', operator: 'b' },
];
const envelope = (result: unknown) => ({ jsonrpc: '2.0', id: 1, result });
function respond(value: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(value))));
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('RPC HTTP response contract', () => {
  it.each([null, false, 0, '', [], { nested: ['0xc4'] }])('preserves valid result %j', async result => {
    respond(envelope(result));
    await expect(httpRequest(sources[0], 'eth_chainId', [])).resolves.toEqual(result);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    expect(JSON.parse(init!.body as string)).toEqual({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    null, [], [envelope('0xc4')], '0xc4', 1,
    { id: 1, result: '0xc4' },
    { jsonrpc: '1.0', id: 1, result: '0xc4' },
    { jsonrpc: '2.0', id: '1', result: '0xc4' },
    { jsonrpc: '2.0', id: 2, result: '0xc4' },
    { jsonrpc: '2.0', id: null, result: '0xc4' },
    { jsonrpc: '2.0', id: 1 },
    { ...envelope('0xc4'), error: null },
    { ...envelope('0xc4'), error: { code: -32000, message: 'revert' } },
    { jsonrpc: '2.0', id: 1, error: null },
    { jsonrpc: '2.0', id: 1, error: [] },
    { jsonrpc: '2.0', id: 1, error: { code: '-32000', message: 'revert' } },
    { jsonrpc: '2.0', id: 1, error: { code: 1.5, message: 'revert' } },
    { jsonrpc: '2.0', id: 1, error: { code: -32000 } },
  ])('rejects malformed or mismatched envelope %j', async value => {
    respond(value);
    await expect(httpRequest(sources[0], 'eth_chainId', [])).rejects.toMatchObject({ code: 'RPC_INVALID' });
  });
  it('preserves a valid RPC error and bounds its message', async () => {
    respond({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'x'.repeat(300), data: '0x' } });
    await expect(httpRequest(sources[0], 'eth_call', [])).rejects.toMatchObject({
      code: 'RPC_REVERT', message: 'x'.repeat(180),
    });
  });
  it.each(['{', ''])('rejects malformed JSON %j', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    await expect(httpRequest(sources[0], 'eth_chainId', [])).rejects.toMatchObject({ code: 'RPC_INVALID' });
  });
  it('rejects invalid UTF-8 instead of repairing response bytes', async () => {
    const prefix = new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"result":"');
    const suffix = new TextEncoder().encode('"}');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([...prefix, 0xff, ...suffix]))));
    await expect(httpRequest(sources[0], 'eth_chainId', [])).rejects.toMatchObject({ code: 'RPC_INVALID' });
  });
  it('rejects oversized declared content without reading it', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-length': '4194305' } })));
    await expect(httpRequest(sources[0], 'eth_chainId', [])).rejects.toMatchObject({ code: 'RPC_INVALID' });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('caps streamed content even when the declared length is absent or misleading', async () => {
    for (const headers of [new Headers(), new Headers({ 'content-length': '1' })]) {
      const cancel = vi.fn();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(4 * 1024 * 1024));
          controller.enqueue(new Uint8Array(1));
        }, cancel,
      });
      vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers })));
      await expect(httpRequest(sources[0], 'eth_chainId', [])).rejects.toMatchObject({ code: 'RPC_INVALID' });
      expect(cancel).toHaveBeenCalledOnce();
    }
  });
  it('preserves HTTP failures and does not parse their bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    await expect(httpRequest(sources[0], 'eth_chainId', [])).rejects.toMatchObject({
      code: 'RPC_UNAVAILABLE', message: 'RPC HTTP 429',
    });
  });
  it('cannot form a quorum from matching results in invalid envelopes', async () => {
    respond({ id: 1, result: '0xc4' });
    await expect(new StrictRpc(sources).checkChain(196)).rejects.toMatchObject({ code: 'QUORUM' });
  });
});

describe('RPC quantities', () => {
  it.each([196, '196', '0x00', '0x', '-0x1', '0x' + 'f'.repeat(65), null])(
    'rejects noncanonical chain, estimate and price values %j', async value => {
      const rpc = new StrictRpc(sources, async () => value);
      await expect(rpc.checkChain(196)).rejects.toMatchObject({ code: 'RPC_INVALID' });
      await expect(rpc.estimate({})).rejects.toMatchObject({ code: 'RPC_INVALID' });
      await expect(rpc.gasPrice()).rejects.toMatchObject({ code: 'RPC_INVALID' });
    });
  it('rejects a malformed value from either gas source even when the other is valid', async () => {
    const rpc = new StrictRpc(sources, async source => source.operator === 'a' ? '0x5208' : '21000');
    await expect(rpc.estimate({})).rejects.toMatchObject({ code: 'RPC_INVALID' });
    await expect(rpc.gasPrice()).rejects.toMatchObject({ code: 'RPC_INVALID' });
  });
  it('rejects zero gas estimates but preserves a valid zero gas price', async () => {
    const rpc = new StrictRpc(sources, async () => '0x0');
    await expect(rpc.estimate({})).rejects.toMatchObject({ code: 'RPC_INVALID' });
    await expect(rpc.gasPrice()).resolves.toBe(0n);
  });
  it('uses the greater valid estimate or price without requiring equality', async () => {
    const rpc = new StrictRpc(sources, async source => source.operator === 'a' ? '0x5208' : '0x6000');
    await expect(rpc.estimate({})).resolves.toBe(24576n);
    await expect(rpc.gasPrice()).resolves.toBe(24576n);
  });
});

describe('actual HTTP transport boundaries', () => {
  let server: Server, url: string, redirected = 0;
  let started: () => void;
  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(307, { location: '/destination' }); response.end();
      } else if (request.url === '/destination') {
        redirected++; response.end(JSON.stringify(envelope('0xc4')));
      } else if (request.url === '/stall') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('{"jsonrpc":"2.0",'); started();
      } else response.end(JSON.stringify(envelope('0xc4')));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    url = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  it('reads a real HTTP result and never follows redirects', async () => {
    await expect(httpRequest({ url, operator: 'local' }, 'eth_chainId', [])).resolves.toBe('0xc4');
    await expect(httpRequest({ url: `${url}/redirect`, operator: 'local' }, 'eth_chainId', [])).rejects.toThrow();
    expect(redirected).toBe(0);
  });
  it('keeps the deadline signal active while reading a stalled response body', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const headersSent = new Promise<void>(resolve => { started = resolve; });
    const request = httpRequest({ url: `${url}/stall`, operator: 'local' }, 'eth_chainId', []);
    const rejected = expect(request).rejects.toThrow();
    await headersSent;
    controller.abort(new Error('Fixture deadline'));
    await rejected;
    expect(AbortSignal.timeout).toHaveBeenCalledWith(8000);
  });
});
