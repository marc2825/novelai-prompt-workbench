import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { expect, test, type Page } from '@playwright/test';
import type { WorkbenchData } from '../../src/core/types';
import { dataset, nearLimitDataset } from '../unit/perf/dataset';

// Opt-in benchmark in real Chromium (issue #22): `corepack pnpm bench:chromium`.
// It drives the fixture page (React development build, the same as Mock E2E) through
// the dev-only `window.__workbenchBench` hook (src/ui/useWorkbench.ts) and measures:
// - validate: validateData of a one-entry edit (what every commit runs)
// - commit: the synchronous part of commit() in the app (validate + Undo history + queueing the save)
// - input → frame: one keystroke-sized edit of the active workspace's free text until the next frame
// - edit → saved: commit until the save transaction it started has completed (保存済み is then checked)
// - save (isolated): WorkbenchRepository.save of an edit in a separate DB, without React
// - full save: the same right after load() (no trusted previous state: every record is written)
// - heap: performance.memory.usedJSHeapSize after CDP HeapProfiler.collectGarbage, after load
//   and after 31 edits (30 Undo steps, the maximum)
// Results: a table on stdout and JSON in test-results/bench-chromium-<BENCH_LABEL|latest>.json.
// BENCH_SIZES=100,500,2000,limit selects scenarios. Not part of test:e2e or Vitest.

interface Bench {
  commit(change: (data: WorkbenchData) => WorkbenchData): boolean;
  validateData(input: unknown): WorkbenchData;
  Repository: {
    open(name: string): Promise<{ save(data: WorkbenchData, revision: number): Promise<number>; load(): Promise<unknown>; close(): void }>;
    prototype: { save(...args: unknown[]): Promise<number> };
  };
  latest(): WorkbenchData | null;
  undoDepth(): number;
  idle(): boolean;
}
type BenchWindow = Window & { __workbenchBench?: Bench; __benchSaves?: { start: number; end: number }[] };

const SCENARIOS = [
  { key: '100', label: '100件', build: () => dataset(100, { workspaces: 1 }) },
  { key: '500', label: '500件', build: () => dataset(500, { workspaces: 2 }) },
  { key: '2000', label: '2,000件', build: () => dataset(2000, { workspaces: 10 }) },
  { key: 'limit', label: '上限付近', build: () => nearLimitDataset() },
];
const selected = process.env.BENCH_SIZES?.split(',').map(value => value.trim());
const EDITS = 31; // the first save after load writes everything; 30 more fill the Undo history
const KEYSTROKES = 20;
const VALIDATIONS = 15;
const FULL_SAVES = 5;
const SAVES = 15;

const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const middle = sorted.length >> 1; return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2; };
const records = (value: unknown): number => {
  if (!value || typeof value !== 'object') return 0;
  const children = Object.values(value).reduce<number>((sum, child) => sum + records(child), 0);
  return children + (!Array.isArray(value) && typeof (value as { id?: unknown }).id === 'string' ? 1 : 0);
};

interface Result {
  scenario: string; entries: number; workspaces: number; presets: number; records: number; jsonBytes: number;
  validateMs: number; validateFreshMs: number; commitMs: number; inputFrameMs: number; inputCommitMs: number;
  savedMs: number; firstSavedMs: number; appSaveMs: number; saveMs: number; fullSaveMs: number;
  heapLoadedBytes: number; heapHistoryBytes: number; undoDepth: number;
  raw: Record<string, number[]>;
}
const results: Result[] = [];
let browserVersion = '';

async function ready(page: Page) {
  await page.waitForFunction(() => { const bench = (window as BenchWindow).__workbenchBench; return !!bench?.latest() && bench.idle(); }, undefined, { timeout: 120_000 });
  await expect(page.getByText('保存済み · この端末のみ', { exact: true })).toBeVisible({ timeout: 120_000 });
}

test.describe.configure({ mode: 'serial' });

