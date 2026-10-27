import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createRecoveryProxy } from '../../tools/recovery-proxy';

const fixture = '/tests/fixtures/runtime.html';
async function ready(page: Page) {
  await page.goto(fixture);
  await page.waitForFunction(() => !!window.harness);
}
test('native Web Locks exclude another tab and preserve intent after the sending tab closes', async ({ context, page }) => {
  await ready(page);
  const other = await context.newPage();
  await ready(other);
  await page.evaluate(() => window.harness.start());
  await expect.poll(() => page.evaluate(() => window.harness.count())).toBe(1);
  await other.evaluate(() => window.harness.start());
  await expect.poll(() => other.evaluate(() => window.harness.outcome())).toBe('SUBMISSION_LOCK');
  expect(await other.evaluate(() => window.harness.count())).toBe(0);
  await page.close();
  await other.evaluate(() => window.harness.start());
  await expect.poll(() => other.evaluate(() => window.harness.outcome())).toBe('SUBMISSION_BLOCKED');
  await other.reload();
  await other.waitForFunction(() => !!window.harness);
  expect(await other.evaluate(() => window.harness.state().state)).toBe('blocked');
});
test('explicit cancellation releases the native lock and shared intent for another tab', async ({ context, page }) => {
  await ready(page);
  const other = await context.newPage();
  await ready(other);
  await page.evaluate(() => window.harness.start());
  await expect.poll(() => page.evaluate(() => window.harness.count())).toBe(1);
  await page.evaluate(() => window.harness.finish('reject'));
  await expect.poll(() => page.evaluate(() => window.harness.outcome())).toBe('4001');
  await other.evaluate(() => window.harness.start());
  await expect.poll(() => other.evaluate(() => window.harness.count())).toBe(1);
  await other.evaluate(() => window.harness.finish('unknown'));
  await expect.poll(() => other.evaluate(() => window.harness.state().state)).toBe('blocked');
});
test('a real Service Worker controller replacement changes identity and invalidates the old runtime', async ({ page }) => {
  await ready(page);
  expect(await page.evaluate(() => window.harness.runtime())).toMatchObject({ mode: 'local' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/tests/fixtures/identity-sw.js?v=1', { scope: '/tests/fixtures/' });
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const original = await page.evaluate(() => window.harness.runtime());
  expect(original).toMatchObject({ mode: 'tape-client', verified: true, container: `0x${'11'.repeat(20)}` });
  await page.evaluate(async () => {
    const changed = new Promise<void>(resolve => navigator.serviceWorker.addEventListener(
      'controllerchange', () => resolve(), { once: true }));
    await navigator.serviceWorker.register('/tests/fixtures/identity-sw.js?v=2', { scope: '/tests/fixtures/' });
    await changed;
  });
  const current = await page.evaluate(() => window.harness.runtime());
  expect(current).toMatchObject({ verified: true, container: `0x${'22'.repeat(20)}` });
  expect(await page.evaluate(({ original, current }) => {
    try { window.harness.assertRuntime(original, current); return 'accepted'; }
    catch (error) { return (error as { code: string }).code; }
  }, { original, current })).toBe('ENTRY_CHANGED');
});
test('recovery proxy blocks a request issued inside an actual Service Worker', async ({ browser }) => {
  const proxy = await createRecoveryProxy('primary.example');
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ baseURL: 'http://127.0.0.1:4174',
      serviceWorkers: 'allow', proxy: { server: proxy.url, bypass: '127.0.0.1' } });
    const page = await context.newPage();
    await ready(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/tests/fixtures/identity-sw.js?v=1', { scope: '/tests/fixtures/' });
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const result = await page.evaluate(() => new Promise<string>(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data); };
      navigator.serviceWorker.controller!.postMessage('probe-primary', [channel.port2]);
    }));
    expect(result).toBe('blocked');
    expect(proxy.blockedCount()).toBeGreaterThan(0);
  } finally { await context?.close(); await proxy.close(); }
});
