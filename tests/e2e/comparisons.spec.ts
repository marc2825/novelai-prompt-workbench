import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openFold, openPresetDetails, openPreview } from './helpers';
import { unknownSettings } from '../../src/core/experiments';
import { savePreset } from '../../src/core/presets';
import { fixture, timestamp } from '../unit/helpers';
import { chunk, png, stealthBytes, stealthPng } from '../fixtures/png';

const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const saved = (page: Page) => expect(page.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
// The workspace output preview starts collapsed on the Compare / Settings tabs; open it like a user would.
const tab = async (page: Page, name: string) => { await page.getByRole('tab', { name, exact: true }).click(); if (name === '比較' || name === '設定') await openPreview(page); };
async function boot(page: Page, demo = true) {
  page.on('dialog', dialog => void dialog.accept()); await page.goto('/tests/fixtures/index.html'); await saved(page);
  if (demo) { await tab(page, '設定'); await button(page, 'デモを追加').click(); await saved(page); }
  await tab(page, '比較');
}
async function create(page: Page, name = 'テスト比較') { await field(page, '新しい比較名').fill(name); await button(page, '比較セッションを作成').click(); await saved(page); }
async function upload(page: Page, label: 'A' | 'B', buffer: Buffer, name = 'synthetic.png') { await page.getByLabel(`${label}にPNGを取り込む`, { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer }); await expect(page.getByText('画像を検証・取り込み中…', { exact: true })).toHaveCount(0); await saved(page); }
async function exportJson(page: Page) { await tab(page, '設定'); const event = page.waitForEvent('download'); await button(page, 'JSONをエクスポート').click(); const path = await (await event).path(); return JSON.parse(await readFile(path!, 'utf8')); }

test('fixed A/B snapshots, local B changes, one-step Undo and session CRUD persist without changing workspace', async ({ page }) => {
  await boot(page); const original = await field(page, '出力 Positive').inputValue(); await create(page);
  await expect(field(page, 'A positive')).toHaveValue(original); await expect(field(page, 'B positive')).toHaveValue(original);
  await button(page, 'Bのグループ・タグを編集').click(); await field(page, 'B変更案 positive').fill('{{red|blue}}, 🌟');
  const draft = page.getByRole('region', { name: 'Bスナップショット編集', exact: true });
  await draft.getByRole('radio', { name: 'blonde hair, short hair', exact: true }).check();
  await expect(draft).toContainText('未保存'); await expect(button(page, '元に戻す')).toBeDisabled();
  await button(page, 'Bの変更を確定').click(); await saved(page);
  await expect(field(page, 'A positive')).toHaveValue(original); await expect(field(page, 'B positive')).toHaveValue('{{red|blue}}, 🌟, blonde hair, short hair, night, city lights'); await expect(field(page, '出力 Positive')).toHaveValue(original);
  await expect(page.getByLabel('A/Bテキスト差分')).toContainText('選択候補');
  await button(page, '元に戻す').click(); await expect(field(page, 'B positive')).toHaveValue(original); await button(page, 'やり直す').click();
  await field(page, '比較名').fill('保存比較 🌟'); await field(page, '比較名').press('Enter'); await saved(page);
  await button(page, '比較を複製').click(); await saved(page); await expect(field(page, '比較名')).toHaveValue('保存比較 🌟 のコピー');
  await button(page, '比較を削除').click(); await saved(page); await expect(field(page, '比較名')).toHaveValue('保存比較 🌟'); await button(page, '元に戻す').click(); await saved(page);
  await page.reload(); await saved(page); await tab(page, '比較'); await expect(page.getByRole('combobox', { name: '保存済み比較', exact: true }).locator('option')).toHaveCount(3); await expect(field(page, 'A positive')).toHaveValue(original);
  await expect(button(page, 'NovelAIに反映（P2）')).toBeDisabled();
});

test('preset source remains reproducible after preset and library changes', async ({ page }) => {
  await boot(page); await tab(page, 'ワークスペース'); await field(page, '新しいプリセット名').fill('元プリセット'); await button(page, '現在の構成をプリセット保存').click(); await saved(page);
  const original = await field(page, '出力 Positive').inputValue(); await tab(page, '比較'); await page.getByRole('combobox', { name: '比較元', exact: true }).selectOption({ label: '元プリセット' }); await create(page);
  await tab(page, 'ワークスペース'); await field(page, '自由入力 Positive').fill('changed current'); await button(page, '現在の構成で上書き保存').click(); await saved(page); await openPresetDetails(page); await button(page, 'プリセットを削除').click(); await saved(page);
  await tab(page, '比較'); await expect(field(page, 'A positive')).toHaveValue(original); await expect(field(page, 'B positive')).toHaveValue(original); await expect(page.getByLabel('比較 A', { exact: true })).toContainText('参照先削除済み'); await expect(field(page, '出力 Positive')).toContainText('changed current');
});

test('imports metadata/no-metadata PNG, deduplicates by SHA-256, supports drop, viewer modes and reload', async ({ page }) => {
  await boot(page); await create(page);
  const raw = JSON.stringify({ format: 'nai-prompt-workbench-generation', schemaVersion: 1, positive: '<script>alert(1)</script>', negative: '[text]', settings: { ...unknownSettings(), seed: '900719925474099312345', model: 'synthetic', evidence: 'png-metadata' } });
  const a = png(4, 4, { 'nai-prompt-workbench': raw }); await upload(page, 'A', a); await upload(page, 'B', a, 'same-bytes.png');
  await expect(page.getByText('同一ハッシュの画像を再利用しました。', { exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: '画像ライブラリ (1)', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible();
  await openFold(page, /^画像の情報・照合（A/); await page.getByLabel('比較 A', { exact: true }).getByText('抽出メタデータ（信頼されないテキスト）', { exact: true }).click(); await expect(page.getByLabel('比較 A', { exact: true })).toContainText('900719925474099312345'); expect(await page.locator('img[onerror], script:not([src])').count()).toBe(0);
  await page.getByRole('combobox', { name: '表示モード', exact: true }).selectOption('diff'); await expect(page.getByLabel('画像比較', { exact: true })).toContainText('変更ピクセル 0 / 16');
  const bytes = [...png(2, 3, {}, 200)]; const target = page.getByLabel('比較 B', { exact: true }).locator('.drop-zone');
  const transfer = await page.evaluateHandle(bytes => { const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], 'different.png', { type: 'image/png' })); return transfer; }, bytes);
  await target.dispatchEvent('drop', { dataTransfer: transfer }); await expect(page.getByRole('heading', { name: '画像ライブラリ (2)', exact: true })).toBeVisible(); await saved(page);
  await expect(page.getByLabel('画像比較', { exact: true })).toContainText('画像サイズが異なります'); await expect(page.getByLabel('画像比較', { exact: true })).toContainText('リサイズ条件を明示的に選ぶまで');
  await page.getByRole('checkbox', { name: 'BをAの幅・高さへ変形して比較', exact: false }).check(); await expect(page.getByRole('img', { name: 'A/Bピクセル差分', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '表示モード', exact: true }).selectOption('wipe'); await page.getByLabel('重ね合わせ位置', { exact: true }).fill('35'); await page.getByLabel('同期ズーム', { exact: true }).fill('2'); await page.getByLabel('同期画像枠', { exact: true }).focus(); await page.keyboard.press('ArrowRight');
  const styles = await page.getByLabel('画像比較', { exact: true }).locator('img').evaluateAll(images => images.map(image => image.getAttribute('style'))); expect(styles[0]).toContain('20px'); expect(styles[1]).toContain('20px');
  await page.getByLabel('画像比較', { exact: true }).screenshot({ path: test.info().outputPath('nai-p4-comparison.png') });
  await page.reload(); await saved(page); await tab(page, '比較'); await expect(page.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible(); await expect(page.getByRole('img', { name: '比較画像B', exact: true })).toBeVisible();
  await expect(page.getByLabel('比較 B', { exact: true })).toContainText('NovelAI固有メタデータは未検証');
});

test('rejects corrupt files without replacing snapshots or existing image and undoes image deletion', async ({ page }) => {
  await boot(page); await create(page); await upload(page, 'A', png());
  const original = await field(page, 'A positive').inputValue();
  await page.getByLabel('AにPNGを取り込む', { exact: true }).setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload=alert(1)>') });
  await expect(page.getByRole('alert')).toContainText('PNG署名'); await expect(field(page, 'A positive')).toHaveValue(original); await expect(page.getByRole('heading', { name: '画像ライブラリ (1)', exact: true })).toBeVisible();
  const corruptPixels = Buffer.concat([png().subarray(0, 33), chunk('IDAT', Buffer.from([1, 2, 3])), chunk('IEND', Buffer.alloc(0))]);
  await page.getByLabel('AにPNGを取り込む', { exact: true }).setInputFiles({ name: 'corrupt-pixels.png', mimeType: 'image/png', buffer: corruptPixels });
  await expect(page.getByRole('alert')).toContainText('画像取込失敗'); await expect(page.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible();
  await openFold(page, /^画像ライブラリ/); await button(page, '登録画像を削除').click(); await saved(page); await expect(page.getByRole('heading', { name: '画像ライブラリ (0)', exact: true })).toBeVisible();
  await button(page, '元に戻す').click(); await saved(page); await expect(page.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible();
});

test('JSON explicitly excludes binaries, fresh-profile restore diagnoses missing PNG and reimport repairs it', async ({ page, browser }) => {
  await boot(page); await create(page); const bytes = png(); await upload(page, 'A', bytes); const exported = await exportJson(page);
  expect(exported.imageBinariesIncluded).toBe(false); expect(exported.payload.images).toHaveLength(1); expect(JSON.stringify(exported)).not.toContain('base64');
  const context = await browser.newContext(); const restored = await context.newPage(); await boot(restored, false); await tab(restored, '設定');
  await restored.getByLabel('JSONをインポート', { exact: true }).setInputFiles({ name: 'p4.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) }); await button(restored, '確認してインポート').click(); await saved(restored); await tab(restored, '比較');
  await expect(restored.getByLabel('画像比較', { exact: true })).toContainText('画像原本が欠落'); await upload(restored, 'A', bytes); await expect(restored.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible(); await expect(restored.getByRole('heading', { name: '画像ライブラリ (1)', exact: true })).toBeVisible(); await context.close();
});

test('quota failure keeps original DB atomic, reports unsaved state and allows retry', async ({ page }) => {
  await boot(page); await create(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restorePut: () => void }).restorePut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function (...args) { if (this.name === 'imageThumbnails') throw new DOMException('storage quota exceeded', 'QuotaExceededError'); return original.apply(this, args); };
  });
  await page.getByLabel('AにPNGを取り込む', { exact: true }).setInputFiles({ name: 'quota.png', mimeType: 'image/png', buffer: png() });
  await expect(page.getByText('保存エラー・作業データは未保存です', { exact: true })).toBeVisible(); await expect(page.getByRole('alert')).toContainText('quota');
  const count = await page.evaluate(async () => { const req = indexedDB.open('nai-prompt-workbench'); return new Promise<number>(resolve => { req.onsuccess = () => { const db = req.result; const read = db.transaction('images').objectStore('images').count(); read.onsuccess = () => { db.close(); resolve(read.result); }; }; }); }); expect(count).toBe(0);
  await page.evaluate(() => (window as unknown as { restorePut: () => void }).restorePut()); await button(page, '保存を再試行').click(); await saved(page); await page.reload(); await saved(page); await tab(page, '比較'); await expect(page.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible();
});

test('Chromium upgrades v2 with preserved presets and backed-up records', async ({ page }) => {
  page.on('dialog', dialog => void dialog.accept()); let data = fixture(); data = savePreset(data, data.workspaces[0]!.id, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000099', 'v2プリセット', timestamp);
  await page.goto('/tests/fixtures/blank.html'); await page.evaluate(async data => { const path = '/tests/fixtures/legacy-db.js'; const { seedV2Database } = await import(path).catch(() => import(path.replace(/\.js$/, '.ts'))); (await seedV2Database(indexedDB, 'nai-prompt-workbench', data)).close(); }, data);
  await page.goto('/tests/fixtures/index.html'); await saved(page); await tab(page, '比較'); await page.getByRole('combobox', { name: '比較元', exact: true }).selectOption({ label: 'v2プリセット' }); await create(page); await expect(field(page, 'A positive')).toHaveValue(await field(page, '出力 Positive').inputValue());
  await tab(page, '設定'); const event = page.waitForEvent('download'); await button(page, '移行前バックアップを保存').click(); const path = await (await event).path(); const backup = JSON.parse(await readFile(path!, 'utf8')); expect(backup.payload).toEqual(data);
});

test('manual settings preserve exact Seed, show unknown/mismatch and confirm draft navigation', async ({ page }) => {
  await boot(page); await create(page); const a = page.getByLabel('比較 A', { exact: true }); await a.getByText('生成設定の確認・手入力', { exact: true }).click();
  await a.getByLabel('Seed', { exact: true }).fill('900719925474099312345'); await a.getByLabel('モデル', { exact: true }).fill('manual model'); await a.getByRole('button', { name: '設定を保存', exact: true }).click(); await saved(page);
  await expect(page.getByLabel('A/Bテキスト差分')).toContainText('検証不能'); await expect(page.getByLabel('A/Bテキスト差分')).toContainText('900719925474099312345');
  await button(page, 'Bのグループ・タグを編集').click(); await field(page, 'B変更案 negative').fill('[new|negative]');
  page.removeAllListeners('dialog'); page.on('dialog', dialog => void dialog.dismiss()); await tab(page, 'ライブラリ'); await expect(page.getByRole('tab', { name: '比較', exact: true })).toHaveAttribute('aria-selected', 'true'); await expect(field(page, 'B変更案 negative')).toHaveValue('[new|negative]');
  page.removeAllListeners('dialog'); page.on('dialog', dialog => void dialog.accept()); await button(page, 'Bの変更を確定').click(); await saved(page); await page.reload(); await saved(page); await tab(page, '比較'); const slot = page.getByLabel('比較 A', { exact: true }); await slot.getByText('生成設定の確認・手入力', { exact: true }).click(); await expect(slot.getByLabel('Seed', { exact: true })).toHaveValue('900719925474099312345');
});

test('manual image notes and original-file export preserve pixels and never rewrite fixed prompts', async ({ page }) => {
  await boot(page); await create(page);
  await page.evaluate(() => { const urls = new Set<string>(); (window as unknown as { liveUrls: Set<string> }).liveUrls = urls; const create = URL.createObjectURL; const revoke = URL.revokeObjectURL; URL.createObjectURL = value => { const url = create(value); urls.add(url); return url; }; URL.revokeObjectURL = url => { urls.delete(url); revoke(url); }; });
  const bytes = png(3, 2); await upload(page, 'A', bytes); const before = await field(page, 'A positive').inputValue();
  const slot = page.getByLabel('比較 A', { exact: true }); await openFold(page, /^画像の情報・照合（A/); await slot.getByText('画像情報を手入力で補完', { exact: true }).click();
  await slot.getByLabel('画像 Positive 注記', { exact: true }).fill('<script>手入力</script>'); await slot.getByLabel('画像 Negative 注記', { exact: true }).fill('manual negative'); await slot.getByRole('button', { name: '画像のプロンプト注記を保存', exact: true }).click(); await saved(page);
  await expect(slot).toContainText('画像Prompt取得元: manual'); await expect(field(page, 'A positive')).toHaveValue(before);
  await openFold(page, /^画像ライブラリ/); const event = page.waitForEvent('download'); await button(page, '画像原本を保存').click(); const path = await (await event).path(); expect(await readFile(path!)).toEqual(bytes);
  await tab(page, 'ライブラリ'); await expect.poll(() => page.evaluate(() => (window as unknown as { liveUrls: Set<string> }).liveUrls.size)).toBe(0);
  await page.reload(); await saved(page); await tab(page, '比較'); await expect(page.getByLabel('比較 A', { exact: true })).toContainText('画像Prompt取得元: manual');
});

test('restoring changed metadata under an existing image ID rejects stale bytes and same-PNG repair corrects dimensions', async ({ page }) => {
  await boot(page); await create(page); const bytes = png(3, 2); await upload(page, 'A', bytes); const exported = await exportJson(page);
  const restore = async (value: unknown) => {
    await tab(page, '設定'); await page.getByLabel('JSONをインポート', { exact: true }).setInputFiles({ name: 'changed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
    await page.getByRole('combobox', { name: '取込方法', exact: true }).selectOption('replace'); await button(page, '確認してインポート').click(); await saved(page); await tab(page, '比較');
  };
  const changedHash = structuredClone(exported); changedHash.payload.images[0].hash = '0'.repeat(64); await restore(changedHash);
  await expect(page.getByLabel('画像比較', { exact: true })).toContainText('メタデータと不整合'); await expect(page.getByRole('img', { name: '比較画像A', exact: true })).toHaveCount(0);
  await button(page, '元に戻す').click(); await saved(page); await expect(page.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible();
  const changedSize = structuredClone(exported); changedSize.payload.images[0].width = 4; changedSize.payload.images[0].thumbnailBytes += 1; await restore(changedSize);
  await expect(page.getByLabel('画像比較', { exact: true })).toContainText('メタデータと不整合'); await upload(page, 'A', bytes);
  await expect(page.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: '画像ライブラリ (1)', exact: true })).toBeVisible();
  await expect(page.getByLabel('比較 A', { exact: true })).toContainText('3×2');
});

// The slot's own settings editor; the attached image has a second one inside 画像情報を手入力で補完.
const variantSettings = (slot: Locator) => slot.locator('details').filter({ has: slot.page().locator('summary', { hasText: /^生成設定の確認・手入力$/ }) }).first();
// Synthetic PNG in NovelAI's official *container* format (text chunks + alpha-channel stealth payload).
// Not a real NovelAI image: this does not verify real-site files or the meaning of the fields.
test('NovelAI container values appear only as unverified candidates and are adopted after confirm', async ({ page }) => {
  await boot(page); await create(page); const original = await field(page, 'A positive').inputValue();
  const comment = { prompt: '<script>alert(1)</script>, 1girl', uc: 'lowres', seed: 1234567890, steps: 28, width: 96, height: 96, scale: 5.5, cfg_rescale: 0, sampler: 'k_euler_ancestral', extra_flag: true };
  const fields = { Description: '1girl', Software: 'NovelAI', Source: 'Synthetic Model 0000', 'Generation time': '1.5', Comment: JSON.stringify(comment) };
  await upload(page, 'A', stealthPng(stealthBytes(fields), { width: 96, height: 96, filter: 4, texts: [['Title', 'NovelAI generated image'], ...Object.entries(fields)] }), 'novelai-synthetic.png');
  const slot = page.getByLabel('比較 A', { exact: true }); await openFold(page, /^画像の情報・照合（A/);
  const info = page.getByRole('region', { name: 'NovelAIの画像情報（候補・A）', exact: true });
  await expect(info).toContainText('NovelAIの公式文書で意味が確認されていない項目です。値を確認してから採用してください。'); await expect(info).toContainText('PNGテキスト・アルファチャンネル（内容が一致）');  await expect(info.getByRole('row', { name: 'Seed Comment.seed 1234567890', exact: true })).toBeVisible(); await expect(info.getByRole('row', { name: 'モデル Source Synthetic Model 0000', exact: true })).toBeVisible();
  await expect(slot).toContainText('NovelAI固有メタデータは未検証です'); await expect(slot).toContainText('画像設定照合: 検証不能'); await expect(button(page, '画像の設定を採用')).toBeDisabled();
  expect(await page.locator('script:not([src])').count()).toBe(0);
  // Nothing is adopted on import, and dismissing the confirm keeps the slot unknown.
  await variantSettings(slot).getByText('生成設定の確認・手入力', { exact: true }).click(); await expect(variantSettings(slot).getByLabel('Seed', { exact: true })).toHaveValue('');
  page.removeAllListeners('dialog'); const messages: string[] = []; page.on('dialog', dialog => { messages.push(dialog.message()); void dialog.dismiss(); });
  await button(page, 'NovelAIの候補を確認して採用（A）').click(); expect(messages[0]).toContain('公式に意味が確認されていない値です'); await expect(variantSettings(slot).getByLabel('Seed', { exact: true })).toHaveValue('');
  page.removeAllListeners('dialog'); page.on('dialog', dialog => void dialog.accept());
  await button(page, 'NovelAIの候補を確認して採用（A）').click(); await saved(page);
  await expect(variantSettings(slot).getByLabel('Seed', { exact: true })).toHaveValue('1234567890'); await expect(variantSettings(slot).getByLabel('Steps', { exact: true })).toHaveValue('28'); await expect(variantSettings(slot).getByLabel('Guidance / CFG', { exact: true })).toHaveValue('5.5');
  await expect(variantSettings(slot).getByLabel('モデル', { exact: true })).toHaveValue('Synthetic Model 0000'); await expect(variantSettings(slot).getByLabel('生成枚数', { exact: true })).toHaveValue('');
  await expect(variantSettings(slot).getByRole('checkbox', { name: '追加条件をすべて確認した', exact: true })).not.toBeChecked(); await expect(field(page, 'A positive')).toHaveValue(original);
  await button(page, 'NovelAIのPrompt候補を画像の注記に採用（A）').click(); await saved(page); await expect(slot).toContainText('画像Prompt取得元: png-metadata'); await expect(field(page, 'A positive')).toHaveValue(original);
  const exported = await exportJson(page); const variant = exported.payload.experiments[0].variantA; const image = exported.payload.images[0];
  expect(variant.settings).toEqual({ ...unknownSettings(), seed: '1234567890', steps: 28, width: 96, height: 96, sampler: 'k_euler_ancestral', guidance: 5.5, cfgRescale: 0, model: 'Synthetic Model 0000', evidence: 'png-metadata' });
  expect(variant.compiled.positive).toBe(original); expect(image.metadata.novelai).toEqual({ sources: ['text', 'stealth'], agreement: 'match', stealth: null });
  expect(image.metadata.settings).toEqual(unknownSettings()); expect([image.metadata.positive, image.metadata.negative, image.metadata.promptEvidence]).toEqual([comment.prompt, 'lowres', 'png-metadata']);
  await page.reload(); await saved(page); await tab(page, '比較'); const reloaded = page.getByLabel('比較 A', { exact: true }); await variantSettings(reloaded).getByText('生成設定の確認・手入力', { exact: true }).click(); await expect(variantSettings(reloaded).getByLabel('Seed', { exact: true })).toHaveValue('1234567890');
});

test('disagreeing NovelAI containers are both shown and adoption requires choosing a source', async ({ page }) => {
  await boot(page); await create(page);
  const fields = (seed: number) => ({ Software: 'NovelAI', Comment: JSON.stringify({ seed, steps: 20 }) });
  await upload(page, 'B', stealthPng(stealthBytes(fields(42)), { texts: Object.entries(fields(7)) as [string, string][] }));
  await openFold(page, /^画像の情報・照合（B/); const info = page.getByRole('region', { name: 'NovelAIの画像情報（候補・B）', exact: true });
  await expect(info.getByRole('alert')).toContainText('内容が異なります'); await expect(info.getByRole('row', { name: 'Seed Comment.seed 7', exact: true })).toBeVisible(); await expect(info.getByRole('row', { name: 'Seed Comment.seed 42', exact: true })).toBeVisible();
  await expect(button(page, 'NovelAIの候補を確認して採用（B）')).toBeDisabled();
  await page.getByRole('combobox', { name: '採用する取得元（B）', exact: true }).selectOption({ label: 'アルファチャンネル' }); await button(page, 'NovelAIの候補を確認して採用（B）').click(); await saved(page);
  const slot = page.getByLabel('比較 B', { exact: true }); await variantSettings(slot).getByText('生成設定の確認・手入力', { exact: true }).click(); await expect(variantSettings(slot).getByLabel('Seed', { exact: true })).toHaveValue('42');
});
