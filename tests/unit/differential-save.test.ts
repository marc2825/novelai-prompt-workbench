import { createHash } from 'node:crypto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unknownSettings } from '../../src/core/experiments';
import type { ImageRecord, LibraryEntry, WorkbenchData } from '../../src/core/types';
import { StorageConflictError, WorkbenchRepository } from '../../src/data/repository';
import { validateData } from '../../src/data/validation';
import { png } from '../fixtures/png';
import { fixture, timestamp } from './helpers';

// Issue #22 / ADR-105: a save writes only the records that changed since what the same
// repository instance last committed, in the same single transaction with the revision check.
const ASSETS = ['libraryEntries', 'categories', 'workspaces', 'presets', 'experiments', 'images'];
let factory: IDBFactory;
beforeEach(() => { factory = new IDBFactory(); });

/** Records which object stores a run puts into, deletes from and clears. */
async function writes(run: () => Promise<unknown>) {
  const spies = { put: vi.spyOn(IDBObjectStore.prototype, 'put'), delete: vi.spyOn(IDBObjectStore.prototype, 'delete'), clear: vi.spyOn(IDBObjectStore.prototype, 'clear') };
  const names = (spy: { mock: { contexts: unknown[] } }) => spy.mock.contexts.map(store => (store as IDBObjectStore).name);
  try {
    await run();
    const put = names(spies.put);
    return { assets: put.filter(name => name !== 'metadata'), metadata: put.filter(name => name === 'metadata').length, delete: names(spies.delete), clear: names(spies.clear) };
  } finally { for (const spy of Object.values(spies)) spy.mockRestore(); }
}
/** What a different connection (another panel) reads, so the instance under test keeps its state. */
async function stored(name: string) {
  const reader = await WorkbenchRepository.open(name, factory);
  try { return await reader.load(); } finally { reader.close(); }
}
const entryId = (n: number) => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`;
const entry = (n: number, raw = `raw ${n}`): LibraryEntry => ({ id: entryId(n), title: `部品 ${n}`, raw, description: '', categoryId: null, tags: [], defaultChannel: 'positive', previewImageIds: [], createdAt: timestamp, updatedAt: timestamp });
const editEntry = (data: WorkbenchData, index: number, patch: Partial<LibraryEntry>) => validateData({ ...data, libraryEntries: data.libraryEntries.map((item, at) => at === index ? { ...item, ...patch } : item) });

describe('differential save (issue #22)', () => {
  it('after a full first save, an edit puts only the changed record plus the metadata', async () => {
    const repository = await WorkbenchRepository.open('diff-edit', factory);
    const first = validateData(fixture());
    const initial = await writes(() => repository.save(first, 0));
    expect(initial.clear).toEqual(ASSETS);
    const second = editEntry(first, 1, { title: '変更' });
    const edit = await writes(() => repository.save(second, 1));
    expect(edit).toEqual({ assets: ['libraryEntries'], metadata: 4, delete: [], clear: [] });
    expect(await stored('diff-edit')).toEqual({ data: second, revision: 2 });
    // Saving the same state again writes metadata (revision) only.
    expect(await writes(() => repository.save(second, 2))).toEqual({ assets: [], metadata: 4, delete: [], clear: [] });
    repository.close();
  });

  it('reordering only rewrites the order metadata', async () => {
    const repository = await WorkbenchRepository.open('diff-order', factory);
    const first = validateData(fixture());
    await repository.save(first, 0);
    const reversed = validateData({ ...first, libraryEntries: [...first.libraryEntries].reverse() });
    expect(await writes(() => repository.save(reversed, 1))).toEqual({ assets: [], metadata: 4, delete: [], clear: [] });
    expect((await stored('diff-order')).data.libraryEntries.map(item => item.id)).toEqual(reversed.libraryEntries.map(item => item.id));
    repository.close();
  });

  it('deletes removed records and restores them when the same ID comes back (Undo of a deletion)', async () => {
    const repository = await WorkbenchRepository.open('diff-readd', factory);
    const first = validateData(fixture());
    await repository.save(first, 0);
    const removed = validateData({ ...first, libraryEntries: first.libraryEntries.filter((_, index) => index !== 2) });
    expect(await writes(() => repository.save(removed, 1))).toEqual({ assets: [], metadata: 4, delete: ['libraryEntries'], clear: [] });
    expect((await stored('diff-readd')).data).toEqual(removed);
    // Undo: the earlier result (with the original, shared record) is saved again.
    expect(await writes(() => repository.save(first, 2))).toEqual({ assets: ['libraryEntries'], metadata: 4, delete: [], clear: [] });
    expect(await stored('diff-readd')).toEqual({ data: first, revision: 3 });
    // The same ID with different content in one step is a put, never a skipped write.
    const replaced = validateData({ ...first, libraryEntries: first.libraryEntries.map((item, index) => index === 2 ? { ...entry(99), id: item.id } : item) });
    expect((await writes(() => repository.save(replaced, 3))).assets).toEqual(['libraryEntries']);
    expect((await stored('diff-readd')).data.libraryEntries[2]).toEqual({ ...entry(99), id: first.libraryEntries[2]!.id });
    repository.close();
  });

  it('Undo/Redo states saved in any order leave exactly that state', async () => {
    const repository = await WorkbenchRepository.open('diff-undo', factory);
    const s0 = validateData(fixture());
    const s1 = editEntry(s0, 0, { raw: 'edited' });
    const s2 = validateData({ ...s1, categories: [...s1.categories, { id: entryId(500), name: '追加' }], libraryEntries: [...s1.libraryEntries, entry(1)] });
    const s3 = validateData({ ...s2, workspaces: s2.workspaces.map(item => ({ ...item, groups: item.groups.slice(1) })), settings: { ...s2.settings, librarySort: 'updatedAt' } });
    let revision = 0;
    for (const state of [s0, s1, s2, s3, s1, s3, s0, s2]) {
      revision = await repository.save(state, revision);
      expect(await stored('diff-undo')).toEqual({ data: state, revision });
    }
    repository.close();
  });

  it('a quota failure in the middle of a differential save changes nothing, and the next save writes everything', async () => {
    const repository = await WorkbenchRepository.open('diff-quota', factory);
    const first = validateData(fixture());
    await repository.save(first, 0);
    const second = validateData({ ...first, libraryEntries: first.libraryEntries.map(item => ({ ...item, raw: `${item.raw}, changed` })), settings: { ...first.settings, librarySort: 'updatedAt' } });
    const put = IDBObjectStore.prototype.put; let count = 0;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      // Two records are already queued in this transaction when the third put fails.
      if (this.name === 'libraryEntries' && ++count === 3) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return put.call(this, value, key);
    });
    try { await expect(repository.save(second, 1)).rejects.toThrow('quota'); } finally { spy.mockRestore(); }
    expect(count).toBe(3);
    expect(await stored('diff-quota')).toEqual({ data: first, revision: 1 });
    // The failed save left no trusted base: the retry writes every record again.
    const retry = await writes(() => repository.save(second, 1));
    expect(retry.clear).toEqual(ASSETS);
    expect(await stored('diff-quota')).toEqual({ data: second, revision: 2 });
    const third = editEntry(second, 0, { title: '再開' });
    expect((await writes(() => repository.save(third, 2))).clear).toEqual([]);
    expect(await stored('diff-quota')).toEqual({ data: third, revision: 3 });
    repository.close();
  });

  it('a revision conflict writes nothing; after reloading, the stale panel writes everything', async () => {
    const a = await WorkbenchRepository.open('diff-conflict', factory);
    const b = await WorkbenchRepository.open('diff-conflict', factory);
    const first = validateData(fixture());
    await a.save(first, 0);
    const fromB = validateData({ ...(await b.load()).data, libraryEntries: [...first.libraryEntries, entry(1)] });
    expect((await writes(() => b.save(fromB, 1))).clear).toEqual(ASSETS); // b only loaded: no trusted base
    // a still holds revision 1 as its base; the revision check stops the differential write.
    const fromA = editEntry(first, 0, { raw: 'a' });
    const conflict = await writes(() => expect(a.save(fromA, 1)).rejects.toBeInstanceOf(StorageConflictError));
    expect(conflict).toEqual({ assets: [], metadata: 0, delete: [], clear: [] });
    expect(await stored('diff-conflict')).toEqual({ data: fromB, revision: 2 });
    // a reloads (sees b's entry), removes it and edits: the first save after the load is complete.
    const loaded = await a.load();
    const merged = validateData({ ...loaded.data, libraryEntries: loaded.data.libraryEntries.filter(item => item.id !== entryId(1)).map((item, index) => index === 0 ? { ...item, raw: 'a' } : item) });
    expect((await writes(() => a.save(merged, loaded.revision))).clear).toEqual(ASSETS);
    expect(await stored('diff-conflict')).toEqual({ data: merged, revision: 3 });
    // b's base is revision 2 while the database is at 3. Even when b passes the current revision
    // (learnt elsewhere), its older base is not used: b writes everything, so none of a's changes
    // (entry 0, the removed entry) stay behind.
    const fromB2 = editEntry(fromB, 1, { raw: 'b again' });
    expect((await writes(() => b.save(fromB2, 3))).clear).toEqual(ASSETS);
    expect(await stored('diff-conflict')).toEqual({ data: fromB2, revision: 4 });
    // a's base (revision 3) is stale now: a conflict, nothing written.
    await expect(a.save(editEntry(merged, 1, { raw: 'a again' }), 3)).rejects.toBeInstanceOf(StorageConflictError);
    expect(await stored('diff-conflict')).toEqual({ data: fromB2, revision: 4 });
    a.close(); b.close();
  });

  it('two panels alternating with reloads never resurrect or lose a record', async () => {
    const panels = [await WorkbenchRepository.open('diff-alternate', factory), await WorkbenchRepository.open('diff-alternate', factory)] as const;
    let state = validateData(fixture());
    let revision = await panels[0].save(state, 0);
    for (let step = 1; step <= 8; step++) {
      const panel = panels[step % 2]!;
      const loaded = await panel.load();
      expect(loaded).toEqual({ data: state, revision });
      // Each panel adds one entry, drops the oldest added one and saves twice (full, then differential).
      const added = [...loaded.data.libraryEntries, entry(step)].filter(item => item.id !== entryId(step - 2));
      state = validateData({ ...loaded.data, libraryEntries: added });
      revision = await panel.save(state, revision);
      state = editEntry(state, 0, { raw: `step ${step}` });
      expect((await writes(() => panel.save(state, revision))).clear).toEqual([]);
      revision++;
      expect(await stored('diff-alternate')).toEqual({ data: state, revision });
    }
    panels[0].close(); panels[1].close();
  });

  it('a pre-import backup save writes everything and keeps the previous state', async () => {
    const repository = await WorkbenchRepository.open('diff-backup', factory);
    const first = validateData(fixture());
    await repository.save(first, 0);
    const second = editEntry(first, 0, { raw: 'before import' });
    await repository.save(second, 1);
    const imported = validateData({ ...second, libraryEntries: [entry(1), entry(2)], workspaces: [], presets: [], settings: { activeWorkspaceId: null, librarySort: 'title' } });
    expect((await writes(() => repository.save(imported, 2, true))).clear).toEqual(ASSETS);
    expect(await repository.previousImport()).toMatchObject({ revision: 2, data: second });
    expect(await stored('diff-backup')).toEqual({ data: imported, revision: 3 });
    // Undo of the import goes back to the earlier result: a differential save against the imported state.
    const undo = await writes(() => repository.save(second, 3));
    expect(undo.clear).toEqual([]);
    expect(await stored('diff-backup')).toEqual({ data: second, revision: 4 });
    repository.close();
  });

  it('input that did not come from validateData, and the first save after a load, are written in full', async () => {
    const repository = await WorkbenchRepository.open('diff-untrusted', factory);
    const first = validateData(fixture());
    await repository.save(first, 0);
    const plain = structuredClone(editEntry(first, 0, { raw: 'plain' }));
    expect((await writes(() => repository.save(plain, 1))).clear).toEqual(ASSETS);
    expect(await stored('diff-untrusted')).toEqual({ data: plain, revision: 2 });
    const loaded = await repository.load();
    expect((await writes(() => repository.save(editEntry(loaded.data, 0, { raw: 'after load' }), 2))).clear).toEqual(ASSETS);
    repository.close();
  });

  it('image records and binaries are written by a differential save and survive later edits', async () => {
    const repository = await WorkbenchRepository.open('diff-images', factory);
    const first = validateData(fixture());
    await repository.save(first, 0);
    const bytes = new Uint8Array(png(8, 6, {}, 10)); const thumb = new Uint8Array(png(4, 3, {}, 10));
    const record: ImageRecord = { id: entryId(700), hash: createHash('sha256').update(bytes).digest('hex'), mime: 'image/png', name: 'image.png', width: 8, height: 6, byteLength: bytes.byteLength, thumbnailBytes: thumb.byteLength, createdAt: timestamp, metadata: { positive: null, negative: null, settings: unknownSettings(), texts: {}, warnings: [] } };
    const withImage = validateData({ ...first, images: [record] });
    const write = { id: record.id, original: new Blob([bytes], { type: 'image/png' }), thumbnail: new Blob([thumb], { type: 'image/png' }) };
    const added = await writes(() => repository.save(withImage, 1, false, [write]));
    expect(added).toEqual({ assets: ['images', 'imageOriginals', 'imageThumbnails'], metadata: 4, delete: [], clear: [] });
    const edited = editEntry(withImage, 0, { raw: 'after image' });
    expect((await writes(() => repository.save(edited, 2))).assets).toEqual(['libraryEntries']);
    expect(await stored('diff-images')).toEqual({ data: edited, revision: 3 });
    expect(new Uint8Array(await (await repository.imageBlob(record.id))!.arrayBuffer())).toEqual(bytes);
    // Removing the record deletes metadata only; the binary stays for Undo (purge is separate).
    await repository.save(first, 3);
    expect((await stored('diff-images')).data.images).toEqual([]);
    expect(await repository.binaryBindings([record.id])).toEqual(new Map([[record.id, { hash: record.hash, byteLength: record.byteLength, thumbnailBytes: record.thumbnailBytes }]]));
    repository.close();
  });

  it('random edit sequences (fixed seed) keep IndexedDB equal to the last saved state', async () => {
    let seed = 22;
    const random = (limit: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % limit; };
    const repository = await WorkbenchRepository.open('diff-random', factory);
    const states = [validateData({ ...fixture(), libraryEntries: Array.from({ length: 20 }, (_, index) => entry(index)) })];
    let state = states[0]!; let next = 20;
    let revision = await repository.save(state, 0);
    for (let step = 0; step < 120; step++) {
      const entries = state.libraryEntries;
      const operation = random(7);
      if (operation === 0) state = validateData({ ...state, libraryEntries: [...entries, entry(next++)] });
      else if (operation === 1 && entries.length > 1) state = validateData({ ...state, libraryEntries: entries.filter((_, index) => index !== random(entries.length)) });
      else if (operation === 2) { const a = random(entries.length); const b = random(entries.length); const swapped = [...entries]; [swapped[a], swapped[b]] = [swapped[b]!, swapped[a]!]; state = validateData({ ...state, libraryEntries: swapped }); }
      else if (operation === 3) state = states[random(states.length)]!; // Undo/Redo to any earlier state
      else if (operation === 4) state = validateData({ ...state, workspaces: state.workspaces.map(item => ({ ...item, freeformPositive: `step ${step}` })) });
      else if (operation === 5) state = validateData({ ...state, categories: state.categories.length > 1 ? state.categories.slice(0, 1) : [...state.categories, { id: entryId(10_000 + step), name: `分類${step}` }] });
      else state = editEntry(state, random(entries.length), { raw: `edit ${step}` });
      states.push(state);
      revision = await repository.save(state, revision);
      expect(await stored('diff-random')).toEqual({ data: state, revision });
    }
    repository.close();
  });
});
