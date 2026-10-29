import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadPublication, digest } from './publish-core';
import { createRecoveryProxy } from './recovery-proxy';
import { parseGatewayRecoveryTask } from './gateway-recovery-task';
import { verifyBrowserRecovery } from './gateway-recovery-browser';
import { readGatewayResource } from './gateway-resource';
// @ts-expect-error The existing loopback static server is dependency-free JavaScript.
import { createLocalServer } from './local-server.mjs';

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Use the exact clean source for live recovery acceptance');
const publication = await loadPublication('dist');
const manifest = JSON.parse(publication.contents.find(c => c.file.path === 'release-manifest.json')!.bytes.toString());
if (manifest.sourceCommit !== git('rev-parse', 'HEAD')) throw new Error('Build the current clean source first');
const task = parseGatewayRecoveryTask(JSON.parse(await readFile('docs/gateway-recovery-task-67042.json', 'utf8')));
const directory = 'release-artifacts/recovery-failure';
await mkdir(directory, { recursive: true });
const hosts = ['2-2-289.netlify.app', '2-2-289.vercel.app', 'app.uniswap.org', 'interface.gateway.uniswap.org'];
const report: Record<string, any> = { sourceCommit: manifest.sourceCommit, manifestSha256: publication.manifestSha256,
  observedAt: new Date().toISOString(), status: 'RUNNING', signingApproved: false, independentReview: 'NOT_COMPLETED',
  task, blockedHosts: hosts, views: [], environment: 'FRESH_BROWSER_LOCAL_PACKAGE_MAINNET_READ_ONLY',
  limitations: 'Real HTTPS CONNECT blocks and real RPC reads. Not a clean physical device, wallet extension acceptance, public candidate deployment or proof of backend independence.' };
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const server = await createLocalServer('dist', 4192);
const proxy = await createRecoveryProxy(hosts);
try {
  browser = await chromium.launch();
  for (const view of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ locale: 'zh-CN', viewport: view,
      serviceWorkers: 'allow', proxy: { server: proxy.url, bypass: '127.0.0.1,localhost' } });
    const observed: Record<string, any> = { name: view.name, probes: [] };
    report.views.push(observed);
    try {
      for (const host of hosts) {
        const before = proxy.blockedByHost()[host] || 0, probe = await context.newPage();
        let error = '';
        try { await probe.goto(`https://${host}`, { timeout: 10000 }); }
        catch (e) { error = e instanceof Error ? e.message : String(e); }
        finally { await probe.close(); }
        if (!error || (proxy.blockedByHost()[host] || 0) <= before) throw new Error(`Host block not exercised: ${host}`);
        observed.probes.push({ host, blocked: true, error });
      }
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:4192/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#root', { state: 'visible' });
      for (const { file } of publication.contents) {
        const resource = await page.evaluate(readGatewayResource, { url: `http://127.0.0.1:4192/${file.path}`, maxBytes: file.size });
        if (resource.url !== `http://127.0.0.1:4192/${file.path}` ||
            digest(new Uint8Array(resource.bytes)) !== file.sha256) throw new Error(`Local release bytes differ: ${file.path}`);
      }
      observed.recovery = await verifyBrowserRecovery(page, task, view.name === 'mobile',
        `${directory}/${view.name}-recovery.json`);
      await page.screenshot({ path: `${directory}/${view.name}.png`, fullPage: true });
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
        throw new Error('Recovery page overflows viewport');
      observed.blockedByHost = proxy.blockedByHost();
      observed.status = 'LOCAL_RECOVERY_WITH_PUBLIC_ORIGINS_BLOCKED';
    } finally { await context.close(); }
  }
  report.status = 'LOCAL_READ_ONLY_FAULT_RECOVERY_CHECKED';
  report.blockedByHost = proxy.blockedByHost();
} catch (error) {
  report.status = 'FAILED'; report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await browser?.close(); await proxy.close();
  await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  report.completedAt = new Date().toISOString();
  await writeFile(`${directory}/verification.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
