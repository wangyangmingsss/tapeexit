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

async function connectedClient(initiallyAuthorized = false) {
  const base = `${process.cwd()}/tools/publication-workbench/`;
  const template = document.createElement('template');
  template.innerHTML = await readFile(`${base}index.html`, 'utf8');
  template.content.querySelectorAll('link, script').forEach(element => element.remove());
  document.body.replaceChildren(template.content);
  const publisher = '0x1000000000000000000000000000000000000001';
  const context = { contextId: 'release', publisher, fileCount: 9, totalBytes: 587736, totalOperations: 31,
    maximumWei: '7000000000000000', reservedWei: '0', attempts: [], unresolved: null,
    authorization: initiallyAuthorized ? { expiresAt: Date.now() + 3600000 } : null };
  const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => {
    return Response.json(context);
  });
  const events = new Map<string, () => void>();
  const provider = { request: vi.fn(async ({ method }: { method: string }): Promise<unknown> => {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [publisher];
    if (method === 'eth_chainId') return '0xc4';
    throw new Error(`Unexpected wallet method ${method}`);
  }), on: (event: string, callback: () => void) => events.set(event, callback),
  removeListener: (event: string) => events.delete(event) };
  let tick!: () => void, timeout!: () => void, automatic!: () => void;
  const execute = new (Object.getPrototypeOf(async () => {}).constructor)(
    'fetch', 'setInterval', 'setTimeout', 'clearTimeout', await readFile(`${base}client.js`, 'utf8'));
  await execute(fetcher, (fn: () => void) => { tick = fn; }, (fn: () => void, ms: number) => {
    if (ms === 15000) timeout = fn;
    if (ms <= 3000 && ms > 500) automatic = fn;
    return 0;
  }, () => {});
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: { info: { uuid: 'test-wallet', name: 'Test wallet' }, provider },
  }));
  const button = document.getElementById('connect') as HTMLButtonElement;
  (document.getElementById('connect') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  return { provider, fetcher, context, publisher, events, tick: () => tick(), timeout: () => timeout(),
    automatic: () => automatic() };
}

async function submissionClient() {
  const f = await connectedClient();
  const ctx = f.context as unknown as Record<string, any>;
  const transaction = { from: f.publisher, to: '0x2000000000000000000000000000000000000002',
    data: '0x12345678', value: '0x0', chainId: '0xc4', gas: '0x5208', gasPrice: '0x1', nonce: '0x0' };
  Object.assign(ctx, { registry: transaction.to, maxGas: '7000000', maxGasPriceWei: '30000000',
    authorization: { expiresAt: Date.now() + 3600000 } });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => callback({}),
  } });
  const hash = `0x${'ab'.repeat(32)}`;
  f.provider.request.mockImplementation(async ({ method }: { method: string }) => {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [f.publisher];
    if (method === 'eth_chainId') return '0xc4';
    if (method === 'eth_sendTransaction') return hash;
    throw new Error('Unexpected wallet method');
  });
  let finish!: (response: Response) => void;
  const reserved = new Promise<Response>(resolve => { finish = resolve; });
  const attempt = { id: 'attempt', operation: 0, status: 'reserved', transaction };
  f.fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/preview')) return Response.json({ id: 'preview', expiresAt: Date.now() + 180000,
      operation: 0, remaining: 31, file: 'LICENSE.txt', chunk: 0, maximumCostWei: '21000', transaction });
    if (url.endsWith('/reserve')) return reserved;
    if (url.endsWith('/hash')) ctx.attempts[0].hash = JSON.parse(String(options?.body)).hash;
    if (url.endsWith('/reconcile')) { ctx.attempts[0].status = 'confirmed'; ctx.unresolved = null; }
    return Response.json(ctx);
  });
  (document.getElementById('refresh') as HTMLButtonElement).click();
  await vi.waitFor(() => expect((document.getElementById('send') as HTMLButtonElement).disabled).toBe(false));
  return { ...f, ctx, finish: () => {
    ctx.attempts.push(attempt); ctx.unresolved = attempt.id; finish(Response.json(attempt));
  } };
}

