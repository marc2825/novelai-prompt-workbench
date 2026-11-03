import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { png } from '../fixtures/png';

test('built MV3 extension loads unpacked and persists across a full browser restart', async ({}, testInfo) => {
  const extensionPath = resolve('.output/chrome-mv3');
  const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8')) as {
    manifest_version: number; permissions: string[]; host_permissions?: string[];
    side_panel: { default_path: string }; action: { default_popup: string };
    content_scripts: { matches: string[] }[]; background?: unknown;
  };
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toEqual(['sidePanel']);
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.background).toBeUndefined();
  expect(manifest.side_panel.default_path).toBe('sidepanel.html');
  expect(manifest.action.default_popup).toBe('sidepanel.html');
  expect(manifest.content_scripts).toHaveLength(1);
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
