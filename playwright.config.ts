import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'output/playwright/report', open: 'never' }],
  ],
  outputDir: 'output/playwright/results',
  use: {
    baseURL: 'http://127.0.0.1:4200',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @tandrove-demo/billing-api dev',
      url: 'http://127.0.0.1:4100/health',
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: 'pnpm --filter @tandrove-demo/billing-demo dev',
      url: 'http://127.0.0.1:4200',
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
