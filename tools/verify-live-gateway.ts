import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { assertProfileManifest, checkGatewayFile, type GatewayProfile } from './release-profile-core';
import { digest, validatePublishManifest } from './publish-core';
import { readGatewayResource } from './gateway-resource';

// This is the immutable release already uploaded and activated, not today's dist.
const profile: GatewayProfile = {
  schemaVersion: 1,
  chainId: 196,
  sourceCommit: '733ca795d9216ea43038e386ee652c1a84f112b5',
  manifestSha256: '8282142e417188b95421249ec7beb8993aaea65308c7e87b337c08a9c77415ba',
  container: '0x5A8aE6857FD40df5c7dCa7F378e4Cc74Ff58e59D',
  tapeName: '2.2.289.tape',
  gateways: [{ origin: 'https://2-2-289.netlify.app', operator: 'netlify' }],
};
const origin = profile.gateways[0].origin;
const directory = 'release-artifacts/live-gateway';
await mkdir(directory, { recursive: true });
const report: Record<string, any> = {
  ...profile,
  verifierSourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  observedAt: new Date().toISOString(),
  status: 'RUNNING',
  primaryBlockedDuringRecovery: false,
  walletTested: false,
  signingApproved: false,
  views: [],
  scope: 'One public gateway, fresh desktop/mobile Chromium contexts and pinned original publication bytes. ' +
    'Does not verify a second operator, failover, wallet extension behavior, signing or future origin changes.',
};
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch();
  for (const view of [
    { name: 'desktop', viewport: { width: 1440, height: 1000 }, isMobile: false },
    { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true },
  ]) {
    const context = await browser.newContext({
      serviceWorkers: 'allow', viewport: view.viewport, isMobile: view.isMobile,
    });
    const page = await context.newPage();
    const observed: Record<string, any> = { name: view.name, viewport: view.viewport, files: [],
      consoleErrors: [], failedRequests: [] };
    report.views.push(observed);
    page.on('pageerror', error => observed.consoleErrors.push(error.message));
    page.on('requestfailed', request => observed.failedRequests.push({
      url: request.url(), error: request.failure()?.errorText,
    }));
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await page.waitForSelector('#root', { state: 'visible', timeout: 120_000 });
      const controller = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
      if (!controller || new URL(controller).href !== `${origin}/sw.js` ||
          new URL(page.url()).origin !== origin)
        throw new Error('Expected same-origin Service Worker and application document');
      observed.controller = controller;
      const manifestResponse = await page.evaluate(readGatewayResource, {
        url: `${origin}/release-manifest.json`, maxBytes: 128 * 1024,
      });
      const manifestBytes = new Uint8Array(manifestResponse.bytes);
      assertProfileManifest(profile, manifestBytes);
      const files = [...validatePublishManifest(JSON.parse(Buffer.from(manifestBytes).toString('utf8'))), {
        path: 'release-manifest.json', size: manifestBytes.length,
        sha256: profile.manifestSha256, contentType: 'application/json',
      }];
      for (const file of files) {
        const response = file.path === 'release-manifest.json' ? manifestResponse :
          await page.evaluate(readGatewayResource, {
            url: `${origin}/${file.path}`, maxBytes: file.size,
          });
        const bytes = new Uint8Array(response.bytes);
        checkGatewayFile(profile, file, bytes, response.headers, response.url, origin);
        observed.files.push({ ...file, observedSha256: digest(bytes), headers: response.headers });
        console.log(`${view.name}: verified ${file.path} (${bytes.length} bytes)`);
      }
      const statusResponse = await page.evaluate(readGatewayResource, {
        url: `${origin}/.tape/status?json=1`, maxBytes: 128 * 1024,
      });
      if (new URL(statusResponse.url).origin !== origin) throw new Error('Status response changed origin');
      const status = JSON.parse(Buffer.from(statusResponse.bytes).toString('utf8'));
      if (status.name !== profile.tapeName || status.chainId !== 196 || status.status !== 'ok' ||
          status.container?.toLowerCase() !== profile.container.toLowerCase() ||
          status.showable !== true || status.devPreview !== false || status.paid !== true ||
          !/^[0-9]+$/.test(String(status.paidUntil)) ||
          BigInt(status.paidUntil) * 1000n <= BigInt(Date.now()) || status.stores?.ok !== true)
        throw new Error('Runtime identity, activation or store checks failed');
      observed.runtime = status;
      const layout = await page.evaluate(() => ({
        width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        text: document.body.innerText,
      }));
      observed.layout = { width: layout.width, scrollWidth: layout.scrollWidth };
      if (layout.scrollWidth > layout.width + 1 || !layout.text.includes('TapeExit') ||
          !/READ ONLY|主网只读/.test(layout.text))
        throw new Error('Expected usable read-only application layout');
      await page.screenshot({ path: `${directory}/${view.name}.png`, fullPage: true });
      observed.status = 'ORIGINAL_RELEASE_BYTES_CHECKED';
    } catch (error) {
      observed.status = 'FAILED';
      observed.error = error instanceof Error ? error.message : String(error);
      observed.finalUrl = page.url();
      observed.body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
      await page.screenshot({ path: `${directory}/${view.name}-failure.png`, fullPage: true }).catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
  report.status = 'SINGLE_GATEWAY_ORIGINAL_RELEASE_CHECKED';
  console.log(JSON.stringify({ status: report.status, origin, sourceCommit: profile.sourceCommit,
    manifestSha256: profile.manifestSha256,
    views: report.views.map((view: any) => ({ name: view.name, files: view.files.length })) }));
} catch (error) {
  report.status = 'FAILED';
  report.error = error instanceof Error ? error.message : String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  await browser?.close();
  await writeFile(`${directory}/verification.json`, JSON.stringify(report, null, 2) + '\n');
}
