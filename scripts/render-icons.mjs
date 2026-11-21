// Renders the extension icons from the SVG sources in scripts/icon/ into
// public/icon/<size>.png (WXT adds them to manifest.icons automatically).
// Uses the Chromium that Playwright already installs for E2E.
// Usage: node scripts/render-icons.mjs
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const sizes = [16, 32, 48, 128];
const source = async size => readFile(`${root}scripts/icon/${size <= 32 ? 'icon-small' : 'icon'}.svg`, 'utf8');

await mkdir(`${root}public/icon`, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of sizes) {
    const svg = Buffer.from(await source(size)).toString('base64');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent"><img alt="" width="${size}" height="${size}" style="display:block" src="data:image/svg+xml;base64,${svg}"></body></html>`);
    await page.locator('img').evaluate(image => image.decode());
    await page.locator('img').screenshot({ path: `${root}public/icon/${size}.png`, omitBackground: true });
    console.log(`public/icon/${size}.png`);
  }
} finally { await browser.close(); }
