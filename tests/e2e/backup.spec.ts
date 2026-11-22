import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { png } from '../fixtures/png';

// Mock E2E on the local fixture (no extension, no NovelAI). A second browser
// context has its own IndexedDB, standing in for another Chrome profile.

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

test('complete backup restores text, comparisons, shuffle and original PNGs into a fresh profile; corrupt ZIPs change nothing', async ({ page, browser }) => {
  const errors = await boot(page);
  await tab(page, '設定'); await button(page, 'デモを追加').click(); await saved(page);
  await tab(page, '比較');
  await field(page, '新しい比較名').fill('バックアップ比較'); await button(page, '比較セッションを作成').click(); await saved(page);
  await page.getByLabel('AにPNGを取り込む', { exact: true }).setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png(6, 4, {}, 30) });
  await expect(page.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible();
  await page.getByLabel('BにPNGを取り込む', { exact: true }).setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: png(6, 4, {}, 220) });
  await expect(page.getByRole('img', { name: '比較画像B', exact: true })).toBeVisible();
  await saved(page);
  await tab(page, 'シャッフル');
  await field(page, '新しいプロファイル名').fill('移行プロファイル'); await button(page, '＋ プロファイル').click(); await saved(page);
  await tab(page, '設定');
  const download = page.waitForEvent('download');
  await button(page, '完全バックアップをZIPで保存').click();
  const zip = await download;
  expect(zip.suggestedFilename()).toMatch(/^spellbinder-backup-\d{8}-\d{6}Z\.zip$/);
  const zipPath = (await zip.path())!;
  await expect(page.getByLabel('完全バックアップ', { exact: true }).getByRole('status').last()).toContainText('画像原本2件');

  const other = await browser.newContext();
  try {
    const restored = await other.newPage();
    const otherErrors = await boot(restored);
    await expect(restored.getByText('0件 / 全0件', { exact: true })).toBeVisible();
    await tab(restored, '設定');
    // A corrupt (truncated) ZIP is rejected and nothing changes.
    const bytes = await readFile(zipPath);
    await restored.getByLabel('完全バックアップZIPを読み込む', { exact: true }).setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: bytes.subarray(0, bytes.length - 40) });
    await expect(restored.getByLabel('完全バックアップ', { exact: true }).getByRole('alert')).toContainText('現在のデータは変更していません');
    await expect(restored.getByLabel('完全バックアップの内容プレビュー', { exact: true })).toHaveCount(0);
    // The real backup: verify, preview, restore.
    await restored.getByLabel('完全バックアップZIPを読み込む', { exact: true }).setInputFiles(zipPath);
    const preview = restored.getByLabel('完全バックアップの内容プレビュー', { exact: true });
    await expect(preview).toContainText('画像原本（検証済み）');
    await expect(preview.getByRole('row', { name: /^ライブラリ 0 5$/ })).toBeVisible();
    await expect(preview.getByRole('row', { name: /^A\/B比較 0 1$/ })).toBeVisible();
    await expect(preview).toContainText('2件');
    await button(restored, '確認して完全バックアップを復元').click();
    await expect(restored.getByLabel('完全バックアップ', { exact: true }).getByRole('status').last()).toContainText('完全バックアップを復元しました');
    await saved(restored);
    await tab(restored, 'ライブラリ');
    await expect(restored.getByText('5件 / 全5件', { exact: true })).toBeVisible();
    await tab(restored, '比較');
    await expect(field(restored, '比較名')).toHaveValue('バックアップ比較');
    await expect(restored.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible();
    await expect(restored.getByRole('img', { name: '比較画像B', exact: true })).toBeVisible();
    await restored.getByRole('combobox', { name: '表示モード', exact: true }).selectOption('diff');
    await expect(restored.getByLabel('画像比較', { exact: true })).toContainText('変更ピクセル 24 / 24');
    await tab(restored, 'シャッフル');
    await expect(restored.getByRole('combobox', { name: 'シャッフルプロファイル', exact: true })).toContainText('移行プロファイル');
    // The restore is a single Undo step (memory history), then it persists across a reload.
    await button(restored, '元に戻す').click(); await saved(restored);
    await tab(restored, 'ライブラリ');
    await expect(restored.getByText('0件 / 全0件', { exact: true })).toBeVisible();
    await button(restored, 'やり直す').click(); await saved(restored);
    await expect(restored.getByText('5件 / 全5件', { exact: true })).toBeVisible();
    await restored.reload(); await saved(restored);
    await tab(restored, '比較');
    await expect(restored.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible();
    await expect(restored.getByRole('img', { name: '比較画像B', exact: true })).toBeVisible();
    expect(otherErrors).toEqual([]);
  } finally { await other.close(); }
  expect(errors).toEqual([]);
});

