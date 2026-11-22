import { SCHEMA_VERSION, validateData } from '../../src/data/validation';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commentRange } from '../../src/core/comments';
import { compileWorkspace } from '../../src/core/compose';
import { savePreset } from '../../src/core/presets';
import { MigrationError, WorkbenchRepository } from '../../src/data/repository';
import { seedLegacyDatabase } from '../fixtures/legacy-db';
import { fixture, timestamp } from './helpers';

let factory: IDBFactory;
beforeEach(() => { factory = new IDBFactory(); });
async function raw(name: string) {
  const request = factory.open(name);
  const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const names = Array.from(database.objectStoreNames);
  const transaction = database.transaction(names, 'readonly');
  const values = await Promise.all(names.map(name => new Promise<unknown[]>((resolve, reject) => { const req = transaction.objectStore(name).getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); })));
  const version = database.version; database.close();
  return { version, names, values };
}

describe('P3 v1 → v2 IndexedDB migration', () => {
  it('backs up v1 first, preserves P2 spans/order/unknown fields and previous backups, then opens v2', async () => {
    const data = fixture(); data.libraryEntries.reverse(); data.future = { safe: '保全 🌟' };
    const workspace = data.workspaces[0]!;
    workspace.freeformPositive = 'a, b, c';
    workspace.freeformPositiveSpans = commentRange('a, b, c', undefined, 3, 4, ['aaaaaaaa-aaaa-4aaa-8aaa-000000000011', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000012', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000013']);
    const previousImport = { preserved: 'old recovery' };
    const old = await seedLegacyDatabase(factory, 'migrate', data, { previousImport }); old.close();
    const repository = await WorkbenchRepository.open('migrate', factory);
    expect(await repository.load()).toEqual({ data, revision: 8 });
    expect(compileWorkspace((await repository.load()).data.workspaces[0]!)).toEqual(compileWorkspace(workspace));
    expect(await repository.previousImport()).toEqual(previousImport);
    const backup = await repository.migrationBackup();
    expect(backup).toMatchObject({ schemaVersion: 1, databaseVersion: 1, revision: 7, libraryEntries: data.libraryEntries.slice().sort((a, b) => a.id.localeCompare(b.id)), data: { workspaces: data.workspaces, future: data.future } });
    expect((await raw('migrate')).names).toContain('presets');
    repository.close();
    const reopened = await WorkbenchRepository.open('migrate', factory);
    expect(await reopened.load()).toEqual({ data, revision: 8 });
    expect(await reopened.migrationBackup()).toEqual(backup);
    reopened.close();
  });
  it('after a migration the first save writes everything, the next only the change, and the backup stays (issue #22)', async () => {
    const data = fixture(); data.future = { safe: true };
    const old = await seedLegacyDatabase(factory, 'migrate-then-save', data); old.close();
    const repository = await WorkbenchRepository.open('migrate-then-save', factory);
    const loaded = await repository.load();
    const backup = await repository.migrationBackup();
    const clear = vi.spyOn(IDBObjectStore.prototype, 'clear');
    const first = validateData({ ...loaded.data, libraryEntries: loaded.data.libraryEntries.slice(1) });
    const second = validateData({ ...first, libraryEntries: first.libraryEntries.map((entry, index) => index === 0 ? { ...entry, raw: 'edited' } : entry) });
    try {
      await repository.save(first, loaded.revision);
      expect(clear).toHaveBeenCalledTimes(6);
      clear.mockClear();
      await repository.save(second, loaded.revision + 1);
      expect(clear).not.toHaveBeenCalled();
    } finally { clear.mockRestore(); }
    repository.close();
    const reopened = await WorkbenchRepository.open('migrate-then-save', factory);
    expect(await reopened.load()).toEqual({ data: second, revision: loaded.revision + 2 });
    expect(await reopened.migrationBackup()).toEqual(backup);
    reopened.close();
  });
  it('does not create a migration backup for a brand-new database', async () => {
    const repository = await WorkbenchRepository.open('new', factory);
    expect(await repository.migrationBackup()).toBeUndefined();
    expect((await raw('new')).version).toBe(SCHEMA_VERSION); repository.close();
  });
  it('rejects corrupt legacy input without version/store/data changes and exposes a recovery snapshot', async () => {
    const data = fixture(); Object.assign(data.libraryEntries[0]!, { raw: 42 });
    const old = await seedLegacyDatabase(factory, 'corrupt-v1', data); old.close();
    const before = await raw('corrupt-v1');
    let failure: unknown;
    try { await WorkbenchRepository.open('corrupt-v1', factory); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(MigrationError);
    expect((failure as MigrationError).snapshot).toMatchObject({ schemaVersion: 1, libraryEntries: expect.arrayContaining([expect.objectContaining({ raw: 42 })]) });
    expect(await raw('corrupt-v1')).toEqual(before);
  });
  it.each(['backup', 'schema'] as const)('rolls back v1 completely when the %s write fails', async stage => {
    const old = await seedLegacyDatabase(factory, `fail-${stage}`, fixture()); old.close();
    const before = await raw(`fail-${stage}`);
    const add = IDBObjectStore.prototype.add; const put = IDBObjectStore.prototype.put;
    const spy = stage === 'backup'
      ? vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) { if (key === 'migrationBackup:v1') throw new DOMException('quota', 'QuotaExceededError'); return add.call(this, value, key); })
      : vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) { if (key === 'schemaVersion' && value === SCHEMA_VERSION) throw new DOMException('quota', 'QuotaExceededError'); return put.call(this, value, key); });
    try { await expect(WorkbenchRepository.open(`fail-${stage}`, factory)).rejects.toThrow('移行に失敗'); } finally { spy.mockRestore(); }
    expect(await raw(`fail-${stage}`)).toEqual(before);
  });
  it('a blocked upgrade aborts after the old connection closes; only a new explicit open migrates', async () => {
    const old = await seedLegacyDatabase(factory, 'blocked', fixture());
    await expect(WorkbenchRepository.open('blocked', factory)).rejects.toThrow('別のパネル');
    old.close();
    expect((await raw('blocked')).version).toBe(1);
    const repository = await WorkbenchRepository.open('blocked', factory);
    expect((await raw('blocked')).version).toBe(SCHEMA_VERSION); repository.close();
  });
});

