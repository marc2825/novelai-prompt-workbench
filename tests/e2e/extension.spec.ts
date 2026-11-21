import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { openFold } from './helpers';
import { png } from '../fixtures/png';

test('built MV3 extension loads unpacked and persists across a full browser restart', async ({}, testInfo) => {
  test.setTimeout(90_000); // two full browser launches; the 30s default was exceeded once on a slow CI runner
  const extensionPath = resolve('.output/chrome-mv3');
  const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8')) as {
    manifest_version: number; permissions: string[]; host_permissions?: string[];
    side_panel: { default_path: string }; action: { default_popup?: string; default_title: string };
    content_scripts: { matches: string[] }[]; background?: { service_worker: string; type?: string };
  };
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toEqual(['sidePanel']);
  expect(manifest.host_permissions).toBeUndefined();
  // The only background job is opening the side panel from the toolbar button (no popup).
  expect(manifest.background).toEqual({ service_worker: 'background.js' });
  expect(manifest.side_panel.default_path).toBe('sidepanel.html');
  expect(manifest.action.default_popup).toBeUndefined();
  expect(manifest.action.default_title).toBeTruthy();
  expect(manifest.content_scripts).toHaveLength(1);
  // Only the extension itself plus its license notices are shipped: no source maps, tests or fixtures.
  const { readdir } = await import('node:fs/promises');
  const shipped = (await readdir(extensionPath, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name).slice(extensionPath.length + 1).replaceAll('\\', '/'));
  for (const file of shipped) expect(file).toMatch(/^(manifest\.json|sidepanel\.html|background\.js|LICENSE\.txt|THIRD_PARTY_NOTICES\.txt|icon\/(16|32|48|128)\.png|chunks\/[\w-]+\.js|content-scripts\/novelai\.js|assets\/[\w-]+\.css)$/);
  expect(shipped).toEqual(expect.arrayContaining(['LICENSE.txt', 'THIRD_PARTY_NOTICES.txt', 'icon/16.png', 'icon/32.png', 'icon/48.png', 'icon/128.png']));
  expect((manifest as unknown as { icons: Record<string, string> }).icons).toEqual({ 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' });
  expect([...manifest.content_scripts[0]!.matches].sort()).toEqual(['https://novelai.net/image', 'https://novelai.net/image?*', 'https://novelai.net/image/*'].sort());

  // Chromium derives an unpacked extension ID from its normalized absolute path.
  const id = createHash('sha256').update(extensionPath).digest('hex').slice(0, 32)
    .replace(/[a-f0-9]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
  const profile = await mkdtemp(join(tmpdir(), 'nai-extension-test-'));
  const launch = () => chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 400, height: 900 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  let context = await launch();
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await expect.poll(() => worker.evaluate(() => (globalThis as unknown as { chrome: { sidePanel: { getPanelBehavior(): Promise<{ openPanelOnActionClick?: boolean }> } } }).chrome.sidePanel.getPanelBehavior())).toEqual({ openPanelOnActionClick: true });
    let page = await context.newPage();
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(page.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
    await expect(page.getByText('0件 / 全0件', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'NovelAIの接続を確認', exact: true }).click();
    await expect(page.getByText('NovelAI画像ページに接続できません。ページを開くか再読込してください。コピーは利用できます。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Positiveをコピー', exact: true })).toBeEnabled();
    await page.getByRole('tab', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: 'デモを追加', exact: true }).click();
    await expect(page.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
    await page.getByRole('textbox', { name: '自由入力 Positive', exact: true }).fill('browser restart 🌟');
    await page.getByRole('textbox', { name: '新しいプリセット名', exact: true }).fill('再起動プリセット');
    await page.getByRole('button', { name: '現在の構成をプリセット保存', exact: true }).click();
    await expect(page.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
    const before = await page.getByRole('textbox', { name: '出力 Positive', exact: true }).inputValue();
    await page.screenshot({ path: testInfo.outputPath('extension-workspace.png'), fullPage: true });
    await page.getByRole('tab', { name: '比較', exact: true }).click();
    await page.getByRole('textbox', { name: '新しい比較名', exact: true }).fill('再起動A/B');
    await page.getByRole('button', { name: '比較セッションを作成', exact: true }).click();
    await page.getByLabel('AにPNGを取り込む', { exact: true }).setInputFiles({ name: 'restart.png', mimeType: 'image/png', buffer: png(8, 8) });
    await expect(page.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible();
    await expect(page.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
    await context.close();

    context = await launch();
    page = await context.newPage();
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(page.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
    await expect(page.getByText('5件 / 全5件', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue(before);
    await expect(page.getByRole('textbox', { name: '出力 Negative', exact: true })).toHaveValue('[watermark]');
    await expect(page.getByLabel('プリセット保存状態', { exact: true })).toContainText('再起動プリセット');
    await page.getByRole('tab', { name: 'プリセット', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'プリセットを選択', exact: true })).toContainText('再起動プリセット');
    await page.getByRole('tab', { name: '比較', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '比較名', exact: true })).toHaveValue('再起動A/B');
    await expect(page.getByRole('textbox', { name: 'A positive', exact: true })).toHaveValue(before);
    await expect(page.getByRole('img', { name: '比較画像A', exact: true })).toBeVisible();
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('real Content Script messaging isolates actual tabs and rejects reload/navigation without extra permissions', async () => {
  const extensionPath = resolve('.output/chrome-mv3');
  const id = createHash('sha256').update(extensionPath).digest('hex').slice(0, 32).replace(/[a-f0-9]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
  const profile = await mkdtemp(join(tmpdir(), 'nai-content-test-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  try {
    // The apparent NovelAI pages are served entirely from this synthetic route.
    // No live site, account, private API or external network is used by this test.
    await context.route('https://novelai.net/**', route => {
      const url = new URL(route.request().url());
      const name = url.searchParams.get('fixture') === 'A' ? 'A' : 'B';
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Mock ${name}</title><div class="prompt-input-box-prompt" data-prompt-input="true"><div class="ProseMirror" contenteditable="true"><p>positive ${name}</p></div></div><div class="prompt-input-box-undesired-content" data-prompt-input="true"><div class="ProseMirror" contenteditable="true"><p>negative ${name}</p></div></div><button>Generate untouched</button>` });
    });
    const first = await context.newPage(); const second = await context.newPage();
    await first.goto('https://novelai.net/image?fixture=A');
    await second.goto('https://novelai.net/image?fixture=B');
    const panel = await context.newPage(); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(panel.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'NovelAIの接続を確認', exact: true }).click();
    const select = panel.getByRole('combobox', { name: '対象タブ', exact: true });
    await expect(select.getByRole('option')).toHaveCount(3);
    const firstId = await select.getByRole('option', { name: /Mock A/ }).getAttribute('value');
    const secondId = await select.getByRole('option', { name: /Mock B/ }).getAttribute('value');
    await select.selectOption(firstId!);
    await panel.getByRole('button', { name: 'サイトの現在値を読む', exact: true }).click();
    await expect(panel.getByRole('textbox', { name: 'サイトの現在値 (positive)', exact: true })).toHaveValue('positive A');
    await expect(panel.getByRole('button', { name: '反映プレビューを作成', exact: true })).toBeDisabled();
    await first.evaluate(() => {
      const root = document.querySelector('.prompt-input-box-prompt')!;
      const duplicate = root.cloneNode(true) as HTMLElement; duplicate.hidden = true; duplicate.id = 'hidden-duplicate'; root.after(duplicate);
    });
    await panel.getByRole('button', { name: 'サイトの現在値を読む', exact: true }).click();
    await expect(panel.getByRole('textbox', { name: 'サイトの現在値 (positive)', exact: true })).toHaveValue('positive A');
    await first.evaluate(() => { document.getElementById('hidden-duplicate')!.hidden = false; });
    await panel.getByRole('button', { name: 'サイトの現在値を読む', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('編集欄が複数');
    await expect(panel.getByRole('textbox', { name: 'サイトの現在値 (positive)', exact: true })).toHaveCount(0);
    await first.evaluate(() => {
      document.getElementById('hidden-duplicate')!.remove();
      const span = document.createElement('span'); span.textContent = 'unknown rich node'; document.querySelector('.ProseMirror p')!.append(span);
    });
    await panel.getByRole('button', { name: 'サイトの現在値を読む', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('原文を推測しません');
    await select.selectOption(secondId!);
    await panel.getByRole('combobox', { name: '反映チャンネル', exact: true }).selectOption('negative');
    await panel.getByRole('button', { name: 'サイトの現在値を読む', exact: true }).click();
    await expect(panel.getByRole('textbox', { name: 'サイトの現在値 (negative)', exact: true })).toHaveValue('negative B');
    await second.reload();
    await panel.getByRole('button', { name: 'サイトの現在値を読む', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('ページが移動・再読込');
    await panel.getByRole('button', { name: 'NovelAIの接続を確認', exact: true }).click();
    await select.selectOption(secondId!);
    await second.goto('https://novelai.net/stories?fixture=B');
    await panel.getByRole('button', { name: 'サイトの現在値を読む', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('接続できません');
    await expect(first.locator('[contenteditable=true]').first()).toHaveText('positive Aunknown rich node');
    await expect(panel.getByRole('button', { name: 'Positiveをコピー', exact: true })).toBeEnabled();
    await expect(panel.getByRole('button', { name: 'Negativeをコピー', exact: true })).toBeEnabled();
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('real Content Script: shuffle reports unverified character fields, generation detection and writes as unsupported', async () => {
  const extensionPath = resolve('.output/chrome-mv3');
  const id = createHash('sha256').update(extensionPath).digest('hex').slice(0, 32).replace(/[a-f0-9]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
  const profile = await mkdtemp(join(tmpdir(), 'nai-shuffle-content-test-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  try {
    // Synthetic page only; no live site, account or network. Contains look-alike
    // character boxes that the production adapter must NOT treat as verified.
    await context.route('https://novelai.net/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Mock shuffle</title><div class="prompt-input-box-prompt" data-prompt-input="true"><div class="ProseMirror" contenteditable="true"><p>base text</p></div></div><div class="prompt-input-box-undesired-content" data-prompt-input="true"><div class="ProseMirror" contenteditable="true"><p>uc text</p></div></div><textarea class="character-prompt">character one</textarea><button>Generate untouched</button>' }));
    const site = await context.newPage();
    await site.goto('https://novelai.net/image');
    const panel = await context.newPage();
    panel.on('dialog', dialog => void dialog.accept());
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(panel.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
    await panel.getByRole('tab', { name: 'シャッフル', exact: true }).click();
    await panel.getByRole('button', { name: '＋ プロファイル', exact: true }).click();
    await panel.getByRole('textbox', { name: '新しいキャラクター名', exact: true }).fill('Solo');
    await panel.getByRole('button', { name: 'キャラクターを追加', exact: true }).click();
    await openFold(panel, /^NovelAIのページへ反映/);
    await panel.getByRole('button', { name: 'シャッフル用にNovelAIを接続', exact: true }).click();
    const select = panel.getByRole('combobox', { name: 'シャッフルの対象タブ', exact: true });
    const tabId = await select.getByRole('option', { name: /Mock shuffle/ }).getAttribute('value');
    await select.selectOption(tabId!);
    const support = panel.getByRole('list', { name: 'シャッフルの対象サイトの対応状況', exact: true });
    await expect(support).toContainText('ベース Prompt: 読取りのみ');
    await expect(support).toContainText('キャラクター欄: 0個（書込み不可）');
    await expect(support).toContainText('Character Prompts欄のDOMは未検証');
    await expect(support).toContainText('モデル表示: 不明');
    await expect(support).toContainText('キャラクター位置: 変更しません');
    await expect(support).toContainText('生成検知: 非対応');
    await expect(panel.getByRole('button', { name: 'Apply（反映プレビュー）', exact: true })).toBeDisabled();
    await panel.getByRole('combobox', { name: '自動シャッフルの間隔', exact: true }).selectOption('1');
    await expect(panel.getByRole('button', { name: '自動シャッフルを開始', exact: true })).toBeDisabled();
    await expect(panel.getByLabel('自動シャッフルの状態', { exact: true })).toContainText('このページでは生成を検知できません');
    await expect(panel.getByRole('button', { name: '生成完了を手動で記録（+1）', exact: true })).toBeEnabled();
    await expect(panel.getByRole('button', { name: 'ベース Promptをコピー', exact: true })).toBeEnabled();
    await expect(site.locator('[contenteditable=true]').first()).toHaveText('base text');
    await expect(site.locator('textarea.character-prompt')).toHaveValue('character one');
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('real Content Script: the wide Lab tab (sidepanel.html#lab) is accepted as the panel; read-only stays read-only', async () => {
  const extensionPath = resolve('.output/chrome-mv3');
  const id = createHash('sha256').update(extensionPath).digest('hex').slice(0, 32).replace(/[a-f0-9]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
  const profile = await mkdtemp(join(tmpdir(), 'nai-wide-tab-test-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  try {
    await context.route('https://novelai.net/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Mock wide</title><div class="prompt-input-box-prompt" data-prompt-input="true"><div class="ProseMirror" contenteditable="true"><p>wide positive</p></div></div><div class="prompt-input-box-undesired-content" data-prompt-input="true"><div class="ProseMirror" contenteditable="true"><p>wide negative</p></div></div>' }));
    const site = await context.newPage();
    await site.goto('https://novelai.net/image');
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html#lab`);
    await expect(panel.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
    await panel.getByText('NovelAIからベースPromptを読む', { exact: true }).click();
    await panel.getByRole('button', { name: 'NovelAIの接続を確認', exact: true }).click();
    const select = panel.getByRole('combobox', { name: '対象タブ', exact: true });
    await expect(select.getByRole('option')).toHaveCount(2);
    await select.selectOption((await select.getByRole('option', { name: /Mock wide/ }).getAttribute('value'))!);
    await panel.getByRole('button', { name: 'サイトの現在値を読む', exact: true }).click();
    await expect(panel.getByRole('textbox', { name: 'サイトの現在値 (positive)', exact: true })).toHaveValue('wide positive');
    await expect(panel.getByRole('button', { name: '反映プレビューを作成', exact: true })).toBeDisabled();
    await expect(site.locator('[contenteditable=true]').first()).toHaveText('wide positive');
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('real Content Script: reads the Japanese UI structure (issue #4) without confusing character fields; unlisted languages fail safely', async () => {
  const extensionPath = resolve('.output/chrome-mv3');
  const id = createHash('sha256').update(extensionPath).digest('hex').slice(0, 32).replace(/[a-f0-9]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
  const profile = await mkdtemp(join(tmpdir(), 'nai-locale-test-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  // Synthetic copy of the wrapper structure reported in issue #4 (class = prompt-input-box-<visible label>).
  const box = (label: string, text: string) => `<div class="prompt-input-box prompt-input-box-${label}" data-prompt-input="true"><div class="ProseMirror" contenteditable="true"><p>${text}</p></div></div>`;
  const japanese = [box('ベースプロンプト', 'ja base'), box('除外したい要素', 'ja uc'), ...[1, 2].flatMap(n => [box(`キャラクタープロンプト-${n}`, `char ${n}`), box(`キャラクタープロンプト-${n}-除外したい要素`, `char uc ${n}`)])].join('');
  const unknown = [box('Basis-Prompt', 'de base'), box('Unerwünschter-Inhalt', 'de uc')].join('');
  try {
    await context.route('https://novelai.net/**', route => {
      const german = new URL(route.request().url()).searchParams.get('lang') === 'de';
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><title>${german ? 'Mock DE' : 'Mock JA'}</title>${german ? unknown : japanese}` });
    });
    const ja = await context.newPage(); await ja.goto('https://novelai.net/image');
    const de = await context.newPage(); await de.goto('https://novelai.net/image?lang=de');
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(panel.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'NovelAIの接続を確認', exact: true }).click();
    const select = panel.getByRole('combobox', { name: '対象タブ', exact: true });
    await select.selectOption((await select.getByRole('option', { name: /Mock JA/ }).getAttribute('value'))!);
    await panel.getByRole('button', { name: 'サイトの現在値を読む', exact: true }).click();
    await expect(panel.getByRole('textbox', { name: 'サイトの現在値 (positive)', exact: true })).toHaveValue('ja base');
    await panel.getByRole('combobox', { name: '反映チャンネル', exact: true }).selectOption('negative');
    await panel.getByRole('button', { name: 'サイトの現在値を読む', exact: true }).click();
    await expect(panel.getByRole('textbox', { name: 'サイトの現在値 (negative)', exact: true })).toHaveValue('ja uc');
    await expect(panel.getByRole('button', { name: '反映プレビューを作成', exact: true })).toBeDisabled();
    // An unlisted language is detected at connection time: reading stays disabled and the reason is shown.
    await select.selectOption((await select.getByRole('option', { name: /Mock DE/ }).getAttribute('value'))!);
    await expect(panel.getByRole('button', { name: 'サイトの現在値を読む', exact: true })).toBeDisabled();
    await expect(panel.getByLabel('NovelAIサイト連携', { exact: true })).toContainText('確認済みの入力欄構造を検出できません');
    await expect(panel.getByRole('textbox', { name: 'サイトの現在値 (negative)', exact: true })).toHaveCount(0);
    await expect(ja.locator('[contenteditable=true]').first()).toHaveText('ja base');
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
