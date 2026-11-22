import { emptyData } from '../core/commands';
import { inspectPng } from '../core/png';
import type { ImageRecord, WorkbenchData } from '../core/types';
import { isValidated, SCHEMA_VERSION, validateData, validateLegacyData, validatePreImageData } from './validation';
import { quarantineShuffle } from './shuffle';

const ASSETS = ['libraryEntries', 'categories', 'workspaces', 'presets', 'experiments', 'images'] as const;
const BINARY_STORES = ['imageOriginals', 'imageThumbnails'] as const;
const STORES = [...ASSETS, ...BINARY_STORES, 'metadata'];
const LEGACY_STORES = ['libraryEntries', 'categories', 'workspaces', 'metadata'];
const MIGRATION_BACKUP = 'migrationBackup:v1';
import type { ImageWrite } from './images';
export const DATABASE_NAME = 'nai-prompt-workbench';
export class StorageConflictError extends Error {}
export class MigrationError extends Error {
  constructor(message: string, readonly snapshot: unknown) { super(message); }
}
export interface StoredState { data: WorkbenchData; revision: number; notice?: string }

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('保存トランザクションが中止されました'));
    transaction.onerror = () => { /* onabort reports the final failure */ };
  });
}

async function readState(transaction: IDBTransaction, expectedVersion = SCHEMA_VERSION, checkOrder = true, legacy = false): Promise<{ data: unknown; revision: number }> {
  const metadata = transaction.objectStore('metadata');
  const [libraryEntries, categories, workspaces, presets, experiments, images, settings, extra, version, revision, order] = await Promise.all([
    request(transaction.objectStore('libraryEntries').getAll()),
    request(transaction.objectStore('categories').getAll()),
    request(transaction.objectStore('workspaces').getAll()),
    expectedVersion === 1 || legacy ? Promise.resolve(undefined) : request(transaction.objectStore('presets').getAll()),
    expectedVersion < 3 ? Promise.resolve([]) : request(transaction.objectStore('experiments').getAll()),
    expectedVersion < 3 ? Promise.resolve([]) : request(transaction.objectStore('images').getAll()),
    request(metadata.get('settings')) as Promise<unknown>,
    request(metadata.get('extra')) as Promise<Record<string, unknown> | undefined>,
    request(metadata.get('schemaVersion')) as Promise<unknown>,
    request(metadata.get('revision')) as Promise<unknown>,
    request(metadata.get('order')) as Promise<Record<string, unknown> | undefined>,
  ]);
  if (version !== expectedVersion) throw new Error('DBのschemaVersionが不正または未対応です。データは変更しません');
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) throw new Error('DBのrevisionが破損しています');
  if (!extra || typeof extra !== 'object' || Array.isArray(extra) || settings === undefined) throw new Error('DBのmetadataが破損しています');
  const ordered = (records: { id: string }[], key: string) => {
    if (order === undefined) return records;
    const ids = order?.[key];
    const byId = new Map(records.map(record => [record.id, record]));
    if (!Array.isArray(ids) || ids.length !== records.length || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id as string))) {
      if (checkOrder) throw new Error('DBのレコード順序が破損しています');
      return records;
    }
    return ids.map(id => byId.get(id as string)!);
  };
  return { data: { ...extra, libraryEntries: ordered(libraryEntries, 'libraryEntries'), categories: ordered(categories, 'categories'), workspaces: ordered(workspaces, 'workspaces'), ...(expectedVersion === 1 || legacy ? {} : { presets: ordered(presets!, 'presets') }), ...(expectedVersion < 3 ? {} : { experiments: ordered(experiments, 'experiments'), images: ordered(images, 'images') }), settings }, revision: revision as number };
}

/** Revision check for a save: two metadata reads instead of reading every store. */
async function readRevision(transaction: IDBTransaction): Promise<number> {
  const metadata = transaction.objectStore('metadata');
  const [version, revision] = await Promise.all([request(metadata.get('schemaVersion')) as Promise<unknown>, request(metadata.get('revision')) as Promise<unknown>]);
  if (version !== SCHEMA_VERSION) throw new Error('DBのschemaVersionが不正または未対応です。データは変更しません');
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) throw new Error('DBのrevisionが破損しています');
  return revision as number;
}

