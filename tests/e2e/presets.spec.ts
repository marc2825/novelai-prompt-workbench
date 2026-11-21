import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { openPresetDetails } from './helpers';
import { emptyData } from '../../src/core/commands';
import { commentRange } from '../../src/core/comments';
import { compileWorkspace } from '../../src/core/compose';
import { exportBackup } from '../../src/data/backup';
import { SCHEMA_VERSION } from '../../src/data/validation';
import { fixture, timestamp } from '../unit/helpers';

const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });
const saved = (page: Page) => expect(page.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
async function boot(page: Page, demo = true) {
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/tests/fixtures/index.html'); await saved(page);
  if (demo) {
    await page.getByRole('tab', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: 'デモを追加', exact: true }).click(); await saved(page);
  }
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
}
async function save(page: Page, name: string) {
  await field(page, '新しいプリセット名').fill(name);
  await page.getByRole('button', { name: '現在の構成をプリセット保存', exact: true }).click(); await saved(page);
}
async function select(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'プリセットを選択', exact: true }).selectOption({ label: name });
  // In the Workspace tab the diff, search, rename and delete controls are folded; open them like a user would.
  await openPresetDetails(page);
}
async function apply(page: Page) {
  await page.getByRole('button', { name: 'プリセットを適用', exact: true }).click(); await saved(page);
}
async function download(page: Page, button: string) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const path = await (await event).path();
  return JSON.parse(await readFile(path!, 'utf8'));
}
async function upload(page: Page, text: string) {
  await page.getByRole('tab', { name: '設定', exact: true }).click();
  await page.getByLabel('JSONをインポート', { exact: true }).setInputFiles({ name: 'presets.json', mimeType: 'application/json', buffer: Buffer.from(text) });
}

