import { describe, expect, it } from 'vitest';
import initialFixture from '../fixtures/sample-library-v1.json';
import { emptyData } from '../../src/core/commands';
import { exportBackup, prepareImport } from '../../src/data/backup';
import { MAX_BYTES, MAX_DEPTH, parseBackup, validateData } from '../../src/data/validation';
import { fixture, timestamp } from './helpers';

describe('backup validation / AC08, AC09', () => {
  it('round-trips all P1 assets, exact raw, IDs, descriptions and settings', () => {
    const data = fixture();
    data.libraryEntries[0]!.raw = '  {{髪}}, [tag], 1.2::light:: | !macro:Name!\n🌟  ';
    data.libraryEntries[0]!.title = '日本語, 名前 🌟';
    expect(parseBackup(exportBackup(data, timestamp)).payload).toEqual(data);
    expect(prepareImport(emptyData(), parseBackup(exportBackup(data, timestamp)).payload, 'replace')).toEqual(data);
  });
  it('accepts the supplied v1 kit fixture, normalizing missing categories/settings only', () => {
    const parsed = parseBackup(JSON.stringify(initialFixture));
    expect(parsed.payload.categories).toEqual([]);
    expect(parsed.payload.settings).toEqual(emptyData().settings);
    expect(parsed.payload.libraryEntries[0]!.title).toBe('黒髪ロング');
  });
  it('preserves unknown safe fields on records, settings and payload', () => {
    const data = fixture();
    Object.assign(data.libraryEntries[0]!, { future: { memo: '<script>alert(1)</script>' } });
    Object.assign(data.settings, { theme: 'future' });
    data.extension = { notes: ['safe'] };
    const result = parseBackup(exportBackup(data, timestamp));
    expect(result.payload).toEqual(data);
  });
  it.each(['{', 'null', '[]', '{}', '"text"'])('rejects invalid JSON/document: %s', text => {
    expect(() => parseBackup(text)).toThrow();
  });
  it.each(['format', 'schemaVersion', 'exportedAt'])('rejects invalid envelope %s', key => {
    const document = JSON.parse(exportBackup(fixture(), timestamp)) as Record<string, unknown>;
    document[key] = key === 'schemaVersion' ? 999 : 'invalid';
    expect(() => parseBackup(JSON.stringify(document))).toThrow(key);
  });
  it.each([
    (data: ReturnType<typeof fixture>) => { data.libraryEntries[0]!.id = 'not-uuid'; },
    (data: ReturnType<typeof fixture>) => { data.libraryEntries[0]!.createdAt = 'not-date'; },
    (data: ReturnType<typeof fixture>) => { data.libraryEntries[0]!.categoryId = '00000000-0000-4000-8000-999999999999'; },
    (data: ReturnType<typeof fixture>) => { data.workspaces[0]!.groups[0]!.selectedMemberId = 'missing'; },
    (data: ReturnType<typeof fixture>) => { data.settings.activeWorkspaceId = 'missing'; },
    (data: ReturnType<typeof fixture>) => { delete (data.workspaces[0]!.groups[0]!.members[0] as unknown as Record<string, unknown>).rawSnapshot; },
    (data: ReturnType<typeof fixture>) => { (data.workspaces[0]!.groups[0] as unknown as Record<string, unknown>).enabled = 'true'; },
    (data: ReturnType<typeof fixture>) => { data.libraryEntries[0]!.tags = Array.from({ length: 101 }, () => 'tag'); },
  ])('rejects malformed record fields and dangling structural references', mutate => {
    const data = fixture(); mutate(data); expect(() => validateData(data)).toThrow();
  });
  it('permits deleted entry snapshots and empty local overrides', () => {
    const data = fixture(); data.libraryEntries = [];
    data.workspaces[0]!.groups[0]!.members[0]!.overrideRaw = '';
    expect(validateData(data)).toEqual(data);
  });
  it('rejects duplicate IDs both within and across all instance collections', () => {
    const data = fixture();
    data.libraryEntries.push(structuredClone(data.libraryEntries[0]!));
    expect(() => validateData(data)).toThrow('重複ID');
    data.libraryEntries.pop();
    data.workspaces[0]!.groups[1]!.id = data.workspaces[0]!.groups[0]!.id;
    expect(() => validateData(data)).toThrow('重複ID');
  });
  it('merge is non-destructive, accepts new IDs and rejects conflicts before changing input', () => {
    const current = fixture();
    const original = structuredClone(current);
    expect(() => prepareImport(current, current, 'merge')).toThrow('重複ID');
    expect(current).toEqual(original);
    const added = emptyData();
    added.libraryEntries.push({ ...current.libraryEntries[0]!, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', categoryId: null });
    const merged = prepareImport(current, added, 'merge');
    expect(merged.libraryEntries).toHaveLength(6);
    expect(merged.settings).toEqual(current.settings);
    expect(current).toEqual(original);
  });
  it('rejects oversized UTF-8 before JSON parsing and excessive depth', () => {
    expect(() => parseBackup('🌟'.repeat(MAX_BYTES / 4 + 1))).toThrow('10MiB');
    expect(() => parseBackup('['.repeat(MAX_DEPTH + 2) + '0' + ']'.repeat(MAX_DEPTH + 2))).toThrow('深さ');
  });
  it('rejects excessive record count, dangerous keys and malformed comparison assets', () => {
    const data = emptyData();
    data.libraryEntries = Array.from({ length: 10_001 }, () => fixture().libraryEntries[0]!);
    expect(() => validateData(data)).toThrow('10000');
    for (const key of ['__proto__', 'constructor', 'prototype']) expect(() => parseBackup(`{"${key}":{}}`)).toThrow('危険');
    expect(() => validateData({ ...fixture(), experiments: [{ id: 'later' }] })).toThrow('UUID');
  });
  it('rejects oversized live state rather than generating an unimportable backup', () => {
    const data = fixture();
    data.padding = 'x'.repeat(MAX_BYTES);
    expect(() => exportBackup(data, timestamp)).toThrow('10MiB');
  });
  it('counts the total records across collections, not just each individual array', () => {
    const data = emptyData();
    const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const entry = fixture().libraryEntries[0]!;
    data.libraryEntries = Array.from({ length: 5001 }, (_, i) => ({ ...entry, id: id(i), categoryId: null }));
    data.categories = Array.from({ length: 5000 }, (_, i) => ({ id: id(i + 6000), name: 'category' }));
    expect(() => validateData(data)).toThrow('レコード総数');
  });
  it('rejects normalized invalid calendar dates', () => {
    const data = fixture(); data.libraryEntries[0]!.createdAt = '2026-02-31T00:00:00Z';
    expect(() => validateData(data)).toThrow('存在しない日時');
  });
  it('merge preserves existing unknown payload fields while importing new safe fields', () => {
    const current = fixture(); current.notes = 'keep';
    const incoming = emptyData(); incoming.notes = 'incoming'; incoming.future = { safe: true };
    const result = prepareImport(current, incoming, 'merge');
    expect(result.notes).toBe('keep'); expect(result.future).toEqual({ safe: true });
  });
});
