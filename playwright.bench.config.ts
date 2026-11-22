import { defineConfig } from '@playwright/test';

// Opt-in Chromium benchmark (`corepack pnpm bench:chromium`, issue #22). Not part of
// `test:e2e` (testDir tests/e2e) or Vitest. Uses the same fixture build and E2E_PORT.
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './tests/perf',
  testMatch: '*.bench.spec.ts',
  // The table/JSON are written to test-results/ directly; per-test artifacts go below it.
  outputDir: './test-results/bench-artifacts',
  fullyParallel: false,
  workers: 1,
  timeout: 20 * 60_000,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`, viewport: { width: 400, height: 900 },
    // Full Chromium (new headless), not the headless shell; precise (unbucketed) performance.memory.
    channel: 'chromium', headless: true, launchOptions: { args: ['--enable-precise-memory-info'] },
  },
  webServer: { command: 'node scripts/serve-fixture.mjs', url: `http://127.0.0.1:${port}/tests/fixtures/index.html`, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
