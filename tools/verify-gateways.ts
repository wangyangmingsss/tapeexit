import { chromium } from '@playwright/test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadPublication } from './publish-core';
import { checkGatewayFile, parseGatewayProfile } from './release-profile-core';

const output = 'release-artifacts/gateway-verification.json';
await rm(output, { force: true });
const [path] = process.argv.slice(2);
if (!path || process.argv.length !== 3) throw new Error('Usage: npm run verify:gateways -- <profile.json>');
const profile = parseGatewayProfile(JSON.parse(await readFile(path, 'utf8')));
const publication = await loadPublication('dist');
if (publication.manifestSha256 !== profile.manifestSha256 ||
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== profile.sourceCommit ||
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
  throw new Error('Gateway check requires current clean release identity');
const browser = await chromium.launch();
try {
  const gateways = [];
  for (const [index, gateway] of profile.gateways.entries()) {
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    try {
      // The backup is tested in a fresh browser context with all primary-origin requests blocked.
      const primary = profile.gateways[0].origin;
      const blockedRequests: string[] = [];
      if (index === 1) await context.route(`${primary}/**`, route => {
        blockedRequests.push(new URL(route.request().url()).pathname);
        return route.abort('internetdisconnected');
      });
      const page = await context.newPage();
      if (index === 1) {
        await page.goto(primary, { timeout: 10_000 }).catch(() => {});
        if (!blockedRequests.length) throw new Error('Primary block was not exercised');
      }
      await page.goto(gateway.origin, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 });
      await page.waitForSelector('#root', { state: 'attached', timeout: 60_000 });
      for (const { file } of publication.contents) {
        const response = await page.evaluate(async path => {
          const response = await fetch(`/${path}`, { cache: 'no-store', credentials: 'omit',
            signal: AbortSignal.timeout(60_000) });
          if (!response.ok) throw new Error(`Gateway HTTP ${response.status}`);
          return { url: response.url, headers: Object.fromEntries(response.headers),
            bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
            controller: navigator.serviceWorker.controller?.scriptURL };
        }, file.path);
        if (!response.controller || new URL(response.controller).origin !== gateway.origin)
          throw new Error('Missing same-origin Service Worker controller');
        checkGatewayFile(profile, file, new Uint8Array(response.bytes), response.headers, response.url, gateway.origin);
      }
      const status = await page.evaluate(async () => {
        const response = await fetch('/.tape/status?json=1', { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error('Gateway status unavailable');
        return response.json();
      });
      if (status.name !== profile.tapeName || status.container?.toLowerCase() !== profile.container.toLowerCase() ||
          status.chainId !== 196 || status.status !== 'ok') throw new Error('Gateway runtime identity mismatch');
      gateways.push({ ...gateway, releaseBytesChecked: true, filesChecked: publication.contents.length,
        status, blockedPrimaryRequests: blockedRequests.length });
    } finally { await context.close(); }
  }
  await mkdir('release-artifacts', { recursive: true });
  await writeFile(output, JSON.stringify({ ...profile, observedAt: new Date().toISOString(),
    status: 'TWO_GATEWAYS_CHECKED', primaryBlockedDuringRecovery: true, gateways,
    scope: 'Fresh Chromium contexts, client-mode identity headers and exact release bytes. ' +
      'Backup tested with primary origin blocked. No wallet transactions. ' +
      'Does not authenticate upstream worker code, operator independence or protect against future origin changes.',
  }, null, 2) + '\n');
  console.log('Two gateway client origins and backup recovery checked. No signing performed.');
} finally { await browser.close(); }