it('shows the checked remaining confirmations instead of the historical operation upper bound', async () => {
  const f = await connectedClient(), ctx = f.context as unknown as Record<string, any>;
  Object.assign(ctx, { totalOperations: 42, requiredOperations: 34, completedOperations: 1, remainingTransactions: 33 });
  (document.getElementById('consent') as HTMLInputElement).checked = true;
  document.getElementById('consent')!.dispatchEvent(new Event('change'));
  (document.getElementById('authorize') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.getElementById('confirmed')!.textContent).toBe('1 / 34 步，剩余 33 笔'));
  expect(f.provider.request.mock.calls.some(([r]) => /send|sign|upgrade/i.test(r.method))).toBe(false);
});

it('shows the submission recheck countdown and sends once after a 45-second recheck', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const f = await submissionClient(), button = document.getElementById('send') as HTMLButtonElement;
  button.click(); button.click();
  await vi.waitFor(() => expect(button.textContent).toContain('提交前复核'));
  expect(document.getElementById('submission-progress')!.textContent).toContain('尚未请求钱包');
  now += 45000; f.tick();
  expect(button.textContent).toContain('45 秒');
  expect(f.provider.request.mock.calls.some(([r]) => r.method === 'eth_sendTransaction')).toBe(false);
  f.finish();
  await vi.waitFor(() => expect(f.ctx.attempts[0].status).toBe('confirmed'));
  expect(f.provider.request.mock.calls.filter(([r]) => r.method === 'eth_sendTransaction')).toHaveLength(1);
  expect(document.getElementById('submission-progress')!.textContent).toContain('交易哈希并保存');
});

it('reports a hung wallet state query beside the submit button without reserving or sending', async () => {
  const f = await submissionClient();
  f.provider.request.mockImplementation(() => new Promise(() => {}));
  (document.getElementById('send') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.getElementById('send')!.textContent).toContain('正在核对钱包'));
  f.timeout();
  await vi.waitFor(() => expect(document.getElementById('submission-progress')!.textContent).toContain('钱包状态查询超时'));
  expect(f.fetcher.mock.calls.some(([url]) => url.endsWith('/reserve'))).toBe(false);
  expect(f.ctx.attempts).toHaveLength(0);
});

it('automatically prepares after three seconds without submitting another wallet transaction', async () => {
  const f = await submissionClient();
  (document.getElementById('send') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.getElementById('send')!.textContent).toContain('提交前复核'));
  f.finish();
  await vi.waitFor(() => expect(document.getElementById('refresh')!.textContent).toContain('自动准备下一笔'));
  const before = f.fetcher.mock.calls.filter(([url]) => url.endsWith('/preview')).length;
  f.automatic();
  await vi.waitFor(() => expect(f.fetcher.mock.calls.filter(([url]) => url.endsWith('/preview')).length).toBe(before + 1));
  expect(f.provider.request.mock.calls.filter(([r]) => r.method === 'eth_sendTransaction')).toHaveLength(1);
});

it('retries only the same pending receipt after three seconds without preparing or sending', async () => {
  const f = await submissionClient();
  let checks = 0;
  const original = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/reconcile')) { checks++; return Response.json({ error:
      'Transaction not confirmed by both RPC sources; keep waiting' }, { status: 409 }); }
    return original(url, options);
  });
  (document.getElementById('send') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.getElementById('send')!.textContent).toContain('提交前复核'));
  f.finish();
  await vi.waitFor(() => expect(document.getElementById('reconcile')!.textContent).toContain('自动再次核验'));
  for (let i = 0; i < 4; i++) {
    f.automatic();
    await vi.waitFor(() => expect(checks).toBe(i + 2));
    await vi.waitFor(() => expect((document.getElementById('reconcile') as HTMLButtonElement).disabled).toBe(false));
  }
  expect(document.getElementById('reconcile')!.textContent).toBe('核验交易和文件');
  expect(f.ctx.unresolved).toBe('attempt');
  expect(f.fetcher.mock.calls.filter(([url]) => url.endsWith('/preview'))).toHaveLength(1);
  expect(f.provider.request.mock.calls.filter(([r]) => r.method === 'eth_sendTransaction')).toHaveLength(1);
});

it('cancels queued automatic preparation if the connected account changes', async () => {
  const f = await submissionClient();
  (document.getElementById('send') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.getElementById('send')!.textContent).toContain('提交前复核'));
  f.finish();
  await vi.waitFor(() => expect(document.getElementById('refresh')!.textContent).toContain('自动准备下一笔'));
  f.events.get('accountsChanged')!();
  f.automatic();
  expect(f.fetcher.mock.calls.filter(([url]) => url.endsWith('/preview'))).toHaveLength(1);
  expect(f.provider.request.mock.calls.filter(([r]) => r.method === 'eth_sendTransaction')).toHaveLength(1);
});

