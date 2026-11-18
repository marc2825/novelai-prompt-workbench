import { crc32, inspectPng, MAX_IMAGE_BYTES } from '../core/png';
import type { BackupDocument, ImageRecord, WorkbenchData } from '../core/types';
import { APP_NAME, APP_VERSION } from '../version';
import { exportBackup, prepareImport } from './backup';
import type { ImageWrite } from './images';
import { MAX_BYTES, parseBackup, SCHEMA_VERSION, validateSafeJson } from './validation';
import { readZipDirectory, readZipEntry, writeZip, zipEntryBlob, ZipError, type ZipEntry, type ZipInput } from './zip';

// Complete backup: every text asset (data.json, the regular JSON backup) plus the
// original PNG and thumbnail of every image, so a different Chrome profile can be
// restored exactly. See docs/backup.md for the format and the threat model.
//
//   manifest.json   format, versions, counts, size + SHA-256 of every file
//   data.json       the regular JSON backup (importable on its own)
//   images/<id>.png       original PNG (SHA-256 = ImageRecord.hash)
//   thumbnails/<id>.png   stored thumbnail (≤256px)

export const FULL_BACKUP_FORMAT = 'nai-prompt-workbench-full-backup';
export const FULL_BACKUP_VERSION = 1;
export const FULL_BACKUP_MAX_BYTES = 2 * 1024 * 1024 * 1024 - 1;
const MANIFEST_MAX_BYTES = 8 * 1024 * 1024;
const THUMBNAIL_MAX_BYTES = 1024 * 1024;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const IMAGE_PATH = new RegExp(`^images/(${UUID})\\.png$`, 'i');
const THUMBNAIL_PATH = new RegExp(`^thumbnails/(${UUID})\\.png$`, 'i');
const HEX64 = /^[0-9a-f]{64}$/;

export interface FileDigest { path: string; bytes: number; sha256: string }
export interface FullBackupManifest {
  format: typeof FULL_BACKUP_FORMAT;
  manifestVersion: typeof FULL_BACKUP_VERSION;
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
  generator: { name: string; version: string };
  data: FileDigest;
  images: { id: string; original: FileDigest; thumbnail: FileDigest }[];
  /** Image records whose binaries were unavailable or corrupt at export time. */
  missingImages: string[];
  counts: BackupCounts;
}
export type BackupCounts = Record<'libraryEntries' | 'categories' | 'workspaces' | 'presets' | 'experiments' | 'images' | 'labExperiments' | 'shuffleProfiles' | 'shuffleCharacters' | 'shuffleTemplates' | 'shuffleHistory', number>;

export class BackupError extends Error {}
const fail = (message: string): never => { throw new BackupError(message); };

export function countsOf(data: WorkbenchData): BackupCounts {
  return {
    libraryEntries: data.libraryEntries.length, categories: data.categories.length, workspaces: data.workspaces.length, presets: data.presets.length,
    experiments: data.experiments.length, images: data.images.length, labExperiments: data.lab?.experiments.length ?? 0,
    shuffleProfiles: data.shuffle?.profiles.length ?? 0, shuffleCharacters: data.shuffle?.characters.length ?? 0,
    shuffleTemplates: data.shuffle?.templates.length ?? 0, shuffleHistory: data.shuffle?.history.length ?? 0,
  };
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), value => value.toString(16).padStart(2, '0')).join('');
}
export function fullBackupFilename(time: string): string {
  return `nai-prompt-workbench-backup-${time.replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '').replace('T', '-')}.zip`;
}

export interface BinarySource { image(id: string, thumbnail: boolean): Promise<Blob | undefined> }
export interface ExportResult { blob: Blob; manifest: FullBackupManifest; missing: string[]; warnings: string[] }
export type Progress = (done: number, total: number) => void;

/**
 * Builds the complete backup. Image bytes are read one at a time (to verify the
 * SHA-256 against the record and compute the ZIP CRC) and then released; the
 * resulting ZIP references the stored Blobs instead of copying them.
 */
