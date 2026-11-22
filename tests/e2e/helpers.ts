import type { BrowserContext, Page } from '@playwright/test';

/** Opens a collapsed <details> by its summary text, like a user would. No-op when already open. */
export async function openFold(page: Page, summary: string | RegExp) {
  const target = page.locator('summary').filter({ hasText: summary }).first();
  if (!(await target.evaluate(element => (element.parentElement as HTMLDetailsElement).open))) await target.click();
}
/** The workspace output preview starts collapsed on the Shuffle / Compare / Settings tabs. */
export const openPreview = (page: Page) => openFold(page, /^出力プレビュー/);
export const openPresetDetails = (page: Page) => openFold(page, /^詳細（差分の内容/);

/**
 * ID of the extension loaded in this context, read from its service worker URL. Chromium derives
 * unpacked extension IDs from the folder path, and the exact derivation differs by OS (Windows hashes
 * the UTF-16 path), so tests must not compute it themselves.
 */
export async function extensionIdOf(context: BrowserContext): Promise<string> {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  if (!/^[a-p]{32}$/.test(id)) throw new Error(`unexpected extension ID in ${worker.url()}`);
  return id;
}
