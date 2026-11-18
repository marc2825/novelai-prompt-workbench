import { expect, test, type Page } from '@playwright/test';

// Mock E2E only: the "site" is the local React fixture (tests/fixtures/site.tsx).
// It proves the extension's own logic, not real NovelAI behaviour.

const A = 'girl, blonde hair, blue eyes, white dress';
const B = 'girl, black hair, red jacket';
const ACTOR = 'standing, source#pointing at another';
const RECIPIENT = 'sitting, target#pointing';
const textbox = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });
const spinbutton = (page: Page, name: string) => page.getByRole('spinbutton', { name, exact: true });
const appliedNotice = (page: Page) => expect(page.getByLabel('シャッフルのサイト反映', { exact: true }).getByText(/再読取りで一致を確認しました|次のプロンプトを反映しました/)).toBeVisible();
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const saved = (page: Page) => expect(page.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
const runtimeErrors = new WeakMap<Page, string[]>();

async function commitText(page: Page, name: string, value: string) {
  const field = textbox(page, name);
  await field.fill(value);
  await field.blur();
}
async function addCharacter(page: Page, name: string, fixed: string) {
  await textbox(page, '新しいキャラクター名').fill(name);
  await button(page, 'キャラクターを追加').click();
  await page.getByRole('article', { name: `キャラクター ${name}` }).getByText(`「${name}」を編集`, { exact: true }).click();
  await commitText(page, `${name}の固定プロンプト`, fixed);
}
async function setup(page: Page, extra: [string, string][] = []) {
  await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
  await button(page, '＋ ワークスペース').click();
  await textbox(page, '自由入力 Positive').fill('2girls, indoors');
  await saved(page);
  await page.getByRole('tab', { name: 'シャッフル', exact: true }).click();
  await button(page, '＋ プロファイル').click();
  for (const [name, fixed] of [['Alice', A], ['Bella', B], ...extra] as [string, string][]) await addCharacter(page, name, fixed);
  await page.getByText(/^役割テンプレート・ポーズセット/).click();
  await textbox(page, '新しいテンプレート名').fill('Pointing');
  await button(page, 'テンプレートを追加').click();
  await page.getByText('「Pointing」を編集', { exact: true }).click();
  await commitText(page, 'Pointing / 行動する側のプロンプト', ACTOR);
  await commitText(page, 'Pointing / 行動される側のプロンプト', RECIPIENT);
  await saved(page);
}
async function connect(page: Page, tabId = '101') {
  await button(page, 'シャッフル用にNovelAIを接続').click();
  await page.getByRole('combobox', { name: 'シャッフルの対象タブ', exact: true }).selectOption(tabId);
  await expect(page.getByRole('list', { name: 'シャッフルの対象サイトの対応状況' })).toBeVisible();
}
const summary = (page: Page) => page.getByRole('list', { name: '現在のシャッフル内容', exact: true });
const status = (page: Page) => page.getByLabel('自動シャッフルの状態', { exact: true });
const roleOf = (prompt: string, fixed: string) => prompt === `${fixed}, ${ACTOR}` ? 'actor' : prompt === `${fixed}, ${RECIPIENT}` ? 'recipient' : 'invalid';

test.beforeEach(async ({ page }) => {
  const errors: string[] = []; runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/tests/fixtures/site.html');
  await saved(page);
});
test.afterEach(async ({ page }) => { expect(runtimeErrors.get(page)).toEqual([]); });

test('two characters: Shuffle Now swaps roles consistently, Apply writes only after confirmation, Restore returns the original', async ({ page }) => {
  await setup(page);
  await expect(summary(page)).toContainText('シャッフルなし');
  await button(page, 'Shuffle Now').click();
  await expect(summary(page)).toContainText('役割: Pointing');
  const alice = textbox(page, '現在の出力: キャラクター1（Alice）');
  const bella = textbox(page, '現在の出力: キャラクター2（Bella）');
  const aliceFirst = roleOf(await alice.inputValue(), A);
  expect([aliceFirst, roleOf(await bella.inputValue(), B)].sort()).toEqual(['actor', 'recipient']);
  // Shuffle Bag: the second step must use the other assignment (B=actor ⇔ A=actor).
  await button(page, 'Shuffle Now').click();
  await expect.poll(async () => roleOf(await alice.inputValue(), A)).toBe(aliceFirst === 'actor' ? 'recipient' : 'actor');
  expect(roleOf(await bella.inputValue(), B)).toBe(aliceFirst);
  expect(await textbox(page, '現在の出力: ベース Prompt').inputValue()).toBe('2girls, indoors');
  // Shuffling never touches the site.
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('site 101 positive');
  await expect(textbox(page, 'Mock Character 1 Positive 101')).toHaveValue('site 101 character 1');

  await connect(page);
  await expect(page.getByRole('list', { name: 'シャッフルの対象サイトの対応状況' })).toContainText('キャラクター欄: 2個（書込み可）');
  await expect(page.getByRole('list', { name: 'シャッフルの対象サイトの対応状況' })).toContainText('キャラクター位置: 変更しません');
  await button(page, 'Apply（反映プレビュー）').click();
  const expectedAlice = await alice.inputValue();
  await expect(textbox(page, 'キャラクター1 Prompt（反映後）')).toHaveValue(expectedAlice);
  await expect(textbox(page, 'Mock Character 1 Positive 101')).toHaveValue('site 101 character 1');
  await button(page, '確認してApply').click();
  await expect(textbox(page, 'Mock Character 1 Positive 101')).toHaveValue(expectedAlice);
  await expect(textbox(page, 'Mock Character 2 Positive 101')).toHaveValue(await bella.inputValue());
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('2girls, indoors');
  await expect(page.getByLabel('React state Positive 101', { exact: true })).toHaveText('2girls, indoors');
  await expect(textbox(page, 'Mock Negative 101')).toHaveValue('site 101 negative');
  await expect(textbox(page, 'Mock Character 1 Positive 202')).toHaveValue('site 202 character 1');

  await button(page, 'Restore（復元プレビュー）').click();
  await expect(textbox(page, 'キャラクター1 Prompt（復元後）')).toHaveValue('site 101 character 1');
  await button(page, '確認してRestore').click();
  await expect(textbox(page, 'Mock Character 1 Positive 101')).toHaveValue('site 101 character 1');
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('site 101 positive');
  await expect(button(page, 'Generate 101 (0)')).toBeVisible();
});

test('edits made on the site after Apply are never overwritten without explicit confirmation', async ({ page }) => {
  await setup(page);
  await button(page, 'Shuffle Now').click();
  await connect(page);
  await button(page, 'Apply（反映プレビュー）').click();
  await button(page, '確認してApply').click();
  await appliedNotice(page);
  await textbox(page, 'Mock Character 2 Positive 101').fill('user tweak');
  await button(page, 'Shuffle Now').click();
  await button(page, 'Apply（反映プレビュー）').click();
  const preview = page.getByLabel('シャッフルの反映前の確認', { exact: true });
  await expect(preview.getByRole('alert')).toContainText('NovelAI側で編集された');
  await expect(preview.getByRole('alert')).toContainText('キャラクター2 Prompt');
  await expect(preview.getByRole('alert')).not.toContainText('キャラクター1 Prompt');
  await expect(button(page, '確認してApply')).toBeDisabled();
  await page.getByRole('checkbox', { name: 'サイト側の編集を上書きすることを確認しました', exact: true }).check();
  // Another edit after the preview: compare-and-swap aborts with zero writes.
  await textbox(page, 'Mock Character 1 Positive 101').fill('second edit');
  await button(page, '確認してApply').click();
  await expect(page.getByLabel('シャッフルのサイト反映', { exact: true }).getByRole('alert')).toContainText('プレビュー後に変更');
  await expect(textbox(page, 'Mock Character 2 Positive 101')).toHaveValue('user tweak');
  await expect(textbox(page, 'Mock Character 1 Positive 101')).toHaveValue('second edit');
  // A failed/aborted apply leaves those fields "uncertain": the next preview still demands consent.
  await button(page, 'Apply（反映プレビュー）').click();
  await expect(page.getByLabel('シャッフルの反映前の確認', { exact: true }).getByRole('alert')).toContainText('キャラクター2 Prompt');
  await expect(button(page, '確認してApply')).toBeDisabled();
});

test('auto shuffle every 5 successful jobs counts each job once, ignores re-renders and failures, and never clicks Generate', async ({ page }) => {
  await setup(page);
  await connect(page);
  await page.getByRole('combobox', { name: '自動シャッフルの間隔', exact: true }).selectOption('5');
  await saved(page);
  await button(page, '自動シャッフルを開始').click();
  await expect(status(page)).toContainText('動作中（0/5ジョブ');
  const generate = page.getByRole('button', { name: /^Generate 101 / });
  for (let index = 1; index <= 4; index++) {
    await generate.click();
    await expect(status(page)).toContainText(`（${index}/5ジョブ`);
  }
  await button(page, 'Re-render status 101').click();
  await page.getByRole('checkbox', { name: 'Fail generations 101', exact: true }).check();
  await generate.click();
  await expect(page.getByLabel('Generation status 101', { exact: true })).toContainText('failed');
  await page.waitForTimeout(2200);
  await expect(status(page)).toContainText('（4/5ジョブ');
  await expect(textbox(page, 'Mock Character 1 Positive 101')).toHaveValue('site 101 character 1');
  await page.getByRole('checkbox', { name: 'Fail generations 101', exact: true }).uncheck();
  await generate.click();
  await expect(textbox(page, 'Mock Character 1 Positive 101')).not.toHaveValue('site 101 character 1');
  const applied = await textbox(page, 'Mock Character 1 Positive 101').inputValue();
  expect(['actor', 'recipient']).toContain(roleOf(applied, A));
  await expect(textbox(page, 'Mock Positive 101')).toHaveValue('2girls, indoors');
  await expect(status(page)).toContainText('（0/5ジョブ');
  await expect(button(page, 'Generate 101 (6)')).toBeVisible();
  await page.getByText(/^シャッフル履歴/).click();
  await expect(page.getByLabel('シャッフル履歴', { exact: true })).toContainText('自動');
  await button(page, '自動シャッフルを停止').click();
  await expect(status(page)).toContainText('停止中');
  for (let index = 0; index < 5; index++) await generate.click();
  await page.waitForTimeout(1500);
  await expect(textbox(page, 'Mock Character 1 Positive 101')).toHaveValue(applied);
});

test('auto shuffle waits while generating and stops instead of overwriting a user edit', async ({ page }) => {
  await setup(page);
  await connect(page);
  await page.getByRole('combobox', { name: '自動シャッフルの間隔', exact: true }).selectOption('1');
  await button(page, '自動シャッフルを開始').click();
  await page.getByRole('checkbox', { name: 'Hold generation 101', exact: true }).check();
  await page.getByRole('button', { name: /^Generate 101 / }).click();
  await expect(status(page)).toContainText('生成中のため待機');
  await page.waitForTimeout(1500);
  await expect(textbox(page, 'Mock Character 1 Positive 101')).toHaveValue('site 101 character 1');
  await page.getByRole('checkbox', { name: 'Hold generation 101', exact: true }).uncheck();
  await appliedNotice(page);
  await expect(textbox(page, 'Mock Character 1 Positive 101')).not.toHaveValue('site 101 character 1');
  await textbox(page, 'Mock Character 1 Positive 101').fill('manual change');
  await page.getByRole('button', { name: /^Generate 101 / }).click();
  await expect(page.getByLabel('シャッフルのサイト反映', { exact: true }).getByRole('alert')).toContainText('上書きせず自動シャッフルを停止');
  await expect(status(page)).toContainText('停止中');
  await expect(textbox(page, 'Mock Character 1 Positive 101')).toHaveValue('manual change');
});

test('auto shuffle stops safely when generation cannot be detected or the page navigates away', async ({ page }) => {
  await setup(page);
  await connect(page);
  await page.getByRole('combobox', { name: '自動シャッフルの間隔', exact: true }).selectOption('1');
  await page.getByRole('checkbox', { name: 'Hide generation status 101', exact: true }).check();
  await button(page, '自動シャッフルを開始').click();
  await expect(page.getByLabel('シャッフルのサイト反映', { exact: true }).getByRole('alert')).toContainText('生成状態の要素');
  await expect(status(page)).toContainText('停止中');
  await page.getByRole('checkbox', { name: 'Hide generation status 101', exact: true }).uncheck();
  await button(page, '自動シャッフルを開始').click();
  await expect(status(page)).toContainText('動作中');
  await button(page, 'Navigate away 101').click();
  await expect(page.getByLabel('シャッフルのサイト反映', { exact: true }).getByRole('alert')).toContainText('画像生成ページ以外');
  await expect(status(page)).toContainText('停止中');
  await expect(textbox(page, 'Mock Character 1 Positive 101')).toHaveValue('site 101 character 1');
});

test('three characters: partial role assignment and a character-slot mismatch is refused until the site matches', async ({ page }) => {
  await setup(page, [['Cara', 'girl, red hair, glasses']]);
  await button(page, 'Shuffle Now').click();
  await expect(summary(page)).toContainText('役割: Pointing');
  const prompts = await Promise.all(['Alice', 'Bella', 'Cara'].map((name, index) => textbox(page, `現在の出力: キャラクター${index + 1}（${name}）`).inputValue()));
  expect(prompts.filter(prompt => prompt.includes('#'))).toHaveLength(2);
  expect(prompts[2]!.startsWith('girl, red hair, glasses')).toBe(true);
  await connect(page);
  await expect(page.getByText('構成は3人、サイトのキャラクター欄は2個です。')).toBeVisible();
  await button(page, 'Apply（反映プレビュー）').click();
  await expect(page.getByLabel('シャッフルのサイト反映', { exact: true }).getByRole('alert')).toContainText('一致しません');
  await expect(textbox(page, 'Mock Character 1 Positive 101')).toHaveValue('site 101 character 1');
  await button(page, 'Add character 101').click();
  await connect(page);
  await button(page, 'Apply（反映プレビュー）').click();
  await button(page, '確認してApply').click();
  await expect(textbox(page, 'Mock Character 3 Positive 101')).toHaveValue(prompts[2]!);
});

test('without a site connection: copy fallback, manual generation count and persisted settings', async ({ page }) => {
  await page.goto('/tests/fixtures/index.html');
  await saved(page);
  await setup(page);
  await expect(page.getByLabel('シャッフルのサイト反映', { exact: true })).toContainText('コピーを使用してください');
  await page.getByRole('combobox', { name: '自動シャッフルの間隔', exact: true }).selectOption('custom');
  await spinbutton(page, '任意の回数').fill('4');
  await spinbutton(page, '任意の回数').blur();
  for (let index = 0; index < 3; index++) await button(page, '生成完了を手動で記録（+1）').click();
  await expect(summary(page)).toContainText('シャッフルなし');
  await button(page, '生成完了を手動で記録（+1）').click();
  await expect(summary(page)).toContainText('役割: Pointing');
  const seed = await textbox(page, 'シャッフルSeed').inputValue();
  const output = await textbox(page, '現在の出力: キャラクター1（Alice）').inputValue();
  await saved(page);
  await page.reload();
  await saved(page);
  await page.getByRole('tab', { name: 'シャッフル', exact: true }).click();
  await expect(textbox(page, 'シャッフルSeed')).toHaveValue(seed);
  await expect(page.getByRole('combobox', { name: '自動シャッフルの間隔', exact: true })).toHaveValue('custom');
  await expect(spinbutton(page, '任意の回数')).toHaveValue('4');
  await expect(textbox(page, '現在の出力: キャラクター1（Alice）')).toHaveValue(output);
  // Undo returns to the state before the consecutive shuffle run.
  await button(page, 'シャッフルを解除（元の構成）').click();
  await expect(textbox(page, '現在の出力: キャラクター1（Alice）')).toHaveValue(A);
  await button(page, '元に戻す').click();
  await expect(textbox(page, '現在の出力: キャラクター1（Alice）')).toHaveValue(output);
});

test('standard templates: each category appears at most once per target across many shuffles, and settings export', async ({ page }) => {
  await page.goto('/tests/fixtures/index.html');
  await saved(page);
  await setup(page);
  // The Pointing role prompts contain poses, so the roles must claim the pose category too.
  for (const role of ['行動する側', '行動される側']) await page.getByRole('checkbox', { name: `Pointing / ${role}: ポーズ`, exact: true }).check();
  await page.getByText('標準テンプレート・シャッフル設定の取込/書出し', { exact: true }).click();
  await button(page, '標準テンプレート・候補を追加').click();
  for (const label of ['表情', 'カメラ・視線']) await page.getByRole('checkbox', { name: label, exact: true }).check();
  await saved(page);
  const vocabulary = {
    angle: ['from above', 'from below', 'eye level', 'dutch angle', 'from side'],
    framing: ['close-up', 'upper body', 'cowboy shot', 'full body', 'wide shot'],
    pose: ['standing', 'sitting', 'kneeling', 'leaning forward', 'looking back', 'crossed arms', 'lying'],
    expression: ['smile', 'open mouth', 'surprised', 'blush', 'serious', 'closed eyes', 'laughing'],
    gaze: ['looking at viewer', 'looking at another', 'looking away'],
  };
  const count = (text: string, words: string[]) => text.split(', ').filter(tag => words.includes(tag)).length;
  for (let index = 0; index < 12; index++) {
    await button(page, 'Shuffle Now').click();
    await expect(page.getByText(`ステップ ${index + 1}。`)).toBeVisible();
    const base = await textbox(page, '現在の出力: ベース Prompt').inputValue();
    expect(base.startsWith('2girls, indoors')).toBe(true);
    expect(count(base, vocabulary.angle)).toBeLessThanOrEqual(1);
    expect(count(base, vocabulary.framing)).toBeLessThanOrEqual(1);
    for (const [position, name, fixed] of [[1, 'Alice', A], [2, 'Bella', B]] as const) {
      const prompt = await textbox(page, `現在の出力: キャラクター${position}（${name}）`).inputValue();
      expect(prompt.startsWith(fixed)).toBe(true);
      for (const words of [vocabulary.pose, vocabulary.expression, vocabulary.gaze]) expect(count(prompt, words)).toBeLessThanOrEqual(1);
    }
  }
  const download = page.waitForEvent('download');
  await button(page, 'シャッフル設定をエクスポート').click();
  const path = await (await download).path();
  const exported = JSON.parse(await (await import('node:fs/promises')).readFile(path!, 'utf8')) as { format: string; shuffle: { templates: unknown[]; history: unknown[]; characters: unknown[] } };
  expect(exported.format).toBe('nai-prompt-workbench-shuffle');
  expect(exported.shuffle.templates).toHaveLength(9);
  expect(exported.shuffle.characters).toHaveLength(2);
  expect(exported.shuffle.history).toEqual([]);
});

const targetSelect = (page: Page) => page.getByRole('combobox', { name: 'シャッフルの対象タブ', exact: true });
async function applyShuffle(page: Page) {
  await button(page, 'Apply（反映プレビュー）').click();
  await button(page, '確認してApply').click();
  await appliedNotice(page);
}

test('restore information is bound to the tab it was recorded on and is never applied to another tab', async ({ page }) => {
  await setup(page);
  await button(page, 'Shuffle Now').click();
  await connect(page, '101');
  await applyShuffle(page);
  const shuffled101 = await textbox(page, 'Mock Character 1 Positive 101').inputValue();
  expect(shuffled101).not.toBe('site 101 character 1');
  await expect(button(page, 'Restore（復元プレビュー）')).toBeEnabled();
  // Tab 202: tab 101's restore text is not offered for Restore, only shown copy-only.
  await targetSelect(page).selectOption('202');
  await expect(page.getByRole('list', { name: 'シャッフルの対象サイトの対応状況' })).toBeVisible();
  await expect(button(page, 'Restore（復元プレビュー）')).toBeDisabled();
  await page.getByText(/^他の対象・再読込前のページの反映前原文/).click();
  await expect(page.getByRole('textbox', { name: /^タブ101・プロファイル1・ページ.+: キャラクター1 Prompt（反映前）$/ })).toHaveValue('site 101 character 1');
  // No false "edited" warning on 202 caused by 101's writes.
  await button(page, 'Apply（反映プレビュー）').click();
  await expect(page.getByLabel('シャッフルの反映前の確認', { exact: true }).getByRole('alert')).toHaveCount(0);
  await button(page, '確認してApply').click();
  await appliedNotice(page);
  await button(page, 'Restore（復元プレビュー）').click();
  await expect(textbox(page, 'キャラクター1 Prompt（復元後）')).toHaveValue('site 202 character 1');
  await expect(textbox(page, 'ベース Prompt（復元後）')).toHaveValue('site 202 positive');
  await button(page, '確認してRestore').click();
  await expect(textbox(page, 'Mock Character 1 Positive 202')).toHaveValue('site 202 character 1');
  await expect(textbox(page, 'Mock Positive 202')).toHaveValue('site 202 positive');
  // Tab 101 keeps its shuffled text and its own restore information.
  await expect(textbox(page, 'Mock Character 1 Positive 101')).toHaveValue(shuffled101);
  await targetSelect(page).selectOption('101');
  await expect(page.getByRole('list', { name: 'シャッフルの対象サイトの対応状況' })).toBeVisible();
  await button(page, 'Restore（復元プレビュー）').click();
  await expect(textbox(page, 'キャラクター1 Prompt（復元後）')).toHaveValue('site 101 character 1');
  await button(page, '確認してRestore').click();
  await expect(textbox(page, 'Mock Character 1 Positive 101')).toHaveValue('site 101 character 1');
});

test('a reloaded document and another profile cannot use earlier restore information', async ({ page }) => {
  await setup(page);
  await button(page, 'Shuffle Now').click();
  await connect(page, '101');
  await applyShuffle(page);
  // Another profile on the same tab: no restore information, no edit history.
  await textbox(page, '新しいプロファイル名').fill('Second');
  await button(page, '＋ プロファイル').click();
  await expect(page.getByRole('combobox', { name: 'シャッフルプロファイル', exact: true })).toHaveValue(/.+/);
  await expect(button(page, 'Restore（復元プレビュー）')).toBeDisabled();
  await page.getByRole('combobox', { name: 'シャッフルプロファイル', exact: true }).selectOption({ label: 'プロファイル1' });
  await expect(button(page, 'Restore（復元プレビュー）')).toBeEnabled();
  // Reloading the NovelAI document invalidates the old target and its restore information.
  await button(page, 'Reload document 101').click();
  await button(page, 'Restore（復元プレビュー）').click();
  await expect(page.getByLabel('シャッフルのサイト反映', { exact: true }).getByRole('alert')).toContainText('ページが移動・再読込');
  await expect(page.getByLabel('シャッフルの復元前の確認', { exact: true })).toHaveCount(0);
  await connect(page, '101');
  await expect(button(page, 'Restore（復元プレビュー）')).toBeDisabled();
  await page.getByText(/^他の対象・再読込前のページの反映前原文/).click();
  await expect(page.getByRole('textbox', { name: /^タブ101・プロファイル1・ページ.+: キャラクター1 Prompt（反映前）$/ })).toHaveValue('site 101 character 1');
  // The text remains for manual copy only; the site keeps the shuffled text.
  await expect(textbox(page, 'Mock Character 1 Positive 101')).not.toHaveValue('site 101 character 1');
});

test('auto shuffle freezes its configuration: a settings change stops it and no further write happens', async ({ page }) => {
  await setup(page);
  await connect(page);
  await page.getByRole('combobox', { name: '自動シャッフルの間隔', exact: true }).selectOption('1');
  await saved(page);
  await button(page, '自動シャッフルを開始').click();
  await expect(status(page)).toContainText('動作中');
  await expect(button(page, 'Shuffle Now')).toBeDisabled();
  await expect(page.getByLabel('自動シャッフル実行中の注意', { exact: true })).toBeVisible();
  const generate = page.getByRole('button', { name: /^Generate 101 / });
  await generate.click();
  await appliedNotice(page);
  const applied = await textbox(page, 'Mock Character 1 Positive 101').inputValue();
  // The run's own shuffles do not stop it.
  await expect(status(page)).toContainText('動作中');
  await commitText(page, 'シャッフルSeed', 'edited-seed');
  await expect(page.getByLabel('シャッフルのサイト反映', { exact: true }).getByRole('alert')).toContainText('変更されたため、自動シャッフルを停止しました');
  await expect(status(page)).toContainText('停止中');
  await expect(button(page, 'Shuffle Now')).toBeEnabled();
  await generate.click();
  await page.waitForTimeout(1500);
  await expect(textbox(page, 'Mock Character 1 Positive 101')).toHaveValue(applied);
});

test('a generation already running when auto shuffle starts is not counted', async ({ page }) => {
  await setup(page);
  await connect(page);
  await page.getByRole('combobox', { name: '自動シャッフルの間隔', exact: true }).selectOption('1');
  await saved(page);
  await page.getByRole('checkbox', { name: 'Hold generation 101', exact: true }).check();
  const generate = page.getByRole('button', { name: /^Generate 101 / });
  await generate.click();
  await expect(page.getByLabel('Generation status 101', { exact: true })).toContainText('generating');
  await button(page, '自動シャッフルを開始').click();
  await expect(status(page)).toContainText('生成中のため待機');
  await page.getByRole('checkbox', { name: 'Hold generation 101', exact: true }).uncheck();
  await expect(page.getByLabel('Generation status 101', { exact: true })).toContainText('succeeded');
  await page.waitForTimeout(2200);
  await expect(status(page)).toContainText('（0/1ジョブ');
  await expect(textbox(page, 'Mock Character 1 Positive 101')).toHaveValue('site 101 character 1');
  // The next job started after monitoring began is counted.
  await generate.click();
  await appliedNotice(page);
  await expect(textbox(page, 'Mock Character 1 Positive 101')).not.toHaveValue('site 101 character 1');
});