async function rawDump(transaction: IDBTransaction, legacy = false) {
  const [entries, categories, workspaces, presets, keys, metadata] = await Promise.all([
    request(transaction.objectStore('libraryEntries').getAll()),
    request(transaction.objectStore('categories').getAll()),
    request(transaction.objectStore('workspaces').getAll()),
    legacy ? Promise.resolve([]) : request(transaction.objectStore('presets').getAll()),
    request(transaction.objectStore('metadata').getAllKeys()),
    request(transaction.objectStore('metadata').getAll()),
  ]);
  const extraAssets: Record<string, unknown> = {};
  for (const name of ['experiments', 'images']) if (transaction.objectStoreNames.contains(name)) extraAssets[name] = await request(transaction.objectStore(name).getAll());
  return { format: 'nai-prompt-workbench-recovery', imageBinariesIncluded: false, libraryEntries: entries, categories, workspaces, presets, ...extraAssets, metadataKeys: keys, metadata };
}
/**
 * Differential write of one asset store (ADR-105): `before` is exactly what the store
 * holds. Both arrays are validateData results, whose records are frozen and shared
 * between results, so an unchanged record is the same object; anything else is put.
 */
function writeChanges(store: IDBObjectStore, before: readonly { id: string }[], after: readonly { id: string }[]) {
  const removed = new Map(before.map(record => [record.id, record]));
  for (const record of after) {
    if (removed.get(record.id) !== record) store.put(record);
    removed.delete(record.id);
  }
  for (const id of removed.keys()) store.delete(id);
}
function writeMetadata(metadata: IDBObjectStore, data: WorkbenchData, revision: number) {
  const { libraryEntries: _entries, categories: _categories, workspaces: _workspaces, presets: _presets, experiments: _experiments, images: _images, settings, ...extra } = data;
  metadata.put(settings, 'settings');
  metadata.put(extra, 'extra');
  metadata.put(Object.fromEntries(ASSETS.map(name => [name, data[name].map(item => item.id)])), 'order');
  metadata.put(revision, 'revision');
}

async function migrateLegacy(database: IDBDatabase, transaction: IDBTransaction, version: number): Promise<void> {
  let backup: unknown = null;
  try {
    const raw = await rawDump(transaction, version === 1);
    backup = { ...raw, databaseVersion: version, schemaVersion: version, savedAt: new Date().toISOString() };
    const previous = await readState(transaction, version, true, version === 1);
    const data = version === 1 ? validateLegacyData(previous.data) : validatePreImageData(previous.data);
    backup = { ...backup as object, data: previous.data, revision: previous.revision };
    // Wait for the full v1 backup write to succeed before changing the schema.
    // This versionchange transaction is atomic: any later failure rolls it all back.
    await request(transaction.objectStore('metadata').add(backup, `migrationBackup:v${version}`));
    for (const name of [...ASSETS, ...BINARY_STORES]) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'id' });
    writeMetadata(transaction.objectStore('metadata'), data, previous.revision + 1);
    transaction.objectStore('metadata').put(SCHEMA_VERSION, 'schemaVersion');
  } catch (cause) {
    throw new MigrationError(`v${version}→v3移行に失敗しました。元DBは変更しません: ${cause instanceof Error ? cause.message : '不明なエラー'}`, backup);
  }
}

export class WorkbenchRepository {
  /**
   * What this instance itself last wrote in a committed save, and the revision it
   * wrote. The next save writes only the differences when the database is still at
   * that revision (every writer bumps it). Cleared by load, purge, any failure and
   * while a save runs; backup saves and unvalidated input always write everything.
   */
  private committed: { data: WorkbenchData; revision: number } | null = null;
  private constructor(private readonly database: IDBDatabase) {
    database.onversionchange = () => database.close();
  }

  static open(name = DATABASE_NAME, factory: IDBFactory = indexedDB): Promise<WorkbenchRepository> {
    return new Promise((resolve, reject) => {
      const req = factory.open(name, SCHEMA_VERSION);
      let blocked = false;
      let migrationError: unknown;
      req.onblocked = () => { blocked = true; reject(new Error('別のパネルがDBを使用中です。閉じて再試行してください')); };
      req.onerror = () => reject(migrationError ?? req.error ?? new Error('IndexedDBを開けません'));
      req.onupgradeneeded = event => {
        const transaction = req.transaction!;
        if (blocked) { transaction.abort(); return; }
        if (event.oldVersion === 1 || event.oldVersion === 2) {
          if ([...LEGACY_STORES, ...(event.oldVersion === 2 ? ['presets'] : [])].some(store => !req.result.objectStoreNames.contains(store))) {
            migrationError = new MigrationError(`v${event.oldVersion} DBのストアが不足しています。自動初期化しません`, null);
            transaction.abort(); return;
          }
          void migrateLegacy(req.result, transaction, event.oldVersion).catch(error => {
            migrationError = error;
            try { transaction.abort(); } catch { /* Already aborted. */ }
          });
          return;
        }
        if (event.oldVersion !== 0) { transaction.abort(); return; }
        for (const store of STORES) req.result.createObjectStore(store, store === 'metadata' ? undefined : { keyPath: 'id' });
        const metadata = transaction.objectStore('metadata');
        metadata.put(SCHEMA_VERSION, 'schemaVersion');
        writeMetadata(metadata, emptyData(), 0);
      };
      req.onsuccess = () => { if (blocked) req.result.close(); else resolve(new WorkbenchRepository(req.result)); };
    });
  }

