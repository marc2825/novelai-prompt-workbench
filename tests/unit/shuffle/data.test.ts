import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { advanceShuffle, getShuffle, removeCharacter, addDefaultLibrary, emptyShuffle } from '../../../src/core/shuffle/state';
import { SHUFFLE_SCHEMA_VERSION, type ShuffleData } from '../../../src/core/shuffle/types';
import { exportBackup, prepareImport } from '../../../src/data/backup';
import { WorkbenchRepository } from '../../../src/data/repository';
import { exportShuffle, importShuffle, migrateShuffle, parseShuffleExport, quarantineShuffle, validateShuffleData } from '../../../src/data/shuffle';
import { parseBackup, validateData } from '../../../src/data/validation';
import { fixture } from '../helpers';
import { BASE, idFactory, pointingSetup } from './helpers';

const NOW = '2026-11-14T00:00:00.000Z';
function populated(): ShuffleData {
  const { shuffle, profile } = pointingSetup();
  const withDefaults = addDefaultLibrary(shuffle, idFactory('d'));
  const advanced = advanceShuffle({ ...fixture(), shuffle: withDefaults }, { profileId: profile.id, historyId: idFactory('h')(), now: NOW, trigger: 'manual', base: BASE });
  return getShuffle(advanced.data);
}

describe('shuffle data validation', () => {
  it('accepts a populated state, preserves unknown safe fields and returns a copy', () => {
    const shuffle = { ...populated(), futureField: { safe: true } } as ShuffleData;
    const validated = validateShuffleData(shuffle);
    expect(validated).toEqual(shuffle);
    expect(validated).not.toBe(shuffle);
    expect(validateData({ ...fixture(), shuffle }).shuffle).toEqual(shuffle);
  });

  it.each([
    ['unknown version', (s: any) => { s.schemaVersion = 99; }, 'バージョン'],
    ['duplicate ID across collections', (s: any) => { s.templates[0].id = s.characters[0].id; }, '重複ID'],
    ['dangling participant', (s: any) => { s.profiles[0].characterIds.push('00000000-0000-4000-8000-999999999999'); }, '存在しないキャラクター'],
    ['invalid weight', (s: any) => { s.pools[0].options[0].weight = -1; }, 'weight'],
    ['NaN weight', (s: any) => { s.templates[0].weight = Number.NaN; }, 'weight'],
    ['bad category', (s: any) => { s.pools[0].category = 'hair'; }, 'category'],
    ['empty seed', (s: any) => { s.profiles[0].settings.seed = '  '; }, 'Seed'],
    ['bad interval', (s: any) => { s.profiles[0].settings.autoEvery = 0; }, 'autoEvery'],
    ['template without roles', (s: any) => { s.templates[0].roles = []; }, '役割'],
    ['history of a missing profile', (s: any) => { s.history[0].profileId = '00000000-0000-4000-8000-999999999999'; }, 'プロファイル'],
    ['duplicate camera category', (s: any) => { s.cameraPresets[0].parts = [{ category: 'angle', prompt: 'a' }, { category: 'angle', prompt: 'b' }]; }, 'カテゴリ'],
    ['non-UUID ID', (s: any) => { s.characters[0].id = 'A'; }, 'UUID'],
    ['too many characters', (s: any) => { s.characters = Array.from({ length: 101 }, () => s.characters[0]); }, '最大100'],
  ])('rejects %s', (_label, mutate, message) => {
    const shuffle = structuredClone(populated());
    mutate(shuffle);
    expect(() => validateShuffleData(shuffle)).toThrow(message);
    expect(() => validateData({ ...fixture(), shuffle })).toThrow();
  });

  it('runs registered migrations in order and rejects future or unmigratable versions', () => {
    const v0 = { ...structuredClone(populated()), schemaVersion: 0, legacyName: 'x' } as unknown as Record<string, unknown>;
    const migrated = migrateShuffle(v0, { 0: input => { const { legacyName: _legacy, ...rest } = input; return rest; } });
    expect(migrated.migratedFrom).toBe(0);
    expect(validateShuffleData(migrated.data).schemaVersion).toBe(SHUFFLE_SCHEMA_VERSION);
    expect(v0.legacyName).toBe('x');
    expect(() => migrateShuffle(v0)).toThrow('移行手順');
    expect(() => migrateShuffle({ ...v0, schemaVersion: SHUFFLE_SCHEMA_VERSION + 1 })).toThrow('将来版');
    expect(migrateShuffle(populated()).migratedFrom).toBeNull();
  });
});