it('exposes only single upload controls and does not detect capabilities on connection', async () => {
  const f = await connectedClient();
  for (const id of ['detect-batch', 'prepare-batch', 'send-batch', 'batch-consent'])
    expect(document.getElementById(id)).toBeNull();
  expect(f.provider.request.mock.calls.every(([r]) =>
    ['eth_requestAccounts', 'eth_accounts', 'eth_chainId'].includes(r.method))).toBe(true);
  expect(f.fetcher.mock.calls.every(([url]) => url === '/api/context')).toBe(true);
});

it('resumes automatic preparation after reconnecting with existing fee consent', async () => {
  const f = await connectedClient(true);
  expect(document.getElementById('automatic-status')!.textContent).toContain('自动准备下一笔');
  expect(f.fetcher.mock.calls.some(([url]) => url.endsWith('/preview'))).toBe(false);
  f.fetcher.mockImplementation(async (url: string) => Response.json(url.endsWith('/preview')
    ? { complete: true } : f.context));
  f.automatic();
  await vi.waitFor(() => expect(document.getElementById('automatic-status')!.textContent).toContain('自动衔接已完成'));
  expect(f.fetcher.mock.calls.filter(([url]) => url.endsWith('/preview'))).toHaveLength(1);
  expect(f.provider.request.mock.calls.some(([r]) => /send|sign/i.test(r.method))).toBe(false);
});

it('starts automatic preparation after renewing expired or missing fee consent', async () => {
  const f = await connectedClient();
  expect(document.getElementById('automatic-status')!.textContent).toContain('等待确认上传费用');
  f.fetcher.mockImplementation(async (url: string) => {
    if (url.endsWith('/authorize')) f.context.authorization = { expiresAt: Date.now() + 3600000 };
    return Response.json(url.endsWith('/preview') ? { complete: true } : f.context);
  });
  (document.getElementById('consent') as HTMLInputElement).checked = true;
  document.getElementById('consent')!.dispatchEvent(new Event('change'));
  (document.getElementById('authorize') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.getElementById('automatic-status')!.textContent).toContain('自动准备下一笔'));
  f.automatic();
  await vi.waitFor(() => expect(document.getElementById('automatic-status')!.textContent).toContain('自动衔接已完成'));
  expect(f.provider.request.mock.calls.some(([r]) => /send|sign/i.test(r.method))).toBe(false);
});

it('shows preparation failures instead of silently stopping or scheduling endless retries', async () => {
  const f = await connectedClient(true);
  f.fetcher.mockImplementation(async (url: string) => url.endsWith('/preview')
    ? Response.json({ error: 'Independent RPC responses unavailable' }, { status: 409 })
    : Response.json(f.context));
  f.automatic();
  await vi.waitFor(() => expect(document.getElementById('automatic-status')!.textContent)
    .toContain('自动衔接已暂停：Independent RPC'));
  expect(f.fetcher.mock.calls.filter(([url]) => url.endsWith('/preview'))).toHaveLength(1);
  expect(f.provider.request.mock.calls.some(([r]) => /send|sign/i.test(r.method))).toBe(false);
});

