// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); Reflect.deleteProperty(navigator, 'locks'); });

it('shows a slow quote and its error locally, then permits a successful retry without wallet calls', async () => {
  const base = `${process.cwd()}/tools/publication-workbench/`;
  const template = document.createElement('template');
  template.innerHTML = await readFile(`${base}index.html`, 'utf8');
  template.content.querySelectorAll('link, script').forEach(element => element.remove());
  document.body.replaceChildren(template.content);
  let settle!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { settle = resolve; });
  const context = { fileCount: 9, totalBytes: 587736, totalOperations: 31,
    maximumWei: '7000000000000000', reservedWei: '0', attempts: [], unresolved: null };
  const fetcher = vi.fn(async (url: string) => url.endsWith('/preview') ?
    pending : Response.json(context));
  const source = await readFile(`${base}client.js`, 'utf8');
  const execute = new (Object.getPrototypeOf(async () => {}).constructor)(
    'fetch', 'setInterval', 'setTimeout', source);
  await execute(fetcher, () => 0, () => 0);
  const button = document.getElementById('refresh') as HTMLButtonElement;
  const preview = document.getElementById('preview')!;
  button.click();
  expect(button.disabled).toBe(true);
  expect(button.textContent).toContain('正在准备');
  expect(preview.textContent).toContain('正在核对两个 RPC');
  settle(Response.json({ error: 'RPC unavailable' }, { status: 409 }));
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(preview.textContent).toContain('RPC unavailable');
  fetcher.mockImplementation(async (url: string) => Response.json(url.endsWith('/preview') ? {
    operation: 1, remaining: 30, file: 'THIRD-PARTY-NOTICES.txt', chunk: 0,
    maximumCostWei: '1', expiresAt: Date.now() + 30000,
    transaction: { gas: '0x5208', gasPrice: '0x1' },
  } : context));
  button.click();
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(preview.textContent).toContain('THIRD-PARTY-NOTICES.txt');
  expect(fetcher.mock.calls.every(([url]) => /\/api\/(context|preview)$/.test(url))).toBe(true);
});

it.each(['confirmed', 'reverted'])('counts down verification, preserves errors and displays the checked outcome: %s', async outcome => {
  const base = `${process.cwd()}/tools/publication-workbench/`;
  const template = document.createElement('template');
  template.innerHTML = await readFile(`${base}index.html`, 'utf8');
  template.content.querySelectorAll('link, script').forEach(element => element.remove());
  document.body.replaceChildren(template.content);
  let now = 100000, tick!: () => void, settle!: (response: Response) => void;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const pending = new Promise<Response>(resolve => { settle = resolve; });
  const context = { fileCount: 9, totalBytes: 587736, totalOperations: 31,
    maximumWei: '7000000000000000', reservedWei: '0', unresolved: 'attempt',
    attempts: [{ id: 'attempt', operation: 1, status: 'reserved', hash: `0x${'ab'.repeat(32)}` }] };
  const fetcher = vi.fn(async (url: string) => url.endsWith('/reconcile') ? pending : Response.json(context));
  const execute = new (Object.getPrototypeOf(async () => {}).constructor)(
    'fetch', 'setInterval', 'setTimeout', await readFile(`${base}client.js`, 'utf8'));
  await execute(fetcher, (callback: () => void) => { tick = callback; }, () => 0);
  const button = document.getElementById('reconcile') as HTMLButtonElement;
  const result = document.getElementById('verification-result')!;
  button.click(); button.click();
  expect(button.disabled).toBe(true);
  expect(button.textContent).toContain('90 秒');
  now += 5000; tick();
  expect(button.textContent).toContain('85 秒');
  expect(document.getElementById('verification-progress')!.textContent).toContain('已等待 5 秒');
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/reconcile'))).toHaveLength(1);
  settle(Response.json({ error: 'request timed out' }, { status: 409 }));
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(result.hidden).toBe(false);
  expect(result.textContent).toContain('无需重新发送');
  expect(context.unresolved).toBe('attempt');
  fetcher.mockImplementation(async () => {
    context.unresolved = '';
    context.attempts[0].status = outcome;
    return Response.json(context);
  });
  button.click();
  await vi.waitFor(() => expect(result.textContent).toContain(outcome === 'confirmed' ? '核验成功' : '回滚'));
  expect(result.hidden).toBe(false);
  expect(document.getElementById('pending-section')!.hidden).toBe(true);
  expect(fetcher.mock.calls.every(([url]) => /\/api\/(context|reconcile)$/.test(url))).toBe(true);
});