test('A/B/A bulk switching previews changes, preserves independent flags and undoes unsaved edits in one step', async ({ page }) => {
  await boot(page);
  await page.getByRole('tab', { name: 'ライブラリ', exact: true }).click();
  await page.getByRole('combobox', { name: '追加先グループ', exact: true }).selectOption({ label: '背景 (positive)' });
  await page.getByRole('article', { name: '赤髪', exact: true }).getByRole('button', { name: '構成に追加', exact: true }).click();
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  const outputA = await field(page, '出力 Positive').inputValue();
  await save(page, '制服 A');
  const hair = page.getByRole('region', { name: '髪型（排他）', exact: true });
  const background = page.getByRole('region', { name: '背景', exact: true });
  await hair.getByRole('radio', { name: '金髪ショート', exact: true }).click();
  await background.getByRole('checkbox', { name: '夜の街 🌃', exact: true }).uncheck();
  await expect(background.getByRole('checkbox', { name: '赤髪', exact: true })).toBeChecked();
  await background.getByRole('checkbox', { name: 'グループ有効', exact: true }).uncheck();
  await page.getByRole('button', { name: '背景を上へ', exact: true }).click();
  await field(page, '自由入力 Negative').fill('negative B');
  await save(page, '私服 B');
  await field(page, '自由入力 Positive').fill('unsaved B');
  const unsavedB = await field(page, '出力 Positive').inputValue();
  await expect(page.getByLabel('プリセット保存状態', { exact: true })).toContainText('未保存の変更');
  await select(page, '制服 A');
  await expect(field(page, '出力 Positive')).toHaveValue(unsavedB);
  await expect(field(page, '適用後のpositive')).toHaveValue(outputA);
  await expect(page.getByRole('table')).toBeVisible();
  page.removeAllListeners('dialog'); page.on('dialog', dialog => void dialog.dismiss());
  await page.getByRole('button', { name: 'プリセットを適用', exact: true }).click();
  await expect(field(page, '出力 Positive')).toHaveValue(unsavedB);
  page.removeAllListeners('dialog'); page.on('dialog', dialog => void dialog.accept());
  await apply(page);
  await expect(field(page, '出力 Positive')).toHaveValue(outputA);
  await expect(field(page, '出力 Negative')).toHaveValue('[watermark]');
  await expect(hair.getByRole('radio', { name: '黒髪ロング', exact: true })).toBeChecked();
  await expect(background.getByRole('checkbox', { name: '夜の街 🌃', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(field(page, '出力 Positive')).toHaveValue(unsavedB);
  await expect(field(page, '出力 Negative')).toHaveValue('negative B, [watermark]');
  await expect(background.getByRole('checkbox', { name: 'グループ有効', exact: true })).not.toBeChecked();
  await expect(background.getByRole('checkbox', { name: '夜の街 🌃', exact: true })).not.toBeChecked();
  await expect(page.getByLabel('プリセット保存状態', { exact: true })).toContainText('未保存の変更');
  await select(page, '制服 A'); await apply(page);
  await select(page, '私服 B'); await apply(page);
  await expect(field(page, '出力 Positive')).toHaveValue('1girl, blonde hair, short hair');
  await select(page, '制服 A'); await apply(page); await page.reload(); await saved(page);
  await expect(field(page, '出力 Positive')).toHaveValue(outputA);
  await expect(page.getByLabel('プリセット保存状態', { exact: true })).toContainText('保存済みプリセットと一致');
  await expect(page.getByRole('button', { name: 'NovelAIに反映（P2）', exact: true })).toBeDisabled();
});

test('preset rename/copy/edit/overwrite/delete/search preserves original snapshot and working text', async ({ page }) => {
  await boot(page); const original = await field(page, '出力 Positive').inputValue();
  await save(page, '制服');
  await page.getByRole('tab', { name: 'プリセット', exact: true }).click();
  await field(page, 'プリセット名の変更').fill('制服 更新 🌟');
  await page.getByRole('button', { name: '名前を変更', exact: true }).click();
  await page.getByRole('button', { name: 'プリセットを複製', exact: true }).click();
  await field(page, 'プリセット名の変更').fill('私服');
  await page.getByRole('button', { name: '名前を変更', exact: true }).click();
  await page.getByRole('button', { name: '適用してグループを編集', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'ワークスペース', exact: true })).toHaveAttribute('aria-selected', 'true');
  await field(page, '自由入力 Positive').fill('casual');
  await expect(page.getByLabel('プリセット保存状態', { exact: true })).toContainText('未保存の変更');
  await page.getByRole('button', { name: '現在の構成で上書き保存', exact: true }).click(); await saved(page);
  await expect(page.getByLabel('プリセット保存状態', { exact: true })).toContainText('保存済みプリセットと一致');
  const updated = await field(page, '出力 Positive').inputValue();
  await select(page, '制服 更新 🌟'); await apply(page);
  await expect(field(page, '出力 Positive')).toHaveValue(original);
  await select(page, '私服'); await apply(page);
  await expect(field(page, '出力 Positive')).toHaveValue(updated);
  await page.getByRole('button', { name: 'プリセットを削除', exact: true }).click(); await saved(page);
  await expect(field(page, '出力 Positive')).toHaveValue(updated);
  await expect(page.getByLabel('プリセット保存状態', { exact: true })).toContainText('プリセットに未保存');
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.getByLabel('プリセット保存状態', { exact: true })).toContainText('私服');
  await page.getByRole('searchbox', { name: 'プリセット検索', exact: true }).fill('制服');
  await select(page, '制服 更新 🌟');
  await expect(field(page, '適用後のpositive')).toHaveValue(original);
});

test('changed/deleted library and deleted source workspace are diagnosed while snapshots remain usable', async ({ page }) => {
  await boot(page); const output = await field(page, '出力 Positive').inputValue();
  await save(page, '辞書独立');
  await page.getByRole('tab', { name: 'ライブラリ', exact: true }).click();
  await page.getByRole('article', { name: '黒髪ロング', exact: true }).getByRole('button', { name: '編集', exact: true }).click();
  await field(page, 'プロンプト原文').fill('changed library source');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('article', { name: '金髪ショート', exact: true }).getByRole('button', { name: '削除', exact: true }).click();
  await page.getByRole('tab', { name: 'プリセット', exact: true }).click();
  await expect(page.getByLabel('プリセット参照診断', { exact: true })).toContainText('辞書原文が変更');
  await expect(page.getByLabel('プリセット参照診断', { exact: true })).toContainText('がありません');
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  await page.getByRole('button', { name: 'ワークスペースを削除', exact: true }).click();
  await select(page, '辞書独立');
  await expect(page.getByLabel('プリセット参照診断', { exact: true })).toContainText('作成元ワークスペースがありません');
  await page.getByRole('button', { name: '新しいワークスペースに復元', exact: true }).click(); await saved(page);
  await expect(field(page, '出力 Positive')).toHaveValue(output);
  await page.getByRole('tab', { name: 'ライブラリ', exact: true }).click();
  await expect(page.getByRole('article', { name: '黒髪ロング', exact: true }).locator('pre')).toHaveText('changed library source');
  await expect(page.getByRole('article', { name: '金髪ショート', exact: true })).toHaveCount(0);
});

test('P2 comment snapshots round-trip through v2 JSON, reject corrupt presets and persist after reload', async ({ page }) => {
  await boot(page);
  await field(page, '自由入力 Positive').fill('a, b, c');
  await field(page, '自由入力 Positive').evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(3, 4));
  await page.getByRole('button', { name: '自由入力 Positiveの選択範囲をOFF', exact: true }).click();
  await save(page, 'コメント保存'); const output = await field(page, '出力 Positive').inputValue();
  await page.getByRole('tab', { name: '設定', exact: true }).click();
  const exported = await download(page, 'JSONをエクスポート');
  expect(exported.schemaVersion).toBe(SCHEMA_VERSION); expect(exported.payload.presets).toHaveLength(1);
  await upload(page, exportBackup(emptyData(), timestamp));
  await page.getByRole('combobox', { name: '取込方法', exact: true }).selectOption('replace');
  await page.getByRole('button', { name: '確認してインポート', exact: true }).click(); await saved(page);
  await upload(page, JSON.stringify(exported));
  await page.getByRole('button', { name: '確認してインポート', exact: true }).click(); await saved(page);
  const invalid = structuredClone(exported); invalid.payload.presets[0].workspaceSnapshot.groups[0].selectedMemberId = 'missing';
  await upload(page, JSON.stringify(invalid));
  await expect(page.getByRole('alert')).toContainText('選択先');
  await page.reload(); await saved(page);
  await expect(field(page, '出力 Positive')).toHaveValue(output);
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  await expect(field(page, '自由入力 Positive')).toHaveValue('a, b, c');
  await expect(page.getByLabel('自由入力 Positiveのコメント範囲', { exact: true }).getByRole('checkbox', { name: '範囲2 有効', exact: true })).not.toBeChecked();
  await select(page, 'コメント保存');
  await expect(field(page, '適用後のpositive')).toHaveValue(output);
});