async function legacyClient(mode = 'success') {
  const f = await connectedClient();
  const ctx = f.context as unknown as Record<string, any>;
  ctx.attempts = [{ id: 'legacy', operation: 0, status: 'reserved',
    batch: { operations: [0, 1], requestId: 'app-id', bundleId: 'wallet-id', needsUpgrade: true } }];
  ctx.unresolved = 'legacy';
  f.fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    if (url.endsWith('/bundle')) ctx.attempts[0].batch.bundleId = body.bundleId;
    if (url.endsWith('/hash')) ctx.attempts[0].hash = body.hash;
    if (url.endsWith('/batch-failure')) ctx.attempts[0].batch.offchainFailure = true;
    if (url.endsWith('/reconcile')) { ctx.attempts[0].status = 'confirmed'; ctx.unresolved = null; }
    return Response.json(ctx);
  });
  f.provider.request.mockImplementation(async ({ method }: { method: string }) => {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [f.publisher];
    if (method === 'eth_chainId') return '0xc4';
    if (method === 'wallet_getCallsStatus') {
      if (mode === 'unknown') throw new Error('wallet response lost');
      return { version: '2.0.0', id: mode === 'mismatch' ? 'wrong-id' : 'wallet-id', chainId: '0xc4',
        status: mode === 'partial' ? 600 : mode === 'pending' ? 100 : mode === 'failed' ? 400 : 200,
        atomic: true, receipts: mode === 'failed' ? [] : [{ transactionHash: `0x${'ab'.repeat(32)}` }] };
    }
    throw new Error('unexpected wallet method');
  });
  (document.getElementById('connect') as HTMLButtonElement).click();
  await vi.waitFor(() => expect((document.getElementById('connect') as HTMLButtonElement).disabled).toBe(false));
  return { ...f, ctx, recover: document.getElementById('recover-batch') as HTMLButtonElement };
}
it('recovers an existing batch read-only and counts both verified operations', async () => {
  const f = await legacyClient(); f.recover.click(); f.recover.click();
  await vi.waitFor(() => expect(document.getElementById('verification-result')!.textContent).toContain('本批 2 步'));
  expect(document.getElementById('confirmed')!.textContent).toBe('2 / 31 步');
  expect(f.provider.request.mock.calls.filter(([r]) => r.method === 'wallet_getCallsStatus')).toHaveLength(1);
  expect(f.provider.request.mock.calls.some(([r]) => /send|sign|upgrade/i.test(r.method))).toBe(false);
  const paths = f.fetcher.mock.calls.map(([url]) => url);
  expect(paths.indexOf('/api/hash')).toBeLessThan(paths.indexOf('/api/reconcile'));
});
it.each(['unknown', 'partial', 'pending', 'mismatch', 'failed'])(
  'keeps historical batch recovery blocked without new sends: %s', async mode => {
    const f = await legacyClient(mode); f.recover.click();
    await vi.waitFor(() => expect((document.getElementById('connect') as HTMLButtonElement).disabled).toBe(false));
    expect(f.ctx.unresolved).toBe('legacy');
    expect((document.getElementById('refresh') as HTMLButtonElement).disabled).toBe(true);
    expect(f.provider.request.mock.calls.some(([r]) => /send|sign|upgrade/i.test(r.method))).toBe(false);
    expect(f.fetcher.mock.calls.some(([url]) => url.endsWith('/reconcile'))).toBe(false);
    expect(!!f.ctx.attempts[0].batch.offchainFailure).toBe(mode === 'failed');
  });

