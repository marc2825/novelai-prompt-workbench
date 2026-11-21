import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { ALLOWED_FILE, readZip, verifyReleaseZip, zipName } from '../../scripts/release-lib.mjs';

// Installs the real release artifact the way a user does: build the ZIP, extract it,
// load the extracted folder as an unpacked extension. No NovelAI page is involved.

// Chromium derives an unpacked extension's ID from its absolute path.
const extensionId = (path: string) => createHash('sha256').update(path).digest('hex').slice(0, 32).replace(/[a-f0-9]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
const saved = '保存済み · この端末のみ';

test('release ZIP installs from an extracted folder, keeps data across restarts and across an update into the same folder', async () => {
  test.setTimeout(180_000);
  execFileSync(process.execPath, ['node_modules/wxt/bin/wxt.mjs', 'zip'], { stdio: 'pipe' });
  const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
  const zip = await readFile(join('.output', zipName(version)));
  expect(verifyReleaseZip(zip, version).problems).toEqual([]);

  const base = await realpath(await mkdtemp(join(tmpdir(), 'nai-release-test-')));
  const profile = join(base, 'chrome-profile');
  const extract = async (folder: string, manifestVersion?: string) => {
    await rm(folder, { recursive: true, force: true });
    for (const entry of readZip(zip)) {
      if (entry.directory) continue;
      expect(entry.name).toMatch(ALLOWED_FILE);
      const target = join(folder, entry.name);
      await mkdir(dirname(target), { recursive: true });
      const data = entry.name === 'manifest.json' && manifestVersion ? Buffer.from(JSON.stringify({ ...JSON.parse(entry.data.toString('utf8')), version: manifestVersion })) : entry.data;
      await writeFile(target, data);
    }
  };
  const launch = (folder: string) => chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 400, height: 900 },
    args: [`--disable-extensions-except=${folder}`, `--load-extension=${folder}`],
  });
  const install = join(base, 'novelai-prompt-workbench'); // the folder a user keeps and updates in place
  await extract(install);
  // manifest.json sits directly in the extracted folder, so Chrome can load that folder.
  expect(existsSync(join(install, 'manifest.json'))).toBe(true);
  const id = extensionId(install);
  let context = await launch(install);
  try {
    // 1. First install: side panel opens from the toolbar button, data can be saved.
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await expect.poll(() => worker.evaluate(() => (globalThis as unknown as { chrome: { sidePanel: { getPanelBehavior(): Promise<{ openPanelOnActionClick?: boolean }> } } }).chrome.sidePanel.getPanelBehavior())).toEqual({ openPanelOnActionClick: true });
    let page = await context.newPage();
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(page.getByText(saved, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (globalThis as unknown as { chrome: { runtime: { getManifest(): { version: string } } } }).chrome.runtime.getManifest().version)).toBe(version);
    await page.getByRole('tab', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: 'デモを追加', exact: true }).click();
    await expect(page.getByText(saved, { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
    await page.getByRole('textbox', { name: '自由入力 Positive', exact: true }).fill('release install 🌟');
    await expect(page.getByText(saved, { exact: true })).toBeVisible();
    const output = await page.getByRole('textbox', { name: '出力 Positive', exact: true }).inputValue();
    expect(output).toContain('release install 🌟');
    await context.close();

    // 2. Chrome restart: data is still there.
    context = await launch(install);
    page = await context.newPage();
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(page.getByText('5件 / 全5件', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue(output);
    await context.close();

    // 3. Update: a newer release extracted over the SAME folder keeps the extension ID and the data.
    await extract(install, '0.99.0');
    context = await launch(install);
    page = await context.newPage();
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(page.getByText('5件 / 全5件', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '出力 Positive', exact: true })).toHaveValue(output);
    expect(await page.evaluate(() => (globalThis as unknown as { chrome: { runtime: { getManifest(): { version: string } } } }).chrome.runtime.getManifest().version)).toBe('0.99.0');
    await context.close();

    // 4. Why the folder must be reused: the same files in ANOTHER folder are a different extension with empty data.
    const elsewhere = join(base, 'novelai-prompt-workbench-0.99.0');
    await extract(elsewhere, '0.99.0');
    expect(extensionId(elsewhere)).not.toBe(id);
    context = await launch(elsewhere);
    page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId(elsewhere)}/sidepanel.html`);
    await expect(page.getByText(saved, { exact: true })).toBeVisible();
    await expect(page.getByText('0件 / 全0件', { exact: true })).toBeVisible();
  } finally {
    await context.close();
    await rm(base, { recursive: true, force: true });
  }
});