describe('P3 preset persistence and transaction integrity', () => {
  it('persists preset snapshots/bindings across DB reopen and can back up before a replace', async () => {
    const repository = await WorkbenchRepository.open('presets', factory);
    const data = fixture();
    const saved = savePreset(data, data.workspaces[0]!.id, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', '制服', timestamp);
    await repository.save(saved, 0); repository.close();
    const reopened = await WorkbenchRepository.open('presets', factory);
    expect(await reopened.load()).toEqual({ data: saved, revision: 1 });
    await reopened.save(fixture(), 1, true);
    expect(await reopened.previousImport()).toMatchObject({ data: saved }); reopened.close();
  });
  it('a presets-store failure rolls back library/workspace/settings and the pre-import backup', async () => {
    const repository = await WorkbenchRepository.open('preset-fail', factory);
    const original = fixture(); await repository.save(original, 0);
    const changed = savePreset(structuredClone(original), original.workspaces[0]!.id, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'test', timestamp);
    changed.libraryEntries[0] = { ...changed.libraryEntries[0]!, title: 'pending update' };
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) { if (this.name === 'presets') throw new DOMException('quota', 'QuotaExceededError'); return put.call(this, value, key); });
    try { await expect(repository.save(changed, 1, true)).rejects.toThrow('quota'); } finally { spy.mockRestore(); }
    expect(await repository.load()).toEqual({ data: original, revision: 1 });
    expect(await repository.previousImport()).toBeUndefined(); repository.close();
  });
});