describe('corruption recovery', () => {
  it('quarantines unreadable shuffle data without touching the library, keeping the raw copy', () => {
    const data = { ...fixture(), shuffle: { schemaVersion: 1, characters: 'broken' } };
    const result = quarantineShuffle(data, NOW);
    expect(result.notice).toContain('隔離');
    const recovered = validateData(result.data);
    expect(recovered.shuffle).toBeUndefined();
    expect(recovered.libraryEntries).toEqual(fixture().libraryEntries);
    expect(recovered.shuffleRecovery).toHaveLength(1);
    expect(recovered.shuffleRecovery![0]!.raw).toEqual({ schemaVersion: 1, characters: 'broken' });
    expect(quarantineShuffle(fixture(), NOW)).toEqual({ data: fixture(), notice: null });
  });

  it('stores unsafe corrupt values as a diagnostic string and caps the recovery list', () => {
    const cyclic: Record<string, unknown> = { schemaVersion: 1 }; cyclic.self = cyclic;
    const result = quarantineShuffle({ ...fixture(), shuffle: cyclic }, NOW);
    const recovered = validateData(result.data);
    expect(typeof recovered.shuffleRecovery![0]!.raw).toBe('string');
    let data: unknown = recovered;
    for (let index = 0; index < 7; index++) data = validateData(quarantineShuffle({ ...(data as object), shuffle: { schemaVersion: 1 } }, NOW).data);
    expect((data as { shuffleRecovery: unknown[] }).shuffleRecovery).toHaveLength(5);
  });

  it('isolates corrupt shuffle data at DB load and persists the quarantine on the next save', async () => {
    const factory = new IDBFactory();
    let repository = await WorkbenchRepository.open('shuffle-corrupt', factory);
    const good = { ...fixture(), shuffle: populated() };
    const revision = await repository.save(good, 0);
    repository.close();
    // Simulate on-disk corruption of the inert metadata.extra record only.
    const raw = await new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open('shuffle-corrupt'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => {
      const transaction = raw.transaction('metadata', 'readwrite');
      const store = transaction.objectStore('metadata');
      const read = store.get('extra');
      read.onsuccess = () => { const extra = read.result as Record<string, any>; extra.shuffle.profiles[0].settings.mode = 'chaos'; store.put(extra, 'extra'); };
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
    });
    raw.close();
    repository = await WorkbenchRepository.open('shuffle-corrupt', factory);
    const loaded = await repository.load();
    expect(loaded.notice).toContain('隔離');
    expect(loaded.data.shuffle).toBeUndefined();
    expect(loaded.data.libraryEntries).toEqual(good.libraryEntries);
    expect((loaded.data.shuffleRecovery![0]!.raw as ShuffleData).profiles[0]!.settings.mode).toBe('chaos');
    await repository.save(loaded.data, revision);
    repository.close();
    repository = await WorkbenchRepository.open('shuffle-corrupt', factory);
    const reopened = await repository.load();
    expect(reopened.notice).toBeUndefined();
    expect(reopened.data.shuffleRecovery).toHaveLength(1);
    repository.close();
  });
});

describe('persistence and import/export', () => {
  it('survives DB close/reopen and full JSON backup round trips', async () => {
    const factory = new IDBFactory();
    const data = { ...fixture(), shuffle: populated() };
    let repository = await WorkbenchRepository.open('shuffle-persist', factory);
    await repository.save(data, 0);
    repository.close();
    repository = await WorkbenchRepository.open('shuffle-persist', factory);
    expect((await repository.load()).data.shuffle).toEqual(data.shuffle);
    repository.close();
    expect(parseBackup(exportBackup(data, NOW)).payload.shuffle).toEqual(data.shuffle);
  });

  it('merges shuffle collections on import and rejects ID collisions without changes', () => {
    const current = { ...fixture(), shuffle: populated() };
    const id = idFactory('z');
    const other = { ...emptyShuffle(), characters: [{ ...current.shuffle.characters[0]!, id: id(), name: 'Imported' }] };
    const incoming = { ...fixture(), libraryEntries: [], categories: [], workspaces: [], settings: { activeWorkspaceId: null, librarySort: 'title' as const }, shuffle: other };
    const merged = prepareImport(current, incoming, 'merge');
    expect(merged.shuffle!.characters.map(item => item.name)).toEqual(['A', 'B', 'Imported']);
    expect(merged.shuffle!.history).toEqual(current.shuffle.history);
    expect(() => prepareImport(current, { ...incoming, shuffle: current.shuffle }, 'merge')).toThrow('重複ID');
    expect(prepareImport(current, incoming, 'replace').shuffle!.characters).toHaveLength(1);
    const noShuffle = prepareImport(fixture(), incoming, 'merge');
    expect(noShuffle.shuffle!.characters).toHaveLength(1);
  });

  it('exports shuffle-only files without history and imports them with merge or replace', () => {
    const shuffle = populated();
    const text = exportShuffle(shuffle, NOW);
    const parsed = parseShuffleExport(text);
    expect(parsed.history).toEqual([]);
    expect(parsed.profiles[0]!.current).toBeNull();
    expect(parsed.templates).toEqual(shuffle.templates);
    expect(importShuffle(shuffle, parsed, 'replace').characters).toEqual(shuffle.characters);
    expect(() => importShuffle(shuffle, parsed, 'merge')).toThrow('重複ID');
    expect(importShuffle(undefined, parsed, 'merge')).toEqual(parsed);
    expect(() => parseShuffleExport('{')).toThrow('構文');
    expect(() => parseShuffleExport(JSON.stringify({ format: 'other', exportedAt: NOW, shuffle }))).toThrow('シャッフル設定ファイル');
    expect(() => parseShuffleExport('{"format":"nai-prompt-workbench-shuffle","exportedAt":"2026-11-14T00:00:00.000Z","shuffle":{"__proto__":{"x":1}}}')).toThrow('危険');
  });

  it('removes every reference when a character is deleted', () => {
    const shuffle = populated();
    const [A] = shuffle.characters;
    const limited = { ...shuffle, templates: shuffle.templates.map((item, index) => index === 0 ? { ...item, roles: item.roles.map(role => ({ ...role, allowedCharacterIds: [A!.id] })) } : item), pools: shuffle.pools.map(item => ({ ...item, characterIds: [A!.id] })) };
    const removed = removeCharacter(validateShuffleData(limited), A!.id);
    expect(() => validateShuffleData(removed)).not.toThrow();
    expect(removed.profiles[0]!.characterIds).not.toContain(A!.id);
    expect(removed.templates[0]!.roles[0]!.allowedCharacterIds).toEqual([]);
  });
});