test('Chromium migrates a real v1 IndexedDB preserving comments, order and migration backup', async ({ page }) => {
  page.on('dialog', dialog => void dialog.accept());
  const data = fixture(); data.libraryEntries.reverse(); data.future = { safe: '保全' };
  data.workspaces[0]!.freeformPositive = 'legacy, hidden, raw';
  data.workspaces[0]!.freeformPositiveSpans = commentRange('legacy, hidden, raw', undefined, 8, 14, ['aaaaaaaa-aaaa-4aaa-8aaa-000000000011', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000012', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000013']);
  const output = compileWorkspace(data.workspaces[0]!);
  await page.goto('/tests/fixtures/blank.html');
  await page.evaluate(async data => {
    const path = '/tests/fixtures/legacy-db.js'; const { seedLegacyDatabase } = await import(path).catch(() => import(path.replace(/\.js$/, '.ts')));
    const database = await seedLegacyDatabase(indexedDB, 'nai-prompt-workbench', data); database.close();
  }, data);
  await page.goto('/tests/fixtures/index.html'); await saved(page);
  await expect(field(page, '出力 Positive')).toHaveValue(output.positive);
  await page.getByRole('tab', { name: '設定', exact: true }).click();
  const backup = await download(page, '移行前バックアップを保存');
  expect(backup.payload).toEqual(data);
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  await save(page, '移行後保存'); await page.reload(); await saved(page);
  await expect(page.getByLabel('プリセット保存状態', { exact: true })).toContainText('移行後保存');
  const version = await page.evaluate(async () => {
    const request = indexedDB.open('nai-prompt-workbench');
    return new Promise<number>(resolve => { request.onsuccess = () => { const version = request.result.version; request.result.close(); resolve(version); }; });
  });
  expect(version).toBe(SCHEMA_VERSION);
});

test('a corrupt legacy database remains v1 and can be downloaded without automatic reset', async ({ page }) => {
  const data = fixture(); Object.assign(data.libraryEntries[0]!, { raw: 42 });
  await page.goto('/tests/fixtures/blank.html');
  await page.evaluate(async data => {
    const path = '/tests/fixtures/legacy-db.js'; const { seedLegacyDatabase } = await import(path).catch(() => import(path.replace(/\.js$/, '.ts')));
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic; data.future = cyclic;
    const database = await seedLegacyDatabase(indexedDB, 'nai-prompt-workbench', data); database.close();
  }, data);
  await page.goto('/tests/fixtures/index.html');
  await expect(page.getByRole('alert')).toContainText('移行に失敗');
  const recovery = await download(page, 'DB復旧用ファイルを保存');
  expect(JSON.stringify(recovery)).toContain('循環参照');
  expect(recovery.libraryEntries.some((entry: { raw: unknown }) => entry.raw === 42)).toBe(true);
  const stored = await page.evaluate(async () => {
    const request = indexedDB.open('nai-prompt-workbench');
    return new Promise<{ version: number; presets: boolean }>(resolve => { request.onsuccess = () => { const database = request.result; const result = { version: database.version, presets: database.objectStoreNames.contains('presets') }; database.close(); resolve(result); }; });
  });
  expect(stored).toEqual({ version: 1, presets: false });
});
