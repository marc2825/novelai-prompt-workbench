import { describe, expect, it } from 'vitest';
import { applyTagWeight, previewTagWeight, selectTagWeight } from '../../src/core/weights';
import { captureVariant } from '../../src/core/experiments';
import { compileWorkspace } from '../../src/core/compose';
import { record, redo, startHistory, undo } from '../../src/core/history';
import { validateData } from '../../src/data/validation';
import { fixture } from './helpers';

const select = (raw: string, text: string, from = 0) => {
  const start = raw.indexOf(text, from);
  return selectTagWeight(raw, start, start + text.length);
};

describe('explicit tag weight editing', () => {
  it('changes only the selected duplicate and preserves whitespace, separators and Unicode', () => {
    const source = '  猫🌟, blue eyes ,  blue eyes,  portrait  ';
    const target = select(source, '  blue eyes', source.indexOf('blue eyes') + 1);
    expect(target.text).toBe('blue eyes');
    expect(applyTagWeight(source, target, 1.25)).toBe('  猫🌟, blue eyes ,  1.25::blue eyes::,  portrait  ');
    expect(previewTagWeight(target, 1)).toBe(source);
  });

  it('replaces an explicitly selected numeric wrapper without accumulating wrappers', () => {
    const source = 'a, 1.20::blue eyes::, 0.7::cat::';
    const target = select(source, '1.20::blue eyes::');
    expect(target.weight).toBe(1.2);
    expect(previewTagWeight(target, 1.2)).toBe(source);
    expect(previewTagWeight(target, 0.5)).toBe('a, 0.5::blue eyes::, 0.7::cat::');
    expect(previewTagWeight(target, 1.5)).toBe('a, 1.5::blue eyes::, 0.7::cat::');
    expect(previewTagWeight(target, 1)).toBe('a, blue eyes, 0.7::cat::');
  });

  it('supports independent weights in both preceding and following context', () => {
    const source = '0.5::a::,  blue eyes,  1.5::cat::, 日本語';
    expect(previewTagWeight(select(source, 'blue eyes'), 2)).toBe('0.5::a::,  2::blue eyes::,  1.5::cat::, 日本語');
  });

  it('keeps zero as a weight and formats fractional slider values deterministically', () => {
    const target = select('🌟 猫', '🌟 猫');
    expect(previewTagWeight(target, 0)).toBe('0::🌟 猫::');
    expect(previewTagWeight(target, 0.1 + 0.2)).toBe('0.3::🌟 猫::');
  });

  it.each([
    ['blue eyes', 'blue'], ['blue eyes, cat', 'eyes'], ['blue eyes, cat', 'blue eyes, cat'],
    ['a, , b', ','], ['1.2::blue eyes::', 'blue eyes'], ['a, {blue eyes}, b', '{blue eyes}'],
    ['a, [blue eyes], b', '[blue eyes]'], ['a, ||red|blue||, b', '||red|blue||'],
    ['a, !macro:Name!, b', '!macro:Name!'], ['a, 1.2::b, c::', '1.2::b, c::'],
    ['a, 2.1::b::', '2.1::b::'], ['a, -0.5::b::', '-0.5::b::'],
  ])('rejects partial, multi-tag or unsupported selections: %s / %s', (source, text) => {
    expect(() => select(source, text)).toThrow();
  });

  it.each(['{a, b, c}', '[a, b, c]', '1.2::a, b, c::', 'a | x, b, c', '!macro:X!, b, c', 'a\nb, b, c', 'a\\, b, c'])('rejects ambiguous surrounding syntax without editing: %s', source => {
    expect(() => select(source, 'b', source.indexOf(',') + 1)).toThrow();
  });

  it.each([[0, 0], [-1, 2], [0, 100], [0.5, 2], [0, NaN], [1, 2], [0, 1]])('rejects invalid or split-Unicode offsets %s..%s', (start, end) => {
    expect(() => selectTagWeight('🌟 cat', start, end)).toThrow();
  });

  it.each([NaN, Infinity, -0.01, 2.01, 1.234])('rejects invalid weight %s', weight => {
    expect(() => previewTagWeight(select('cat', 'cat'), weight)).toThrow();
  });

  it('rejects stale text and excessive output length', () => {
    expect(() => applyTagWeight('changed', select('cat', 'cat'), 1.2)).toThrow('原文が変わりました');
    const raw = 'x'.repeat(1_000_000);
    expect(() => previewTagWeight(selectTagWeight(raw, 0, raw.length), 1.2)).toThrow('上限');
  });

  it('uses ordinary raw snapshots, preserving other channels, library and undo/redo', () => {
    const data = fixture(); const original = structuredClone(data);
    const workspace = data.workspaces[0]!;
    const raw = workspace.freeformPositive;
    const weighted = previewTagWeight(selectTagWeight(raw, 0, raw.length), 1.3);
    const changed = { ...workspace, freeformPositive: weighted };
    const history = record(startHistory(workspace), changed);
    expect(undo(history).present).toEqual(workspace);
    expect(redo(undo(history)).present).toEqual(changed);
    expect(compileWorkspace(changed).negative).toBe(compileWorkspace(workspace).negative);
    const snapshot = captureVariant('a', 'A', changed, null);
    expect(snapshot.compiled.positive).toContain(weighted);
    expect(validateData({ ...data, workspaces: [changed] }).workspaces[0]!.freeformPositive).toBe(weighted);
    expect(data).toEqual(original);
  });
});
