import { describe, expect, it } from 'vitest';
import { compileWorkspace } from '../../src/core/compose';
import type { PromptWorkspace } from '../../src/core/types';

function demo(): PromptWorkspace {
  return {
    id: 'w', title: 'Test', updatedAt: '2026-11-03T00:00:00Z',
    freeformPositive: '1girl', freeformNegative: 'bad anatomy',
    groups: [
      { id: 'hair', name: 'Hair', channel: 'positive', mode: 'exclusive', enabled: true,
        selectedMemberId: 'b', members: [
          { id: 'a', entryId: 'a', enabled: true, rawSnapshot: 'black hair' },
          { id: 'b', entryId: 'b', enabled: true, rawSnapshot: 'blonde hair' },
        ] },
      { id: 'style', name: 'Style', channel: 'positive', mode: 'multi', enabled: true,
        selectedMemberId: null, members: [
          { id: 'x', entryId: 'x', enabled: true, rawSnapshot: '{{detailed}}, 1.2::lighting::' },
          { id: 'y', entryId: 'y', enabled: false, rawSnapshot: 'city street' },
        ] },
      { id: 'ban', name: 'Ban', channel: 'negative', mode: 'multi', enabled: true,
        selectedMemberId: null, members: [
          { id: 'z', entryId: 'z', enabled: true, rawSnapshot: '[watermark]' },
        ] },
    ],
  };
}

describe('compileWorkspace', () => {
  it('uses one exclusive choice, enabled multi entries, and separate channels', () => {
    const result = compileWorkspace(demo());
    expect(result.positive).toBe('1girl, blonde hair, {{detailed}}, 1.2::lighting::');
    expect(result.negative).toBe('bad anatomy, [watermark]');
    expect(result.warnings).toEqual([]);
  });
  it('preserves child selection when group is temporarily disabled', () => {
    const ws = demo();
    const group = ws.groups[0]!;
    group.enabled = false;
    expect(compileWorkspace(ws).positive).not.toContain('blonde hair');
    group.enabled = true;
    expect(compileWorkspace(ws).positive).toContain('blonde hair');
  });
  it('rejects invalid selectedMemberId without inserting an unintended entry', () => {
    const ws = demo();
    ws.groups[0]!.selectedMemberId = 'not-found';
    const result = compileWorkspace(ws);
    expect(result.positive).not.toContain('hair');
    expect(result.warnings).toHaveLength(1);
  });
  it('does not mutate workspace and preserves macro/pipes verbatim', () => {
    const ws = demo();
    ws.groups[1]!.members[0]!.rawSnapshot = '!macro:Style!, |, {tag}';
    const original = structuredClone(ws);
    expect(compileWorkspace(ws).positive).toContain('!macro:Style!, |, {tag}');
    expect(ws).toEqual(original);
  });
  it('does not insert a second comma when raw already ends with one', () => {
    const ws = demo();
    ws.freeformPositive = '1girl,';
    expect(compileWorkspace(ws).positive.startsWith('1girl, blonde hair')).toBe(true);
  });
  it.each([
    ['first,', ', second', 'first, second'],
    ['first', ', second', 'first, second'],
    ['first,', 'second', 'first, second'],
    [' first ', '  {raw, internal},\n| !macro:名!  ', 'first, {raw, internal},\n| !macro:名!'],
    ['', '   ', ''],
  ])('joins only fragment boundaries: %s + %s', (freeform, raw, expected) => {
    const workspace = demo();
    workspace.freeformPositive = freeform;
    workspace.groups = [{ ...workspace.groups[1]!, members: [{ id: 'raw', entryId: 'entry', enabled: true, rawSnapshot: raw }] }];
    expect(compileWorkspace(workspace).positive).toBe(expected);
    expect(workspace.groups[0]!.members[0]!.rawSnapshot).toBe(raw);
  });
  it('does not leak a selection from another group, including empty and disabled groups', () => {
    const workspace = demo();
    workspace.groups[0]!.selectedMemberId = 'z';
    workspace.groups[1]!.enabled = false;
    expect(compileWorkspace(workspace)).toEqual({ positive: '1girl', negative: 'bad anatomy, [watermark]', warnings: ['Group hair: missing selected member z'] });
    workspace.groups[0]!.selectedMemberId = null;
    expect(compileWorkspace(workspace).warnings).toEqual([]);
  });
  it('honors a local empty override and keeps group/member order per channel', () => {
    const workspace = demo();
    workspace.groups[0]!.members[1]!.overrideRaw = '';
    workspace.groups[1]!.members[1]!.enabled = true;
    expect(compileWorkspace(workspace).positive).toBe('1girl, {{detailed}}, 1.2::lighting::, city street');
    workspace.groups.reverse();
    workspace.groups[1]!.members.reverse();
    expect(compileWorkspace(workspace).positive).toBe('1girl, city street, {{detailed}}, 1.2::lighting::');
    expect(compileWorkspace(workspace).negative).toBe('bad anatomy, [watermark]');
  });
});
