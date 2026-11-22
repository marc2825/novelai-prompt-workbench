import { defineConfig } from '@playwright/test';

// E2E_PORT lets several checkouts (git worktrees) run E2E at the same time without
// reusing each other's fixture server.
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 400, height: 900 }, headless: true, trace: 'retain-on-failure' },
  // Plain Node (no corepack/pnpm needed): builds the fixtures once and serves the static files (issue #4).
  webServer: { command: 'node scripts/serve-fixture.mjs', url: `http://127.0.0.1:${port}/tests/fixtures/index.html`, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
