import { describe, expect, it } from 'vitest';
import { diffTags, splitTags } from '../../src/core/prompt-diff';
import { deletePresetRevision, duplicatePreset, MAX_PRESET_REVISIONS, overwritePreset, restorePresetRevision, savePreset } from '../../src/core/presets';
import { exportBackup, prepareImport } from '../../src/data/backup';
import { parseBackup, validateData } from '../../src/data/validation';
import { fixture, timestamp } from './helpers';

const id = (n: number) => `ffffffff-ffff-4fff-8fff-${String(n).padStart(12, '0')}`;
const at = (n: number) => `2026-11-22T00:00:${String(n).padStart(2, '0')}.000Z`;

describe('tag-level prompt difference (issue #30)', () => {
  it('splits at top-level commas, keeping weight blocks, braces and their inner commas together', () => {
    expect(splitTags(' blue eyes ,1.2::smile, open mouth::, {{red hair}}, [blush] ')?.map(tag => [tag.core, tag.weight])).toEqual([['blue eyes', ''], ['smile, open mouth', '1.2::'], ['red hair', '{{'], ['blush', '[']]);
    expect(splitTags('')).toEqual([]);
  });
  it('refuses to interpret macros or unbalanced syntax (callers fall back to the raw difference)', () => {
    for (const prompt of ['||a|b||, c', '{unclosed, tag', 'closed}, tag', '1.2::never closed', 'a::b', '(x, y']) expect(splitTags(prompt), prompt).toBeNull();
    expect(diffTags('||a|b||', 'c')).toBeNull();
  });
  it('reports added, removed, reweighted and moved tags', () => {
    const diff = diffTags('1girl, blue eyes, smile, long hair, outdoors', 'long hair, 1girl, 1.3::blue eyes::, outdoors, night')!;
    expect(diff.added.map(tag => tag.raw)).toEqual(['night']);
    expect(diff.removed.map(tag => tag.raw)).toEqual(['smile']);
    expect(diff.reweighted).toEqual([{ core: 'blue eyes', before: 'blue eyes', after: '1.3::blue eyes::' }]);
    expect(diff.moved).toEqual(['long hair']);
    expect(diff.unchanged).toBe(2);
    expect(diffTags('a, b', 'a,b')).toEqual({ added: [], removed: [], reweighted: [], moved: [], unchanged: 2 });
  });
  it('counts duplicate tags separately and prefers an exact weight match', () => {
    const diff = diffTags('a, {a}, b', '{a}, b')!;
    expect(diff.removed.map(tag => tag.raw)).toEqual(['a']);
    expect(diff.reweighted).toEqual([]);
  });
});

describe('preset version history (issue #30)', () => {
  const base = () => { const data = fixture(); return savePreset(data, data.workspaces[0]!.id, id(1), '保存', at(0)); };
  const edit = (data: ReturnType<typeof base>, text: string) => ({ ...data, workspaces: data.workspaces.map((item, index) => index ? item : { ...item, freeformPositive: text }) });
  it('keeps the previous content when overwriting, newest first, up to the limit', () => {
    let data = base();
    for (let n = 1; n <= MAX_PRESET_REVISIONS + 3; n++) data = validateData(overwritePreset(edit(data, `v${n}`), id(1), data.workspaces[0]!.id, at(n), id(100 + n)));
    const preset = data.presets[0]!;
    expect(preset.workspaceSnapshot.freeformPositive).toBe(`v${MAX_PRESET_REVISIONS + 3}`);
    expect(preset.revisions).toHaveLength(MAX_PRESET_REVISIONS);
    expect(preset.revisions![0]!.workspaceSnapshot.freeformPositive).toBe(`v${MAX_PRESET_REVISIONS + 2}`);
    expect(preset.revisions![0]!.savedAt).toBe(at(MAX_PRESET_REVISIONS + 2));
    // Without a revision ID (older callers) nothing is recorded.
    expect(overwritePreset(base(), id(1), base().workspaces[0]!.id, at(9)).presets[0]!.revisions).toBeUndefined();
  });
  it('restores a version without losing the current one, deletes versions, and round-trips through backups', () => {
    let data = base();
    data = validateData(overwritePreset(edit(data, 'second'), id(1), data.workspaces[0]!.id, at(1), id(201)));
    data = validateData(overwritePreset(edit(data, 'third'), id(1), data.workspaces[0]!.id, at(2), id(202)));
    const oldest = data.presets[0]!.revisions![1]!;
    const restored = validateData(restorePresetRevision(data, id(1), oldest.id, id(203), at(3)));
    expect(restored.presets[0]!.workspaceSnapshot).toEqual(oldest.workspaceSnapshot);
    expect(restored.presets[0]!.revisions!.map(item => [item.id, item.workspaceSnapshot.freeformPositive])).toEqual([[id(203), 'third'], [id(202), 'second']]);
    const removed = validateData(deletePresetRevision(restored, id(1), id(202)));
    expect(removed.presets[0]!.revisions!.map(item => item.id)).toEqual([id(203)]);
    const cleared = validateData(deletePresetRevision(removed, id(1), id(203)));
    expect(cleared.presets[0]!.revisions).toBeUndefined();
    expect(parseBackup(exportBackup(restored, timestamp)).payload).toEqual(restored);
    expect(() => restorePresetRevision(data, id(1), id(999), id(204), at(4))).toThrow('保存履歴が見つかりません');
  });
  it('duplicates without the history and rejects corrupt or colliding versions', () => {
    let data = base();
    data = validateData(overwritePreset(edit(data, 'second'), id(1), data.workspaces[0]!.id, at(1), id(301)));
    const copy = validateData(duplicatePreset(data, id(1), id(2), 'コピー', at(2)));
    expect(copy.presets[1]!.revisions).toBeUndefined();
    const revision = data.presets[0]!.revisions![0]!;
    const withPresets = (revisions: unknown) => ({ ...data, presets: [{ ...data.presets[0]!, revisions }] });
    expect(() => validateData(withPresets([{ ...revision, id: data.libraryEntries[0]!.id }]))).toThrow('重複ID');
    expect(() => validateData(withPresets([{ ...revision, savedAt: 'yesterday' }]))).toThrow('ISO 8601');
    expect(() => validateData(withPresets([{ ...revision, workspaceSnapshot: { ...revision.workspaceSnapshot, appliedPresetId: id(1) } }]))).toThrow('循環');
    expect(() => validateData(withPresets(Array.from({ length: MAX_PRESET_REVISIONS + 1 }, (_, n) => ({ ...revision, id: id(400 + n) }))))).toThrow('最大');
    expect(() => prepareImport(data, data, 'merge')).toThrow('重複ID');
  });
});
