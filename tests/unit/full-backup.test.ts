import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { createExperiment, unknownSettings } from '../../src/core/experiments';
import { crc32 } from '../../src/core/png';
import { addProfile, createCharacter, createProfile, emptyShuffle } from '../../src/core/shuffle/state';
import type { ImageRecord, WorkbenchData } from '../../src/core/types';
import { createLab } from '../../src/core/lab/engine';
import { defaultDefinition } from '../../src/core/lab/types';
import { exportLabZip } from '../../src/data/lab-export';
import {
  BackupError, exportFullBackup, fullBackupFilename, inspectFullBackup, planFullRestore, validateManifest, type BinarySource,
} from '../../src/data/full-backup';
import { WorkbenchRepository } from '../../src/data/repository';
import { parseBackup, validateData } from '../../src/data/validation';
import { readZipDirectory, readZipEntry, writeZip, ZipError } from '../../src/data/zip';
import { APP_VERSION } from '../../src/version';
import { png } from '../fixtures/png';
import { fixture, timestamp } from './helpers';

const id = (n: number) => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const blob = (bytes: Uint8Array) => new Blob([new Uint8Array(bytes)], { type: 'image/png' });

function imageRecord(n: number, bytes: Uint8Array, thumb: Uint8Array, width: number, height: number): ImageRecord {
  return { id: id(n), hash: hash(bytes), mime: 'image/png', name: `image-${n}.png`, width, height, byteLength: bytes.byteLength, thumbnailBytes: thumb.byteLength, createdAt: timestamp, metadata: { positive: null, negative: null, settings: unknownSettings(), texts: {}, warnings: [] } };
}

/** Data with comparisons sharing one image, a Lab condition, shuffle settings and two distinct images. */
function richData() {
  const first = new Uint8Array(png(8, 6, {}, 10)); const second = new Uint8Array(png(4, 4, {}, 200));
  const thumbFirst = new Uint8Array(png(4, 3, {}, 10)); const thumbSecond = new Uint8Array(png(2, 2, {}, 200));
  const data = fixture();
  const a = imageRecord(1, first, thumbFirst, 8, 6); const b = imageRecord(2, second, thumbSecond, 4, 4);
  data.images.push(a, b);
  const one = createExperiment(id(10), id(11), id(12), '比較1', data.workspaces[0]!, null, timestamp);
  one.variantA.imageId = a.id; one.variantB.imageId = b.id;
  const two = createExperiment(id(20), id(21), id(22), '比較2', data.workspaces[0]!, null, timestamp);
  two.variantA.imageId = a.id; // the same image referenced twice
  data.experiments.push(one, two);
  const lab = createLab(id(30), defaultDefinition(), timestamp);
  lab.conditions[0] = { ...lab.conditions[0]!, imageId: b.id, status: 'completed' };
  data.lab = { schemaVersion: 1, experiments: [lab] };
  let shuffle = emptyShuffle();
  shuffle = { ...shuffle, characters: [{ ...createCharacter(id(40), 'Alice'), fixedPrompt: 'girl, blonde hair' }] };
  shuffle = addProfile(shuffle, { ...createProfile(id(41), 'Profile', 'seed1'), characterIds: [id(40)] });
  data.shuffle = shuffle;
  const binaries = new Map([[a.id, { original: blob(first), thumbnail: blob(thumbFirst) }], [b.id, { original: blob(second), thumbnail: blob(thumbSecond) }]]);
  return { data: validateData(data), binaries };
}
const sourceOf = (binaries: Map<string, { original: Blob; thumbnail: Blob }>): BinarySource => ({ image: async (imageId, thumbnail) => { const item = binaries.get(imageId); return thumbnail ? item?.thumbnail : item?.original; } });
async function zipBytes(file: Blob) { return new Uint8Array(await file.arrayBuffer()); }
/** Rebuild a backup ZIP with modified entries (CRC recomputed, so only deeper checks can catch it). */
async function rebuild(file: Blob, change: (name: string, bytes: Uint8Array) => Uint8Array | null, extra: { name: string; data: Uint8Array }[] = []) {
  const entries = await readZipDirectory(file);
  const parts = [];
  for (const entry of entries) { const next = change(entry.name, await readZipEntry(file, entry, 1 << 30)); if (next) parts.push({ name: entry.name, data: next }); }
  return writeZip([...parts, ...extra]);
}
const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const json = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;

