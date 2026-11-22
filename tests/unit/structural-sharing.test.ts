import { describe, expect, it } from 'vitest';
import { record, redo, startHistory, undo } from '../../src/core/history';
import { addDefaultLibrary, advanceShuffle, getShuffle } from '../../src/core/shuffle/state';
import type { WorkbenchData } from '../../src/core/types';
import { exportBackup } from '../../src/data/backup';
import { isShared, isValidated, MAX_BYTES, parseBackup, validateData } from '../../src/data/validation';
import { fixture, timestamp } from './helpers';
import { dataset, editOne } from './perf/dataset';
import { BASE, idFactory, pointingSetup } from './shuffle/helpers';

// Issue #22 / ADR-105: validateData copies only nodes that are not part of an earlier
// result and freezes everything it returns (in every build, including this Node run).
const nodes = (root: unknown): object[] => {
  const found: object[] = [];
  const stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    found.push(value);
    stack.push(...Object.values(value));
  }
  return found;
};
const withShuffle = (): WorkbenchData => {
  const { shuffle, profile } = pointingSetup();
  const advanced = advanceShuffle({ ...fixture(), shuffle: addDefaultLibrary(shuffle, idFactory('d')) }, { profileId: profile.id, historyId: idFactory('h')(), now: timestamp, trigger: 'manual', base: BASE });
  return validateData(advanced.data);
};

describe('structural sharing in validateData (issue #22)', () => {
  it('reuses unchanged validated records and copies only the changed path', () => {
    const first = validateData(fixture());
    const edited = { ...first, libraryEntries: first.libraryEntries.map((entry, index) => index === 0 ? { ...entry, title: '変更' } : entry) };
    const second = validateData(edited);
    expect(second).toEqual(edited);
    // The root is always new and registered; the edited array and record are frozen copies, not the caller's objects.
    expect(second).not.toBe(first); expect(isValidated(second)).toBe(true);
    expect(second.libraryEntries).not.toBe(edited.libraryEntries);
    expect(second.libraryEntries[0]).not.toBe(edited.libraryEntries[0]);
    expect(Object.isFrozen(edited.libraryEntries[0])).toBe(false);
    // Everything else is the earlier result's node.
    expect(second.libraryEntries[0]!.tags).toBe(first.libraryEntries[0]!.tags);
    second.libraryEntries.slice(1).forEach((entry, index) => expect(entry).toBe(first.libraryEntries[index + 1]));
    for (const key of ['categories', 'workspaces', 'presets', 'experiments', 'images', 'settings'] as const) expect(second[key]).toBe(first[key]);
    // Validating a result again gives a new root over the same nodes.
    const again = validateData(second);
    expect(again).not.toBe(second); expect(again.libraryEntries).toBe(second.libraryEntries);
  });

  it('freezes every node of a result in every build and never freezes or aliases the caller’s input', () => {
    const input = fixture();
    const output = validateData(input);
    expect(nodes(output).every(node => Object.isFrozen(node) && isShared(node))).toBe(true);
    expect(nodes(input).some(node => Object.isFrozen(node) || isShared(node))).toBe(false);
    input.libraryEntries[0]!.title = '検証後に変更';
    input.libraryEntries.push(input.libraryEntries[1]!);
    expect(output.libraryEntries[0]!.title).not.toBe('検証後に変更');
    expect(output.libraryEntries).toHaveLength(5);
    expect(() => { (output.libraryEntries[0] as { title: string }).title = 'x'; }).toThrow(TypeError);
    expect(() => { (output.libraryEntries as unknown[]).push({}); }).toThrow(TypeError);
    expect(() => { (output.settings as { librarySort: string }).librarySort = 'updatedAt'; }).toThrow(TypeError);
  });

  it('never trusts a shared node: IDs, references, types and limits are checked on every call', () => {
    const data = validateData(fixture());
    const entry = data.libraryEntries[0]!;
    expect(() => validateData({ ...data, libraryEntries: [...data.libraryEntries, entry] })).toThrow('重複ID');
    expect(() => validateData({ ...data, categories: [] })).toThrow('カテゴリが存在しません');
    expect(() => validateData({ ...data, settings: entry })).toThrow('settings.librarySort');
    expect(() => validateData({ ...data, workspaces: [] })).toThrow('settings.activeWorkspaceId');
    const huge = Array.from({ length: Math.ceil(MAX_BYTES / 1_000_000) + 1 }, (_, index) => ({ ...entry, id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, raw: 'x'.repeat(1_000_000) }));
    expect(() => validateData({ ...data, libraryEntries: [...data.libraryEntries, ...huge] })).toThrow('10MiB');
    // A failed validation registers nothing.
    const rejected = { ...data, libraryEntries: [...data.libraryEntries, entry] };
    expect(() => validateData(rejected)).toThrow();
    expect(isShared(rejected) || isShared(rejected.libraryEntries) || isValidated(rejected)).toBe(false);
  });

  it('keeps unchanged shuffle data shared between commits and still validates it', () => {
    const first = withShuffle();
    expect(first.shuffle!.history.length).toBeGreaterThan(0);
    const second = validateData({ ...first, settings: { ...first.settings, librarySort: 'updatedAt' } });
    expect(second.shuffle).toBe(first.shuffle);
    const broken = { ...first.shuffle!, history: [...first.shuffle!.history, first.shuffle!.history[0]!] };
    expect(() => validateData({ ...first, shuffle: broken })).toThrow('重複ID');
  });

  it('an imported (never validated) document is copied completely', () => {
    const data = validateData(fixture());
    const imported = parseBackup(exportBackup(data, timestamp)).payload;
    expect(imported).toEqual(data);
    const shared = new Set(nodes(data));
    expect(nodes(imported).some(node => shared.has(node))).toBe(false);
  });

  it('31 Undo snapshots hold each unchanged record once, and Undo/Redo states validate onto the same nodes', () => {
    const base = dataset(2000);
    let history = startHistory(base);
    for (let step = 0; step < 31; step++) history = record(history, validateData(editOne(history.present, step)));
    const snapshots = [...history.past, history.present];
    expect(snapshots).toHaveLength(31);
    // 1,999 shared entries plus one edited entry per snapshot (instead of 31 × 2,000).
    expect(new Set(snapshots.flatMap(state => state.libraryEntries)).size).toBe(1999 + 31);
    expect(new Set(snapshots.map(state => state.workspaces)).size).toBe(1);
    expect(new Set(snapshots.map(state => state.presets)).size).toBe(1);
    const back = undo(undo(history));
    expect(back.present.libraryEntries[0]!.raw).toBe('edited 28');
    const forward = redo(back);
    expect(forward.present).toBe(history.past.at(-1));
    expect(validateData(back.present).libraryEntries).toBe(back.present.libraryEntries);
  });
});
