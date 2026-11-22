import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { openFold, openPreview } from './helpers';
import { emptyData } from '../../src/core/commands';
import { exportBackup } from '../../src/data/backup';
import { fixture, timestamp } from '../unit/helpers';

const runtimeErrors = new WeakMap<Page, string[]>();

async function saved(page: Page) { await expect(page.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible(); }
async function demo(page: Page) {
  await page.getByRole('tab', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: 'デモを追加', exact: true }).click();
  await saved(page);
}
async function upload(page: Page, text: string) {
  await page.getByRole('tab', { name: '設定', exact: true }).click();
  await page.getByLabel('JSONをインポート', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
}
async function exported(page: Page) {
  await page.getByRole('tab', { name: '設定', exact: true }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSONをエクスポート', exact: true }).click();
  const path = await (await event).path();
  if (!path) throw new Error('Missing downloaded JSON');
  return JSON.parse(await readFile(path, 'utf8')) as { payload: ReturnType<typeof fixture> };
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/tests/fixtures/index.html');
  await saved(page);
});

test.afterEach(async ({ page }) => { expect(runtimeErrors.get(page)).toEqual([]); });

test('empty startup, Japanese library/category CRUD, duplication, undo and reload', async ({ page }) => {
  await expect(page.getByText('0件 / 全0件', { exact: true })).toBeVisible();
  await page.getByText('カテゴリ管理', { exact: true }).click();
  await page.getByLabel('新しいカテゴリ', { exact: true }).fill('髪型 🌟');
  await page.getByRole('button', { name: 'カテゴリ追加', exact: true }).click();
  await page.getByRole('button', { name: '＋ ライブラリを追加', exact: true }).click();
  await page.getByLabel('名前', { exact: true }).fill('黒髪, 長い 髪 🌟');
  await page.getByRole('textbox', { name: 'プロンプト原文', exact: true }).fill('  {{hair}}, !macro:Style! | [tag]\n  ');
  await page.getByLabel('説明', { exact: true }).fill('日本語説明');
  await page.getByRole('combobox', { name: 'カテゴリ', exact: true }).selectOption({ label: '髪型 🌟' });
  await page.getByLabel('タグ（1行に1つ）', { exact: true }).fill('hair\n夜 🌃');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await saved(page);
  await page.reload();
  await saved(page);
  await page.getByLabel('検索', { exact: true }).fill('🌟');
  await expect(page.getByRole('article', { name: '黒髪, 長い 髪 🌟', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'プロンプト原文', exact: true })).toHaveValue('  {{hair}}, !macro:Style! | [tag]\n  ');
  await page.getByLabel('名前', { exact: true }).fill('黒髪 更新 🌟');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '複製', exact: true }).click();
  await expect(page.getByText('2件 / 全2件', { exact: true })).toBeVisible();
  await page.getByRole('article', { name: '黒髪 更新 🌟 のコピー', exact: true }).getByRole('button', { name: '削除', exact: true }).click();
  await expect(page.getByText('1件 / 全1件', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.getByText('2件 / 全2件', { exact: true })).toBeVisible();
  await saved(page);
  await page.reload();
  await expect(page.getByText('2件 / 全2件', { exact: true })).toBeVisible();
});

