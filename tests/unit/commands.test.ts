import { describe, expect, it } from 'vitest';
import { moveById, removeMember, snapshotMember, toggleMember, updateGroup } from '../../src/core/commands';
import { compileWorkspace } from '../../src/core/compose';
import { record, redo, startHistory, undo } from '../../src/core/history';
import { searchLibrary } from '../../src/core/search';
import { fixture } from './helpers';

describe('P1 immutable commands / AC01–AC06', () => {
  it('selects A → B → none exclusively; member.enabled does not change exclusive semantics', () => {
    const group = fixture().workspaces[0]!.groups[0]!;
    group.members[1]!.enabled = false;
    const original = structuredClone(group);
    const selected = toggleMember(group, group.members[1]!.id);
    const workspace = fixture().workspaces[0]!;
    workspace.groups = [selected];
    expect(compileWorkspace(workspace).positive).toBe('1girl, blonde hair, short hair');
    expect(toggleMember(selected, selected.selectedMemberId!).selectedMemberId).toBeNull();
    expect(group).toEqual(original);
  });
  it('parent OFF/ON masks multi/exclusive without altering child flags or choice', () => {
    const workspace = fixture().workspaces[0]!;
    for (const group of workspace.groups) {
      const before = compileWorkspace(workspace);
      const disabled = updateGroup(workspace, group.id, current => ({ ...current, enabled: false }));
      expect(disabled.groups.find(item => item.id === group.id)?.members).toEqual(group.members);
      const restored = updateGroup(disabled, group.id, current => ({ ...current, enabled: true }));
      expect(compileWorkspace(restored)).toEqual(before);
    }
  });
  it('multi toggles are independent, repeated references use instance IDs', () => {
    const data = fixture();
    const entry = data.libraryEntries[0]!;
    const group = { ...data.workspaces[0]!.groups[1]!, members: [snapshotMember(entry, 'a'), snapshotMember(entry, 'b')] };
    const next = toggleMember(group, 'b');
    expect(next.members.map(member => member.enabled)).toEqual([true, false]);
    expect(toggleMember(group, 'absent')).toBe(group);
    const workspace = { ...data.workspaces[0]!, groups: [next] };
    expect(compileWorkspace(workspace).positive).toBe(`1girl, ${entry.raw}`);
  });
  it('snapshot survives source library edit and deletion', () => {
    const data = fixture();
    const workspace = data.workspaces[0]!;
    const before = compileWorkspace(workspace);
    data.libraryEntries[0]!.raw = 'changed';
    data.libraryEntries = [];
    expect(compileWorkspace(workspace)).toEqual(before);
  });
  it('member deletion clears its selection only, with undo and redo restoring exact raw', () => {
    const workspace = fixture().workspaces[0]!;
    const group = workspace.groups[0]!;
    group.members[0]!.rawSnapshot = '  {{髪}}, [tag], 1.2::x::, !macro:Style! | 🌃\n';
    const history = record(startHistory(workspace), updateGroup(workspace, group.id, current => removeMember(current, current.selectedMemberId!)));
    expect(history.present.groups[0]!.selectedMemberId).toBeNull();
    expect(undo(history).present).toEqual(workspace);
    expect(redo(undo(history)).present).toEqual(history.present);
    expect(startHistory(workspace).present).toBe(workspace);
  });
  it('reorders by stable ID, including edge and missing positions, without mutation', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(moveById(list, 'b', -1).map(item => item.id)).toEqual(['b', 'a', 'c']);
    expect(moveById(list, 'a', 1).map(item => item.id)).toEqual(['b', 'a', 'c']);
    expect(moveById(list, 'a', -1)).toBe(list);
    expect(moveById(list, 'c', 1)).toBe(list);
    expect(moveById(list, 'missing', 1)).toBe(list);
    expect(list.map(item => item.id)).toEqual(['a', 'b', 'c']);
  });
  it('history clears redo on a new branch and bounds destructive history', () => {
    let history = startHistory(0);
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
    for (let i = 1; i <= 40; i++) history = record(history, i);
    expect(history.past).toHaveLength(30);
    history = record(undo(history), 100);
    expect(history.future).toEqual([]);
  });
});

describe('search / AC06 and AC12', () => {
  it('matches Japanese, punctuation, emoji, raw, description, tags and category; filters and sorts', () => {
    const data = fixture();
    const entry = data.libraryEntries[0]!;
    entry.title = '黒髪, 長い 髪 🌟';
    for (const query of ['黒髪,', '長い 髪', '🌟', 'BLACK HAIR', '操作確認', 'hair', '髪型']) expect(searchLibrary(data.libraryEntries, data.categories, { query }).map(item => item.id)).toContain(entry.id);
    expect(searchLibrary(data.libraryEntries, data.categories, { query: '', categoryId: data.categories[0]!.id, tag: 'hair' })).toHaveLength(3);
    expect(searchLibrary(data.libraryEntries, data.categories, { query: 'missing' })).toEqual([]);
    expect(searchLibrary(data.libraryEntries, data.categories, { query: '', sort: 'updatedAt' })).toHaveLength(5);
  });
  it('searches 1000 records and reports p95 timing (informational)', () => {
    const entry = fixture().libraryEntries[0]!;
    const entries = Array.from({ length: 1000 }, (_, i) => ({ ...entry, id: `entry-${i}`, title: `日本語 🌟 ${i}`, raw: `{{hair}}, tag ${i}` }));
    const timings: number[] = [];
    for (let i = 0; i < 25; i++) {
      const start = performance.now();
      expect(searchLibrary(entries, [], { query: '🌟 999' })).toEqual([entries[999]]);
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    console.info(`AC12 search 1000 records: p95=${timings[23]!.toFixed(2)}ms (informational)`);
  });
});
