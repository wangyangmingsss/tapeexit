import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
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
    { command: 'npm run accept:wallet', url: 'http://127.0.0.1:4180', reuseExistingServer: !process.env.CI },
  ],
});