test('exclusive/multi keyboard toggles, parent masking, raw preservation, channel isolation, copy and reload', async ({ page, context }) => {
  await demo(page);
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  const hair = page.getByRole('region', { name: '髪型（排他）', exact: true });
  const blonde = hair.getByRole('radio', { name: '金髪ショート', exact: true });
  await blonde.click();
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('1girl, blonde hair, short hair, night, city lights');
  await hair.getByLabel('グループ有効', { exact: true }).uncheck();
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('1girl, night, city lights');
  await hair.getByLabel('グループ有効', { exact: true }).check();
  await expect(blonde).toBeChecked();
  await blonde.focus();
  await blonde.press('Space');
  await expect(blonde).not.toBeChecked();
  await blonde.press('Space');
  await expect(blonde).toBeChecked();
  const city = page.getByRole('checkbox', { name: '夜の街 🌃', exact: true });
  await city.focus(); await city.press('Space');
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('1girl, blonde hair, short hair');
  await expect(page.getByRole('textbox', { name: '出力 Negative', exact: true })).toHaveValue('[watermark]');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Positiveをコピー', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('1girl, blonde hair, short hair');
  await page.getByRole('button', { name: 'Negativeをコピー', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('[watermark]');
  await saved(page);
  await page.reload(); await saved(page);
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('1girl, blonde hair, short hair');
  await expect(page.getByRole('button', { name: 'NovelAIに反映（P2）', exact: true })).toBeDisabled();
});

test('corrupt startup preserves records, exports recovery and restores from a validated backup', async ({ page }) => {
  await demo(page);
  const before = await exported(page);
  await page.evaluate(async () => {
    const req = indexedDB.open('nai-prompt-workbench');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const transaction = db.transaction('libraryEntries', 'readwrite');
    const store = transaction.objectStore('libraryEntries');
    const records = store.getAll();
    records.onsuccess = () => store.put({ ...records.result[0], raw: 42 });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
    db.close();
  });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('raw');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'DB復旧用ファイルを保存', exact: true }).click();
  const path = await (await event).path();
  expect(await readFile(path!, 'utf8')).toContain('42');
  await page.getByLabel('復旧用JSON', { exact: true }).setInputFiles({ name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(before)) });
  await page.getByRole('button', { name: '確認して復旧', exact: true }).click();
  await saved(page);
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('1girl, {{black hair}}, long hair, night, city lights');
  await page.reload(); await saved(page);
  expect((await exported(page)).payload).toEqual(before.payload);
});

test('imported HTML stays literal and clipboard denial retains selectable preview', async ({ page }) => {
  const data = fixture();
  data.libraryEntries[0]!.title = '<img src=x onerror=alert(1)> 🌟';
  data.libraryEntries[0]!.raw = '<script>window.bad = true</script> {{hair}}';
  await upload(page, exportBackup(data, timestamp));
  await page.getByRole('combobox', { name: '取込方法', exact: true }).selectOption('replace');
  await page.getByRole('button', { name: '確認してインポート', exact: true }).click();
  await saved(page);
  await page.getByRole('tab', { name: 'ライブラリ', exact: true }).click();
  await expect(page.getByRole('article', { name: data.libraryEntries[0]!.title, exact: true })).toBeVisible();
  await expect(page.locator('article img, article script')).toHaveCount(0);
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new DOMException('denied', 'NotAllowedError'); }; });
  await page.getByRole('button', { name: 'Positiveをコピー', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('手動でコピー');
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('1girl, {{black hair}}, long hair, night, city lights');
});

