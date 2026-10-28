// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

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