async function activationClient(mode = 'success') {
  const f = await connectedClient();
  const ctx = f.context as unknown as Record<string, any>;
  const binding = '0x3000000000000000000000000000000000000003';
  const transaction = { from: f.publisher, to: binding, data: '0x12345678', value: '0x0',
    chainId: '0xc4', gas: '0x371d2', gasPrice: '0x1406f40', nonce: '0x0' };
  const q = { id: 'activation-quote', expiresAt: Date.now() + 120000, transaction,
    serviceFeeWei: '0', maximumGasCostWei: '4740666000000', maximumTotalWei: '4740666000000' };
  const a = { contextId: 'activation-context', publisher: f.publisher, binding, name: '2.2.289.tape',
    gasCap: '500000', gasPriceCapWei: '30000000', consent: 'activation-only', unresolved: null,
    observed: null, attempts: [] } as Record<string, any>;
  ctx.activation = a;
  // Preserve completed upload history while all activation transitions use a separate record.
  ctx.attempts = Array.from({ length: 31 }, (_, operation) => ({
    id: `upload-${operation}`, operation, status: 'confirmed',
  }));
  let settle!: () => void;
  const waiting = new Promise<void>(resolve => { settle = resolve; });
  f.fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    if (url.endsWith('/activation/preview')) return Response.json(q);
    if (url.endsWith('/activation/reserve')) {
      const item = { id: 'activation-attempt', status: 'reserved', quote: q };
      a.attempts.push(item); a.unresolved = item.id;
      return Response.json(mode === 'tampered' ? { ...item, quote: { ...q, transaction: { ...transaction, value: '0x1' } } } : item);
    }
    if (url.endsWith('/activation/hash')) a.attempts[0].hash = body.hash;
    if (url.endsWith('/activation/reconcile')) {
      if (mode === 'slow') await waiting;
      a.attempts[0].status = 'confirmed';
      a.attempts[0].state = { paidUntil: '2000000000' }; a.unresolved = null;
      return Response.json(a);
    }
    return Response.json(ctx);
  });
  f.provider.request.mockImplementation(async ({ method }: { method: string }) => {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [f.publisher];
    if (method === 'eth_chainId') return '0xc4';
    if (method === 'eth_sendTransaction') {
      if (mode === 'unknown') throw new Error('Activation wallet response lost');
      return `0x${'ab'.repeat(32)}`;
    }
    throw new Error(`Unexpected activation wallet method ${method}`);
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (_name: string, _options: unknown, fn: (lock: object) => Promise<void>) => fn({}),
  } });
  (document.getElementById('connect') as HTMLButtonElement).click();
  await vi.waitFor(() => expect((document.getElementById('connect') as HTMLButtonElement).disabled).toBe(false));
  const prepare = document.getElementById('activation-prepare') as HTMLButtonElement;
  prepare.click();
  await vi.waitFor(() => expect(document.getElementById('activation-preview')!.textContent).toContain('服务费'));
  await vi.waitFor(() => expect(prepare.disabled).toBe(false));
  const send = document.getElementById('activation-send') as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  const consent = document.getElementById('activation-consent') as HTMLInputElement;
  consent.checked = true; consent.dispatchEvent(new Event('change'));
  expect(send.disabled).toBe(false);
  return { ...f, ctx, a, q, send, settle };
}
it('requires a separate activation checkbox, submits exactly once and preserves all 31 upload steps', async () => {
  const f = await activationClient();
  expect(f.provider.request.mock.calls.some(([r]) => /send|sign/i.test(r.method))).toBe(false);
  f.send.click(); f.send.click();
  await vi.waitFor(() => expect(document.getElementById('activation-result')!.textContent).toContain('激活核验成功'));
  expect(f.provider.request.mock.calls.filter(([r]) => r.method === 'eth_sendTransaction')).toHaveLength(1);
  expect(document.getElementById('confirmed')!.textContent).toBe('31 / 31 步');
  expect(f.ctx.attempts).toHaveLength(31);
  expect(f.a.attempts).toHaveLength(1);
  const paths = f.fetcher.mock.calls.map(([url]) => url);
  expect(paths.indexOf('/api/activation/reserve')).toBeLessThan(paths.indexOf('/api/activation/hash'));
  expect(paths.some(path => path === '/api/reserve' || path === '/api/authorize')).toBe(false);
});
it.each(['unknown', 'tampered'])('keeps activation reservations after %s without an automatic resend', async mode => {
  const f = await activationClient(mode); f.send.click();
  await vi.waitFor(() => expect((document.getElementById('connect') as HTMLButtonElement).disabled).toBe(false));
  expect(f.a.unresolved).toBe('activation-attempt');
  expect(document.getElementById('activation-pending')!.hidden).toBe(false);
  expect((document.getElementById('activation-prepare') as HTMLButtonElement).disabled).toBe(true);
  expect(f.provider.request.mock.calls.filter(([r]) => r.method === 'eth_sendTransaction')).toHaveLength(mode === 'tampered' ? 0 : 1);
});
it('counts down activation verification beside the controls and displays the final expiry', async () => {
  const f = await activationClient('slow'); f.send.click();
  await vi.waitFor(() => expect(document.getElementById('activation-progress')!.textContent).toContain('核验激活结果'));
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 5000); f.tick();
  expect(document.getElementById('activation-progress')!.textContent).toContain('85 秒');
  expect((document.getElementById('activation-reconcile') as HTMLButtonElement).disabled).toBe(true);
  f.settle();
  await vi.waitFor(() => expect(document.getElementById('activation-result')!.textContent).toContain('名称到期'));
});
it('invalidates activation consent and quote when the connected account changes', async () => {
  const f = await activationClient(); f.events.get('accountsChanged')!();
  expect(f.send.disabled).toBe(true);
  expect((document.getElementById('activation-consent') as HTMLInputElement).checked).toBe(false);
  expect(f.provider.request.mock.calls.some(([r]) => /send|sign/i.test(r.method))).toBe(false);
});