test('workspace/group creation, snapshot source independence, member ordering and undo', async ({ page }) => {
  await demo(page);
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  await page.getByRole('button', { name: '＋ ワークスペース', exact: true }).click();
  await page.getByLabel('構成名', { exact: true }).fill('新規テスト');
  await page.getByLabel('構成名', { exact: true }).press('Enter');
  await page.getByLabel('グループ名', { exact: true }).fill('新グループ');
  await page.getByRole('button', { name: 'グループ追加', exact: true }).click();
  await page.getByRole('tab', { name: 'ライブラリ', exact: true }).click();
  for (const title of ['黒髪ロング', '金髪ショート']) await page.getByRole('article', { name: title, exact: true }).getByRole('button', { name: '構成に追加', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('{{black hair}}, long hair, blonde hair, short hair');
  await page.getByRole('article', { name: '黒髪ロング', exact: true }).getByRole('button', { name: '編集', exact: true }).click();
  await page.getByRole('textbox', { name: 'プロンプト原文', exact: true }).fill('changed source');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('{{black hair}}, long hair, blonde hair, short hair');
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  await page.getByRole('button', { name: '金髪ショート (2)を上へ', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('blonde hair, short hair, {{black hair}}, long hair');
  await page.getByRole('article', { name: '黒髪ロング', exact: true }).getByRole('button', { name: '部品削除', exact: true }).click();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('blonde hair, short hair, {{black hair}}, long hair');
  await saved(page);
});

test('export → clear via validated replace → import restores assets; merge collisions and invalid JSON are non-destructive', async ({ page }) => {
  await demo(page);
  const before = await exported(page);
  await upload(page, exportBackup(emptyData(), timestamp));
  await page.getByRole('combobox', { name: '取込方法', exact: true }).selectOption('replace');
  await page.getByRole('button', { name: '確認してインポート', exact: true }).click();
  await saved(page);
  await openPreview(page);
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('');
  await upload(page, JSON.stringify(before));
  await page.getByRole('button', { name: '確認してインポート', exact: true }).click();
  await saved(page);
  // Merge deliberately keeps the current settings, so select the restored workspace explicitly.
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  await page.getByRole('combobox', { name: 'ワークスペース', exact: true }).selectOption(before.payload.workspaces[0]!.id);
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('1girl, {{black hair}}, long hair, night, city lights');
  await upload(page, JSON.stringify(before));
  await expect(page.getByRole('alert')).toContainText('重複ID');
  await expect(page.getByRole('button', { name: '確認してインポート', exact: true })).toBeDisabled();
  await upload(page, '{broken');
  await expect(page.getByRole('alert')).toContainText('JSONの構文が不正');
  await saved(page);
  await page.reload(); await saved(page);
  const after = await exported(page);
  expect(after.payload.libraryEntries).toEqual(before.payload.libraryEntries);
  expect(after.payload.workspaces).toEqual(before.payload.workspaces);
});

test('1000-record import, paginated rendering, Japanese search and selecting a result', async ({ page }) => {
  const data = fixture();
  const template = data.libraryEntries[0]!;
  data.libraryEntries = Array.from({ length: 1000 }, (_, i) => ({ ...template, id: randomUUID(), title: `日本語 🌟 ${i}`, raw: `{{hair}}, tag ${i}` }));
  await upload(page, exportBackup(data, timestamp));
  await page.getByRole('combobox', { name: '取込方法', exact: true }).selectOption('replace');
  await page.getByRole('button', { name: '確認してインポート', exact: true }).click();
  await saved(page);
  await page.getByRole('tab', { name: 'ライブラリ', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(50);
  const started = performance.now();
  await page.getByLabel('検索', { exact: true }).fill('🌟 999');
  await expect(page.getByRole('article')).toHaveCount(1);
  console.info(`AC12 browser search (including automation): ${(performance.now() - started).toFixed(1)}ms`);
  await page.getByRole('article', { name: '日本語 🌟 999', exact: true }).getByRole('button', { name: '構成に追加', exact: true }).click();
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  await page.getByRole('radio', { name: '日本語 🌟 999', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('1girl, {{hair}}, tag 999, night, city lights');
  await saved(page);
});

test('storage errors retain unsaved draft, show recovery actions and save successfully on retry', async ({ page }) => {
  await demo(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as Window & { failWrites?: boolean }).failWrites = true;
    IDBObjectStore.prototype.put = function (value, key) {
      if ((window as Window & { failWrites?: boolean }).failWrites) throw new DOMException('Test quota exceeded', 'QuotaExceededError');
      return original.call(this, value, key);
    };
  });
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  await page.getByRole('textbox', { name: '自由入力 Positive', exact: true }).fill('unsaved 🌟');
  await expect(page.getByRole('alert')).toContainText('quota');
  const backup = await exported(page);
  expect(backup.payload.workspaces[0]!.freeformPositive).toBe('unsaved 🌟');
  await page.evaluate(() => { (window as Window & { failWrites?: boolean }).failWrites = false; });
  await page.getByRole('button', { name: '保存を再試行', exact: true }).click();
  await saved(page);
  await page.reload(); await saved(page);
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('unsaved 🌟, {{black hair}}, long hair, night, city lights');
});

test('two panels detect a stale write and preserve the other panel’s committed state', async ({ page, context }) => {
  await demo(page);
  const second = await context.newPage();
  second.on('dialog', dialog => void dialog.accept());
  await second.goto('/tests/fixtures/index.html'); await saved(second);
  for (const panel of [page, second]) await panel.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  await page.getByRole('textbox', { name: '自由入力 Positive', exact: true }).fill('first-panel'); await saved(page);
  await second.getByRole('textbox', { name: '自由入力 Positive', exact: true }).fill('second-panel');
  await expect(second.getByRole('alert')).toContainText('別のパネルで更新');
  expect((await exported(second)).payload.workspaces[0]!.freeformPositive).toBe('second-panel');
  await second.reload(); await saved(second);
  await expect(second.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('first-panel, {{black hair}}, long hair, night, city lights');
  await second.close();
});

test('a panel is told when another panel saved, and can load that state explicitly instead of conflicting', async ({ page, context }) => {
  await demo(page);
  const second = await context.newPage();
  second.on('dialog', dialog => void dialog.accept());
  await second.goto('/tests/fixtures/index.html'); await saved(second);
  for (const panel of [page, second]) await panel.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  await expect(second.getByRole('status', { name: '他の画面での変更', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: '自由入力 Positive', exact: true }).fill('from-first'); await saved(page);
  await expect(second.getByRole('status', { name: '他の画面での変更', exact: true })).toBeVisible();
  await second.getByRole('button', { name: '他の画面の変更を読み込む', exact: true }).click();
  await expect(second.getByRole('status', { name: '他の画面での変更', exact: true })).toHaveCount(0);
  await expect(second.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('from-first, {{black hair}}, long hair, night, city lights');
  await second.getByRole('textbox', { name: '自由入力 Positive', exact: true }).fill('from-second'); await saved(second);
  await expect(second.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('status', { name: '他の画面での変更', exact: true })).toBeVisible();
  await second.close();
});

test('first-run guide, workflow tab order and keyboard tab navigation', async ({ page }) => {
  await page.goto('/tests/fixtures/index.html'); await saved(page);
  await expect(page.getByRole('region', { name: 'はじめに', exact: true })).toBeVisible();
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText(['ライブラリ', 'ワークスペース', 'プリセット', 'シャッフル', '比較', 'Experiment Lab', '設定']);
  await page.getByRole('tab', { name: 'ライブラリ', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'ワークスペース', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'ワークスペース', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: '設定', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'ライブラリ', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: '設定', exact: true })).toHaveAttribute('tabindex', '-1');
  await expect(page.getByRole('link', { name: '広いタブで開く', exact: true })).toHaveAttribute('target', '_blank');
  await page.getByRole('tab', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: 'デモを追加', exact: true }).click(); await saved(page);
  await page.getByRole('tab', { name: 'ライブラリ', exact: true }).click();
  await expect(page.getByRole('region', { name: 'はじめに', exact: true })).toHaveCount(0);
});

test('detail texts stay hidden until hover, focus or tap, and stay inside the narrow panel', async ({ page }) => {
  await page.goto('/tests/fixtures/index.html'); await saved(page);
  const help = page.getByRole('button', { name: '出力プレビューの説明', exact: true });
  const tip = page.getByRole('tooltip').filter({ hasText: '現在のワークスペースから合成したプロンプト' });
  await expect(tip).toBeHidden();
  await help.hover();
  await expect(tip).toBeVisible();
  await expect(help).toHaveAttribute('aria-describedby', (await tip.getAttribute('id'))!);
  const box = (await tip.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(400);
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  await expect(tip).toBeHidden();
  // Keyboard: focus shows, Escape hides.
  await help.focus();
  await expect(tip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  // Touch-style tap pins it open until tapped again or clicked elsewhere.
  await help.click();
  await page.mouse.move(0, 0);
  await expect(tip).toBeVisible();
  await page.getByRole('heading', { name: 'NovelAI Prompt Workbench', exact: true }).click();
  await expect(tip).toBeHidden();
});

test('workspace keeps details behind icons: member text editor, group settings, folded group creation and presets', async ({ page }) => {
  await demo(page);
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  const group = page.getByRole('region', { name: '背景', exact: true });
  const member = group.getByRole('article', { name: /^夜の街/ });
  // Editors and settings are not shown until asked for.
  await expect(page.getByRole('textbox', { name: '構成内の原文', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'グループの名前', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'グループ名', exact: true })).toHaveCount(0);
  await member.getByRole('button', { name: '原文を編集・移動', exact: true }).click();
  await page.getByRole('textbox', { name: '構成内の原文', exact: true }).fill('night, neon lights');
  await saved(page);
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('1girl, {{black hair}}, long hair, night, neon lights');
  await member.getByRole('button', { name: '原文を編集・移動', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '構成内の原文', exact: true })).toHaveCount(0);
  await group.getByRole('button', { name: 'グループ設定', exact: true }).click();
  await page.getByRole('textbox', { name: 'グループの名前', exact: true }).fill('背景と光');
  await page.getByRole('textbox', { name: 'グループの名前', exact: true }).press('Enter');
  await saved(page);
  await expect(page.getByRole('region', { name: '背景と光', exact: true })).toBeVisible();
  // Group creation is folded once groups exist.
  await openFold(page, /グループを追加/);
  await page.getByRole('textbox', { name: 'グループ名', exact: true }).fill('小物');
  await page.getByRole('button', { name: 'グループ追加', exact: true }).click(); await saved(page);
  await expect(page.getByRole('region', { name: '小物', exact: true })).toBeVisible();
  // Presets: select / apply / save stay visible, management is folded.
  await page.getByRole('textbox', { name: '新しいプリセット名', exact: true }).fill('夜');
  await page.getByRole('button', { name: '現在の構成をプリセット保存', exact: true }).click(); await saved(page);
  await expect(page.getByRole('button', { name: 'プリセットを適用', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'プリセットを削除', exact: true })).toHaveCount(0);
  await openFold(page, /^詳細（差分の内容/);
  await expect(page.getByRole('button', { name: 'プリセットを削除', exact: true })).toBeVisible();
});

test('tabs are grouped into areas, settings sits apart, and the wide tab opens the same section with the preview beside it (issue #29)', async ({ page, context }) => {
  await page.goto('/tests/fixtures/index.html'); await saved(page);
  const nav = page.getByRole('tablist', { name: '機能', exact: true });
  for (const label of ['編集', 'バリエーション', '比較・実験']) await expect(nav.getByText(label, { exact: true })).toBeVisible();
  // Area captions are visual only: the tabs keep their names and order.
  await expect(page.getByRole('tab')).toHaveText(['ライブラリ', 'ワークスペース', 'プリセット', 'シャッフル', '比較', 'Experiment Lab', '設定']);
  const settings = await page.getByRole('tab', { name: '設定', exact: true }).boundingBox();
  const lab = await page.getByRole('tab', { name: 'Experiment Lab', exact: true }).boundingBox();
  expect(settings && lab && (settings.y > lab.y + 1 || settings.x > lab.x)).toBe(true);
  await page.getByRole('tab', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: 'デモを追加', exact: true }).click(); await saved(page);
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  const link = page.getByRole('link', { name: '広いタブで開く', exact: true });
  await expect(link).toHaveAttribute('href', /#workspace$/);
  const wide = await context.newPage();
  await wide.setViewportSize({ width: 1280, height: 900 });
  await wide.goto(`/tests/fixtures/index.html#workspace`); await saved(wide);
  await expect(wide.getByRole('tab', { name: 'ワークスペース', exact: true })).toHaveAttribute('aria-selected', 'true');
  // Wide layout: the output preview stays open in a column to the right of the section.
  const preview = wide.getByRole('group', { name: 'ライブプレビュー', exact: true });
  await expect(preview.getByRole('textbox', { name: '出力 Positive', exact: true })).toBeVisible();
  const panel = await wide.getByRole('tabpanel').boundingBox(); const side = await preview.boundingBox();
  expect(panel && side && side.x >= panel.x + panel.width - 1).toBe(true);
  await wide.getByRole('tab', { name: 'シャッフル', exact: true }).click();
  await expect(preview.getByRole('textbox', { name: '出力 Positive', exact: true })).toBeVisible();
  // The narrow panel keeps one column (preview below, collapsed on Shuffle).
  await page.getByRole('tab', { name: 'シャッフル', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toBeHidden();
});