  close() { this.database.close(); }

  async load(): Promise<StoredState> {
    this.committed = null;
    const transaction = this.database.transaction(STORES, 'readonly');
    const [state] = await Promise.all([readState(transaction), completion(transaction)]);
    // Corrupt shuffle data is isolated (kept in shuffleRecovery) instead of blocking the library.
    const isolated = quarantineShuffle(state.data, new Date().toISOString());
    return { data: validateData(isolated.data), revision: state.revision, ...(isolated.notice ? { notice: isolated.notice } : {}) };
  }

  async save(input: WorkbenchData, expectedRevision: number, backup = false, imageWrites: ImageWrite[] = []): Promise<number> {
    // Data produced by validateData (every commit) is not validated a second time.
    const data = isValidated(input) ? input : validateData(input);
    const base = this.committed;
    this.committed = null;
    // Complete asynchronous hashing before opening the transaction, which must
    // remain active until all metadata and binary writes have been queued.
    for (const image of imageWrites) {
      const record = data.images.find(record => record.id === image.id);
      if (!record) continue;
      if (!(image.original instanceof Blob) || !(image.thumbnail instanceof Blob) || image.original.size !== record.byteLength || image.thumbnail.size !== record.thumbnailBytes || image.original.type !== 'image/png' || image.thumbnail.type !== 'image/png') throw new Error('画像Blobとメタデータが一致しません');
      const bytes = new Uint8Array(await image.original.arrayBuffer()); const png = inspectPng(bytes);
      const thumb = inspectPng(new Uint8Array(await image.thumbnail.arrayBuffer()));
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('');
      if (hash !== record.hash || png.width !== record.width || png.height !== record.height || thumb.width > 256 || thumb.height > 256) throw new Error('画像ハッシュまたは寸法が一致しません');
    }
    const transaction = this.database.transaction(STORES, 'readwrite');
    const done = completion(transaction);
    void done.catch(() => {});
    try {
      // Only a pre-import backup needs the full previous state; a normal save only checks the revision.
      const previous = backup ? await readState(transaction, SCHEMA_VERSION, false) : null;
      const revision = previous ? previous.revision : await readRevision(transaction);
      if (revision !== expectedRevision) throw new StorageConflictError('別のパネルで更新されています。作業中データをエクスポートして再読込してください');
      const metadata = transaction.objectStore('metadata');
      if (previous) metadata.put({ ...previous, savedAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION }, 'previousImport');
      // The revision check above proves that no other save happened since `base` was committed.
      const differential = !backup && base !== null && base.revision === expectedRevision && isValidated(input);
      for (const name of ASSETS) {
        const store = transaction.objectStore(name);
        if (differential) { writeChanges(store, base.data[name], data[name]); continue; }
        store.clear();
        for (const item of data[name]) store.put(item);
      }
      for (const image of imageWrites) {
        const record = data.images.find(record => record.id === image.id);
        if (!record) continue;
        const binding = { hash: record.hash, width: record.width, height: record.height, byteLength: record.byteLength, thumbnailBytes: record.thumbnailBytes };
        transaction.objectStore('imageOriginals').put({ id: image.id, blob: image.original, ...binding });
        transaction.objectStore('imageThumbnails').put({ id: image.id, blob: image.thumbnail, ...binding });
      }
      writeMetadata(metadata, data, expectedRevision + 1);
      await done;
      this.committed = { data, revision: expectedRevision + 1 };
      return expectedRevision + 1;
    } catch (error) {
      try { transaction.abort(); } catch { /* Already completed/aborted. */ }
      await done.catch(() => {});
      throw error;
    }
  }

