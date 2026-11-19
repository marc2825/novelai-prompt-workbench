// Serves the local E2E fixtures as a static build (no package manager, no Vite dev
// server). A dev server streams hundreds of ES modules per page load, which can
// exhaust sockets/file handles on small machines (issue #4); a build serves a few files.
// NODE_ENV=development keeps React's development build (StrictMode checks) and
// import.meta.env.DEV, which enables the deep freeze of validated data in E2E.
// Usage: node scripts/serve-fixture.mjs [--build-only]
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'development';
const { build, preview } = await import('vite');
const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = '.output/e2e-fixture';
const shared = { root, configFile: false, logLevel: 'warn', mode: 'development', build: { outDir, emptyOutDir: true } };

await build({
  ...shared,
  build: {
    ...shared.build,
    sourcemap: false,
    // One development bundle per page by design; size warnings are irrelevant here.
    chunkSizeWarningLimit: 8192,
    rollupOptions: {
      input: { index: 'tests/fixtures/index.html', site: 'tests/fixtures/site.html', blank: 'tests/fixtures/blank.html', 'legacy-db': 'tests/fixtures/legacy-db.ts' },
      // Migration tests import the legacy-DB seeder from the page at a fixed path.
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: chunk => chunk.name === 'legacy-db' ? 'tests/fixtures/legacy-db.js' : 'assets/[name]-[hash].js' },
    },
  },
});
if (!process.argv.includes('--build-only')) {
  const server = await preview({ ...shared, preview: { host: '127.0.0.1', port: 4173, strictPort: true } });
  console.log(`fixture served at ${server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:4173/'}tests/fixtures/index.html`);
}
