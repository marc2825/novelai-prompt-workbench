import { expect, test, type Page } from '@playwright/test';
import { openFold } from './helpers';

// Tag completion and the local tag dictionary (issue #27). Mock UI only (no NovelAI site involved).
const runtimeErrors = new WeakMap<Page, string[]>();
const saved = (page: Page) => expect(page.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();
const positive = (page: Page) => page.getByRole('textbox', { name: '自由入力 Positive', exact: true });
const suggestions = (page: Page) => page.getByRole('listbox', { name: '自由入力 Positiveのタグ候補', exact: true });
const caretAtEnd = async (page: Page) => { await positive(page).focus(); await positive(page).press('Control+End'); };
const caret = (page: Page) => positive(page).evaluate(element => (element as HTMLTextAreaElement).selectionStart);

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/tests/fixtures/index.html');
  await saved(page);
  await tab(page, '設定');
  await page.getByRole('button', { name: 'デモを追加', exact: true }).click();
  await saved(page);
});
test.afterEach(async ({ page }) => { expect(runtimeErrors.get(page)).toEqual([]); });

test('completes a library tag with the keyboard: ↑/↓ choose, Enter accepts, Undo restores, Esc and plain Enter behave as before', async ({ page }) => {
  await tab(page, 'ワークスペース');
  await caretAtEnd(page);
  await positive(page).pressSequentially(', bl');
  const list = suggestions(page);
  // Tags already used in the library (demo: "{{black hair}}, long hair", "blonde hair, short hair").
  await expect(list.getByRole('option')).toHaveText([/^black hair/, /^blonde hair/]);
  await expect(positive(page)).toHaveAttribute('aria-controls', (await list.getAttribute('id'))!);
  await expect(positive(page)).not.toHaveAttribute('aria-activedescendant');
  await positive(page).press('ArrowDown');
  await positive(page).press('ArrowDown');
  const blonde = list.getByRole('option', { name: /^blonde hair/ });
  await expect(blonde).toHaveAttribute('aria-selected', 'true');
  await expect(positive(page)).toHaveAttribute('aria-activedescendant', (await blonde.getAttribute('id'))!);
  await positive(page).press('Enter');
  await expect(positive(page)).toHaveValue('1girl, blonde hair');
  await expect(list).toHaveCount(0);
  expect(await caret(page)).toBe('1girl, blonde hair'.length);
  await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue('1girl, blonde hair, {{black hair}}, long hair, night, city lights');
  await saved(page);
  // The accepted suggestion is one normal edit.
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(positive(page)).toHaveValue('1girl, bl');
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(positive(page)).toHaveValue('1girl, blonde hair');
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await saved(page);
  // Escape closes the list; typing reopens it; Enter without a chosen suggestion is a newline.
  await caretAtEnd(page);
  await expect(list).toBeVisible();
  await positive(page).press('Escape');
  await expect(list).toHaveCount(0);
  await positive(page).pressSequentially('o');
  await expect(list.getByRole('option')).toHaveText([/^blonde hair/]);
  // While an IME composition is in progress the list stays out of the way.
  await positive(page).evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })));
  await expect(list).toHaveCount(0);
  await positive(page).evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' })));
  await expect(list.getByRole('option')).toHaveText([/^blonde hair/]);
  await positive(page).press('Enter');
  await expect(positive(page)).toHaveValue('1girl, blo\n');
  await expect(list).toHaveCount(0);
  // Weights and braces around the partial tag are kept; only the partial tag is replaced.
  await positive(page).fill('{{x}}, 1.2::bl::');
  await positive(page).evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(14, 14));
  await expect(list.getByRole('option')).toHaveText([/^black hair/, /^blonde hair/]);
  await positive(page).press('ArrowUp');
  await positive(page).press('Tab');
  await expect(positive(page)).toHaveValue('{{x}}, 1.2::blonde hair::');
  expect(await caret(page)).toBe('{{x}}, 1.2::blonde hair'.length);
  await expect(positive(page)).toBeFocused();
  // No completion inside a ||randomizer|| or in the middle of a word.
  await positive(page).fill('||red|bl');
  await expect(list).toHaveCount(0);
  await positive(page).fill('blond');
  await positive(page).evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(2, 2));
  await positive(page).press('ArrowRight');
  await expect(list).toHaveCount(0);
  await saved(page);
});