  private async metadataValue(key: string): Promise<unknown> {
    const transaction = this.database.transaction('metadata', 'readonly');
    const [data] = await Promise.all([request(transaction.objectStore('metadata').get(key)) as Promise<unknown>, completion(transaction)]);
    return data;
  }
  previousImport() { return this.metadataValue('previousImport'); }
  async migrationBackup() { return await this.metadataValue('migrationBackup:v2') ?? await this.metadataValue(MIGRATION_BACKUP); }

  async imageBlob(id: string, thumbnail = false, expected?: ImageRecord): Promise<Blob | undefined> {
    const store = thumbnail ? 'imageThumbnails' : 'imageOriginals';
    const transaction = this.database.transaction([store, 'images'], 'readonly');
    const [result, current] = await Promise.all([
      request(transaction.objectStore(store).get(id)) as Promise<(Pick<ImageRecord, 'hash' | 'width' | 'height' | 'byteLength' | 'thumbnailBytes'> & { blob: Blob }) | undefined>,
      request(transaction.objectStore('images').get(id)) as Promise<ImageRecord | undefined>, completion(transaction),
    ]);
    const record = expected ?? current;
    if (!result || !(result.blob instanceof Blob) || result.blob.type !== 'image/png') return undefined;
    if (record && (['hash', 'width', 'height', 'byteLength', 'thumbnailBytes'] as const).some(key => result[key] !== record[key])) return undefined;
    if (result.blob.size !== (thumbnail ? result.thumbnailBytes : result.byteLength)) return undefined;
    return result.blob;
  }

  /** Bindings of binaries already stored under these image IDs (also ones kept only for Undo / previous import). */
  async binaryBindings(ids: readonly string[]): Promise<Map<string, { hash: string; byteLength: number; thumbnailBytes: number }>> {
    const transaction = this.database.transaction('imageOriginals', 'readonly');
    const store = transaction.objectStore('imageOriginals');
    const [records] = await Promise.all([Promise.all(ids.map(id => request(store.get(id)) as Promise<{ hash?: unknown; byteLength?: unknown; thumbnailBytes?: unknown } | undefined>)), completion(transaction)]);
    const result = new Map<string, { hash: string; byteLength: number; thumbnailBytes: number }>();
    records.forEach((record, index) => { if (record) result.set(ids[index]!, { hash: String(record.hash), byteLength: Number(record.byteLength), thumbnailBytes: Number(record.thumbnailBytes) }); });
    return result;
  }

  // Explicit cleanup is separate from deletion/Undo. Retained binaries allow Undo
  // and the previous-import backup to restore associations without losing pixels.
  // The caller passes every image ID its Undo/Redo history references and must
  // make sure no other page (with its own history) is open (issue #16). The
  // purge bumps the revision, so a page that loaded earlier gets a conflict
  // instead of silently saving references to purged binaries.
  async purgeUnreferenced(protectedIds: readonly string[], expectedRevision?: number): Promise<{ revision: number; removed: number }> {
    this.committed = null;
    const transaction = this.database.transaction(STORES, 'readwrite'); const done = completion(transaction); void done.catch(() => {});
    try {
      const state = await readState(transaction);
      if (expectedRevision !== undefined && state.revision !== expectedRevision) throw new StorageConflictError('別の画面で保存されたため、画像バイナリの整理を中止しました。最新の内容を読み込んでから再試行してください');
      const keep = new Set([...protectedIds, ...validateData(state.data).images.map(image => image.id)]);
      const previous = await request(transaction.objectStore('metadata').get('previousImport')) as { data?: WorkbenchData } | undefined;
      for (const image of previous?.data?.images ?? []) keep.add(image.id);
      let removed = 0;
      for (const store of BINARY_STORES) { for (const key of await request(transaction.objectStore(store).getAllKeys())) if (!keep.has(String(key))) { transaction.objectStore(store).delete(key); if (store === 'imageOriginals') removed++; } }
      transaction.objectStore('metadata').put(state.revision + 1, 'revision');
      await done;
      return { revision: state.revision + 1, removed };
    } catch (error) { try { transaction.abort(); } catch {} await done.catch(() => {}); throw error; }
  }

  async recover(input: WorkbenchData): Promise<StoredState> {
    const data = validateData(input);
    const transaction = this.database.transaction(STORES, 'readonly');
    const [previous] = await Promise.all([readState(transaction, SCHEMA_VERSION, false), completion(transaction)]);
    return { data, revision: await this.save(data, previous.revision, true) };
  }

  async recoveryDump(): Promise<unknown> {
    const transaction = this.database.transaction(STORES, 'readonly');
    const [dump] = await Promise.all([rawDump(transaction), completion(transaction)]);
    return dump;
  }
}
