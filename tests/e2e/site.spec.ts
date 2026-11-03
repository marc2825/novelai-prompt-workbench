import { expect, test, type Page } from '@playwright/test';

const textbox = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });
const runtimeErrors = new WeakMap<Page, string[]>();
const saved = (page: Page) => expect(page.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
async function setupWorkspace(page: Page, raw = 'workbench prompt') {
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  await page.getByRole('button', { name: '＋ ワークスペース', exact: true }).click();
  await textbox(page, '自由入力 Positive').fill(raw);
  await saved(page);
}
async function connect(page: Page, tabId = '101') {
  await page.getByRole('button', { name: 'NovelAIの接続を確認', exact: true }).click();
  await page.getByRole('combobox', { name: '対象タブ', exact: true }).selectOption(tabId);
}
async function preview(page: Page, channel = 'positive', mode = 'replace') {
  await page.getByRole('combobox', { name: '反映チャンネル', exact: true }).selectOption(channel);
  await page.getByRole('combobox', { name: '反映方法', exact: true }).selectOption(mode);
  await page.getByRole('button', { name: '反映プレビューを作成', exact: true }).click();
  await expect(textbox(page, '反映後')).toBeVisible();
}
async function apply(page: Page) {
  await page.getByRole('button', { name: '確認してサイトに反映', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = []; runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/tests/fixtures/site.html');
  await saved(page);
});
test.afterEach(async ({ page }) => { expect(runtimeErrors.get(page)).toEqual([]); });

test('explicit insertion updates React state, survives blur/rerender, isolates tabs/channels and never generates', async ({ page }) => {
  const raw = '{{髪}}, [tag], 1.2::light:: | !macro:Name!';
  await setupWorkspace(page, raw);
  await textbox(page, 'Mock Positive 101').fill('old, TAIL');
  await connect(page);
  await textbox(page, 'Mock Positive 101').evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(5, 9));
  await preview(page, 'positive', 'insert');
  await expect(textbox(page, '反映後')).toHaveValue(`old, ${raw}`);
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('old, TAIL');
  await apply(page);
  await expect(page.getByText(/タブ101のpositiveを反映し、再読取りで一致/)).toBeVisible();
  await textbox(page, 'Mock Negative 101').focus();
  await page.getByRole('button', { name: /Force React render 101/ }).click();
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue(`old, ${raw}`);
  await expect(page.getByLabel('React state Positive 101', { exact: true })).toHaveText(`old, ${raw}`);
  await expect(textbox(page, 'Mock Negative 101')).toHaveValue('site 101 negative');
  await expect(textbox(page, 'Mock Positive 202')).toHaveValue('site 202 positive');
  await expect(page.getByRole('button', { name: 'Generate 101 (0)', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate 202 (0)', exact: true })).toBeVisible();
});

test('negative replacement and explicit clearing affect only the selected second tab', async ({ page }) => {
  await setupWorkspace(page);
  await textbox(page, '自由入力 Negative').fill('[watermark], bad anatomy');
  await connect(page, '202'); await preview(page, 'negative');
  await apply(page);
  await expect(textbox(page, 'Mock Negative 202')).toHaveValue('[watermark], bad anatomy');
  await expect(page.getByLabel('React state Negative 202', { exact: true })).toHaveText('[watermark], bad anatomy');
  await expect(textbox(page, 'Mock Negative 101')).toHaveValue('site 101 negative');
  await expect(textbox(page, 'Mock Positive 202')).toHaveValue('site 202 positive');
  await textbox(page, '自由入力 Negative').fill('');
  await preview(page, 'negative'); await apply(page);
  await expect(textbox(page, 'Mock Negative 202')).toHaveValue('');
});

test('confirmation cancellation and edited workspace invalidate the pending preview without writing', async ({ page }) => {
  await setupWorkspace(page); await connect(page); await preview(page);
  page.removeAllListeners('dialog'); page.on('dialog', dialog => void dialog.dismiss());
  await apply(page);
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('site 101 positive');
  await expect(textbox(page, '反映後')).toBeVisible();
  await textbox(page, '自由入力 Positive').fill('changed locally');
  await expect(page.getByRole('button', { name: '確認してサイトに反映', exact: true })).toHaveCount(0);
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('site 101 positive');
});

test('missing, ambiguous and disabled fields fail without changing the original controlled state', async ({ page }) => {
  await setupWorkspace(page);
  for (const label of ['Missing fields 101', 'Duplicate fields 101', 'Disabled field 101']) {
    await page.getByRole('checkbox', { name: label, exact: true }).check();
    await connect(page);
    await expect(page.getByRole('button', { name: '反映プレビューを作成', exact: true })).toBeDisabled();
    await expect(page.getByLabel('React state Positive 101', { exact: true })).toHaveText('site 101 positive');
    await page.getByRole('checkbox', { name: label, exact: true }).uncheck();
  }
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('site 101 positive');
});

test('controlled input rejection is reported as failed verification without automatic retry', async ({ page }) => {
  await setupWorkspace(page); await connect(page);
  await page.getByRole('checkbox', { name: 'Reject writes 101', exact: true }).check();
  await preview(page); await apply(page);
  await expect(page.getByRole('alert')).toContainText('再読取りが反映内容と一致しません');
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('site 101 positive');
  await expect(page.getByLabel('React state Positive 101', { exact: true })).toHaveText('site 101 positive');
  await expect(page.getByRole('button', { name: '確認してサイトに反映', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate 101 (0)', exact: true })).toBeVisible();
});

test('write exceptions restore only the unchanged write and retain original raw for recovery', async ({ page }) => {
  await setupWorkspace(page); await connect(page); await preview(page);
  await textbox(page, 'Mock Positive 101').evaluate(element => { element.dispatchEvent = () => { throw new Error('Synthetic event failure'); }; });
  await apply(page);
  await expect(page.getByRole('alert')).toContainText('書込みに失敗');
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('site 101 positive');
  await page.getByText('直前のサイト操作の復旧用原文（タブ101 / positive）', { exact: true }).click();
  await expect(textbox(page, '直前の反映前原文')).toHaveValue('site 101 positive');
  await expect(page.getByRole('button', { name: 'Positiveをコピー', exact: true })).toBeEnabled();
});

test('compare-and-swap catches user edits and replacement DOM nodes after preview', async ({ page }) => {
  await setupWorkspace(page); await connect(page); await preview(page);
  await textbox(page, 'Mock Positive 101').fill('concurrent user edit'); await apply(page);
  await expect(page.getByRole('alert')).toContainText('プレビュー後');
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('concurrent user edit');
  await preview(page);
  await page.getByRole('button', { name: 'Replace field 101', exact: true }).click(); await apply(page);
  await expect(page.getByRole('alert')).toContainText('プレビュー後');
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('concurrent user edit');
});

test('document reload and SPA navigation reject stale targets, and panel reload never applies automatically', async ({ page }) => {
  await setupWorkspace(page); await connect(page); await preview(page);
  await page.getByRole('button', { name: 'Reload document 101', exact: true }).click(); await apply(page);
  await expect(page.getByRole('alert')).toContainText('ページが移動・再読込');
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('site 101 positive');
  await connect(page); await preview(page);
  await page.getByRole('button', { name: 'Navigate away 101', exact: true }).click(); await apply(page);
  await expect(page.getByRole('alert')).toContainText('画像生成ページ以外');
  await page.reload(); await saved(page);
  await expect(textbox(page, '出力 Positive')).toHaveValue('workbench prompt');
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('site 101 positive');
  await expect(page.getByRole('button', { name: '確認してサイトに反映', exact: true })).toHaveCount(0);
});

test('range comments restore exact raw, undo/redo, persist across reload and require explicit reapply', async ({ page }) => {
  const raw = 'long hair, black hair, blue eyes';
  await setupWorkspace(page, raw);
  await textbox(page, '自由入力 Positive').evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(11, 21));
  await page.getByRole('button', { name: '自由入力 Positiveの選択範囲をOFF', exact: true }).click();
  await expect(textbox(page, '自由入力 Positive')).toHaveValue(raw);
  await expect(textbox(page, '出力 Positive')).toHaveValue('long hair, blue eyes');
  await connect(page); await preview(page); await apply(page);
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('long hair, blue eyes');
  const ranges = page.getByLabel('自由入力 Positiveのコメント範囲', { exact: true });
  await ranges.getByRole('checkbox', { name: '範囲2 有効', exact: true }).check();
  await expect(textbox(page, '出力 Positive')).toHaveValue(raw);
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('long hair, blue eyes');
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(textbox(page, '出力 Positive')).toHaveValue('long hair, blue eyes');
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(textbox(page, '出力 Positive')).toHaveValue(raw);
  await textbox(page, '自由入力 Positive').press('Control+z');
  await expect(textbox(page, '出力 Positive')).toHaveValue('long hair, blue eyes');
  await saved(page); await page.reload(); await saved(page);
  await expect(textbox(page, '出力 Positive')).toHaveValue('long hair, blue eyes');
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('site 101 positive');
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  await expect(textbox(page, '自由入力 Positive')).toHaveValue(raw);
  await page.getByLabel('自由入力 Positiveのコメント範囲', { exact: true }).getByRole('checkbox', { name: '範囲2 有効', exact: true }).check();
  await expect(textbox(page, '出力 Positive')).toHaveValue(raw);
});

test('complex partial ranges warn without mutation, while entire-field comments preserve special syntax', async ({ page }) => {
  const raw = '{{hair}}, !macro:Name! | [tag]';
  await setupWorkspace(page, raw);
  await textbox(page, '自由入力 Positive').evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(2, 6));
  await page.getByRole('button', { name: '自由入力 Positiveの選択範囲をOFF', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('複雑構文');
  await expect(textbox(page, '出力 Positive')).toHaveValue(raw);
  await textbox(page, '自由入力 Positive').evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(0, element.textContent!.length));
  await page.getByRole('button', { name: '自由入力 Positiveの選択範囲をOFF', exact: true }).click();
  await expect(textbox(page, '出力 Positive')).toHaveValue('');
  await page.getByLabel('自由入力 Positiveのコメント範囲', { exact: true }).getByRole('checkbox').check();
  await expect(textbox(page, '出力 Positive')).toHaveValue(raw);
});
