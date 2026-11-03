import { createHash } from 'node:crypto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { createExperiment, unknownSettings } from '../../src/core/experiments';
import { savePreset } from '../../src/core/presets';
import type { ImageRecord } from '../../src/core/types';
import { exportBackup } from '../../src/data/backup';
import { WorkbenchRepository } from '../../src/data/repository';
import { parseBackup, validateData } from '../../src/data/validation';
import { seedV2Database } from '../fixtures/legacy-db';
import { png } from '../fixtures/png';
import { fixture, timestamp } from './helpers';
const id = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;
const original = new Blob([new Uint8Array(png())], { type: 'image/png' });
function dataWithImage() {
  const data = fixture(); const image: ImageRecord = { id: id(4), hash: createHash('sha256').update(png()).digest('hex'), mime: 'image/png', name: 'synthetic.png', width: 2, height: 2, byteLength: original.size, thumbnailBytes: original.size, createdAt: timestamp, metadata: { positive: null, negative: null, settings: unknownSettings(), texts: {}, warnings: [] } };
  const experiment = createExperiment(id(1), id(2), id(3), '比較', data.workspaces[0]!, null, timestamp); experiment.variantA.imageId = image.id;
  data.experiments.push(experiment); data.images.push(image); return data;
}

describe('P4 image persistence / schema v3', () => {
  it('backs up real v2 layout before migration, preserving presets, spans and unknown fields', async () => {
    const factory = new IDBFactory(); let data = fixture(); data.future = { safe: true }; data = savePreset(data, data.workspaces[0]!.id, id(9), 'old preset', timestamp);
    const old = await seedV2Database(factory, 'v2', data); old.close(); const repo = await WorkbenchRepository.open('v2', factory);
    expect(await repo.load()).toEqual({ data, revision: 13 }); expect(await repo.migrationBackup()).toMatchObject({ schemaVersion: 2, databaseVersion: 2, revision: 12, data: { presets: data.presets, future: data.future } }); repo.close();
    const reopened = await WorkbenchRepository.open('v2', factory); expect((await reopened.load()).data).toEqual(data); reopened.close();
  });
  it('aborts v2 migration atomically when backup cannot be written', async () => {
    const factory = new IDBFactory(); const db = await seedV2Database(factory, 'v2-fail', fixture()); db.close();
    const add = IDBObjectStore.prototype.add; const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) { if (key === 'migrationBackup:v2') throw new DOMException('quota', 'QuotaExceededError'); return add.call(this, value, key); });
    try { await expect(WorkbenchRepository.open('v2-fail', factory)).rejects.toThrow('移行に失敗'); } finally { spy.mockRestore(); }
    const req = factory.open('v2-fail'); const old = await new Promise<IDBDatabase>(resolve => { req.onsuccess = () => resolve(req.result); }); expect(old.version).toBe(2); expect(old.objectStoreNames.contains('images')).toBe(false); old.close();
  });
  it('stores/reopens original and thumbnail separately from JSON metadata', async () => {
    const factory = new IDBFactory(); const data = dataWithImage(); let repo = await WorkbenchRepository.open('images', factory);
    await repo.save(data, 0, false, [{ id: id(4), original, thumbnail: original }]); repo.close(); repo = await WorkbenchRepository.open('images', factory);
    expect((await repo.load()).data).toEqual(data); expect(await (await repo.imageBlob(id(4)))!.arrayBuffer()).toEqual(await original.arrayBuffer()); expect((await repo.imageBlob(id(4), true))!.size).toBe(original.size); repo.close();
  });
  it('keeps comparison metadata on JSON restore and detects missing image binaries', async () => {
    const repo = await WorkbenchRepository.open('restore', new IDBFactory()); const data = parseBackup(exportBackup(dataWithImage(), timestamp)).payload; await repo.save(data, 0);
    expect((await repo.load()).data.experiments[0]!.variantA.imageId).toBe(id(4)); expect(await repo.imageBlob(id(4))).toBeUndefined(); repo.close();
  });
  it('quota failure rolls back image bytes, thumbnail, associations, revision and backup', async () => {
    const repo = await WorkbenchRepository.open('quota', new IDBFactory()); const before = fixture(); await repo.save(before, 0);
    const put = IDBObjectStore.prototype.put; const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) { if (this.name === 'imageThumbnails') throw new DOMException('quota exceeded', 'QuotaExceededError'); return put.call(this, value, key); });
    try { await expect(repo.save(dataWithImage(), 1, true, [{ id: id(4), original, thumbnail: original }])).rejects.toThrow('quota'); } finally { spy.mockRestore(); }
    expect(await repo.load()).toEqual({ data: before, revision: 1 }); expect(await repo.imageBlob(id(4))).toBeUndefined(); expect(await repo.previousImport()).toBeUndefined(); repo.close();
  });
  it('retains pixels for undo and previous-import recovery, purges only unreferenced bytes', async () => {
    const repo = await WorkbenchRepository.open('purge', new IDBFactory()); await repo.save(dataWithImage(), 0, false, [{ id: id(4), original, thumbnail: original }]); await repo.save(fixture(), 1);
    await repo.purgeUnreferenced([id(4)]); expect(await repo.imageBlob(id(4))).toBeDefined(); await repo.purgeUnreferenced([]); expect(await repo.imageBlob(id(4))).toBeUndefined(); repo.close();
  });
  it('protects images referenced by previous-import backup even after deletion', async () => {
    const repo = await WorkbenchRepository.open('backup-pixels', new IDBFactory()); await repo.save(dataWithImage(), 0, false, [{ id: id(4), original, thumbnail: original }]); await repo.save(fixture(), 1, true); await repo.purgeUnreferenced([]); expect(await repo.imageBlob(id(4))).toBeDefined(); repo.close();
  });
  it('rejects duplicate hashes and oversized image metadata without dropping known state', () => {
    const data = dataWithImage(); data.images.push({ ...data.images[0]!, id: id(5) }); expect(() => validateData(data)).toThrow('ハッシュ');
    data.images.pop(); data.images[0]!.width = 100_000; expect(() => validateData(data)).toThrow();
  });
  it('rejects mismatched bytes/hash before opening a write transaction', async () => {
    const repo = await WorkbenchRepository.open('bad-bytes', new IDBFactory()); const data = dataWithImage(); data.images[0]!.hash = '0'.repeat(64);
    await expect(repo.save(data, 0, true, [{ id: id(4), original, thumbnail: original }])).rejects.toThrow('ハッシュ');
    expect((await repo.load()).revision).toBe(0); expect(await repo.imageBlob(id(4))).toBeUndefined(); expect(await repo.previousImport()).toBeUndefined(); repo.close();
  });
  it.each(['hash', 'width', 'byteLength', 'thumbnailBytes'] as const)('never reuses stale binaries after importing different %s under the same image ID', async field => {
    const repo = await WorkbenchRepository.open('stale-binary', new IDBFactory()); const data = dataWithImage();
    await repo.save(data, 0, false, [{ id: id(4), original, thumbnail: original }]);
    const changed = structuredClone(data);
    if (field === 'hash') changed.images[0]!.hash = '0'.repeat(64);
    else changed.images[0]![field] += 1;
    await repo.save(changed, 1, true);
    expect(await repo.imageBlob(id(4))).toBeUndefined(); expect(await repo.imageBlob(id(4), true)).toBeUndefined();
    // Undo metadata also restores the original association to the still-intact bytes.
    await repo.save(data, 2); expect(await repo.imageBlob(id(4))).toBeDefined(); repo.close();
  });
  it.each([1, 2])('imports JSON v%s without images or sessions and preserves existing records', version => {
    const data = fixture(); const { images: _images, experiments: _experiments, ...old } = data;
    expect(parseBackup(JSON.stringify({ format: 'nai-prompt-workbench', schemaVersion: version, exportedAt: timestamp, payload: old })).payload).toEqual(data);
  });
});
