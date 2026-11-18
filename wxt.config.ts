import { defineConfig } from 'wxt';
import { APP_VERSION } from './src/version';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'NovelAI Prompt Workbench (unofficial)',
    description: 'Local-first prompt library and workspace for NovelAI image generation',
    version: APP_VERSION,
    // `sidePanel` is supplied by WXT for the side panel entrypoint; it is the only permission.
    // The toolbar button opens the side panel via the minimal background worker
    // (sidePanel.setPanelBehavior). No popup: a popup closes when the page is clicked.
    // Data lives in IndexedDB, so no storage/host/tabs permissions are needed.
    action: { default_title: 'Prompt Workbench を開く' },
  },
});
