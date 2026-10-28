import { test, expect } from '@playwright/test';
import { readGatewayResource } from '../../tools/gateway-resource';

test('required recovery and signing-boundary browser APIs are available', async ({ page, browser }) => {
  await page.goto('http://127.0.0.1:4175');
  const capabilities = await page.evaluate(() => ({
    webLocks: typeof navigator.locks?.request === 'function',
    serviceWorker: typeof navigator.serviceWorker?.register === 'function',
    subtleCrypto: typeof crypto.subtle?.digest === 'function',
    streams: typeof ReadableStream === 'function',
    bigint: BigInt('340282366920938463463374607431768211456').toString() === '340282366920938463463374607431768211456',
  }));
  expect(Object.values(capabilities).every(Boolean)).toBe(true);
  await test.info().attach('browser-capabilities', { contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ engine: test.info().project.name, version: browser.version(), capabilities })) });
});
test('gateway verification reader enforces actual byte bounds inside the browser', async ({ page }) => {
  await page.goto('http://127.0.0.1:4175');
  await page.route('**/bounded-resource', route => route.fulfill({ status: 200, body: '123', contentType: 'text/plain' }));
  const input = { url: 'http://127.0.0.1:4175/bounded-resource', maxBytes: 3 };
  expect((await page.evaluate(readGatewayResource, input)).bytes).toEqual([49, 50, 51]);
  await expect(page.evaluate(readGatewayResource, { ...input, maxBytes: 2 })).rejects.toThrow('limit');
});
test('gateway verification reader rejects browser redirects without following them', async ({ page }) => {
  await page.goto('http://127.0.0.1:4181');
  let destinationHits = 0;
  await page.route('**/bounded-target', route => { destinationHits++; return route.fulfill({ body: 'unexpected' }); });
  await expect(page.evaluate(readGatewayResource, {
    url: 'http://127.0.0.1:4181/bounded-redirect', maxBytes: 20,
  })).rejects.toThrow();
  expect(destinationHits).toBe(0);
});
