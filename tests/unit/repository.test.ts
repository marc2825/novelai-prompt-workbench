import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyData } from '../../src/core/commands';
import { compileWorkspace } from '../../src/core/compose';
import { exportBackup } from '../../src/data/backup';
import { StorageConflictError, WorkbenchRepository } from '../../src/data/repository';
import { parseBackup, SCHEMA_VERSION } from '../../src/data/validation';
import { fixture, timestamp } from './helpers';

let factory: IDBFactory;
beforeEach(() => { factory = new IDBFactory(); });

describe('IndexedDB repository / AC06–AC09', () => {
  it('starts empty with schemaVersion and does not auto-insert demo data', async () => {
    const repository = await WorkbenchRepository.open('empty', factory);
    expect(await repository.load()).toEqual({ data: emptyData(), revision: 0 });
    expect(await repository.previousImport()).toBeUndefined();
    repository.close();
  });
  it('restores exact state and output after DB close/reopen, including unknown fields', async () => {
    const data = fixture();
    data.libraryEntries[0]!.title = '日本語, スペース 🌟';
    data.future = { safe: true };
    // Asset order must survive IndexedDB's default primary-key sorting as well.
    data.libraryEntries.reverse();
    const before = compileWorkspace(data.workspaces[0]!);
    let repository = await WorkbenchRepository.open('persist', factory);
    await repository.save(data, 0);
    repository.close();
    repository = await WorkbenchRepository.open('persist', factory);
    const loaded = await repository.load();
    expect(loaded.data).toEqual(data);
    expect(compileWorkspace(loaded.data.workspaces[0]!)).toEqual(before);
    repository.close();
  });
  it('exports → deletes all assets → imports and retains a pre-import backup atomically', async () => {
    const repository = await WorkbenchRepository.open('roundtrip', factory);
    const data = fixture();
    await repository.save(data, 0);
    const exported = exportBackup((await repository.load()).data, timestamp);
    await repository.save(emptyData(), 1);
    await repository.save(parseBackup(exported).payload, 2, true);
    expect((await repository.load()).data).toEqual(data);
    expect(await repository.previousImport()).toMatchObject({ revision: 2, data: emptyData() });
    repository.close();
  });
  it('invalid payload cannot change any store, revision or previous backup', async () => {
    const repository = await WorkbenchRepository.open('invalid', factory);
    const data = fixture();
    await repository.save(data, 0);
    const invalid = structuredClone(data); invalid.libraryEntries.push(invalid.libraryEntries[0]!);
    await expect(repository.save(invalid, 1, true)).rejects.toThrow('重複ID');
    expect(await repository.load()).toEqual({ data, revision: 1 });
    expect(await repository.previousImport()).toBeUndefined();
    repository.close();
  });
  it('aborts a mid-write storage failure with all stores and backup unchanged', async () => {
    const repository = await WorkbenchRepository.open('abort', factory);
    const original = fixture();
    await repository.save(original, 0);
    const modified = structuredClone(original); modified.libraryEntries[0]!.title = 'changed';
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'workspaces') throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return put.call(this, value, key);
    });
    try { await expect(repository.save(modified, 1, true)).rejects.toThrow('quota'); } finally { spy.mockRestore(); }
    expect(await repository.load()).toEqual({ data: original, revision: 1 });
    expect(await repository.previousImport()).toBeUndefined();
    repository.close();
  });
  it('detects stale writes from a second panel instead of silently overwriting', async () => {
    const first = await WorkbenchRepository.open('conflict', factory);
    const second = await WorkbenchRepository.open('conflict', factory);
    await first.save(fixture(), 0);
    await expect(second.save(emptyData(), 0)).rejects.toBeInstanceOf(StorageConflictError);
    expect((await second.load()).data.libraryEntries).toHaveLength(5);
    first.close(); second.close();
  });
  it('reports corrupted records without resetting them, supports raw recovery export and backed-up repair', async () => {
    const repository = await WorkbenchRepository.open('corrupt', factory);
    const original = fixture();
    await repository.save(original, 0);
    const req = factory.open('corrupt');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const transaction = db.transaction('libraryEntries', 'readwrite');
    transaction.objectStore('libraryEntries').put({ ...original.libraryEntries[0], raw: 42 });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
    await expect(repository.load()).rejects.toThrow('raw');
    expect(await repository.recoveryDump()).toMatchObject({ format: 'nai-prompt-workbench-recovery', libraryEntries: expect.arrayContaining([expect.objectContaining({ raw: 42 })]) });
    await repository.recover(original);
    expect((await repository.load()).data).toEqual(original);
    expect(await repository.previousImport()).toMatchObject({ data: { libraryEntries: expect.arrayContaining([expect.objectContaining({ raw: 42 })]) } });
    db.close(); repository.close();
  });
  it('refuses a future DB version without modifying it', async () => {
    const req = factory.open('future', SCHEMA_VERSION + 1);
    const db = await new Promise<IDBDatabase>(resolve => { req.onsuccess = () => resolve(req.result); });
    db.close();
    await expect(WorkbenchRepository.open('future', factory)).rejects.toMatchObject({ name: 'VersionError' });
  });
});
