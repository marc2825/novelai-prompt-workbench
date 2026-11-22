import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { emptyData } from '../../src/core/commands';
import { TAG_LIMITS } from '../../src/core/tags';
import type { TagDictionaryEntry, WorkbenchData } from '../../src/core/types';
import { exportBackup, prepareImport } from '../../src/data/backup';
import { countsOf, exportFullBackup, inspectFullBackup } from '../../src/data/full-backup';
import { WorkbenchRepository } from '../../src/data/repository';
import { parseBackup, validateData } from '../../src/data/validation';
import { fixture, timestamp } from './helpers';

const uuid = (n: number) => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, '0')}`;
const entry = (n: number, tag: string, aliases: string[] = [], note = ''): TagDictionaryEntry => ({ id: uuid(n), tag, aliases, note, createdAt: timestamp, updatedAt: timestamp });
function withDictionary(entries: TagDictionaryEntry[] = [entry(1, 'silver hair', ['銀髪', 'gin'], '髪色'), entry(2, 'blonde hair', ['金髪'])]): WorkbenchData {
  return { ...fixture(), tagDictionary: { schemaVersion: 1, entries } };
}
type Mutable = Record<string, unknown> & { tagDictionary: { schemaVersion: unknown; entries: Record<string, unknown>[] } };

describe('tag dictionary data', () => {
  it('old data without a dictionary or completion setting stays valid and unchanged', () => {
    const data = fixture();
    const validated = validateData(data);
    expect(validated).toEqual(data);
    expect('tagDictionary' in validated).toBe(false);
    expect(validated.settings.tagCompletion).toBeUndefined();
    expect(parseBackup(exportBackup(data, timestamp)).payload).toEqual(data);
  });

  it('round-trips through JSON backup, preserving unknown safe fields and the completion setting', () => {
    const data = withDictionary();
    data.settings.tagCompletion = false;
    Object.assign(data.tagDictionary!, { future: { safe: true } });
    Object.assign(data.tagDictionary!.entries[0]!, { color: 'blue' });
    const parsed = parseBackup(exportBackup(data, timestamp)).payload;
    expect(parsed).toEqual(data);
    expect(prepareImport(emptyData(), parsed, 'replace')).toEqual(data);
  });

  it('round-trips through IndexedDB (stored with the other payload fields in one save)', async () => {
    const data = withDictionary();
    data.settings.tagCompletion = false;
    let repository = await WorkbenchRepository.open('tags', new IDBFactory());
    const revision = await repository.save(data, 0);
    expect((await repository.load()).data).toEqual(data);
    const edited = validateData({ ...data, tagDictionary: { schemaVersion: 1, entries: [...data.tagDictionary!.entries, entry(3, 'red eyes')] } });
    await repository.save(edited, revision);
    const loaded = await repository.load();
    expect(loaded.data.tagDictionary!.entries.map(item => item.tag)).toEqual(['silver hair', 'blonde hair', 'red eyes']);
    repository.close();
  });

  it('round-trips through the complete backup without changing the manifest counts keys', async () => {
    const data = validateData(withDictionary());
    const exported = await exportFullBackup(data, { image: async () => undefined }, timestamp);
    expect(Object.keys(exported.manifest.counts)).toEqual(Object.keys(countsOf(fixture())));
    expect(Object.keys(exported.manifest.counts)).not.toContain('tagDictionary');
    const inspected = await inspectFullBackup(exported.blob);
    expect(inspected.document.payload).toEqual(data);
  });

  it('merge appends entries, keeps current entries first and rejects ID or tag collisions', () => {
    const current = withDictionary();
    const incoming = { ...emptyData(), tagDictionary: { schemaVersion: 1 as const, entries: [entry(10, 'red eyes', ['赤目'])] } };
    const merged = prepareImport(current, incoming, 'merge');
    expect(merged.tagDictionary!.entries.map(item => item.tag)).toEqual(['silver hair', 'blonde hair', 'red eyes']);
    expect(prepareImport(emptyData(), incoming, 'merge').tagDictionary).toEqual(incoming.tagDictionary);
    expect(prepareImport(fixture(), emptyData(), 'merge')).not.toHaveProperty('tagDictionary');
    expect(() => prepareImport(current, current, 'merge')).toThrow('重複ID');
    const sameTag = { ...emptyData(), tagDictionary: { schemaVersion: 1 as const, entries: [entry(11, 'Silver_Hair')] } };
    expect(() => prepareImport(current, sameTag, 'merge')).toThrow('同じタグ');
    const aliasClash = { ...emptyData(), tagDictionary: { schemaVersion: 1 as const, entries: [entry(12, '銀髪')] } };
    expect(() => prepareImport(current, aliasClash, 'merge')).toThrow('別の項目のタグ');
  });

  it('dictionary IDs share the global ID scope', () => {
    const data = withDictionary();
    data.tagDictionary!.entries[0]!.id = data.libraryEntries[0]!.id;
    expect(() => validateData(data)).toThrow('重複ID');
    const twice = withDictionary([entry(1, 'a'), entry(1, 'b')]);
    expect(() => validateData(twice)).toThrow('重複ID');
  });

  it.each<[string, (data: Mutable) => void, string]>([
    ['unknown schemaVersion', data => { data.tagDictionary.schemaVersion = 2; }, 'バージョン'],
    ['not an object', data => { (data as Record<string, unknown>).tagDictionary = []; }, 'オブジェクト'],
    ['entries missing', data => { delete (data.tagDictionary as Record<string, unknown>).entries; }, '配列'],
    ['invalid ID', data => { data.tagDictionary.entries[0]!.id = 'x'; }, 'UUID'],
    ['empty tag', data => { data.tagDictionary.entries[0]!.tag = ' '; }, '空のタグ'],
    ['untrimmed tag', data => { data.tagDictionary.entries[0]!.tag = ' silver hair'; }, '前後に空白'],
    ['tag with a comma', data => { data.tagDictionary.entries[0]!.tag = 'a, b'; }, 'カンマ'],
    ['tag with weight syntax', data => { data.tagDictionary.entries[0]!.tag = '1.2::a::'; }, '::'],
    ['tag with braces', data => { data.tagDictionary.entries[0]!.tag = '{a}'; }, 'カンマ'],
    ['too long tag', data => { data.tagDictionary.entries[0]!.tag = 'x'.repeat(TAG_LIMITS.tag + 1); }, `${TAG_LIMITS.tag}`],
    ['non-string tag', data => { data.tagDictionary.entries[0]!.tag = 42; }, '文字列'],
    ['duplicate tag after normalization', data => { data.tagDictionary.entries[1]!.tag = 'ＳＩＬＶＥＲ＿ＨＡＩＲ'; }, '同じタグ'],
    ['alias equal to its own tag', data => { data.tagDictionary.entries[0]!.aliases = ['Silver_Hair']; }, '同じ表記'],
    ['duplicate alias in one entry', data => { data.tagDictionary.entries[0]!.aliases = ['gin', 'GIN']; }, '同じ表記'],
    ['alias equal to another tag', data => { data.tagDictionary.entries[0]!.aliases = ['blonde hair']; }, '別の項目のタグ'],
    ['aliases not an array', data => { data.tagDictionary.entries[0]!.aliases = 'gin'; }, '配列'],
    ['too many aliases', data => { data.tagDictionary.entries[0]!.aliases = Array.from({ length: TAG_LIMITS.aliasesPerEntry + 1 }, (_, n) => `a${n}`); }, `${TAG_LIMITS.aliasesPerEntry}`],
    ['invalid alias', data => { data.tagDictionary.entries[0]!.aliases = ['a|b']; }, 'カンマ'],
    ['too long note', data => { data.tagDictionary.entries[0]!.note = 'x'.repeat(TAG_LIMITS.note + 1); }, `${TAG_LIMITS.note}`],
    ['missing note', data => { delete data.tagDictionary.entries[0]!.note; }, '文字列'],
    ['invalid date', data => { data.tagDictionary.entries[0]!.updatedAt = '2026-02-31T00:00:00Z'; }, '存在しない日時'],
    ['non-boolean completion setting', data => { (data.settings as Record<string, unknown>).tagCompletion = 'yes'; }, '真偽値'],
  ])('rejects corruption: %s', (_name, mutate, message) => {
    const data = structuredClone(withDictionary()) as unknown as Mutable;
    mutate(data);
    expect(() => validateData(data)).toThrow(message);
    expect(() => parseBackup(JSON.stringify({ format: 'nai-prompt-workbench', schemaVersion: 3, exportedAt: timestamp, payload: data }))).toThrow(message);
  });

  it('enforces the entry and total alias limits with explicit errors', () => {
    const tooMany = withDictionary(Array.from({ length: TAG_LIMITS.entries + 1 }, (_, n) => entry(n, `t${n}`)));
    expect(() => validateData(tooMany)).toThrow(`${TAG_LIMITS.entries}`);
    const aliases = Math.ceil((TAG_LIMITS.totalAliases + 1) / TAG_LIMITS.aliasesPerEntry);
    const tooManyAliases = withDictionary(Array.from({ length: aliases }, (_, n) => entry(n, `t${n}`, Array.from({ length: TAG_LIMITS.aliasesPerEntry }, (_, k) => `a${n}-${k}`))));
    expect(() => validateData(tooManyAliases)).toThrow(`合計${TAG_LIMITS.totalAliases}`);
  });

  it('a full 10,000-entry dictionary validates on every commit without counting against the library record limit', () => {
    const big = withDictionary(Array.from({ length: TAG_LIMITS.entries }, (_, n) => entry(n, `tag ${n}`, [`alias ${n}`, `別名${n}`], 'メモ')));
    validateData(big);
    const started = performance.now();
    for (let round = 0; round < 5; round++) validateData(big);
    const perCommit = (performance.now() - started) / 5;
    console.log(`[perf] validateData with a ${TAG_LIMITS.entries}-entry dictionary: ${perCommit.toFixed(1)} ms`);
    expect(perCommit).toBeLessThan(2000);
  });

  it('validated dictionaries are deep copies (input changes do not leak in)', () => {
    const data = withDictionary();
    const validated = validateData(data);
    data.tagDictionary!.entries[0]!.tag = 'changed';
    expect(validated.tagDictionary!.entries[0]!.tag).toBe('silver hair');
  });
});
