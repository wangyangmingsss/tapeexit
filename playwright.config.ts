import { defineConfig } from '@playwright/test';
import { execFileSync } from 'node:child_process';
export default defineConfig({
  metadata: {
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  },
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'release-artifacts/browser-tests.json' }]],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    locale: 'zh-CN',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    { command: 'npm run dev:demo', url: 'http://127.0.0.1:4174', reuseExistingServer: !process.env.CI },
    { command: 'node tools/local-server.mjs', env: { TAPEEXIT_PORT: '4175' },
      url: 'http://127.0.0.1:4175', reuseExistingServer: !process.env.CI },
    { command: 'node tools/local-server.mjs', env: { TAPEEXIT_PORT: '4176' },
      url: 'http://127.0.0.1:4176', reuseExistingServer: !process.env.CI },
    { command: 'node tools/local-server.mjs dist-demo', env: { TAPEEXIT_PORT: '4177' },
      url: 'http://127.0.0.1:4177', reuseExistingServer: !process.env.CI },
    { command: 'npm run accept:wallet', url: 'http://127.0.0.1:4180', reuseExistingServer: !process.env.CI },
    { command: 'node tests/fixtures/fault-server.mjs', url: 'http://127.0.0.1:4181', reuseExistingServer: !process.env.CI },
  ],
});
