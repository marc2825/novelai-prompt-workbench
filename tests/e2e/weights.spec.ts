import { expect, test, type Page } from '@playwright/test';
import { png } from '../fixtures/png';

const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const saved = (page: Page) => expect(page.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();
async function select(page: Page, label: string, text: string, last = false) {
  await field(page, label).evaluate((element: HTMLTextAreaElement, { text, last }) => {
    element.focus(); const start = last ? element.value.lastIndexOf(text) : element.value.indexOf(text); element.setSelectionRange(start, start + text.length);
  }, { text, last });
  await button(page, `${label}の重みを調整`).click();
}
async function upload(page: Page, label: string, shade: number) {
  await page.getByLabel(`${label}にPNGを取り込む`, { exact: true }).setInputFiles({ name: `${label}.png`, mimeType: 'image/png', buffer: png(16, 16, {}, shade) });
  await expect(page.getByText('画像を検証・取り込み中…', { exact: true })).toHaveCount(0); await saved(page);
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/tests/fixtures/index.html'); await saved(page);
  await tab(page, '設定'); await button(page, 'デモを追加').click(); await saved(page);
  await tab(page, 'ワークスペース');
});

test('selected occurrence preview, numeric input, single-step Undo, reset and persistence in both channels', async ({ page }) => {
  const label = '自由入力 Positive'; const source = '猫🌟, blue eyes,  blue eyes  ';
  await field(page, label).fill(source); await select(page, label, 'blue eyes', true);
  const control = page.getByRole('region', { name: `${label}のタグ重み`, exact: true });
  expect((await control.boundingBox())!.width).toBeLessThanOrEqual(400);
  await control.getByRole('slider').fill('1.35');
  await expect(field(page, '重み変更後のプレビュー')).toHaveValue('猫🌟, blue eyes,  1.35::blue eyes::  ');
  await expect(field(page, label)).toHaveValue(source);
  await control.getByRole('spinbutton').fill(''); await expect(button(page, '重みを反映')).toBeDisabled();
  await control.getByRole('spinbutton').fill('1.5'); await button(page, '重みを反映').click(); await saved(page);
  await expect(field(page, label)).toHaveValue('猫🌟, blue eyes,  1.5::blue eyes::  ');
  await button(page, '元に戻す').click(); await expect(field(page, label)).toHaveValue(source);
  await button(page, 'やり直す').click(); await select(page, label, '1.5::blue eyes::');
  await button(page, '標準の重みに戻す').click(); await button(page, '重みを反映').click(); await expect(field(page, label)).toHaveValue(source);
  await field(page, '自由入力 Negative').fill('watermark, text'); await select(page, '自由入力 Negative', 'watermark');
  await page.getByRole('slider', { name: '重みスライダー', exact: true }).fill('0.5'); await button(page, '重みを反映').click(); await saved(page);
  await expect(field(page, '出力 Negative')).toContainText('0.5::watermark::, text');
  await page.reload(); await saved(page); await tab(page, 'ワークスペース');
  await expect(field(page, label)).toHaveValue(source); await expect(field(page, '自由入力 Negative')).toHaveValue('0.5::watermark::, text');
});

test('B weight workflow preserves A and workspace, clears stale B image, restores with Undo and compares new PNGs', async ({ page }) => {
  await tab(page, '比較'); await button(page, '比較セッションを作成').click(); await saved(page);
  const original = await field(page, 'A positive').inputValue();
  await upload(page, 'A', 30); await upload(page, 'B', 120);
  await button(page, 'Bのグループ・タグを編集').click();
  await select(page, 'B変更案 positive', '1girl');
  const slider = page.getByRole('slider', { name: '重みスライダー', exact: true });
  await slider.focus(); await slider.press('ArrowRight'); await expect(slider).toHaveValue('1.05'); await slider.fill('1.4');
  await expect(button(page, 'Bの変更を確定')).toBeDisabled();
  expect((await page.getByRole('region', { name: 'B変更案 positiveのタグ重み', exact: true }).boundingBox())!.width).toBeLessThanOrEqual(400);
  await page.getByRole('region', { name: 'B変更案 positiveのタグ重み', exact: true }).screenshot({ path: test.info().outputPath('nai-tag-weight-control.png') });
  await button(page, '重みを反映').click();
  await expect(field(page, 'B確定前 Positive')).toHaveValue(original.replace('1girl', '1.4::1girl::'));
  await button(page, '変更案をUndo').click(); await expect(field(page, 'B変更案 positive')).toHaveValue('1girl');
  await button(page, '変更案をRedo').click();
  // Group-member editor uses the same control and cannot silently drop a pending preview.
  const group = page.getByRole('group', { name: '背景 / positive', exact: true });
  await group.getByText('この候補のタグを編集', { exact: true }).click(); await select(page, 'B 背景 候補1', 'night');
  await expect(button(page, 'Bの変更を確定')).toBeDisabled(); await button(page, '重みの調整を閉じる').click();
  await button(page, 'Bの変更を確定').click(); await saved(page);
  await expect(field(page, 'A positive')).toHaveValue(original); await expect(field(page, '出力 Positive')).toHaveValue(original);
  await expect(page.getByRole('combobox', { name: 'Bの登録済み画像', exact: true })).toHaveValue('');
  await expect(page.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible();
  await button(page, '元に戻す').click(); await saved(page); await expect(page.getByRole('img', { name: '比較画像B', exact: true })).toBeVisible();
  await button(page, 'やり直す').click(); await saved(page); await upload(page, 'B', 220);
  await expect(page.getByLabel('A/Bテキスト差分')).toContainText('1.4::');
  await page.getByRole('combobox', { name: '表示モード', exact: true }).selectOption('wipe');
  await page.getByRole('slider', { name: '重ね合わせ位置', exact: true }).fill('40');
  await expect(page.getByRole('img', { name: '比較画像B', exact: true })).toBeVisible();
  await page.getByLabel('画像比較', { exact: true }).screenshot({ path: test.info().outputPath('nai-weight-comparison.png') });
  await page.reload(); await saved(page); await tab(page, '比較');
  await expect(field(page, 'B positive')).toHaveValue(original.replace('1girl', '1.4::1girl::'));
  await expect(page.getByRole('img', { name: '比較画像B', exact: true })).toBeVisible();
});

test('rejects ambiguous syntax, protects commented text, and invalidates preview after raw edits', async ({ page }) => {
  const label = '自由入力 Positive';
  await field(page, label).fill('blue eyes, cat'); await select(page, label, 'blue');
  await expect(page.getByRole('alert')).toContainText('タグ全体を選択');
  await field(page, label).fill('{a, b, c}'); await select(page, label, 'b');
  await expect(page.getByRole('alert')).toContainText('複雑構文'); await expect(field(page, label)).toHaveValue('{a, b, c}');
  await field(page, label).fill('cat'); await select(page, label, 'cat');
  await field(page, label).fill('dog'); await expect(button(page, '重みを反映')).toHaveCount(0);
  await field(page, label).selectText(); await button(page, `${label}の選択範囲をOFF`).click();
  await expect(button(page, `${label}の重みを調整`)).toBeDisabled();
  await button(page, '元に戻す').click(); await expect(button(page, `${label}の重みを調整`)).toBeEnabled();
});
