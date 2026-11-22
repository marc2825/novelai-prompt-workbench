import { createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createExperiment, unknownSettings } from '../../src/core/experiments';
import type { ImageRecord, WorkbenchData } from '../../src/core/types';
import { exportBackup } from '../../src/data/backup';
import { exportFullBackup, inspectFullBackup, pinnedBinarySource } from '../../src/data/full-backup';
import { JOURNAL_MAX_CHARS, journalKey, readJournals, removeJournal, sameData, writeJournal, type UnsavedJournal } from '../../src/data/journal';
import { StorageConflictError, WorkbenchRepository } from '../../src/data/repository';
import { exportShuffle, parseShuffleExport } from '../../src/data/shuffle';
import { MAX_BYTES, MAX_DOCUMENT_BYTES, parseBackup, serializeDocument, validateData } from '../../src/data/validation';
import { otherWindows, registerWindow, WINDOW_LOCK_PREFIX } from '../../src/data/window-registry';
import { png } from '../fixtures/png';
import { fixture, timestamp } from './helpers';

const id = (n: number) => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`;

class MemoryStorage {
  private items = new Map<string, string>();
  constructor(private readonly quota = Infinity) {}
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { if (value.length > this.quota) throw new DOMException('quota', 'QuotaExceededError'); this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
}
const journal = (windowId: string, data: WorkbenchData = validateData(fixture()), extra: Partial<UnsavedJournal> = {}): UnsavedJournal => ({ format: 'nai-prompt-workbench-unsaved', version: 1, windowId, savedAt: timestamp, baseRevision: 3, reason: 'pending', missingImageIds: [], data, ...extra });

describe('unsaved-changes journal (issue #17)', () => {
  it('writes synchronously, reads back validated data of other windows and can be removed', () => {
    const storage = new MemoryStorage();
    expect(writeJournal(storage, journal('mine'))).toBe(true);
    expect(writeJournal(storage, journal('closed', validateData(fixture()), { savedAt: '2026-11-04T00:00:00.000Z', reason: 'failed' }))).toBe(true);
    const { journals, unreadable } = readJournals(storage, 'mine');
    expect(unreadable).toEqual([]);
    expect(journals.map(item => item.journal.windowId)).toEqual(['closed']);
    expect(journals[0]!.journal.reason).toBe('failed');
    expect(sameData(journals[0]!.journal.data, validateData(fixture()))).toBe(true);
    removeJournal(storage, journalKey('closed'));
    expect(readJournals(storage).journals.map(item => item.journal.windowId)).toEqual(['mine']);
  });
  it('orders newest first and drops image IDs the data does not contain', () => {
    const storage = new MemoryStorage();
    writeJournal(storage, journal('a', validateData(fixture()), { savedAt: '2026-11-01T00:00:00.000Z', missingImageIds: [id(1)] }));
    writeJournal(storage, journal('b', validateData(fixture()), { savedAt: '2026-11-05T00:00:00.000Z' }));
    const { journals } = readJournals(storage);
    expect(journals.map(item => item.journal.windowId)).toEqual(['b', 'a']);
    expect(journals[1]!.journal.missingImageIds).toEqual([]);
  });
  it('reports corrupt, foreign or tampered entries instead of trusting them', () => {
    const storage = new MemoryStorage();
    storage.setItem(journalKey('broken'), '{not json');
    storage.setItem(journalKey('format'), JSON.stringify({ ...journal('format'), format: 'other' }));
    storage.setItem(journalKey('renamed'), JSON.stringify(journal('someone-else')));
    storage.setItem(journalKey('invalid'), JSON.stringify({ ...journal('invalid'), data: { ...fixture(), libraryEntries: [{ id: 'x' }] } }));
    storage.setItem(journalKey('proto'), `{"format":"nai-prompt-workbench-unsaved","version":1,"windowId":"proto","savedAt":"${timestamp}","baseRevision":1,"reason":"pending","missingImageIds":[],"data":{"__proto__":{"x":1},"libraryEntries":[],"workspaces":[]}}`);
    storage.setItem('unrelated-key', 'kept');
    const { journals, unreadable } = readJournals(storage);
    expect(journals).toEqual([]);
    expect(unreadable.map(item => item.key).sort()).toEqual(['broken', 'format', 'invalid', 'proto', 'renamed'].map(journalKey).sort());
    expect(storage.getItem('unrelated-key')).toBe('kept');
  });
  it('returns false instead of throwing when the journal does not fit', () => {
    expect(writeJournal(new MemoryStorage(100), journal('small'))).toBe(false);
    const huge = validateData(nearLimit(16));
    expect(JSON.stringify(huge).length).toBeGreaterThan(JOURNAL_MAX_CHARS);
    const storage = new MemoryStorage();
    expect(writeJournal(storage, journal('huge', huge))).toBe(false);
    expect(storage.length).toBe(0);
  });
});

class FakeLocks {
  held = new Set<string>();
  request(name: string, callback: () => Promise<void>) { this.held.add(name); return callback().finally(() => this.held.delete(name)); }
  async query() { return { held: [...this.held].map(name => ({ name, mode: 'exclusive' as const, clientId: '' })), pending: [] }; }
}

describe('open-window detection (issue #16)', () => {
  it('counts other open pages through their presence locks and forgets closed ones', async () => {
    const locks = new FakeLocks() as unknown as LockManager;
    const mine = registerWindow('mine', locks); expect(await mine.ready).toBe(true);
    expect(await otherWindows('mine', locks)).toBe(0);
    const other = registerWindow('other', locks); await other.ready;
    expect(await otherWindows('mine', locks)).toBe(1);
    other.release(); await Promise.resolve(); await Promise.resolve();
    expect(await otherWindows('mine', locks)).toBe(0);
    (locks as unknown as FakeLocks).held.add('unrelated-lock');
    expect(await otherWindows('mine', locks)).toBe(0);
    mine.release();
  });
  it('is unknown (null) without Web Locks or when this page does not hold its own lock', async () => {
    expect(await otherWindows('mine', undefined)).toBeNull();
    const locks = new FakeLocks();
    locks.held.add(`${WINDOW_LOCK_PREFIX}someone`);
    expect(await otherWindows('mine', locks as unknown as LockManager)).toBeNull();
    const failing = { request: () => Promise.reject(new Error('x')), query: () => Promise.reject(new Error('x')) } as unknown as LockManager;
    expect(await registerWindow('mine', failing).ready).toBe(false);
    expect(await otherWindows('mine', failing)).toBeNull();
  });
});

const bytes = png();
const original = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
function withImage(): WorkbenchData {
  const data = fixture();
  const image: ImageRecord = { id: id(4), hash: createHash('sha256').update(bytes).digest('hex'), mime: 'image/png', name: 'kept.png', width: 2, height: 2, byteLength: original.size, thumbnailBytes: original.size, createdAt: timestamp, metadata: { positive: null, negative: null, settings: unknownSettings(), texts: {}, warnings: [] } };
  const experiment = createExperiment(id(1), id(2), id(3), '比較', data.workspaces[0]!, null, timestamp); experiment.variantA.imageId = image.id;
  data.experiments.push(experiment); data.images.push(image); return validateData(data);
}

describe('purging image binaries (issue #16)', () => {
  it('bumps the revision, so a page that loaded earlier gets a conflict instead of saving stale references', async () => {
    const repo = await WorkbenchRepository.open('purge-revision', new IDBFactory());
    const data = withImage();
    await repo.save(data, 0, false, [{ id: id(4), original, thumbnail: original }]);
    const without = validateData({ ...data, images: [], experiments: data.experiments.map(item => ({ ...item, variantA: { ...item.variantA, imageId: null } })) });
    await repo.save(without, 1);
    await expect(repo.purgeUnreferenced([], 1)).rejects.toBeInstanceOf(StorageConflictError);
    expect(await repo.imageBlob(id(4))).toBeDefined();
    expect(await repo.purgeUnreferenced([id(4)], 2)).toEqual({ revision: 3, removed: 0 });
    expect(await repo.imageBlob(id(4))).toBeDefined();
    expect(await repo.purgeUnreferenced([], 3)).toEqual({ revision: 4, removed: 1 });
    expect(await repo.imageBlob(id(4))).toBeUndefined();
    expect((await repo.load()).revision).toBe(4);
    await expect(repo.save(without, 2)).rejects.toBeInstanceOf(StorageConflictError);
    repo.close();
  });
});

describe('complete backup of a fixed snapshot (issues #18, #20)', () => {
  it('uses binaries captured at the start even if the live staging map changes during the export', async () => {
    const snapshot = withImage();
    const live = new Map([[id(4), { record: snapshot.images[0]!, original, thumbnail: original }]]);
    const source = pinnedBinarySource(snapshot, live, async () => undefined);
    live.clear(); // e.g. Undo released the staged import while the export was running
    const result = await exportFullBackup(snapshot, source, timestamp);
    expect(result.missing).toEqual([]);
    const inspected = await inspectFullBackup(result.blob);
    expect(inspected.binaries.has(id(4))).toBe(true);
    expect(inspected.document.payload).toEqual(snapshot);
  });
  it('lists an image as missing when the stored binary belongs to a different record', async () => {
    const snapshot = withImage();
    const changed = { ...snapshot.images[0]!, hash: 'f'.repeat(64) };
    const source = pinnedBinarySource(snapshot, new Map([[id(4), { record: changed, original, thumbnail: original }]]), async () => undefined);
    const result = await exportFullBackup(snapshot, source, timestamp);
    expect(result.missing).toEqual([id(4)]);
    expect((await inspectFullBackup(result.blob)).manifest.missingImages).toEqual([id(4)]);
  });
  it('reads committed binaries by the snapshot record, not by whatever the live data holds now', async () => {
    const snapshot = withImage();
    const seen: ImageRecord[] = [];
    const source = pinnedBinarySource(snapshot, new Map(), async record => { seen.push(record); return original; });
    await source.image(id(4), false);
    expect(seen).toEqual([snapshot.images[0]]);
    expect(await source.image(id(99), false)).toBeUndefined();
  });
});

/** Library entries (each `raw` ≤ 1,000,000 chars) padded so the compact payload is MAX_BYTES - margin bytes. */
function nearLimit(margin: number): WorkbenchData {
  const base = fixture();
  const template = base.libraryEntries[0]!;
  const padding = Array.from({ length: 12 }, (_, index) => ({ ...template, id: id(100 + index), title: `pad ${index}`, raw: '' }));
  const empty = { ...base, libraryEntries: [...base.libraryEntries, ...padding] };
  let room = MAX_BYTES - new TextEncoder().encode(JSON.stringify(empty)).byteLength - margin;
  const entries = empty.libraryEntries.map(entry => {
    if (!entry.title.startsWith('pad ')) return entry;
    const extra = Math.max(0, Math.min(900_000, room)); room -= extra;
    return { ...entry, raw: 'a'.repeat(extra) };
  });
  return { ...empty, libraryEntries: entries };
}

describe('size limits: everything that can be saved can be backed up (issue #19)', () => {
  it('a payload just under the save limit still exports and imports as JSON, and inside a complete backup', async () => {
    const data = validateData(nearLimit(16));
    const payloadBytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
    expect(payloadBytes).toBeGreaterThan(MAX_BYTES - 64);
    expect(payloadBytes).toBeLessThanOrEqual(MAX_BYTES);
    const json = exportBackup(data, timestamp);
    expect(new TextEncoder().encode(json).byteLength).toBeGreaterThan(MAX_BYTES);
    expect(parseBackup(json).payload).toEqual(data);
    const full = await exportFullBackup(data, { image: async () => undefined }, timestamp);
    expect((await inspectFullBackup(full.blob)).document.payload).toEqual(data);
  });
  it('the payload limit itself is unchanged: one byte over is rejected on save and on import', () => {
    const over = nearLimit(-1);
    expect(() => validateData(over)).toThrow('10MiBを超えています');
    const document = JSON.stringify({ format: 'nai-prompt-workbench', schemaVersion: 3, exportedAt: timestamp, imageBinariesIncluded: false, payload: over });
    expect(() => parseBackup(document)).toThrow('10MiBを超えています');
  });
  it('documents prefer the indented form while it fits older readers, and reject files over the document limit', () => {
    const small = { format: 'x', value: [1, 2, 3] };
    expect(serializeDocument(small)).toBe(JSON.stringify(small, null, 2));
    expect(() => parseBackup('x'.repeat(MAX_DOCUMENT_BYTES + 1))).toThrow(`${MAX_DOCUMENT_BYTES / 1048576}MiBを超えています`);
    expect(() => serializeDocument({ value: 'x'.repeat(MAX_DOCUMENT_BYTES) })).toThrow('MiBを超えます');
  });
  it('a shuffle export of saveable data stays importable', () => {
    const data = validateData(fixture());
    const shuffle = data.shuffle;
    if (!shuffle) return;
    expect(parseShuffleExport(exportShuffle(shuffle, timestamp)).templates.length).toBe(shuffle.templates.length);
  });
});
