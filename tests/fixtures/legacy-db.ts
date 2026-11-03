import type { WorkbenchData } from '../../src/core/types';

// Exact v1 store layout used by P1/P2, shared by fake-IDB and Chromium migration tests.
export async function seedLegacyDatabase(factory: IDBFactory, name: string, data: WorkbenchData, metadataOverrides: Record<string, unknown> = {}): Promise<IDBDatabase> {
  const request = factory.open(name, 1);
  request.onupgradeneeded = () => {
    for (const store of ['libraryEntries', 'categories', 'workspaces']) request.result.createObjectStore(store, { keyPath: 'id' });
    request.result.createObjectStore('metadata');
  };
  const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const transaction = database.transaction(['libraryEntries', 'categories', 'workspaces', 'metadata'], 'readwrite');
  for (const name of ['libraryEntries', 'categories', 'workspaces'] as const) for (const item of data[name]) transaction.objectStore(name).put(item);
  const { libraryEntries: _entries, categories: _categories, workspaces: _workspaces, presets: _presets, experiments: _experiments, images: _images, settings, ...extra } = data;
  const metadata = transaction.objectStore('metadata');
  const values = { schemaVersion: 1, revision: 7, settings, extra, order: { libraryEntries: data.libraryEntries.map(item => item.id), categories: data.categories.map(item => item.id), workspaces: data.workspaces.map(item => item.id) }, ...metadataOverrides };
  for (const [key, value] of Object.entries(values)) metadata.put(value, key);
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
  return database;
}

export async function seedV2Database(factory: IDBFactory, name: string, data: WorkbenchData): Promise<IDBDatabase> {
  const request = factory.open(name, 2);
  const assets = ['libraryEntries', 'categories', 'workspaces', 'presets'] as const;
  request.onupgradeneeded = () => { for (const store of assets) request.result.createObjectStore(store, { keyPath: 'id' }); request.result.createObjectStore('metadata'); };
  const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const tx = db.transaction([...assets, 'metadata'], 'readwrite');
  for (const asset of assets) for (const record of data[asset]) tx.objectStore(asset).put(record);
  const { libraryEntries: _a, categories: _b, workspaces: _c, presets: _d, experiments: _e, images: _f, settings, ...extra } = data;
  for (const [key, value] of Object.entries({ schemaVersion: 2, revision: 12, settings, extra, order: Object.fromEntries(assets.map(name => [name, data[name].map(item => item.id)])) })) tx.objectStore('metadata').put(value, key);
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); return db;
}
