import { describe, expect, it } from 'vitest';
import { captureVariant, compareSettings, createExperiment, duplicateExperiment, experimentDifferences, pixelDifference, textDifference, unknownSettings } from '../../src/core/experiments';
import { record, startHistory, undo, redo } from '../../src/core/history';
import { applyPreset, presetIdCount, savePreset, overwritePreset } from '../../src/core/presets';
import { exportBackup, prepareImport } from '../../src/data/backup';
import { parseBackup, validateData, validateGenerationSettings } from '../../src/data/validation';
import { fixture, timestamp } from './helpers';
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
export function experimentData() { const data = fixture(); data.experiments.push(createExperiment(id(1), id(2), id(3), '比較', data.workspaces[0]!, null, timestamp)); return data; }

describe('P4 fixed snapshots and comparison / AC15–17', () => {
  it('captures A and B independently without changing workspace or raw syntax', () => {
    const data = fixture(); const source = data.workspaces[0]!; const before = structuredClone(data);
    const item = createExperiment(id(1), id(2), id(3), '比較', source, null, timestamp);
    expect(data).toEqual(before); item.variantB.workspaceSnapshot.groups[0]!.members[0]!.rawSnapshot = 'B';
    expect(item.variantA.workspaceSnapshot).toEqual(source); expect(data).toEqual(before);
  });
  it('retains exact prompts after preset overwrite/deletion, library deletion and source deletion', () => {
    let data = fixture(); const source = data.workspaces[0]!;
    data = savePreset(data, source.id, id(10), 'Preset', timestamp);
    const item = createExperiment(id(1), id(2), id(3), 'snapshot', data.presets[0]!.workspaceSnapshot, id(10), timestamp);
    const expected = structuredClone(item); data.workspaces[0]!.freeformPositive = 'changed';
    data = overwritePreset(data, id(10), source.id, timestamp); data.presets = []; data.libraryEntries = []; data.workspaces = []; data.settings.activeWorkspaceId = null; data.experiments = [item];
    expect(validateData(data).experiments[0]).toEqual(expected);
  });
  it('duplicates settings/images/snapshots with new IDs and no shared references', () => {
    const source = experimentData().experiments[0]!; const copy = duplicateExperiment(source, id(4), id(5), id(6), timestamp);
    copy.variantB.settings.extra.x = true; expect(source.variantB.settings.extra).toEqual({}); expect(copy.variantA.compiled).toEqual(source.variantA.compiled); expect(copy.id).not.toBe(source.id);
  });
  it('shows group selections and compiled prompt differences, preserving nonselected raw text', () => {
    const item = experimentData().experiments[0]!; const b = structuredClone(item.variantB.workspaceSnapshot); const group = b.groups[0]!;
    group.selectedMemberId = group.members[1]!.id; item.variantB = captureVariant(id(3), 'B', b, null);
    expect(experimentDifferences(item).total).toBeGreaterThan(0); expect(item.variantB.compiled).not.toEqual(item.variantA.compiled); expect(item.variantB.workspaceSnapshot.groups[0]!.members).toEqual(item.variantA.workspaceSnapshot.groups[0]!.members);
  });
  it('diffs raw special syntax without treating commas as tags or splitting emoji', () => {
    expect(textDifference('{{a|b}}, 🌟', '{{a|c}}, 🌙')).toEqual({ prefix: '{{a|', removed: 'b}}, 🌟', added: 'c}}, 🌙', suffix: '' });
    expect(textDifference('a', 'a')).toEqual({ prefix: 'a', added: '', removed: '', suffix: '' });
  });
  it('does not claim unknown settings match and never creates guessed values', () => {
    const unknown = unknownSettings(); expect(Object.values(unknown).filter(value => value === null)).toHaveLength(11);
    expect(compareSettings(unknown, unknown).status).toBe('検証不能'); expect(compareSettings(unknown, unknown).unknown).toContain('モデル');
  });
  it('compares all recorded conditions including false/zero extras and string seeds exactly', () => {
    const a = { ...unknownSettings(), model: 'model', seed: '900719925474099312345', width: 2, height: 2, steps: 20, sampler: 'sampler', guidance: 5, cfgRescale: 0, imageCount: 1, imageToImage: '不使用', referenceImages: '不使用', extrasConfirmed: true, evidence: 'manual' as const, extra: { smea: false, zero: 0 } };
    validateGenerationSettings(a); expect(compareSettings(a, a).status).toBe('記録した条件は一致');
    expect(compareSettings(a, { ...a, seed: '900719925474099312346' }).status).toBe('設定不一致');
    expect(compareSettings(a, { ...a, extra: {} }).status).toBe('検証不能');
    const future = { ...a, unknownModelOption: true };
    expect(compareSettings(future, a).status).toBe('検証不能');
  });
  it('remaps preset snapshot IDs that now belong to experiments and variants', () => {
    let data = fixture(); const source = data.workspaces[0]!;
    data = savePreset(data, source.id, id(10), '保存', timestamp);
    // Snapshot IDs remain legitimate after the live source is removed, and can
    // subsequently be used for unrelated records in the global live scope.
    const saved = data.presets[0]!; data.workspaces = []; data.settings.activeWorkspaceId = null;
    data.experiments.push(createExperiment(source.groups[0]!.id, source.groups[0]!.members[0]!.id, source.groups[1]!.id, '比較', source, null, timestamp));
    validateData(data);
    const applied = applyPreset(data, saved.id, null, Array.from({ length: presetIdCount(source) }, (_, index) => id(100 + index)), timestamp);
    expect(validateData(applied).experiments).toEqual(data.experiments);
    expect(applied.workspaces[0]!.groups[0]!.id).not.toBe(source.groups[0]!.id);
  });
  it.each([{ seed: 9007199254740992 }, { width: -1 }, { steps: 1.5 }, { guidance: Infinity }, { extra: { nested: {} } }, { seed: '1e20' }])('rejects invalid settings %o', change => { expect(() => validateGenerationSettings({ ...unknownSettings(), ...change })).toThrow(); });
  it('roundtrips comparisons through JSON and explicitly excludes binary pixels', () => {
    const data = experimentData(); const text = exportBackup(data, timestamp); expect(JSON.parse(text).imageBinariesIncluded).toBe(false); expect(parseBackup(text).payload).toEqual(data);
    expect(prepareImport(fixture(), { ...data, libraryEntries: [], categories: [], workspaces: [], settings: { ...data.settings, activeWorkspaceId: null } }, 'merge').experiments).toEqual(data.experiments);
  });
  it('records multi-variant change once and Undo/Redo leaves workspace/comments unchanged', () => {
    const data = experimentData(); const changed = structuredClone(data); changed.experiments[0]!.variantA.settings.seed = '42'; changed.experiments[0]!.variantB.settings.seed = '42';
    const history = record(startHistory(data), changed); expect(history.past).toHaveLength(1); expect(undo(history).present).toEqual(data); expect(redo(undo(history)).present).toEqual(changed); expect(changed.workspaces).toEqual(data.workspaces);
    const removed = { ...data, experiments: [] }; expect(undo(record(startHistory(data), removed)).present).toEqual(data);
  });
  it.each(['prompt', 'image', 'cycle', 'binding', 'duplicate'] as const)('rejects broken comparison %s', kind => {
    const data = experimentData(); const a = data.experiments[0]!.variantA;
    if (kind === 'prompt') a.compiled.positive = 'tampered';
    if (kind === 'image') a.imageId = id(99);
    if (kind === 'cycle') (a as unknown as Record<string, unknown>).self = a;
    if (kind === 'binding') a.workspaceSnapshot.appliedPresetId = id(99);
    if (kind === 'duplicate') data.experiments[0]!.variantB.id = a.id;
    expect(() => validateData(data)).toThrow();
  });
  it('computes RGBA absolute pixel differences and rejects incompatible buffers', () => {
    const a = new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]); const b = new Uint8ClampedArray([10, 25, 30, 255, 0, 0, 0, 255]);
    const diff = pixelDifference(a, b); expect(diff.changed).toBe(2); expect(diff.mean).toBe(260 / 8); expect([...diff.pixels]).toEqual([0, 5, 0, 255, 255, 255, 255, 255]);
    expect(() => pixelDifference(a, b.slice(0, 4))).toThrow(); expect(() => pixelDifference(new Uint8ClampedArray(1), new Uint8ClampedArray(1))).toThrow();
  });
});
