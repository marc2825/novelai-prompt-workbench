import { SCHEMA_VERSION } from '../../src/data/validation';
import { describe, expect, it } from 'vitest';
import { createWorkspace, moveById, snapshotMember, toggleMember } from '../../src/core/commands';
import { commentRange } from '../../src/core/comments';
import { compileWorkspace } from '../../src/core/compose';
import { record, redo, startHistory, undo } from '../../src/core/history';
import { applyPreset, captureWorkspace, comparePreset, deletePreset, diagnosePreset, duplicatePreset, overwritePreset, presetStatus, renamePreset, samePresetState, savePreset } from '../../src/core/presets';
import { exportBackup, prepareImport } from '../../src/data/backup';
import { parseBackup, validateData } from '../../src/data/validation';
import { fixture, timestamp } from './helpers';

const uuid = (index: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`;
function ids() { return Array.from({ length: 200 }, (_, index) => uuid(index + 100)); }
function saved() { const data = fixture(); return savePreset(data, data.workspaces[0]!.id, uuid(1), '制服 🌟', timestamp); }

describe('P3 snapshots / AC10, AC11', () => {
  it('saves a deep snapshot without any preset dependency and preserves source library', () => {
    const original = fixture(); const library = structuredClone(original.libraryEntries);
    const data = savePreset(original, original.workspaces[0]!.id, uuid(1), '制服 🌟', timestamp);
    expect(validateData(data)).toEqual(data);
    expect(data.presets[0]!.workspaceSnapshot).toEqual(original.workspaces[0]);
    expect(data.presets[0]!.workspaceSnapshot).not.toBe(original.workspaces[0]);
    expect(data.presets[0]!.workspaceSnapshot.appliedPresetId).toBeUndefined();
    expect(data.libraryEntries).toEqual(library); expect(original.presets).toEqual([]);
    expect(presetStatus(data, data.workspaces[0]!).state).toBe('clean');
    data.workspaces[0]!.groups[0]!.members[0]!.rawSnapshot = 'local mutation';
    expect(data.presets[0]!.workspaceSnapshot.groups[0]!.members[0]!.rawSnapshot).toContain('black hair');
  });
  it('restores A → B → A across multiple groups, preserving exclusive/multi/parent/order/channels', () => {
    let data = saved(); const original = compileWorkspace(data.workspaces[0]!);
    const item = data.workspaces[0]!;
    item.groups[0] = toggleMember(item.groups[0]!, item.groups[0]!.members[1]!.id);
    item.groups[1]!.members.push(snapshotMember(data.libraryEntries[2]!, uuid(11)));
    item.groups[1]!.members[0]!.enabled = false;
    item.groups[2]!.enabled = false;
    item.groups = moveById(item.groups, item.groups[1]!.id, -1);
    item.freeformPositive = 'B'; item.freeformNegative = 'negative B';
    data = savePreset(data, item.id, uuid(2), '私服', timestamp);
    const variant = compileWorkspace(data.workspaces[0]!);
    expect(variant.positive).toBe('B, red hair, blonde hair, short hair');
    expect(variant.negative).toBe('negative B');
    data = applyPreset(data, uuid(1), item.id, ids(), timestamp);
    expect(compileWorkspace(data.workspaces[0]!)).toEqual(original);
    data = applyPreset(data, uuid(2), item.id, ids(), timestamp);
    expect(compileWorkspace(data.workspaces[0]!)).toEqual(variant);
    data = applyPreset(data, uuid(1), item.id, ids(), timestamp);
    expect(compileWorkspace(data.workspaces[0]!)).toEqual(original);
    expect(validateData(data)).toEqual(data);
  });
  it('bulk apply and its binding are one undo/redo operation, restoring unsaved edits', () => {
    const before = saved(); before.workspaces[0]!.freeformPositive = 'unsaved text';
    before.workspaces[0]!.groups[0]!.enabled = false;
    const history = record(startHistory(before), applyPreset(before, uuid(1), before.workspaces[0]!.id, ids(), timestamp));
    expect(history.past).toHaveLength(1);
    expect(presetStatus(history.present, history.present.workspaces[0]!).state).toBe('clean');
    expect(undo(history).present).toEqual(before);
    expect(presetStatus(undo(history).present, undo(history).present.workspaces[0]!).state).toBe('dirty');
    expect(redo(undo(history)).present).toEqual(history.present);
  });
  it('dirty detection includes OFF choices, raw overrides, comments and ordering, ignoring identity and time', () => {
    const data = saved(); const snapshot = data.presets[0]!.workspaceSnapshot;
    const item = structuredClone(data.workspaces[0]!);
    item.title = 'destination title'; item.updatedAt = '2027-01-01T00:00:00Z';
    expect(samePresetState(item, snapshot)).toBe(true);
    item.groups[0]!.members[2]!.enabled = false;
    expect(samePresetState(item, snapshot)).toBe(false);
    const diff = comparePreset(item, snapshot);
    expect(diff.total).toBe(1); expect(diff.differences[0]!.label).toContain('有効');
    expect(diff.before).toEqual(diff.after); // Non-selected state still matters.
    const unbound = captureWorkspace(item);
    expect(presetStatus(data, unbound).state).toBe('unbound');
    expect(presetStatus(data, { ...unbound, appliedPresetId: uuid(999) }).state).toBe('missing');
  });
  it('preserves P2 spans, local overrides and all raw syntax through preset application and JSON', () => {
    let data = fixture(); const item = data.workspaces[0]!;
    item.freeformPositive = 'a, b, c';
    item.freeformPositiveSpans = commentRange(item.freeformPositive, undefined, 3, 4, [uuid(11), uuid(12), uuid(13)]);
    const member = item.groups[0]!.members[0]!;
    member.overrideRaw = '  {{hair}}, [tag], 1.2::light:: | !macro:名!\n🌟  ';
    member.overrideSpans = commentRange(member.overrideRaw, undefined, 0, member.overrideRaw.length, [uuid(14), uuid(15), uuid(16)]);
    data = savePreset(data, item.id, uuid(1), 'コメントあり', timestamp);
    const output = compileWorkspace(data.workspaces[0]!);
    expect(output.positive).toBe('a, c, night, city lights');
    const restored = parseBackup(exportBackup(data, timestamp));
    expect(restored.schemaVersion).toBe(SCHEMA_VERSION); expect(restored.payload).toEqual(data);
    const applied = applyPreset(restored.payload, uuid(1), item.id, ids(), timestamp);
    expect(compileWorkspace(applied.workspaces[0]!)).toEqual(output);
    expect(applied.workspaces[0]!.groups[0]!.members[0]!.overrideRaw).toBe(member.overrideRaw);
  });
  it('duplicates, renames, overwrites and deletes without mutating the saved original', () => {
    const original = saved();
    let data = duplicatePreset(original, uuid(1), uuid(2), 'コピー', timestamp);
    data = renamePreset(data, uuid(2), '編集済み', timestamp);
    data.workspaces[0]!.freeformPositive = 'new configuration';
    data = overwritePreset(data, uuid(2), data.workspaces[0]!.id, timestamp);
    expect(data.presets[1]!.workspaceSnapshot.freeformPositive).toBe('new configuration');
    expect(data.presets[0]).toEqual(original.presets[0]);
    expect(presetStatus(data, data.workspaces[0]!).state).toBe('clean');
    const beforeDelete = structuredClone(data);
    data = deletePreset(data, uuid(2));
    expect(data.workspaces[0]!.appliedPresetId).toBeUndefined();
    expect(data.workspaces[0]!.freeformPositive).toBe('new configuration');
    expect(undo(record(startHistory(beforeDelete), data)).present).toEqual(beforeDelete);
  });
  it('diagnoses changed/deleted library and source workspace but still reproduces saved output', () => {
    let data = saved(); const snapshot = data.presets[0]!;
    const output = compileWorkspace(snapshot.workspaceSnapshot);
    data.libraryEntries[0]!.raw = 'changed source'; data.libraryEntries.splice(1, 1);
    data.workspaces = []; data.settings.activeWorkspaceId = null;
    expect(diagnosePreset(snapshot, data.libraryEntries, data.workspaces).map(issue => issue.code)).toEqual(['MISSING_SOURCE', 'CHANGED_ENTRY', 'MISSING_ENTRY']);
    const library = structuredClone(data.libraryEntries);
    data = applyPreset(data, uuid(1), null, ids(), timestamp);
    expect(compileWorkspace(data.workspaces[0]!)).toEqual(output);
    expect(data.libraryEntries).toEqual(library); expect(validateData(data)).toEqual(data);
  });
  it('remaps colliding IDs when restoring into a different or new live workspace', () => {
    let data = saved(); const source = structuredClone(data.workspaces[0]!);
    const second = createWorkspace(uuid(20), 'Destination', timestamp);
    data.workspaces.push(second);
    data = applyPreset(data, uuid(1), second.id, ids(), timestamp);
    expect(data.workspaces[0]).toEqual(source);
    expect(data.workspaces[1]!.title).toBe('Destination');
    expect(data.workspaces[1]!.groups[0]!.id).not.toBe(source.groups[0]!.id);
    expect(compileWorkspace(data.workspaces[1]!)).toEqual(compileWorkspace(source));
    expect(presetStatus(data, data.workspaces[1]!).state).toBe('clean');
    expect(validateData(data)).toEqual(data);
    const restored = applyPreset(data, uuid(1), null, ids(), timestamp);
    expect(restored.workspaces).toHaveLength(3); expect(validateData(restored)).toEqual(restored);
  });
  it('rejects missing preset/workspace and duplicate IDs with no input mutation', () => {
    const data = saved(); const before = structuredClone(data);
    expect(() => applyPreset(data, 'missing', data.workspaces[0]!.id, ids(), timestamp)).toThrow('存在');
    expect(() => applyPreset(data, uuid(1), 'missing', ids(), timestamp)).toThrow('存在');
    expect(() => duplicatePreset(data, uuid(1), uuid(1), 'bad', timestamp)).toThrow('重複');
    expect(() => savePreset(data, data.workspaces[0]!.id, uuid(1), 'bad', timestamp)).toThrow('重複');
    expect(() => applyPreset(data, uuid(1), null, [], timestamp)).toThrow('一意なID');
    expect(applyPreset(data, uuid(1), null, ids(), timestamp)).toEqual(applyPreset(data, uuid(1), null, ids(), timestamp));
    expect(data).toEqual(before);
  });
});

describe('P3 untrusted presets and JSON', () => {
  it('supports v1 legacy input and v2 presets with safe unknown fields', () => {
    const data = saved(); Object.assign(data.presets[0]!, { memo: { future: 'safe' } });
    expect(parseBackup(exportBackup(data, timestamp)).payload).toEqual(data);
    const legacy = fixture(); const document = JSON.parse(exportBackup(legacy, timestamp)) as Record<string, unknown>; document.schemaVersion = 1;
    expect(parseBackup(JSON.stringify(document)).payload).toEqual(legacy);
    expect(() => parseBackup(JSON.stringify({ ...document, payload: data }))).toThrow('v1');
  });
  it.each(['name', 'createdAt', 'sourceWorkspaceId', 'workspaceSnapshot'] as const)('rejects malformed preset %s', key => {
    const data = saved(); (data.presets[0] as unknown as Record<string, unknown>)[key] = 'invalid';
    // name is a valid string, so force the invalid empty-name case.
    if (key === 'name') data.presets[0]!.name = ' ';
    expect(() => validateData(data)).toThrow();
  });
  it('validates snapshot IDs in independent scopes, rejecting duplicates within each snapshot', () => {
    const data = duplicatePreset(saved(), uuid(1), uuid(2), 'copy', timestamp);
    expect(validateData(data)).toEqual(data);
    const snapshot = data.presets[1]!.workspaceSnapshot;
    snapshot.groups[1]!.id = snapshot.groups[0]!.id;
    expect(() => validateData(data)).toThrow('重複ID');
  });
  it('rejects missing selection/binding, snapshot-to-preset links, and object cycles without changes', () => {
    const data = saved(); const copy = structuredClone(data);
    copy.presets[0]!.workspaceSnapshot.groups[0]!.selectedMemberId = uuid(999);
    expect(() => validateData(copy)).toThrow('選択先');
    copy.presets[0]!.workspaceSnapshot = structuredClone(data.presets[0]!.workspaceSnapshot);
    copy.workspaces[0]!.appliedPresetId = uuid(999);
    expect(() => validateData(copy)).toThrow('適用元');
    copy.workspaces[0]!.appliedPresetId = uuid(1);
    copy.presets[0]!.workspaceSnapshot.appliedPresetId = uuid(1);
    expect(() => validateData(copy)).toThrow('循環');
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => validateData({ ...data, cyclic })).toThrow('循環参照');
    expect(data).toEqual(saved());
  });
  it('merge rejects preset ID collisions and replace restores both bindings and snapshots', () => {
    const data = saved(); const before = structuredClone(data);
    expect(() => prepareImport(data, data, 'merge')).toThrow('重複ID');
    expect(prepareImport(fixture(), data, 'replace')).toEqual(data);
    const onlyPreset = { ...fixture(), libraryEntries: [], categories: [], workspaces: [], presets: [data.presets[0]!], settings: { activeWorkspaceId: null, librarySort: 'title' as const } };
    expect(prepareImport(fixture(), onlyPreset, 'merge').presets).toHaveLength(1);
    expect(data).toEqual(before);
  });
});