async function capabilityClient(read: () => Promise<unknown>) {
  const base = `${process.cwd()}/tools/publication-workbench/`;
  const template = document.createElement('template');
  template.innerHTML = await readFile(`${base}index.html`, 'utf8');
  template.content.querySelectorAll('link, script').forEach(element => element.remove());
  document.body.replaceChildren(template.content);
  const publisher = '0x1000000000000000000000000000000000000001';
  const context = { contextId: 'release', publisher, fileCount: 9, totalBytes: 587736, totalOperations: 31,
    maximumWei: '7000000000000000', reservedWei: '0', attempts: [], unresolved: null, walletCapabilities: null };
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (_url.endsWith('/capabilities')) context.walletCapabilities = JSON.parse(String(options?.body));
    return Response.json(context);
  });
  const events = new Map<string, () => void>();
  const provider = { request: vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [publisher];
    if (method === 'eth_chainId') return '0xc4';
    if (method === 'wallet_getCapabilities') return read();
    throw new Error(`Unexpected wallet method ${method}`);
  }), on: (event: string, callback: () => void) => events.set(event, callback),
  removeListener: (event: string) => events.delete(event) };
  let tick!: () => void, timeout!: () => void;
  const execute = new (Object.getPrototypeOf(async () => {}).constructor)(
    'fetch', 'setInterval', 'setTimeout', 'clearTimeout', await readFile(`${base}client.js`, 'utf8'));
  await execute(fetcher, (fn: () => void) => { tick = fn; }, (fn: () => void, ms: number) => {
    if (ms === 15000) timeout = fn;
    return 0;
  }, () => {});
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: { info: { uuid: 'capability-test-wallet', name: 'Capability test wallet' }, provider },
  }));
  const button = document.getElementById('detect-batch') as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  (document.getElementById('connect') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  return { button, provider, fetcher, context, publisher, events,
    tick: () => tick(), timeout: () => timeout(), result: document.getElementById('batch-capability')! };
}

