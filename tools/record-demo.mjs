import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const dir = resolve('release-artifacts/demo-video');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
  throw new Error('Record from a clean source commit');
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
const server = await createServer({ mode: 'demo', server: { host: '127.0.0.1', port: 4190, strictPort: true } });
let browser, context;
try {
  await server.listen();
  browser = await chromium.launch();
  context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 },
    recordVideo: { dir, size: { width: 1440, height: 1000 } } });
  const page = await context.newPage();
  const scenes = [];
  async function scene(name) {
    scenes.push({ name, observedAt: new Date().toISOString() });
    // Deliberate recording pacing; not a synchronization substitute.
    await page.waitForTimeout(1500);
  }
  await page.goto('http://127.0.0.1:4190/');
  await page.getByText('隔离演示 · 测试资产').waitFor();
  await scene('isolation-demo-introduction');
  await page.getByRole('navigation').getByRole('button', { name: '资产总览', exact: true }).click();
  await page.getByText('TEST-USDC / TEST-USDT').waitFor();
  await scene('supported-assets-and-planned-protocols');
  await page.getByRole('button', { name: '打开仓位 28491' }).click();
  await page.getByRole('button', { name: '读取仓位' }).click();
  await page.getByText('TEST-USDC / TEST-USDT').waitFor();
  await scene('test-position-loaded');
  await page.getByRole('button', { name: '50%', exact: true }).click();
  await page.getByRole('button', { name: '预演退出' }).click();
  await page.getByRole('button', { name: '核对交易', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await scene('target-recipient-and-minimums-review');
  await page.getByRole('checkbox', { name: '我已核对目标、仓位和收款地址；此操作由我确认。' }).check();
  await page.getByRole('button', { name: '确认模拟退出' }).click();
  await page.getByText('领取证据已核对').waitFor();
  await page.getByText('模拟结果，不代表真实链上交易。').waitFor();
  await scene('simulation-result');
  await page.screenshot({ path: `${dir}/poster.png`, fullPage: true });
  await page.getByLabel('故障演练').selectOption('conflict');
  await page.getByRole('button', { name: '读取仓位' }).click();
  await page.getByRole('alert').filter({ hasText: '读取结果不一致' }).waitFor();
  await scene('simulated-source-conflict-stops-flow');
  await page.getByRole('button', { name: '恢复入口', exact: true }).click();
  await page.getByRole('region', { name: 'TapeOut 与恢复路径' }).waitFor();
  await scene('tapeout-recorded-release-and-recovery-routes');
  const video = page.video();
  await context.close();
  context = null;
  await video.saveAs(`${dir}/TapeExit-Isolation-Demo.webm`);
  const bytes = await readFile(`${dir}/TapeExit-Isolation-Demo.webm`);
  await writeFile(`${dir}/recording.json`, JSON.stringify({ schemaVersion: 1, sourceCommit,
    environment: 'ISOLATION_DEMO', generatedAt: new Date().toISOString(), scenes,
    videoSha256: createHash('sha256').update(bytes).digest('hex'),
    scope: 'Automatically recorded local simulation. No real wallet, mainnet transaction, user study or TapeOut deployment. ' +
      'Silent short demonstration, not the final competition pitch.' }, null, 2) + '\n');
  console.log('Labelled isolation-demo video recorded; not a live or final competition video.');
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  await server.close();
}
