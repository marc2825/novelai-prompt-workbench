import { describe, expect, it } from 'vitest';
import {
  applyCompletion, buildTagIndex, collectLibraryTags, completionTokenAt, extractPromptTags, normalizeTag, reviewLibraryTags, suggestTags,
  TAG_LIMITS, tagTextIssue, type TagIndex,
} from '../../src/core/tags';
import type { TagDictionaryEntry } from '../../src/core/types';
import { timestamp } from './helpers';

const uuid = (n: number) => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`;
const entry = (n: number, tag: string, aliases: string[] = [], note = ''): TagDictionaryEntry => ({ id: uuid(n), tag, aliases, note, createdAt: timestamp, updatedAt: timestamp });
const library = (...raws: string[]) => raws.map((raw, index) => ({ id: uuid(1000 + index), raw }));
/** The caret is marked with ‸. */
function at(marked: string) { const caret = marked.indexOf('‸'); return { text: marked.replace('‸', ''), caret }; }
function token(marked: string) { const { text, caret } = at(marked); return completionTokenAt(text, caret); }
const tags = (index: TagIndex, query: string, limit?: number) => suggestTags(index, query, limit).map(item => item.tag);

describe('normalizeTag (表記ゆれ)', () => {
  it.each([
    ['Long_Hair', 'long hair'], ['long   hair', 'long hair'], ['  long hair  ', 'long hair'], ['ｌｏｎｇ＿ｈａｉｒ', 'long hair'],
    ['long　hair', 'long hair'], ['BLONDE hair', 'blonde hair'], ['金髪', '金髪'], ['ｶﾀｶﾅ', 'カタカナ'], ['1GIRL', '1girl'], ['artist:Name', 'artist:name'],
  ])('%j → %j', (input, expected) => { expect(normalizeTag(input)).toBe(expected); });
  it('rejects text that is not a single plain tag for the dictionary', () => {
    expect(tagTextIssue('silver hair')).toBeNull();
    expect(tagTextIssue('artist:name (cosplay)')).toBeNull();
    for (const bad of ['', '  ', ' padded', 'a, b', 'a\nb', '{tag}', '[tag]', 'a|b', '1.2::tag::', 'a\\b', '___', 'x'.repeat(TAG_LIMITS.tag + 1)]) expect(tagTextIssue(bad), bad).not.toBeNull();
  });
});

describe('completionTokenAt: only plain tag positions', () => {
  it.each([
    ['bl‸', 0, 'bl'], ['1girl, bl‸', 7, 'bl'], ['1girl,bl‸', 6, 'bl'], ['1girl\nbl‸', 6, 'bl'], ['{{bl‸', 2, 'bl'], ['{{bl‸}}', 2, 'bl'],
    ['[bl‸]', 1, 'bl'], ['1.2::bl‸', 5, 'bl'], ['1.2::bl‸::', 5, 'bl'], ['-1::bl‸::, x', 4, 'bl'], ['1.2::{bl‸}::', 6, 'bl'], ['long ha‸', 0, 'long ha'],
    ['long ‸', 0, 'long '], ['a, 1gi‸', 3, '1gi'], ['artist:na‸', 0, 'artist:na'], ['hatsune miku (vo‸', 0, 'hatsune miku (vo'], ['銀‸', 0, '銀'],
    ['a | bl‸', 4, 'bl'], ['||red|blue||, bl‸', 14, 'bl'], ['1.2::red, bl‸::', 10, 'bl'],
  ])('%j → start %i, query %j', (marked, start, query) => {
    const { caret } = at(marked);
    expect(token(marked)).toEqual({ start, end: caret, query });
  });
  it.each([
    ['‸'], ['1girl, ‸'], ['1girl,‸'], ['bl‸ond'], ['bl‸ hair'], ['bl‸, x'.replace(', x', 'x')],
    ['||red, bl‸||'], ['||bl‸'], ['a, ||b|c‸||'], ['!macro:Na‸'], ['x!‸'], ['{tag}‸'], ['[tag]‸'], ['1.2::tag::‸'], ['tag::bl‸'],
    ['a {bl‸'], ['esc\\a‸'], ['{{‸'], ['1.2::‸'], ['x'.repeat(300) + '‸'],
  ])('%j → null', marked => { expect(token(marked)).toBeNull(); });
  it('rejects invalid carets and a caret inside a surrogate pair', () => {
    expect(completionTokenAt('bl', -1)).toBeNull();
    expect(completionTokenAt('bl', 3)).toBeNull();
    expect(completionTokenAt('bl', 1.5)).toBeNull();
    expect(completionTokenAt('a🌟', 2)).toBeNull();
    expect(completionTokenAt('a🌟', 3)).toEqual({ start: 0, end: 3, query: 'a🌟' });
  });
  it('accepting replaces only the partial token and keeps weights, braces and the rest verbatim', () => {
    for (const [marked, tag, expected] of [
      ['1.2::bl‸::, {{x}}', 'blonde hair', '1.2::blonde hair::, {{x}}'],
      ['{{bl‸}}, ||a|b||', 'black hair', '{{black hair}}, ||a|b||'],
      ['  1girl,  [Lo‸]\n!macro:X!', 'long hair', '  1girl,  [long hair]\n!macro:X!'],
    ] as const) {
      const { text, caret } = at(marked);
      const found = completionTokenAt(text, caret)!;
      const result = applyCompletion(text, found, tag);
      expect(result.text).toBe(expected);
      expect(result.text.slice(0, found.start) + result.text.slice(result.caret)).toBe(text.slice(0, found.start) + text.slice(found.end));
      expect(result.caret).toBe(found.start + tag.length);
    }
    expect(() => applyCompletion('changed', { start: 0, end: 2, query: 'bl' }, 'black hair')).toThrow('入力欄が変わりました');
  });
});

describe('library tags', () => {
  it('extracts plain tags without weight/brace wrappers and skips other syntax', () => {
    expect(extractPromptTags('  {{black hair}}, long hair\n1.2::blue eyes::, [watermark], -1::bad::, 0.5::red hair, green eyes::'))
      .toEqual(['black hair', 'long hair', 'blue eyes', 'watermark', 'bad', 'red hair', 'green eyes']);
    expect(extractPromptTags('||red, blue|green||, cat, !macro:Name!, a|b, esc\\, {a {b}}, 1.2, , 1.2::x::y::, dog')).toEqual(['cat', 'dog']);
    expect(extractPromptTags(`${'word '.repeat(30)}, ok`)).toEqual(['ok']);
  });
  it('groups spellings by normalized form, preferring the most frequent spelling', () => {
    const collected = collectLibraryTags(library('long_hair, Long Hair', 'long hair, long hair', 'cat'));
    expect(collected).toEqual([
      { tag: 'cat', key: 'cat', count: 1, spellings: [{ text: 'cat', count: 1 }] },
      { tag: 'long hair', key: 'long hair', count: 4, spellings: [{ text: 'long hair', count: 2 }, { text: 'Long Hair', count: 1 }, { text: 'long_hair', count: 1 }] },
    ]);
  });
});

describe('suggestTags', () => {
  const dictionary = [entry(1, 'silver hair', ['銀髪', 'gin'], '髪色'), entry(2, 'blonde hair', ['金髪']), entry(3, 'blue eyes')];
  const index = buildTagIndex(dictionary, collectLibraryTags(library('{{black hair}}, long hair, blonde_hair', 'short hair, blue sky', 'black hair, 金髪, night')));

  it('ranks the user dictionary first, then library tags by frequency; dictionary spellings win', () => {
    // Dictionary: shorter key first. Library: "black hair" (2×) before the shorter "blue sky" (1×).
    expect(tags(index, 'bl')).toEqual(['blue eyes', 'blonde hair', 'black hair', 'blue sky']);
    expect(suggestTags(index, 'bl')[2]).toEqual({ tag: 'black hair', source: 'library', count: 2 });
    // "blonde_hair" in the library is the dictionary tag; "金髪" is a dictionary alias.
    expect(tags(index, 'blonde')).toEqual(['blonde hair']);
    expect(suggestTags(index, '金')).toEqual([{ tag: 'blonde hair', source: 'dictionary', alias: '金髪' }]);
  });
  it('matches aliases, word starts and 表記ゆれ of the query', () => {
    expect(suggestTags(index, '銀')).toEqual([{ tag: 'silver hair', source: 'dictionary', alias: '銀髪', note: '髪色' }]);
    expect(suggestTags(index, 'GIN')[0]).toMatchObject({ tag: 'silver hair', alias: 'gin' });
    expect(tags(index, 'ｈａｉｒ')).toEqual(['silver hair', 'blonde hair', 'black hair', 'long hair', 'short hair']);
    expect(tags(index, 'Long_')).toEqual(['long hair']);
    expect(tags(index, 'long ')).toEqual(['long hair']);
    expect(tags(index, 'Short Hair')).toEqual(['short hair']);
  });
  it('omits a no-op suggestion, respects the limit and returns nothing for empty queries', () => {
    expect(tags(index, 'short hair')).toEqual([]);
    expect(tags(index, 'b', 2)).toEqual(['blue eyes', 'blonde hair']);
    expect(tags(index, '')).toEqual([]);
    expect(tags(index, '   ')).toEqual([]);
    expect(tags(index, 'zzz')).toEqual([]);
    expect(tags(buildTagIndex([], []), 'a')).toEqual([]);
  });
  it('is deterministic regardless of library order', () => {
    const reversed = buildTagIndex([...dictionary].reverse(), collectLibraryTags(library('black hair, 金髪, night', 'short hair, blue sky', '{{black hair}}, long hair, blonde_hair')));
    expect(tags(reversed, 'bl')).toEqual(tags(index, 'bl'));
  });
  it('stays fast with a 10,000-tag dictionary and a large library (generous perf guard)', () => {
    const big = Array.from({ length: TAG_LIMITS.entries }, (_, n) => entry(n, `tag ${n.toString(36)} word${n % 97}`, [`alias${n}`, `別名${n}`]));
    const raws = Array.from({ length: 2000 }, (_, n) => Array.from({ length: 20 }, (_, k) => `lib${(n * 20 + k) % 7919} tag, {{x${k}}}`).join(', '));
    const started = performance.now();
    const built = buildTagIndex(big, collectLibraryTags(raws.map(raw => ({ raw }))));
    const buildMs = performance.now() - started;
    const queries = ['t', 'ta', 'tag 1', 'a', 'alias9', '別', 'lib', 'word5', 'x', 'zz'];
    const searchStarted = performance.now();
    for (let round = 0; round < 100; round++) for (const query of queries) expect(suggestTags(built, query).length).toBeLessThanOrEqual(TAG_LIMITS.suggestions);
    const perQuery = (performance.now() - searchStarted) / 1000;
    console.log(`[perf] tag index: build ${buildMs.toFixed(0)} ms for ${built.tiers.reduce((sum, tier) => sum + tier.length, 0)} keys, ${perQuery.toFixed(3)} ms per suggestion query`);
    expect(suggestTags(built, 'alias9999')[0]).toMatchObject({ tag: `tag ${(9999).toString(36)} word${9999 % 97}`, alias: 'alias9999' });
    expect(buildMs).toBeLessThan(5000);
    expect(perQuery).toBeLessThan(20);
  });
});

describe('reviewLibraryTags (read-only 表記ゆれ・重複)', () => {
  const entries = library('long_hair, black hair, 1girl, 1girl', 'Long Hair, 金髪, blonde_hair', 'long hair, cat, CAT');
  const dictionary = [entry(1, 'blonde hair', ['金髪'])];
  it('groups spellings, flags dictionary aliases/spellings and duplicates inside one entry', () => {
    const review = reviewLibraryTags(entries, dictionary);
    expect(review.variants).toEqual([
      { key: 'long hair', preferred: [], spellings: [{ text: 'Long Hair', count: 1, entryIds: [uuid(1001)] }, { text: 'long hair', count: 1, entryIds: [uuid(1002)] }, { text: 'long_hair', count: 1, entryIds: [uuid(1000)] }] },
      { key: 'cat', preferred: [], spellings: [{ text: 'CAT', count: 1, entryIds: [uuid(1002)] }, { text: 'cat', count: 1, entryIds: [uuid(1002)] }] },
      { key: 'blonde hair', preferred: ['blonde hair'], spellings: [{ text: 'blonde_hair', count: 1, entryIds: [uuid(1001)] }] },
      { key: '金髪', preferred: ['blonde hair'], spellings: [{ text: '金髪', count: 1, entryIds: [uuid(1001)] }] },
    ]);
    expect(review.duplicates).toEqual([{ entryId: uuid(1000), tag: '1girl', count: 2 }, { entryId: uuid(1002), tag: 'cat', count: 2 }]);
    expect(review.truncated).toBe(false);
  });
  it('reports nothing for consistent spellings and limits the output', () => {
    expect(reviewLibraryTags(library('black hair', 'black hair, cat'), [])).toEqual({ variants: [], duplicates: [], truncated: false });
    const many = library(...Array.from({ length: 5 }, (_, n) => `t${n}, T${n}, d${n}, d${n}`));
    const limited = reviewLibraryTags(many, [], 3);
    expect(limited.variants).toHaveLength(3);
    expect(limited.duplicates).toHaveLength(3);
    expect(limited.truncated).toBe(true);
  });
  it('does not modify its input', () => {
    const frozen = Object.freeze(entries.map(item => Object.freeze({ ...item })));
    expect(() => reviewLibraryTags(frozen, Object.freeze([Object.freeze(dictionary[0]!)]))).not.toThrow();
  });
});