describe('ZIP layer', () => {
  it('table CRC-32 matches the reference values', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
  it('round-trips stored entries from bytes and Blobs, verifying CRCs', async () => {
    const zip = await writeZip([{ name: 'a.txt', data: new TextEncoder().encode('hello') }, { name: 'dir/b.bin', data: new Blob([new Uint8Array([1, 2, 3])]) }]);
    const entries = await readZipDirectory(zip);
    expect(entries.map(entry => [entry.name, entry.size])).toEqual([['a.txt', 5], ['dir/b.bin', 3]]);
    expect(new TextDecoder().decode(await readZipEntry(zip, entries[0]!, 100))).toBe('hello');
  });
  it.each(['../evil.txt', '/abs.txt', 'a/../../b', 'C:\\x', 'a\\b', 'dir/', '', 'a/./b'])('refuses to write unsafe name %j', async name => {
    await expect(writeZip([{ name, data: new Uint8Array([1]) }])).rejects.toThrow(ZipError);
  });
  it('rejects truncated archives, garbage, compression, encryption and corrupt data', async () => {
    const zip = await zipBytes(await writeZip([{ name: 'a.txt', data: new TextEncoder().encode('hello world') }]));
    await expect(readZipDirectory(new Blob([zip.slice(0, zip.length - 5)]))).rejects.toThrow(ZipError);
    await expect(readZipDirectory(new Blob([new Uint8Array(100)]))).rejects.toThrow('終端');
    const compressed = zip.slice(); new DataView(compressed.buffer).setUint16(compressed.length - 22 - 46 - 5 + 10, 8, true);
    await expect(readZipDirectory(new Blob([compressed]))).rejects.toThrow('圧縮');
    const encrypted = zip.slice(); new DataView(encrypted.buffer).setUint16(encrypted.length - 22 - 46 - 5 + 8, 1, true);
    await expect(readZipDirectory(new Blob([encrypted]))).rejects.toThrow('暗号化');
    const flipped = zip.slice(); flipped[31 + 5]! ^= 0xff;
    const entries = await readZipDirectory(new Blob([flipped]));
    await expect(readZipEntry(new Blob([flipped]), entries[0]!, 100)).rejects.toThrow('CRC');
  });
  it('rejects a central directory path that differs from the local header (Zip Slip style smuggling)', async () => {
    const zip = await zipBytes(await writeZip([{ name: 'aaaaa.txt', data: new Uint8Array([1]) }]));
    const tampered = zip.slice(); const at = tampered.length - 22 - 46 - 9 + 46; tampered.set(new TextEncoder().encode('../x.txt'), at);
    await expect(readZipDirectory(new Blob([tampered]))).rejects.toThrow(/不正なパス|一致しません/);
  });
  it('rejects duplicate names and overlapping entries', async () => {
    const zip = await zipBytes(await writeZip([{ name: 'a', data: new Uint8Array([1]) }, { name: 'b', data: new Uint8Array([2]) }]));
    const duplicate = zip.slice(); const second = duplicate.length - 22 - 47; duplicate[second + 46] = 'a'.charCodeAt(0);
    await expect(readZipDirectory(new Blob([duplicate]))).rejects.toThrow(/同じ名前|一致しません/);
  });
});

describe('complete backup (ZIP with original images)', () => {
  it('empty data round-trips into a fresh profile', async () => {
    const data = fixture();
    const { blob: zip, manifest } = await exportFullBackup(data, sourceOf(new Map()), timestamp);
    expect(manifest).toMatchObject({ format: 'nai-prompt-workbench-full-backup', manifestVersion: 1, schemaVersion: 3, generator: { version: APP_VERSION }, images: [], missingImages: [] });
    const inspected = await inspectFullBackup(zip);
    const target = await WorkbenchRepository.open('empty-target', new IDBFactory());
    const plan = planFullRestore((await target.load()).data, inspected, 'replace', new Map());
    await target.save(plan.data, 0, true, plan.writes);
    expect((await target.load()).data).toEqual(data);
    target.close();
  });

  it('restores every text asset, shuffle, Lab and comparisons with all image associations into another profile', async () => {
    const { data, binaries } = richData();
    const progress: number[] = [];
    const { blob: zip, manifest, missing } = await exportFullBackup(data, sourceOf(binaries), timestamp, done => progress.push(done));
    expect(missing).toEqual([]);
    expect(manifest.images.map(item => item.id)).toEqual([id(1), id(2)]);
    expect(manifest.counts).toMatchObject({ experiments: 2, images: 2, labExperiments: 1, shuffleProfiles: 1, shuffleCharacters: 1 });
    expect(progress.at(-1)).toBe(2);
    // data.json alone is a regular JSON backup (backward compatible).
    const entries = await readZipDirectory(zip);
    expect(entries.map(entry => entry.name)).toEqual(['manifest.json', 'data.json', `images/${id(1)}.png`, `thumbnails/${id(1)}.png`, `images/${id(2)}.png`, `thumbnails/${id(2)}.png`]);
    expect(parseBackup(new TextDecoder().decode(await readZipEntry(zip, entries[1]!, 1 << 24))).payload).toEqual(data);

    const factory = new IDBFactory(); // a different Chrome profile = a different database
    const target = await WorkbenchRepository.open('other-profile', factory);
    const inspected = await inspectFullBackup(zip);
    expect(inspected.binaries.size).toBe(2);
    const plan = planFullRestore((await target.load()).data, inspected, 'replace', await target.binaryBindings([...inspected.binaries.keys()]));
    await target.save(plan.data, 0, true, plan.writes);
    target.close();
    const reopened = await WorkbenchRepository.open('other-profile', factory);
    const restored = (await reopened.load()).data;
    expect(restored).toEqual(data);
    expect(restored.experiments.map(item => [item.variantA.imageId, item.variantB.imageId])).toEqual([[id(1), id(2)], [id(1), null]]);
    expect(restored.lab!.experiments[0]!.conditions[0]!.imageId).toBe(id(2));
    for (const [imageId, item] of binaries) {
      expect(await zipBytes((await reopened.imageBlob(imageId))!)).toEqual(await zipBytes(item.original));
      expect(await zipBytes((await reopened.imageBlob(imageId, true))!)).toEqual(await zipBytes(item.thumbnail));
    }
    reopened.close();
  });

  it('exports records whose binaries are missing or corrupt as missing images, and restores them as missing', async () => {
    const { data, binaries } = richData();
    const corrupt = new Map(binaries); corrupt.set(id(2), { original: blob(new Uint8Array(png(4, 4, {}, 99))), thumbnail: binaries.get(id(2))!.thumbnail });
    corrupt.delete(id(1));
    const { blob: zip, manifest, warnings } = await exportFullBackup(data, sourceOf(corrupt), timestamp);
    expect(manifest.missingImages).toEqual([id(1), id(2)]);
    expect(warnings.join('\n')).toContain('一致しない');
    const inspected = await inspectFullBackup(zip);
    expect(inspected.binaries.size).toBe(0);
    expect(inspected.warnings.join()).toContain('欠落');
    const target = await WorkbenchRepository.open('missing', new IDBFactory());
    const plan = planFullRestore((await target.load()).data, inspected, 'replace', new Map());
    await target.save(plan.data, 0, true, plan.writes);
    expect((await target.load()).data.images).toHaveLength(2);
    expect(await target.imageBlob(id(1))).toBeUndefined();
    target.close();
  });

  it('rejects a ZIP that is not a complete backup, with a specific message for Experiment Lab ZIPs', async () => {
    const { data, binaries } = richData();
    const lab = await exportLabZip(data, data.lab!.experiments[0]!, timestamp, async imageId => binaries.get(imageId)?.original);
    await expect(inspectFullBackup(lab)).rejects.toThrow('Experiment LabのZIP');
    await expect(inspectFullBackup(await writeZip([{ name: 'readme.txt', data: new Uint8Array([1]) }]))).rejects.toThrow('manifest.json');
    await expect(inspectFullBackup(new Blob([new Uint8Array([80, 75, 3, 4, 0, 0])]))).rejects.toThrow('ZIPを読み取れません');
  });

  it.each([
    ['tampered image bytes (CRC recomputed)', (name: string, bytes: Uint8Array) => name === `images/${id(1)}.png` ? new Uint8Array(png(8, 6, {}, 11)) : bytes, 'SHA-256'],
    ['tampered data.json (same size)', (name: string, bytes: Uint8Array) => name === 'data.json' ? new TextEncoder().encode(new TextDecoder().decode(bytes).replace('"exportedAt": "2026-11-03', '"exportedAt": "2026-11-04')) : bytes, 'SHA-256'],
    ['resized data.json', (name: string, bytes: Uint8Array) => name === 'data.json' ? text(json(bytes)) : bytes, 'サイズ'],
    ['missing image file', (name: string, bytes: Uint8Array) => name === `images/${id(2)}.png` ? null : bytes, '画像原本がありません'],
    ['missing thumbnail', (name: string, bytes: Uint8Array) => name === `thumbnails/${id(2)}.png` ? null : bytes, 'サムネイルがありません'],
    ['missing data.json', (name: string, bytes: Uint8Array) => name === 'data.json' ? null : bytes, 'data.json'],
    ['unknown manifest version', (name: string, bytes: Uint8Array) => name === 'manifest.json' ? text({ ...json(bytes), manifestVersion: 2 }) : bytes, '未対応'],
    ['manifest counts not matching', (name: string, bytes: Uint8Array) => name === 'manifest.json' ? text({ ...json(bytes), counts: { ...(json(bytes).counts as object), presets: 99 } }) : bytes, '件数'],
    ['manifest path traversal', (name: string, bytes: Uint8Array) => name === 'manifest.json' ? text({ ...json(bytes), data: { ...(json(bytes).data as object), path: '../data.json' } }) : bytes, 'manifest.data'],
    ['invalid manifest JSON', (name: string, bytes: Uint8Array) => name === 'manifest.json' ? new TextEncoder().encode('{"format": ') : bytes, 'JSON'],
    ['prototype pollution key', (name: string, bytes: Uint8Array) => name === 'manifest.json' ? new TextEncoder().encode(new TextDecoder().decode(bytes).replace('"counts"', '"__proto__": {}, "counts"')) : bytes, '危険'],
  ])('rejects %s before writing anything', async (_label, change, message) => {
    const { data, binaries } = richData();
    const { blob: zip } = await exportFullBackup(data, sourceOf(binaries), timestamp);
    await expect(inspectFullBackup(await rebuild(zip, change))).rejects.toThrow(message);
  });

  it('rejects unexpected extra files, including path-like names', async () => {
    const { data, binaries } = richData();
    const { blob: zip } = await exportFullBackup(data, sourceOf(binaries), timestamp);
    await expect(inspectFullBackup(await rebuild(zip, (_name, bytes) => bytes, [{ name: 'images/evil.js', data: new Uint8Array([1]) }]))).rejects.toThrow('想定外');
    await expect(inspectFullBackup(await rebuild(zip, (_name, bytes) => bytes, [{ name: `images/${id(9)}.png`, data: new Uint8Array(png()) }]))).rejects.toThrow('manifestにない');
  });

  it('merge mode rejects ID collisions; replace refuses to overwrite a different binary under the same ID', async () => {
    const { data, binaries } = richData();
    const { blob: zip } = await exportFullBackup(data, sourceOf(binaries), timestamp);
    const inspected = await inspectFullBackup(zip);
    expect(() => planFullRestore(data, inspected, 'merge', new Map())).toThrow('重複');
    const other = { hash: '0'.repeat(64), byteLength: 1, thumbnailBytes: 1 };
    expect(() => planFullRestore(fixture(), inspected, 'replace', new Map([[id(1), other]]))).toThrow(BackupError);
    // Identical bytes under the same ID are fine (re-restoring the same backup).
    const same = new Map([[id(1), { hash: data.images[0]!.hash, byteLength: data.images[0]!.byteLength, thumbnailBytes: data.images[0]!.thumbnailBytes }]]);
    expect(planFullRestore(fixture(), inspected, 'replace', same).writes).toHaveLength(2);
  });

  it('a quota failure while writing keeps the existing data and binaries untouched (atomic restore)', async () => {
    const { data, binaries } = richData();
    const { blob: zip } = await exportFullBackup(data, sourceOf(binaries), timestamp);
    const repo = await WorkbenchRepository.open('quota-restore', new IDBFactory());
    const before = fixture(); before.libraryEntries[0]!.title = '既存データ';
    await repo.save(validateData(before), 0);
    const inspected = await inspectFullBackup(zip);
    const plan = planFullRestore((await repo.load()).data, inspected, 'replace', new Map());
    const put = IDBObjectStore.prototype.put; let count = 0;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      // Fail on the second image binary: some writes were already queued in the transaction.
      if (this.name === 'imageOriginals' && ++count === 2) throw new DOMException('quota exceeded', 'QuotaExceededError');
      return put.call(this, value, key);
    });
    try { await expect(repo.save(plan.data, 1, true, plan.writes)).rejects.toThrow('quota'); } finally { spy.mockRestore(); }
    expect(await repo.load()).toEqual({ data: validateData(before), revision: 1 });
    expect(await repo.imageBlob(id(1))).toBeUndefined();
    expect(await repo.previousImport()).toBeUndefined();
    repo.close();
  });

  it('re-verifies binaries at write time: a backup file changed after inspection writes nothing', async () => {
    const { data, binaries } = richData();
    const { blob: zip } = await exportFullBackup(data, sourceOf(binaries), timestamp);
    const inspected = await inspectFullBackup(zip);
    const repo = await WorkbenchRepository.open('changed-file', new IDBFactory());
    const plan = planFullRestore((await repo.load()).data, inspected, 'replace', new Map());
    plan.writes[0] = { ...plan.writes[0]!, original: blob(new Uint8Array(png(8, 6, {}, 77))) };
    await expect(repo.save(plan.data, 0, true, plan.writes)).rejects.toThrow('一致しません');
    expect((await repo.load()).revision).toBe(0);
    repo.close();
  });

  it('validates manifest shape strictly and names files deterministically', () => {
    expect(() => validateManifest({ format: 'nai-prompt-workbench-full-backup' })).toThrow(BackupError);
    expect(fullBackupFilename('2026-11-18T06:07:08.123Z')).toBe('nai-prompt-workbench-backup-20261118-060708Z.zip');
  });

  it('package.json and the manifest share one version', () => {
    expect(JSON.parse(readFileSync('package.json', 'utf8')).version).toBe(APP_VERSION);
  });
});