test('an Experiment Lab ZIP or a JSON file is not accepted as a complete backup', async ({ page }) => {
  await boot(page);
  await tab(page, '設定');
  const { writeZip } = await import('../../src/data/zip');
  const lab = Buffer.from(await (await writeZip([{ name: 'experiment.json', data: new TextEncoder().encode('{}') }, { name: 'conditions.csv', data: new Uint8Array([1]) }])).arrayBuffer());
  await page.getByLabel('完全バックアップZIPを読み込む', { exact: true }).setInputFiles({ name: 'experiment.zip', mimeType: 'application/zip', buffer: lab });
  await expect(page.getByLabel('完全バックアップ', { exact: true }).getByRole('alert')).toContainText('Experiment LabのZIP');
  await page.getByLabel('完全バックアップZIPを読み込む', { exact: true }).setInputFiles({ name: 'data.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"nai-prompt-workbench"}') });
  await expect(page.getByLabel('完全バックアップ', { exact: true }).getByRole('alert')).toContainText('ZIPを読み取れません');
});

test('a password-encrypted complete backup restores only with the right password, and its file shows no plaintext (issue #33)', async ({ page, browser }) => {
  const errors = await boot(page);
  await tab(page, '設定'); await button(page, 'デモを追加').click(); await saved(page);
  await page.getByRole('checkbox', { name: 'パスワードで暗号化する', exact: true }).check();
  await expect(button(page, '暗号化して完全バックアップを保存')).toBeDisabled();
  await page.getByLabel('暗号化のパスワード', { exact: true }).fill('demo password 1');
  await page.getByLabel('パスワード（確認）', { exact: true }).fill('demo password 2');
  await expect(page.getByText('確認用のパスワードが一致しません', { exact: true })).toBeVisible();
  await page.getByLabel('パスワード（確認）', { exact: true }).fill('demo password 1');
  const download = page.waitForEvent('download');
  await button(page, '暗号化して完全バックアップを保存').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^spellbinder-backup-\d{8}-\d{6}Z-encrypted\.nwbenc$/);
  const path = (await file.path())!;
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 8).toString('latin1')).toBe('NAIWBENC');
  expect(bytes.includes(Buffer.from('nai-prompt-workbench-full-backup'))).toBe(false);
  await expect(page.getByLabel('完全バックアップ', { exact: true }).getByRole('status').last()).toContainText('パスワードで暗号化した完全バックアップを保存しました');
  await expect(page.getByLabel('暗号化のパスワード', { exact: true })).toHaveValue('');

  const other = await browser.newContext();
  try {
    const restored = await other.newPage();
    const otherErrors = await boot(restored);
    await tab(restored, '設定');
    await restored.getByLabel('完全バックアップZIPを読み込む', { exact: true }).setInputFiles(path);
    const locked = restored.getByRole('form', { name: '暗号化されたバックアップ', exact: true });
    await locked.getByLabel('バックアップのパスワード', { exact: true }).fill('not the password');
    await button(restored, '復号して内容を確認').click();
    await expect(restored.getByLabel('完全バックアップ', { exact: true }).getByRole('alert')).toContainText('パスワードが違うか');
    await expect(restored.getByLabel('完全バックアップの内容プレビュー', { exact: true })).toHaveCount(0);
    await locked.getByLabel('バックアップのパスワード', { exact: true }).fill('demo password 1');
    await button(restored, '復号して内容を確認').click();
    const preview = restored.getByLabel('完全バックアップの内容プレビュー', { exact: true });
    await expect(preview.getByRole('row', { name: /^ライブラリ 0 5$/ })).toBeVisible();
    await button(restored, '確認して完全バックアップを復元').click();
    await expect(restored.getByLabel('完全バックアップ', { exact: true }).getByRole('status').last()).toContainText('完全バックアップを復元しました');
    await saved(restored);
    await tab(restored, 'ライブラリ');
    await expect(restored.getByText('5件 / 全5件', { exact: true })).toBeVisible();
    expect(otherErrors).toEqual([]);
  } finally { await other.close(); }
  expect(errors).toEqual([]);
});