for (const scenario of SCENARIOS) {
  test(scenario.label, async ({ page, context, browser }) => {
    test.skip(!!selected && !selected.includes(scenario.key), 'BENCH_SIZES');
    browserVersion = browser.version();
    const data = scenario.build();
    const json = JSON.stringify(data);
    const cdp = await context.newCDPSession(page);
    const heap = async () => {
      for (let round = 0; round < 3; round++) await cdp.send('HeapProfiler.collectGarbage');
      return page.evaluate(() => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize);
    };

    await page.goto('/tests/fixtures/index.html');
    await ready(page);
    // Seed through the app's own commit → save path, then reload so the measured page starts like a freshly opened panel.
    await page.evaluate(async json => {
      const bench = (window as BenchWindow).__workbenchBench!;
      if (!bench.commit(() => JSON.parse(json) as WorkbenchData)) throw new Error('seed rejected');
      while (!bench.idle()) await new Promise(resolve => setTimeout(resolve, 10));
    }, json);
    await page.reload();
    await ready(page);
    expect(await page.evaluate(() => (window as BenchWindow).__workbenchBench!.latest()!.libraryEntries.length)).toBe(data.libraryEntries.length);
    // Time every save of this page (page-local wrapper around the prototype; benchmark only).
    await page.evaluate(() => {
      const target = window as BenchWindow;
      const prototype = target.__workbenchBench!.Repository.prototype;
      const original = prototype.save;
      target.__benchSaves = [];
      prototype.save = async function (this: unknown, ...args: unknown[]) {
        const start = performance.now();
        try { return await original.apply(this, args); } finally { target.__benchSaves!.push({ start, end: performance.now() }); }
      };
    });
    const heapLoaded = await heap();

    // 31 library edits through the app: the typical "edit one entry and save" path.
    const edits = await page.evaluate(async rounds => {
      const bench = (window as BenchWindow).__workbenchBench!; const saves = (window as BenchWindow).__benchSaves!;
      const settled = async () => { while (!bench.idle() || document.querySelector('div.status')?.textContent !== '保存済み · この端末のみ') await new Promise(resolve => setTimeout(resolve, 1)); };
      const out: { commit: number; save: number; saved: number }[] = [];
      for (let round = 0; round < rounds; round++) {
        const before = saves.length;
        const start = performance.now();
        const ok = bench.commit(data => ({ ...data, libraryEntries: data.libraryEntries.map((entry, index) => index === 0 ? { ...entry, raw: `edited ${round}` } : entry) }));
        const committed = performance.now();
        if (!ok) throw new Error(`edit ${round} rejected`);
        await settled();
        if (saves.length !== before + 1) throw new Error(`edit ${round}: expected one save, got ${saves.length - before}`);
        const save = saves.at(-1)!;
        out.push({ commit: committed - start, save: save.end - save.start, saved: save.end - start });
      }
      return out;
    }, EDITS);
    const heapHistory = await heap();
    const undoDepth = await page.evaluate(() => (window as BenchWindow).__workbenchBench!.undoDepth());

    // Typing in the free text of the active workspace commits once per keystroke.
    await page.getByRole('tab', { name: 'ワークスペース', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '自由入力 Positive', exact: true })).toBeVisible();
    const keystrokes = await page.evaluate(async count => {
      const bench = (window as BenchWindow).__workbenchBench!;
      const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const settled = async () => { while (!bench.idle() || document.querySelector('div.status')?.textContent !== '保存済み · この端末のみ') await new Promise(resolve => setTimeout(resolve, 1)); };
      const out: { commit: number; frame: number }[] = [];
      for (let index = 0; index < count; index++) {
        const updatedAt = new Date(Date.UTC(2026, 10, 3, 0, 0, index)).toISOString();
        const start = performance.now();
        const ok = bench.commit(data => ({ ...data, workspaces: data.workspaces.map(item => item.id === data.settings.activeWorkspaceId ? { ...item, freeformPositive: `${item.freeformPositive}a`, updatedAt } : item) }));
        const committed = performance.now();
        if (!ok) throw new Error(`keystroke ${index} rejected`);
        await frame();
        out.push({ commit: committed - start, frame: performance.now() - start });
        await settled();
      }
      return out;
    }, KEYSTROKES);
    await expect(page.getByRole('textbox', { name: '自由入力 Positive', exact: true })).toHaveValue('a'.repeat(KEYSTROKES));

    // validateData alone (no React, no IndexedDB): a one-entry edit, and fresh (never validated) input like load/import.
    const validation = await page.evaluate(async ({ json, rounds, fresh }) => {
      const bench = (window as BenchWindow).__workbenchBench!;
      const base = bench.latest()!;
      const edit: number[] = []; const whole: number[] = [];
      for (let round = 0; round < rounds; round++) {
        const input = { ...base, libraryEntries: base.libraryEntries.map((entry, index) => index === 0 ? { ...entry, raw: `validate ${round}` } : entry) };
        const start = performance.now(); bench.validateData(input); edit.push(performance.now() - start);
      }
      for (let round = 0; round < fresh; round++) {
        const input = JSON.parse(json) as unknown;
        const start = performance.now(); bench.validateData(input); whole.push(performance.now() - start);
      }
      return { edit, whole };
    }, { json, rounds: VALIDATIONS, fresh: FULL_SAVES });

    // The repository alone, in a separate database: a save right after load() and consecutive saves.
    const storage = await page.evaluate(async ({ json, fullSaves, saves }) => {
      const bench = (window as BenchWindow).__workbenchBench!;
      const name = 'nai-prompt-workbench-bench';
      const edit = (data: WorkbenchData, round: number) => bench.validateData({ ...data, libraryEntries: data.libraryEntries.map((entry, index) => index === 0 ? { ...entry, raw: `stored ${round}` } : entry) });
      const repository = await bench.Repository.open(name);
      let data = bench.validateData(JSON.parse(json));
      let revision = await repository.save(data, 0);
      const full: number[] = []; const incremental: number[] = [];
      for (let round = 0; round < fullSaves; round++) {
        await repository.load();
        data = edit(data, round);
        const start = performance.now(); revision = await repository.save(data, revision); full.push(performance.now() - start);
      }
      for (let round = 0; round < saves; round++) {
        data = edit(data, fullSaves + round);
        const start = performance.now(); revision = await repository.save(data, revision); incremental.push(performance.now() - start);
      }
      const stored = await repository.load() as { data: WorkbenchData; revision: number };
      if (stored.revision !== revision || stored.data.libraryEntries[0]!.raw !== data.libraryEntries[0]!.raw || JSON.stringify(stored.data) !== JSON.stringify(data)) throw new Error('isolated database does not match the last save');
      repository.close();
      await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = () => reject(request.error); });
      return { full, incremental };
    }, { json, fullSaves: FULL_SAVES, saves: SAVES });

    const later = edits.slice(1);
    results.push({
      scenario: scenario.label, entries: data.libraryEntries.length, workspaces: data.workspaces.length, presets: data.presets.length, records: records(data), jsonBytes: new TextEncoder().encode(json).byteLength,
      validateMs: median(validation.edit), validateFreshMs: median(validation.whole),
      commitMs: median(later.map(item => item.commit)), inputCommitMs: median(keystrokes.map(item => item.commit)), inputFrameMs: median(keystrokes.map(item => item.frame)),
      savedMs: median(later.map(item => item.saved)), firstSavedMs: edits[0]!.saved, appSaveMs: median(later.map(item => item.save)),
      saveMs: median(storage.incremental), fullSaveMs: median(storage.full),
      heapLoadedBytes: heapLoaded, heapHistoryBytes: heapHistory, undoDepth,
      raw: { validateEdit: validation.edit, validateFresh: validation.whole, commit: edits.map(item => item.commit), saved: edits.map(item => item.saved), appSave: edits.map(item => item.save), inputCommit: keystrokes.map(item => item.commit), inputFrame: keystrokes.map(item => item.frame), save: storage.incremental, fullSave: storage.full },
    });
    expect(undoDepth).toBe(30);
  });
}

