import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 400, height: 900 }, headless: true, trace: 'retain-on-failure' },
  webServer: { command: 'corepack pnpm fixture', url: 'http://127.0.0.1:4173/tests/fixtures/index.html', reuseExistingServer: !process.env.CI },
});
