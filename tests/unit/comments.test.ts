import { describe, expect, it } from 'vitest';
import { assertSafeCommentRange, commentRange, renderCommentSpans, toggleCommentSpan } from '../../src/core/comments';
import { compileWorkspace } from '../../src/core/compose';
import { record, redo, startHistory, undo } from '../../src/core/history';
import { exportBackup } from '../../src/data/backup';
import { parseBackup, validateData } from '../../src/data/validation';
import { fixture, timestamp } from './helpers';

const ids: [string, string, string] = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'];

describe('P2 non-destructive range comments', () => {
  it.each([
    ['long hair, black hair, blue eyes', 'black hair', 'long hair, blue eyes'],
    ['long hair, black hair, blue eyes', 'long hair', 'black hair, blue eyes'],
    ['long hair, black hair, blue eyes', 'blue eyes', 'long hair, black hair'],
    ['a,b,c', 'b', 'a, c'],
    ['a,  日本語 🌟  , c', '日本語 🌟', 'a, c'],
    ['  {{髪}}, [tag], 1.2::light:: | !macro:Name!\n🌟  ', '  {{髪}}, [tag], 1.2::light:: | !macro:Name!\n🌟  ', ''],
  ])('preserves source and restores it exactly: %s / %s', (raw, selection, expected) => {
    const start = raw.indexOf(selection);
    const spans = commentRange(raw, undefined, start, start + selection.length, ids);
    expect(spans.map(span => span.text).join('')).toBe(raw);
    expect(renderCommentSpans(raw, spans)).toBe(expected);
    expect(renderCommentSpans(raw, toggleCommentSpan(raw, spans, ids[1]))).toBe(raw);
  });
  it('supports adjacent OFF ranges and never creates a doubled delimiter', () => {
    const raw = 'a, b, c';
    const first = commentRange(raw, undefined, 3, 4, ids);
    const second = commentRange(raw, first, 6, 7, ['b1', 'b2', 'b3']);
    expect(renderCommentSpans(raw, second)).toBe('a');
    const third = toggleCommentSpan(raw, second, ids[0]);
    expect(renderCommentSpans(raw, third)).toBe('');
    expect(second.map(span => span.text).join('')).toBe(raw);
    expect(() => commentRange(raw, second, 3, 4, ['c1', 'c2', 'c3'])).toThrow('重な');
  });
  it.each(['{hair}, black hair', '[hair], black hair', '1.2::hair::, black hair', '!macro:Hair!, black hair', 'hair | other, black hair', 'hair\nblack hair'])('refuses partial ranges in complex raw without changing it: %s', raw => {
    expect(() => assertSafeCommentRange(raw, raw.indexOf('black'), raw.length)).toThrow('複雑');
  });
  it('rejects empty, partial-token and surrogate-splitting selections', () => {
    expect(() => assertSafeCommentRange('long hair, 🌟', 2, 4)).toThrow();
    expect(() => assertSafeCommentRange('long hair', 0, 0)).toThrow();
    expect(() => assertSafeCommentRange('🌟', 0, 1)).toThrow();
    expect(() => assertSafeCommentRange('a, b', -1, 2)).toThrow();
    expect(() => assertSafeCommentRange('a, b', 0.5, 2)).toThrow();
  });
  it('undo/redo restores comment state and the exact original including Unicode', () => {
    const raw = '長い髪, 黒髪 🌟, 青い目';
    const spans = commentRange(raw, undefined, raw.indexOf('黒'), raw.indexOf(', 青'), ids);
    const history = record(startHistory({ raw, spans: undefined as typeof spans | undefined }), { raw, spans });
    expect(renderCommentSpans(undo(history).present.raw, undo(history).present.spans)).toBe(raw);
    expect(renderCommentSpans(redo(undo(history)).present.raw, redo(undo(history)).present.spans)).toBe('長い髪, 青い目');
  });
  it('persists, validates and compiles spans on both channels and members, preserving legacy P1 input', () => {
    const data = fixture();
    const workspace = data.workspaces[0]!;
    const legacy = compileWorkspace(workspace);
    workspace.freeformPositive = 'a, b, c';
    workspace.freeformPositiveSpans = commentRange('a, b, c', undefined, 3, 4, ids);
    workspace.freeformNegative = 'bad, watermark';
    workspace.freeformNegativeSpans = commentRange(workspace.freeformNegative, undefined, 0, 3, ['n1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3']);
    const restored = parseBackup(exportBackup(data, timestamp)).payload;
    expect(compileWorkspace(restored.workspaces[0]!).positive).toBe('a, c, {{black hair}}, long hair, night, city lights');
    expect(compileWorkspace(restored.workspaces[0]!).negative).toBe('watermark, [watermark]');
    expect(compileWorkspace(fixture().workspaces[0]!)).toEqual(legacy);
  });
  it('rejects malformed/mismatched/duplicate span data atomically and never leaks OFF raw on compilation', () => {
    const data = fixture(); const workspace = data.workspaces[0]!;
    workspace.freeformPositiveSpans = [{ id: ids[0], text: 'not original', enabled: false }];
    expect(() => validateData(data)).toThrow('一致');
    const result = compileWorkspace(workspace);
    expect(result.positive).not.toContain('not original'); expect(result.warnings).toHaveLength(1);
    workspace.freeformPositiveSpans = [{ id: data.libraryEntries[0]!.id, text: workspace.freeformPositive, enabled: false }];
    expect(() => validateData(data)).toThrow('重複ID');
  });
  it('member range comments are workspace-only, respect the parent and survive export/import', () => {
    const data = fixture(); const workspace = data.workspaces[0]!;
    const member = workspace.groups[0]!.members[0]!;
    member.overrideRaw = 'long hair, black hair';
    member.overrideSpans = commentRange(member.overrideRaw, undefined, 11, 21, ids);
    const before = data.libraryEntries[0]!.raw;
    const restored = parseBackup(exportBackup(data, timestamp)).payload;
    expect(compileWorkspace(restored.workspaces[0]!).positive).toBe('1girl, long hair, night, city lights');
    expect(restored.libraryEntries[0]!.raw).toBe(before);
    // Validated data is frozen in every build (ADR-105): disable the group on a new object.
    const restoredWorkspace = restored.workspaces[0]!;
    const disabled = { ...restoredWorkspace, groups: restoredWorkspace.groups.map((group, index) => index === 0 ? { ...group, enabled: false } : group) };
    expect(compileWorkspace(disabled).positive).toBe('1girl, night, city lights');
    expect(restored.workspaces[0]!.groups[0]!.members[0]!.overrideSpans).toEqual(member.overrideSpans);
  });
});
