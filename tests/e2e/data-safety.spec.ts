import { expect, test, type Page } from '@playwright/test';
import { png } from '../fixtures/png';
import { openFold } from './helpers';

// Mock E2E on the local fixture (no extension, no NovelAI). Pages of one browser
// context share IndexedDB, localStorage and Web Locks like the side panel and the
// wide tab of the extension do; a second context stands in for another profile.

const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const saved = (page: Page) => expect(page.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
const tab = async (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();
async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/tests/fixtures/index.html'); await saved(page);
  return errors;
}

/** Holds a read-write transaction on the workbench DB from another page, so the app's saves wait behind it. */
async function blockSaves(page: Page) {
  await page.goto('/tests/fixtures/blank.html');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('nai-prompt-workbench');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const store = database.transaction('metadata', 'readwrite').objectStore('metadata');
      const state = window as unknown as { releaseSaves?: boolean };
      const spin = () => { if (!state.releaseSaves) store.get('revision').onsuccess = spin; };
      spin(); resolve();
    };
  }));
  return () => page.evaluate(() => { (window as unknown as { releaseSaves?: boolean }).releaseSaves = true; });
}

test('closing a page while its save is still waiting keeps the edit for the next page (issue #17)', async ({ context }) => {
  const first = await context.newPage(); const errors = await boot(first);
  const blocker = await context.newPage(); const release = await blockSaves(blocker);
  await tab(first, '設定'); await button(first, 'デモを追加').click();
  await expect(first.getByText('保存中…', { exact: true })).toBeVisible();
  await first.close();
  await release(); await blocker.close();

  const next = await context.newPage(); errors.push(...await boot(next));
  const notice = next.getByRole('alert', { name: '前回の未保存の変更', exact: true });
  await expect(notice).toContainText('保存されていない変更があります');
  // Nothing was written by the closed page: the library is still empty until the user restores.
  await expect(next.getByText('0件 / 全0件', { exact: true })).toBeVisible();
  await button(next, '未保存の変更を復元').click();
  await expect(notice).toHaveCount(0);
  await expect(next.getByText('5件 / 全5件', { exact: true })).toBeVisible();
  await saved(next);
  // Restoring is an ordinary edit: Undo goes back, Redo forward, and the result persists.
  await button(next, '元に戻す').click(); await expect(next.getByText('0件 / 全0件', { exact: true })).toBeVisible();
  await button(next, 'やり直す').click(); await expect(next.getByText('5件 / 全5件', { exact: true })).toBeVisible(); await saved(next);
  await next.reload(); await saved(next);
  await expect(next.getByText('5件 / 全5件', { exact: true })).toBeVisible();
  await expect(next.getByRole('alert', { name: '前回の未保存の変更', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a page that finished saving leaves no recovery notice, and a discarded journal stays discarded', async ({ context }) => {
  const first = await context.newPage(); await boot(first);
  await tab(first, '設定'); await button(first, 'デモを追加').click(); await saved(first);
  await first.close();
  const second = await context.newPage(); await boot(second);
  await expect(second.getByText('5件 / 全5件', { exact: true })).toBeVisible();
  await expect(second.getByRole('alert', { name: '前回の未保存の変更', exact: true })).toHaveCount(0);

  const blocker = await context.newPage(); const release = await blockSaves(blocker);
  await tab(second, 'ライブラリ');
  await button(second, '複製').first().click();
  await expect(second.getByText('保存中…', { exact: true })).toBeVisible();
  await second.close(); await release(); await blocker.close();
  const third = await context.newPage(); await boot(third);
  await button(third, '未保存の変更を破棄').click();
  await expect(third.getByRole('alert', { name: '前回の未保存の変更', exact: true })).toHaveCount(0);
  await expect(third.getByText('5件 / 全5件', { exact: true })).toBeVisible();
  await third.reload(); await saved(third);
  await expect(third.getByRole('alert', { name: '前回の未保存の変更', exact: true })).toHaveCount(0);
});

test('purging image binaries is refused while another page is open, so its Undo still restores the image (issue #16)', async ({ context }) => {
  const a = await context.newPage(); const errors = await boot(a);
  await tab(a, '設定'); await button(a, 'デモを追加').click(); await saved(a);
  await tab(a, '比較');
  await field(a, '新しい比較名').fill('整理テスト'); await button(a, '比較セッションを作成').click(); await saved(a);
  await a.getByLabel('AにPNGを取り込む', { exact: true }).setInputFiles({ name: 'keep.png', mimeType: 'image/png', buffer: png(6, 4, {}, 90) });
  await expect(a.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible(); await saved(a);

  const b = await context.newPage(); errors.push(...await boot(b));
  // A deletes the image; its Undo history still references the binary.
  await openFold(a, /^画像ライブラリ/);
  await button(a, 'keep.pngを削除').click(); await saved(a);
  await expect(a.getByRole('img', { name: '比較画像A', exact: true })).toHaveCount(0);
  await button(b, '他の画面の変更を読み込む').click(); await saved(b);
  await tab(b, '比較'); await openFold(b, /^画像ライブラリ/);
  await button(b, '参照されない画像バイナリを解放').click();
  await expect(b.getByRole('alert').filter({ hasText: '他に1つ開いています' })).toBeVisible();
  // The refused purge removed nothing: A's Undo brings the picture back.
  await button(a, '元に戻す').click(); await saved(a);
  await expect(a.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible();

  // With A closed, B may purge; the image is referenced again, so nothing it needs is removed.
  await a.close();
  await button(b, '閉じる').click();
  await button(b, '他の画面の変更を読み込む').click(); await saved(b);
  await tab(b, '比較');
  await openFold(b, /^画像ライブラリ/);
  await button(b, '参照されない画像バイナリを解放').click();
  await expect(b.getByRole('status').filter({ hasText: '参照されない画像0件を解放しました' })).toBeVisible();
  await expect(b.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('after a save conflict, the emergency backup keeps unsaved edits and an image not yet stored, and restores in another profile (issue #18)', async ({ context, browser }) => {
  const a = await context.newPage(); const errors = await boot(a);
  await tab(a, '設定'); await button(a, 'デモを追加').click(); await saved(a);
  await tab(a, '比較');
  await field(a, '新しい比較名').fill('退避テスト'); await button(a, '比較セッションを作成').click(); await saved(a);
  const b = await context.newPage(); errors.push(...await boot(b));
  await button(b, '複製').first().click(); await saved(b);
  // A did not reload B's change: importing a picture now fails to save (revision conflict).
  await a.getByLabel('AにPNGを取り込む', { exact: true }).setInputFiles({ name: 'rescue.png', mimeType: 'image/png', buffer: png(6, 4, {}, 150) });
  await expect(a.getByText('保存エラー・作業データは未保存です', { exact: true })).toBeVisible();
  await expect(a.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible();
  const download = a.waitForEvent('download');
  await button(a, '未保存の変更を含めて完全バックアップを保存').click();
  const zipPath = (await (await download).path())!;
  await expect(a.getByRole('status').filter({ hasText: '画像原本1件' })).toContainText('まだ保存されていない変更も含めています');

  const other = await browser.newContext();
  try {
    const restored = await other.newPage(); errors.push(...await boot(restored));
    await tab(restored, '設定');
    await restored.getByLabel('完全バックアップZIPを読み込む', { exact: true }).setInputFiles(zipPath);
    await expect(restored.getByLabel('完全バックアップの内容プレビュー', { exact: true })).toContainText('画像原本（検証済み）');
    await button(restored, '確認して完全バックアップを復元').click();
    await expect(restored.getByLabel('完全バックアップ', { exact: true }).getByRole('status').last()).toContainText('完全バックアップを復元しました');
    await saved(restored);
    await tab(restored, '比較');
    await expect(restored.getByRole('combobox', { name: '保存済み比較', exact: true })).toHaveValue(/.+/);
    await expect(restored.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible();
  } finally { await other.close(); }
  expect(errors).toEqual([]);
});
