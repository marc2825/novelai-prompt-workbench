import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import { APP_VERSION } from './src/version';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Spellbinder for NovelAI (unofficial)',
    short_name: 'Spellbinder',
    description: 'Unofficial local-first prompt library, composer and comparison workbench for NovelAI image generation',
    version: APP_VERSION,
    // `sidePanel` is supplied by WXT for the side panel entrypoint; it is the only permission.
    // The toolbar button opens the side panel via the minimal background worker
    // (sidePanel.setPanelBehavior). No popup: a popup closes when the page is clicked.
    // Data lives in IndexedDB, so no storage/host/tabs permissions are needed.
    // manifest.icons is discovered from public/icon/<size>.png (rendered by scripts/render-icons.mjs).
    action: { default_title: 'Spellbinder を開く', default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png' } },
  },
  hooks: {
    // Ship the project's own MIT license with the build; third-party notices come from public/.
    'build:publicAssets': (_wxt, files) => { files.push({ absoluteSrc: resolve('LICENSE'), relativeDest: 'LICENSE.txt' }); },
  },
});