export async function exportFullBackup(data: WorkbenchData, source: BinarySource, now: string, onProgress?: Progress): Promise<ExportResult> {
  const encoder = new TextEncoder();
  const json = encoder.encode(exportBackup(data, now));
  const entries: ZipInput[] = [];
  const images: FullBackupManifest['images'] = [];
  const missing: string[] = []; const warnings: string[] = [];
  let total = json.byteLength;
  for (const [index, record] of data.images.entries()) {
    onProgress?.(index, data.images.length);
    const original = await source.image(record.id, false); const thumbnail = await source.image(record.id, true);
    if (!original || !thumbnail || original.size !== record.byteLength || thumbnail.size !== record.thumbnailBytes) { missing.push(record.id); continue; }
    const bytes = new Uint8Array(await original.arrayBuffer());
    const hash = await sha256(bytes);
    if (hash !== record.hash) { missing.push(record.id); warnings.push(`画像「${record.name}」の原本がメタデータと一致しないため含めませんでした`); continue; }
    const originalCrc = crc32(bytes);
    const thumbBytes = new Uint8Array(await thumbnail.arrayBuffer());
    total += bytes.byteLength + thumbBytes.byteLength;
    if (total > FULL_BACKUP_MAX_BYTES) fail('バックアップが2GiBを超えます。不要な画像を削除するか、Experiment LabのZIP・画像原本の個別保存を併用してください');
    const id = record.id;
    images.push({ id, original: { path: `images/${id}.png`, bytes: bytes.byteLength, sha256: hash }, thumbnail: { path: `thumbnails/${id}.png`, bytes: thumbBytes.byteLength, sha256: await sha256(thumbBytes) } });
    entries.push({ name: `images/${id}.png`, data: original, crc: originalCrc }, { name: `thumbnails/${id}.png`, data: thumbBytes });
  }
  onProgress?.(data.images.length, data.images.length);
  if (missing.length) warnings.push(`${missing.length}件の画像は原本がこの端末にないため、メタデータだけを含めました（復元先では欠落として表示されます）`);
  const manifest: FullBackupManifest = {
    format: FULL_BACKUP_FORMAT, manifestVersion: FULL_BACKUP_VERSION, schemaVersion: SCHEMA_VERSION, exportedAt: now,
    generator: { name: APP_NAME, version: APP_VERSION },
    data: { path: 'data.json', bytes: json.byteLength, sha256: await sha256(json) },
    images, missingImages: missing, counts: countsOf(data),
  };
  const blob = await writeZip([{ name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest, null, 2)) }, { name: 'data.json', data: json }, ...entries], FULL_BACKUP_MAX_BYTES);
  return { blob, manifest, missing, warnings };
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`manifest.${path}: オブジェクトが必要です`);
  return value as Record<string, unknown>;
}
function digest(value: unknown, path: string, expectedPath: string, maxBytes: number): FileDigest {
  const item = object(value, path);
  if (item.path !== expectedPath || !Number.isSafeInteger(item.bytes) || (item.bytes as number) < 1 || (item.bytes as number) > maxBytes || typeof item.sha256 !== 'string' || !HEX64.test(item.sha256)) fail(`manifest.${path}: ファイル情報が不正です`);
  return { path: expectedPath, bytes: item.bytes as number, sha256: item.sha256 as string };
}
/** Strict manifest validation: known shape only, exact paths, unique IDs. */
export function validateManifest(input: unknown): FullBackupManifest {
  validateSafeJson(input);
  const manifest = object(input, 'root');
  if (manifest.format !== FULL_BACKUP_FORMAT) fail('完全バックアップのmanifestではありません');
  if (manifest.manifestVersion !== FULL_BACKUP_VERSION) fail(`未対応のバックアップ形式バージョンです（${String(manifest.manifestVersion)}）。新しい版のアプリで作成された可能性があります`);
  if (manifest.schemaVersion !== SCHEMA_VERSION) fail(`未対応のデータschemaVersionです（${String(manifest.schemaVersion)}）`);
  if (typeof manifest.exportedAt !== 'string' || !Number.isFinite(Date.parse(manifest.exportedAt))) fail('manifest.exportedAt が不正です');
  const generator = object(manifest.generator, 'generator');
  if (typeof generator.name !== 'string' || generator.name.length > 100 || typeof generator.version !== 'string' || generator.version.length > 50) fail('manifest.generator が不正です');
  const data = digest(manifest.data, 'data', 'data.json', MAX_BYTES);
  if (!Array.isArray(manifest.images) || !Array.isArray(manifest.missingImages)) fail('manifest.images / missingImages が不正です');
  const ids = new Set<string>();
  const images = (manifest.images as unknown[]).map((value, index) => {
    const item = object(value, `images[${index}]`);
    if (typeof item.id !== 'string' || !new RegExp(`^${UUID}$`, 'i').test(item.id) || ids.has(item.id)) fail(`manifest.images[${index}].id が不正または重複しています`);
    const id = item.id as string; ids.add(id);
    return { id, original: digest(item.original, `images[${index}].original`, `images/${id}.png`, MAX_IMAGE_BYTES), thumbnail: digest(item.thumbnail, `images[${index}].thumbnail`, `thumbnails/${id}.png`, THUMBNAIL_MAX_BYTES) };
  });
  const missingImages = (manifest.missingImages as unknown[]).map((value, index) => {
    if (typeof value !== 'string' || !new RegExp(`^${UUID}$`, 'i').test(value) || ids.has(value)) fail(`manifest.missingImages[${index}] が不正または重複しています`);
    ids.add(value as string); return value as string;
  });
  const counts = object(manifest.counts, 'counts');
  const keys = Object.keys(countsOf({ libraryEntries: [], categories: [], workspaces: [], presets: [], experiments: [], images: [], settings: { activeWorkspaceId: null, librarySort: 'title' } }));
  for (const key of keys) if (!Number.isSafeInteger(counts[key]) || (counts[key] as number) < 0) fail(`manifest.counts.${key} が不正です`);
  return { format: FULL_BACKUP_FORMAT, manifestVersion: FULL_BACKUP_VERSION, schemaVersion: SCHEMA_VERSION, exportedAt: manifest.exportedAt as string, generator: { name: generator.name as string, version: generator.version as string }, data, images, missingImages, counts: Object.fromEntries(keys.map(key => [key, counts[key]])) as BackupCounts };
}

