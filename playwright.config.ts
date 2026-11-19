import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 400, height: 900 }, headless: true, trace: 'retain-on-failure' },
  // Plain Node (no corepack/pnpm needed): builds the fixtures once and serves the static files (issue #4).
  webServer: { command: 'node scripts/serve-fixture.mjs', url: 'http://127.0.0.1:4173/tests/fixtures/index.html', reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
