import type { Page } from '@playwright/test';

/** Opens a collapsed <details> by its summary text, like a user would. No-op when already open. */
export async function openFold(page: Page, summary: string | RegExp) {
  const target = page.locator('summary').filter({ hasText: summary }).first();
  if (!(await target.evaluate(element => (element.parentElement as HTMLDetailsElement).open))) await target.click();
}
/** The workspace output preview starts collapsed on the Shuffle / Compare / Settings tabs. */
export const openPreview = (page: Page) => openFold(page, /^出力プレビュー/);
export const openPresetDetails = (page: Page) => openFold(page, /^詳細（差分の内容/);