test.afterAll(() => {
  if (!results.length) return;
  const mib = (bytes: number) => (bytes / 1048576).toFixed(1);
  const ms = (value: number) => value.toFixed(1);
  const lines = [
    '| データ | JSON | レコード | 検証（1件編集） | 検証（全件新規） | commit | 入力→描画 | 編集→保存完了 | 初回保存（読込直後） | 保存（単体） | 全件保存（単体） | ヒープ（読込後） | ヒープ（Undo 30） | 履歴の増分 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...results.map(item => `| ${item.scenario} | ${mib(item.jsonBytes)} MiB | ${item.records} | ${ms(item.validateMs)} ms | ${ms(item.validateFreshMs)} ms | ${ms(item.commitMs)} ms | ${ms(item.inputFrameMs)} ms | ${ms(item.savedMs)} ms | ${ms(item.firstSavedMs)} ms | ${ms(item.saveMs)} ms | ${ms(item.fullSaveMs)} ms | ${mib(item.heapLoadedBytes)} MiB | ${mib(item.heapHistoryBytes)} MiB | ${mib(item.heapHistoryBytes - item.heapLoadedBytes)} MiB |`),
  ];
  const environment = { date: new Date().toISOString(), label: process.env.BENCH_LABEL ?? 'latest', chromium: browserVersion, node: process.version, os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model ?? 'unknown', cpus: cpus().length, memoryGiB: Math.round(totalmem() / 1073741824) };
  console.log(`\n[bench:chromium] ${JSON.stringify(environment)}\n${lines.join('\n')}\n`);
  mkdirSync('test-results', { recursive: true });
  writeFileSync(`test-results/bench-chromium-${environment.label.replace(/[^\w.-]/g, '_')}.json`, `${JSON.stringify({ environment, results }, null, 2)}\n`);
});