it.each([
  [{ '0xc4': { atomic: { status: 'supported' } } }, 'reported', 'supported'],
  [{ '0xc4': { atomic: { status: 'ready' } } }, 'reported', 'ready'],
  [{ '0xC4': { atomic: { status: 'unsupported' } } }, 'reported', 'unsupported'],
  [{ '0x1': { atomic: { status: 'supported' } } }, 'not-reported', null],
  [{ '0x0': { atomic: { status: 'supported' } } }, 'not-reported', null],
  [{ '0xc4': {} }, 'not-reported', null],
  [{ '0xc4': { atomic: { status: true } } }, 'invalid-response', null],
  [[], 'invalid-response', null],
  [null, 'invalid-response', null],
  [{ '0xc4': { atomic: { status: 'supported' } }, '0xC4': { atomic: { status: 'unsupported' } } }, 'invalid-response', null],
])('records only explicit X Layer capability observations: %j', async (value, outcome, atomicStatus) => {
  const f = await capabilityClient(async () => value);
  f.button.click();
  await vi.waitFor(() => expect(f.button.disabled).toBe(false));
  expect(f.context.walletCapabilities).toMatchObject({ outcome, atomicStatus });
  expect(f.provider.request).toHaveBeenCalledWith({
    method: 'wallet_getCapabilities', params: [f.publisher, ['0xc4']],
  });
  expect(f.provider.request.mock.calls.every(([request]) =>
    ['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'wallet_getCapabilities'].includes(request.method))).toBe(true);
  expect(f.fetcher.mock.calls.every(([url]) => /\/api\/(context|capabilities)$/.test(url))).toBe(true);
  expect(f.result.textContent).toContain(['ready', 'supported'].includes(String(atomicStatus))
    ? '可准备两步批量' : '当前上传仍采用逐笔确认');
});

it('shows a countdown, prevents duplicate detection and ignores a late result after timeout', async () => {
  let settle!: (value: unknown) => void;
  const pending = new Promise(resolve => { settle = resolve; });
  const f = await capabilityClient(() => pending);
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  f.button.click(); f.button.click();
  await vi.waitFor(() => expect(f.provider.request.mock.calls.filter(([r]) => r.method === 'wallet_getCapabilities')).toHaveLength(1));
  expect(f.button.textContent).toContain('15 秒');
  vi.mocked(Date.now).mockReturnValue(now + 5000); f.tick();
  expect(f.button.textContent).toContain('10 秒');
  f.timeout();
  await vi.waitFor(() => expect(f.button.disabled).toBe(false));
  expect(f.context.walletCapabilities).toMatchObject({ outcome: 'timeout', atomicStatus: null });
  settle({ '0xc4': { atomic: { status: 'supported' } } });
  await Promise.resolve(); await Promise.resolve();
  expect(f.context.walletCapabilities).toMatchObject({ outcome: 'timeout' });
  expect(f.fetcher.mock.calls.filter(([url]) => url.endsWith('/capabilities'))).toHaveLength(1);
});

it('does not persist capability results from a wallet that changed during detection', async () => {
  let settle!: (value: unknown) => void;
  const f = await capabilityClient(() => new Promise(resolve => { settle = resolve; }));
  f.button.click();
  await vi.waitFor(() => expect(settle).toBeDefined());
  f.events.get('accountsChanged')!();
  settle({ '0xc4': { atomic: { status: 'supported' } } });
  await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toMatch(/变化|不匹配/));
  expect(f.context.walletCapabilities).toBeNull();
  expect(f.fetcher.mock.calls.some(([url]) => url.endsWith('/capabilities'))).toBe(false);
});

it('reports an unsupported wallet method without falling back to any transaction request', async () => {
  const f = await capabilityClient(async () => { throw Object.assign(new Error('Method not found'), { code: -32601 }); });
  f.button.click();
  await vi.waitFor(() => expect(f.button.disabled).toBe(false));
  expect(f.context.walletCapabilities).toMatchObject({ outcome: 'method-unavailable', atomicStatus: null });
  expect(f.result.textContent).toContain('未提供能力检测接口');
  expect(f.provider.request.mock.calls.some(([r]) => /send|sign|upgrade/i.test(r.method))).toBe(false);
});

async function batchClient(mode = 'success') {
  const f = await capabilityClient(async () => ({ '0xc4': { atomic: { status: 'ready' } } }));
  f.button.click();
  await vi.waitFor(() => expect(f.button.disabled).toBe(false));
  const ctx = f.context as unknown as Record<string, any>;
  const registry = '0x2000000000000000000000000000000000000002';
  Object.assign(ctx, { registry, maxGas: '7000000', maxGasPriceWei: '30000000',
    authorization: { expiresAt: Date.now() + 3600000 }, batch: { consent: 'batch-consent' } });
  const calls = [0, 1].map(n => ({ to: registry, data: `0x1234560${n}`, value: '0x0' }));
  const transaction = { from: f.publisher, to: f.publisher, data: '0xabcdef12', value: '0x0',
    chainId: '0xc4', gas: '0xd59f80', gasPrice: '0x1c9c380', nonce: '0x0' };
  const preview = { id: 'preview', expiresAt: Date.now() + 60000, operation: 0, remaining: 31,
    maximumCostWei: '420000000000000', transaction,
    batch: { operations: [0, 1], files: [{ file: 'index.js', chunk: 1 }, { file: 'index.js', chunk: 2 }],
      calls, estimatedGas: '10000000', needsUpgrade: true, implementation: registry } };
  f.fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    if (url.endsWith('/batch-preview')) return Response.json(preview);
    if (url.endsWith('/batch-reserve')) {
      const attempt = { id: 'a', operation: 0, status: 'reserved', transaction, batch: {
        operations: [0, 1], requestId: 'app-id', needsUpgrade: true } };
      ctx.attempts = [attempt]; ctx.unresolved = attempt.id;
      return Response.json({ attempt, request: { version: '2.0.0', id: 'app-id', from: f.publisher,
        chainId: '0xc4', atomicRequired: true,
        calls: mode === 'tampered' ? [{ ...calls[0], data: '0x00' }, calls[1]] : calls } });
    }
    if (url.endsWith('/bundle')) ctx.attempts[0].batch.bundleId = body.bundleId;
    if (url.endsWith('/hash')) ctx.attempts[0].hash = body.hash;
    if (url.endsWith('/batch-failure')) ctx.attempts[0].batch.offchainFailure = true;
    if (url.endsWith('/reconcile')) { ctx.attempts[0].status = 'confirmed'; ctx.unresolved = null; }
    return Response.json(ctx);
  });
  f.provider.request.mockImplementation(async ({ method }: { method: string }) => {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [f.publisher];
    if (method === 'eth_chainId') return '0xc4';
    if (method === 'wallet_sendCalls') {
      if (mode === 'unknown') throw new Error('wallet response lost');
      if (mode === 'rejected') throw Object.assign(new Error('User rejected'), { code: 4001 });
      return { id: 'wallet-id' };
    }
    if (method === 'wallet_getCallsStatus') return { version: '2.0.0', id: 'wallet-id', chainId: '0xc4',
      status: mode === 'partial' ? 600 : mode === 'pending' ? 100 : 200, atomic: true,
      receipts: [{ transactionHash: `0x${'ab'.repeat(32)}` }] };
    throw new Error('unexpected wallet method');
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (_name: string, _options: unknown, fn: (lock: object) => Promise<void>) => fn({}),
  } });
  (document.getElementById('prepare-batch') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.getElementById('batch-preview')!.textContent).toContain('index.js'));
  await vi.waitFor(() => expect((document.getElementById('prepare-batch') as HTMLButtonElement).disabled).toBe(false));
  const send = document.getElementById('send-batch') as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  const consent = document.getElementById('batch-consent') as HTMLInputElement;
  consent.checked = true; consent.dispatchEvent(new Event('change'));
  expect(send.disabled).toBe(false);
  return { ...f, send, ctx };
}
it('submits one durable atomic batch, checks wallet status and counts two verified steps', async () => {
  const f = await batchClient();
  f.send.click(); f.send.click();
  await vi.waitFor(() => expect(document.getElementById('verification-result')!.textContent).toContain('本批 2 步'));
  expect(document.getElementById('confirmed')!.textContent).toBe('2 / 31 步');
  expect(f.provider.request.mock.calls.filter(([r]) => r.method === 'wallet_sendCalls')).toHaveLength(1);
  expect(f.provider.request.mock.calls.some(([r]) => r.method === 'eth_sendTransaction')).toBe(false);
  const paths = f.fetcher.mock.calls.map(([url]) => url);
  expect(paths.indexOf('/api/batch-reserve')).toBeLessThan(paths.indexOf('/api/bundle'));
  expect(paths.indexOf('/api/hash')).toBeLessThan(paths.indexOf('/api/reconcile'));
});
it.each(['unknown', 'rejected', 'tampered', 'partial', 'pending'])('preserves unresolved batch without fallback: %s', async mode => {
  const f = await batchClient(mode);
  f.send.click();
  await vi.waitFor(() => expect((document.getElementById('connect') as HTMLButtonElement).disabled).toBe(false));
  expect(f.ctx.unresolved).toBe('a');
  expect((document.getElementById('refresh') as HTMLButtonElement).disabled).toBe(true);
  expect(f.provider.request.mock.calls.some(([r]) => r.method === 'eth_sendTransaction')).toBe(false);
  expect(f.fetcher.mock.calls.some(([url]) => url.endsWith('/reconcile'))).toBe(false);
  expect(f.provider.request.mock.calls.filter(([r]) => r.method === 'wallet_sendCalls'))
    .toHaveLength(mode === 'tampered' ? 0 : 1);
  if (mode === 'rejected' || mode === 'tampered') expect(f.ctx.attempts[0].batch.offchainFailure).toBe(true);
});
