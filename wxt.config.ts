import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'NovelAI Prompt Workbench (unofficial)',
    description: 'Local-first prompt library and workspace for NovelAI image generation',
    version: '0.1.0',
    // Side Panel permission is automatically supplied by WXT for its entrypoint.
    // P1 stores settings in IndexedDB too; no storage/host permissions are needed.
    // Explicit popup makes the panel reachable without a background worker.
    action: { default_popup: 'sidepanel.html', default_title: 'Prompt Workbench' },
  },
});