export interface InspectedBackup {
  manifest: FullBackupManifest;
  document: BackupDocument;
  /** Verified binaries (lazy Blob views of the selected file) by image ID. */
  binaries: Map<string, { original: Blob; thumbnail: Blob }>;
  imageBytes: number;
  warnings: string[];
}

/**
 * Validates a complete backup before anything is written: ZIP structure, the
 * manifest, data.json (size, SHA-256, full schema validation), the cross-reference
 * between records, manifest and files, and every image (CRC, SHA-256 = record
 * hash, PNG structure and dimensions). Reads one entry at a time.
 */
export async function inspectFullBackup(file: Blob, onProgress?: Progress): Promise<InspectedBackup> {
  if (file.size > FULL_BACKUP_MAX_BYTES) fail('ファイルが2GiBを超えています');
  let entries: ZipEntry[];
  try { entries = await readZipDirectory(file, { maxBytes: FULL_BACKUP_MAX_BYTES }); }
  catch (error) { throw new BackupError(`ZIPを読み取れません: ${error instanceof Error ? error.message : '不明なエラー'}`); }
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  if (!byName.has('manifest.json')) {
    if (byName.has('experiment.json')) fail('Experiment LabのZIPです。アプリ全体の完全バックアップではありません。LabのZIPに含まれるexperiment.jsonは「Experiment Lab」タブの実験JSONインポートで読み込めます');
    fail('manifest.jsonがありません。このアプリの「完全バックアップ」で作成したZIPを選択してください');
  }
  for (const name of byName.keys()) if (name !== 'manifest.json' && name !== 'data.json' && !IMAGE_PATH.test(name) && !THUMBNAIL_PATH.test(name)) fail(`完全バックアップに想定外のファイルがあります: ${name}`);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parseJson = (bytes: Uint8Array, name: string): unknown => {
    try { return JSON.parse(decoder.decode(bytes)); } catch { return fail(`${name}のJSONが不正です`); }
  };
  const manifest = validateManifest(parseJson(await readZipEntry(file, byName.get('manifest.json')!, MANIFEST_MAX_BYTES), 'manifest.json'));
  const dataEntry = byName.get('data.json') ?? fail('data.jsonがありません');
  if (dataEntry.size !== manifest.data.bytes) fail('data.jsonのサイズがmanifestと一致しません');
  const dataBytes = await readZipEntry(file, dataEntry, MAX_BYTES);
  if (await sha256(dataBytes) !== manifest.data.sha256) fail('data.jsonのSHA-256がmanifestと一致しません（改変または破損しています）');
  let document: BackupDocument;
  try { document = parseBackup(decoder.decode(dataBytes)); }
  catch (error) { throw new BackupError(`data.jsonを検証できません: ${error instanceof Error ? error.message : '不明なエラー'}`); }
  const payload = document.payload;
  const counts = countsOf(payload);
  for (const key of Object.keys(counts) as (keyof BackupCounts)[]) if (counts[key] !== manifest.counts[key]) fail(`件数がmanifestと一致しません（${key}: ${manifest.counts[key]} / ${counts[key]}）`);
  const records = new Map<string, ImageRecord>(payload.images.map(image => [image.id, image]));
  const listed = new Set([...manifest.images.map(image => image.id), ...manifest.missingImages]);
  for (const id of listed) if (!records.has(id)) fail(`manifestの画像 ${id} がdata.jsonにありません`);
  for (const id of records.keys()) if (!listed.has(id)) fail(`data.jsonの画像 ${id} がmanifestにありません`);
  const expectedFiles = new Set(['manifest.json', 'data.json', ...manifest.images.flatMap(image => [image.original.path, image.thumbnail.path])]);
  for (const name of byName.keys()) if (!expectedFiles.has(name)) fail(`manifestにないファイルがあります: ${name}`);
  const binaries = new Map<string, { original: Blob; thumbnail: Blob }>();
  let imageBytes = 0;
  for (const [index, item] of manifest.images.entries()) {
    onProgress?.(index, manifest.images.length);
    const record = records.get(item.id)!;
    const originalEntry = byName.get(item.original.path) ?? fail(`画像原本がありません: ${item.original.path}`);
    const thumbnailEntry = byName.get(item.thumbnail.path) ?? fail(`サムネイルがありません: ${item.thumbnail.path}`);
    if (originalEntry.size !== item.original.bytes || thumbnailEntry.size !== item.thumbnail.bytes || record.byteLength !== item.original.bytes || record.thumbnailBytes !== item.thumbnail.bytes) fail(`画像「${record.name}」のサイズがメタデータと一致しません`);
    if (record.hash !== item.original.sha256) fail(`画像「${record.name}」のハッシュがメタデータと一致しません`);
    const original = await readZipEntry(file, originalEntry, MAX_IMAGE_BYTES);
    if (await sha256(original) !== record.hash) fail(`画像「${record.name}」のSHA-256が一致しません（改変または破損しています）`);
    let png: ReturnType<typeof inspectPng>;
    try { png = inspectPng(original); } catch (error) { throw new BackupError(`画像「${record.name}」のPNGが不正です: ${error instanceof Error ? error.message : ''}`); }
    if (png.width !== record.width || png.height !== record.height) fail(`画像「${record.name}」の寸法がメタデータと一致しません`);
    const thumbnail = await readZipEntry(file, thumbnailEntry, THUMBNAIL_MAX_BYTES);
    if (await sha256(thumbnail) !== item.thumbnail.sha256) fail(`画像「${record.name}」のサムネイルが一致しません`);
    let thumb: ReturnType<typeof inspectPng>;
    try { thumb = inspectPng(thumbnail); } catch { return fail(`画像「${record.name}」のサムネイルPNGが不正です`); }
    if (thumb.width > 256 || thumb.height > 256) fail(`画像「${record.name}」のサムネイルが大きすぎます`);
    binaries.set(item.id, { original: zipEntryBlob(file, originalEntry, 'image/png'), thumbnail: zipEntryBlob(file, thumbnailEntry, 'image/png') });
    imageBytes += original.byteLength + thumbnail.byteLength;
  }
  onProgress?.(manifest.images.length, manifest.images.length);
  const warnings: string[] = [];
  if (manifest.missingImages.length) warnings.push(`${manifest.missingImages.length}件の画像は書出し時に原本がなく、メタデータのみです。復元後は欠落として表示されます（同じPNGの再取込で修復できます）`);
  return { manifest, document, binaries, imageBytes, warnings };
}

export interface StoredBinding { hash: string; byteLength: number; thumbnailBytes: number }
export interface RestorePlan { data: WorkbenchData; writes: ImageWrite[] }

/**
 * Combines a validated backup with the current data. `existing` holds the
 * bindings of binaries already stored under the incoming image IDs (including
 * ones kept only for Undo / the previous-import backup). A different binary under
 * the same ID is never overwritten; identical bytes are simply written again.
 */
export function planFullRestore(current: WorkbenchData, backup: InspectedBackup, mode: 'merge' | 'replace', existing: ReadonlyMap<string, StoredBinding>): RestorePlan {
  const data = prepareImport(current, backup.document.payload, mode);
  const records = new Map(backup.document.payload.images.map(image => [image.id, image]));
  const writes: ImageWrite[] = [];
  for (const [id, binary] of backup.binaries) {
    const record = records.get(id)!;
    const stored = existing.get(id);
    if (stored && stored.hash !== record.hash) fail(`画像ID ${id} は、この端末に別の内容の画像として保存されています。上書きしないため復元を中止しました（取込前バックアップ・元に戻す履歴が参照している可能性があります）`);
    writes.push({ id, original: binary.original, thumbnail: binary.thumbnail });
  }
  return { data, writes };
}
export { ZipError };
