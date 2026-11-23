import { describe, expect, it } from 'vitest';
import { compileSegments, compileWorkspace } from '../../src/core/compose';
import type { PromptWorkspace } from '../../src/core/types';
import { fixture } from './helpers';

const join = (segments: { text: string }[]) => segments.map(segment => segment.text).join('');

function workspaceWith(groups: { channel: 'positive' | 'negative'; raws: string[]; mode?: 'multi' | 'exclusive'; enabled?: boolean }[], freeform = ''): PromptWorkspace {
  let n = 0; const id = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, '0')}`;
  return {
    id: id(), title: 'w', updatedAt: '2026-11-23T00:00:00.000Z', freeformPositive: freeform, freeformNegative: '',
    groups: groups.map((group, index) => {
      const members = group.raws.map(raw => ({ id: id(), entryId: id(), enabled: true, rawSnapshot: raw }));
      return { id: `group-${index}`, name: `g${index}`, channel: group.channel, mode: group.mode ?? 'multi', enabled: group.enabled ?? true, selectedMemberId: group.mode === 'exclusive' ? members[0]?.id ?? null : null, members };
    }),
  } as PromptWorkspace;
}

describe('compileSegments (colored output)', () => {
  it('joins to exactly the compiled prompt, with each run attributed to its group', () => {
    const workspace = workspaceWith([{ channel: 'positive', raws: ['{black hair}, long hair'] }, { channel: 'positive', raws: ['night', 'city lights'] }, { channel: 'negative', raws: ['lowres'] }], '1girl');
    const segments = compileSegments(workspace); const compiled = compileWorkspace(workspace);
    expect(join(segments.positive)).toBe(compiled.positive);
    expect(join(segments.negative)).toBe(compiled.negative);
    expect(segments.positive.filter(item => !item.separator).map(item => [item.text, item.groupId])).toEqual([['1girl', null], ['{black hair}, long hair', 'group-0'], ['night', 'group-1'], ['city lights', 'group-1']]);
    expect(segments.positive.filter(item => item.separator).map(item => item.text)).toEqual([', ', ', ', ', ']);
  });
  it('keeps the exact joining rules for leading/trailing commas, blanks, disabled groups and exclusive choices', () => {
    const cases = [
      workspaceWith([{ channel: 'positive', raws: ['a,', ', b', ',c', '  ', 'd'] }]),
      workspaceWith([{ channel: 'positive', raws: ['x'], enabled: false }, { channel: 'positive', raws: ['y', 'z'], mode: 'exclusive' }], 'free, '),
      workspaceWith([{ channel: 'negative', raws: ['  spaced  ', '', 'end,'] }]),
      workspaceWith([]),
    ];
    for (const workspace of cases) {
      const segments = compileSegments(workspace); const compiled = compileWorkspace(workspace);
      expect(join(segments.positive)).toBe(compiled.positive);
      expect(join(segments.negative)).toBe(compiled.negative);
    }
    expect(compileSegments(cases[1]!).positive.filter(item => item.groupId === 'group-0')).toEqual([]);
    expect(compileSegments(cases[3]!)).toEqual({ positive: [], negative: [] });
  });
  it('matches the compiled demo workspace', () => {
    for (const workspace of fixture().workspaces) {
      const segments = compileSegments(workspace); const compiled = compileWorkspace(workspace);
      expect(join(segments.positive)).toBe(compiled.positive);
      expect(join(segments.negative)).toBe(compiled.negative);
    }
  });
});