test('dictionary entries rank first, complete via an alias, show spelling variants, and completion can be turned off', async ({ page }) => {
  await tab(page, 'ライブラリ');
  await openFold(page, /^タグ辞書/);
  await page.getByLabel('辞書のタグ', { exact: true }).fill('silver hair');
  await page.getByLabel('別名（カンマ区切り）', { exact: true }).fill('銀髪、gin');
  await page.getByLabel('辞書のメモ', { exact: true }).fill('髪色');
  await page.getByRole('button', { name: '辞書に追加', exact: true }).click();
  await saved(page);
  const dictionary = page.getByRole('list', { name: 'タグ辞書の項目', exact: true });
  await expect(dictionary.getByRole('listitem')).toHaveText([/^silver hair ← 銀髪, gin — 髪色/]);
  // The same tag with different spelling is rejected (表記ゆれ) and nothing is added.
  await page.getByLabel('辞書のタグ', { exact: true }).fill('Silver_Hair');
  await page.getByRole('button', { name: '辞書に追加', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('同じタグ');
  await expect(dictionary.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('alert').getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByLabel('辞書のタグ', { exact: true }).fill('');

  await tab(page, 'ワークスペース');
  await caretAtEnd(page);
  await positive(page).pressSequentially(', 銀');
  const list = suggestions(page);
  await expect(list.getByRole('option')).toHaveText(['silver hair ← 銀髪 髪色 辞書']);
  await positive(page).press('ArrowDown');
  await positive(page).press('Enter');
  await expect(positive(page)).toHaveValue('1girl, silver hair');
  // The dictionary ranks before library tags ("short hair").
  await positive(page).pressSequentially(', s');
  await expect(list.getByRole('option')).toHaveText(['silver hair 髪色 辞書', 'short hair ライブラリ']);
  await positive(page).pressSequentially('h');
  await expect(list.getByRole('option')).toHaveText([/^short hair/]);
  await positive(page).press('Escape');
  await expect(list).toHaveCount(0);
  await expect(positive(page)).toHaveValue('1girl, silver hair, sh');
  await saved(page);

  // Dictionary edits are normal edits: editing, deleting and Undo.
  await tab(page, 'ライブラリ');
  await openFold(page, /^タグ辞書/);
  await page.getByRole('button', { name: '辞書「silver hair」を編集', exact: true }).click();
  await page.getByLabel('別名（カンマ区切り）', { exact: true }).fill('銀髪, gin, 銀色');
  await page.getByRole('button', { name: '辞書の変更を保存', exact: true }).click();
  await saved(page);
  await expect(dictionary.getByRole('listitem')).toHaveText([/^silver hair ← 銀髪, gin, 銀色 — 髪色/]);
  await page.getByRole('button', { name: '辞書「silver hair」を削除', exact: true }).click();
  await expect(dictionary).toHaveCount(0);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(dictionary.getByRole('listitem')).toHaveCount(1);
  await saved(page);

  // Spelling variants and duplicates are listed read-only from the library.
  await page.getByRole('button', { name: '＋ ライブラリを追加', exact: true }).click();
  await page.getByLabel('名前', { exact: true }).fill('表記ゆれ');
  await page.getByRole('textbox', { name: 'プロンプト原文', exact: true }).fill('Black_Hair, long hair, long hair, 銀髪');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await saved(page);
  await openFold(page, '表記ゆれ・重複の候補');
  const variants = page.getByRole('list', { name: '表記ゆれの候補', exact: true });
  await expect(variants).toContainText('Black_Hair ×1');
  await expect(variants).toContainText('black hair ×1');
  await expect(variants).toContainText('銀髪 ×1（表記ゆれ） → 辞書: silver hair');
  await expect(page.getByRole('list', { name: '重複の候補', exact: true })).toHaveText('「表記ゆれ」: long hair ×2');
  await expect(page.getByRole('article', { name: '表記ゆれ', exact: true }).locator('pre')).toHaveText('Black_Hair, long hair, long hair, 銀髪');

  // Turning completion off (persisted) leaves typing exactly as before.
  await tab(page, '設定');
  const toggle = page.getByRole('checkbox', { name: 'タグの入力補完を使う', exact: true });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await saved(page);
  await page.reload(); await saved(page);
  await tab(page, '設定');
  await expect(toggle).not.toBeChecked();
  await tab(page, 'ワークスペース');
  await caretAtEnd(page);
  await positive(page).pressSequentially(', bl');
  await positive(page).press('ArrowDown');
  await positive(page).press('Enter');
  await expect(suggestions(page)).toHaveCount(0);
  await expect(positive(page)).not.toHaveAttribute('aria-autocomplete');
  await expect(positive(page)).toHaveValue('1girl, silver hair, sh, bl\n');
  await saved(page);
});
