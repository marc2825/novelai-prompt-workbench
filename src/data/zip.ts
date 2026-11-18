import { crc32 } from '../core/png';

// Minimal ZIP32 support for backups. Writing and reading are "stored" (method 0)
// only: nothing is ever decompressed, so compression bombs are impossible, and
// entries are never extracted to a file system (no path traversal surface).

export const ZIP_MAX_BYTES = 2 * 1024 * 1024 * 1024 - 1;
export const ZIP_MAX_ENTRIES = 30_000;
const MAX_NAME = 200;
const MAX_DIRECTORY_BYTES = 16 * 1024 * 1024;
const LOCAL = 0x04034b50, CENTRAL = 0x02014b50, END = 0x06054b50;
const DOS_DATE_1980 = 0x0021; // 1980-01-01, the earliest valid DOS date.

export class ZipError extends Error {}
const fail = (message: string): never => { throw new ZipError(message); };

export interface ZipInput {
  name: string;
  data: Blob | Uint8Array;
  /** Precomputed CRC-32 (avoids reading a Blob twice). */
  crc?: number;
}

/** A conservative name check applied to every entry, before any caller-specific allowlist. */
export function isSafeZipName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME && /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(name) && !name.split('/').some(part => part === '.' || part === '..');
}
async function bytesOf(data: Blob | Uint8Array): Promise<Uint8Array> {
  return data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
}

/**
 * Store-only ZIP32 writer. Blob entries stay Blob references in the result, so a
 * large backup is not copied into memory; each Blob is read at most once (only
 * when no CRC is supplied). Names must pass `isSafeZipName` and be unique.
 */
export async function writeZip(entries: readonly ZipInput[], maxBytes = ZIP_MAX_BYTES): Promise<Blob> {
  if (entries.length > ZIP_MAX_ENTRIES) fail(`ZIPのファイル数が上限（${ZIP_MAX_ENTRIES}）を超えています`);
  const encoder = new TextEncoder();
  const parts: BlobPart[] = []; const directory: Uint8Array<ArrayBuffer>[] = []; const names = new Set<string>();
  let offset = 0;
  for (const entry of entries) {
    if (!isSafeZipName(entry.name) || names.has(entry.name)) fail(`ZIPのファイル名が不正または重複しています: ${entry.name}`);
    names.add(entry.name);
    const size = entry.data instanceof Uint8Array ? entry.data.byteLength : entry.data.size;
    const crc = entry.crc ?? crc32(await bytesOf(entry.data));
    const name = encoder.encode(entry.name);
    const local = new Uint8Array(30 + name.length); const l = new DataView(local.buffer);
    l.setUint32(0, LOCAL, true); l.setUint16(4, 20, true); l.setUint16(12, DOS_DATE_1980, true);
    l.setUint32(14, crc, true); l.setUint32(18, size, true); l.setUint32(22, size, true); l.setUint16(26, name.length, true); local.set(name, 30);
    const central = new Uint8Array(46 + name.length); const c = new DataView(central.buffer);
    c.setUint32(0, CENTRAL, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, DOS_DATE_1980, true);
    c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); central.set(name, 46);
    parts.push(local, entry.data instanceof Uint8Array ? new Uint8Array(entry.data) : entry.data); directory.push(central);
    offset += local.length + size;
    if (offset > maxBytes) fail(`ZIPが上限（${Math.floor(maxBytes / 1048576)}MiB）を超えます`);
  }
  const directorySize = directory.reduce((total, part) => total + part.length, 0);
  if (offset + directorySize + 22 > maxBytes) fail(`ZIPが上限（${Math.floor(maxBytes / 1048576)}MiB）を超えます`);
  const end = new Uint8Array(22); const e = new DataView(end.buffer);
  e.setUint32(0, END, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}

export interface ZipEntry { name: string; start: number; size: number; crc: number }

async function slice(file: Blob, start: number, end: number): Promise<DataView> {
  if (start < 0 || end > file.size || end < start) fail('ZIPの範囲が不正です');
  const buffer = await file.slice(start, end).arrayBuffer();
  if (buffer.byteLength !== end - start) fail('ZIPを読み取れません');
  return new DataView(buffer);
}

/**
 * Parses and cross-checks the central directory and every local header without
 * reading entry data. Rejects ZIP64, multi-disk archives, encryption, data
 * descriptors, any compression, unsafe or duplicate names, inconsistent headers,
 * overlapping entries and trailing/hidden data between the entries and the directory.
 */
export async function readZipDirectory(file: Blob, options: { maxBytes?: number; maxEntries?: number } = {}): Promise<ZipEntry[]> {
  const maxBytes = options.maxBytes ?? ZIP_MAX_BYTES; const maxEntries = options.maxEntries ?? ZIP_MAX_ENTRIES;
  if (file.size < 22) fail('ZIPファイルが短すぎます（破損または別形式です）');
  if (file.size > maxBytes) fail(`ZIPが上限（${Math.floor(maxBytes / 1048576)}MiB）を超えています`);
  const tailStart = Math.max(0, file.size - 22 - 0xffff);
  const tail = await slice(file, tailStart, file.size);
  let endAt = -1;
  for (let index = tail.byteLength - 22; index >= 0; index--) {
    if (tail.getUint32(index, true) === END && index + 22 + tail.getUint16(index + 20, true) === tail.byteLength) { endAt = index; break; }
  }
  if (endAt < 0) fail('ZIPの終端レコードが見つかりません（破損または途中で切れています）');
  const disk = tail.getUint16(endAt + 4, true), directoryDisk = tail.getUint16(endAt + 6, true);
  const onDisk = tail.getUint16(endAt + 8, true), total = tail.getUint16(endAt + 10, true);
  const directorySize = tail.getUint32(endAt + 12, true), directoryOffset = tail.getUint32(endAt + 16, true);
  if (disk !== 0 || directoryDisk !== 0 || onDisk !== total) fail('分割ZIPには対応していません');
  if (total === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) fail('ZIP64には対応していません');
  if (total > maxEntries) fail(`ZIPのファイル数が上限（${maxEntries}）を超えています`);
  if (directorySize > MAX_DIRECTORY_BYTES || directoryOffset + directorySize !== tailStart + endAt) fail('ZIPの中央ディレクトリが破損しています');
  const dir = await slice(file, directoryOffset, directoryOffset + directorySize);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: (ZipEntry & { header: number })[] = []; const names = new Set<string>();
  let at = 0;
  for (let index = 0; index < total; index++) {
    if (at + 46 > dir.byteLength || dir.getUint32(at, true) !== CENTRAL) fail('ZIPの中央ディレクトリが破損しています');
    const flags = dir.getUint16(at + 8, true), method = dir.getUint16(at + 10, true);
    const crc = dir.getUint32(at + 16, true), packed = dir.getUint32(at + 20, true), size = dir.getUint32(at + 24, true);
    const nameLength = dir.getUint16(at + 28, true), extraLength = dir.getUint16(at + 30, true), commentLength = dir.getUint16(at + 32, true);
    const startDisk = dir.getUint16(at + 34, true), header = dir.getUint32(at + 42, true);
    if (flags & 0x0049) fail('暗号化またはデータ記述子付きのZIPには対応していません');
    if (method !== 0) fail('圧縮されたZIPエントリには対応していません（このアプリが書き出したZIPを使用してください）');
    if (packed !== size || startDisk !== 0) fail('ZIPエントリのサイズが不正です');
    if (nameLength === 0 || nameLength > MAX_NAME || at + 46 + nameLength + extraLength + commentLength > dir.byteLength) fail('ZIPのファイル名が不正です');
    let name = '';
    try { name = decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + at + 46, nameLength)); } catch { fail('ZIPのファイル名の文字コードが不正です'); }
    if (!isSafeZipName(name)) fail(`ZIPに不正なパスが含まれています: ${name.slice(0, 80)}`);
    if (names.has(name)) fail(`ZIPに同じ名前のファイルが複数あります: ${name}`);
    names.add(name);
    entries.push({ name, start: 0, size, crc, header });
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== dir.byteLength) fail('ZIPの中央ディレクトリに余分なデータがあります');
  const encoder = new TextEncoder();
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    if (entry.header + 30 + name.length > directoryOffset) fail(`ZIPのローカルヘッダが範囲外です: ${entry.name}`);
    const local = await slice(file, entry.header, entry.header + 30 + name.length);
    if (local.getUint32(0, true) !== LOCAL) fail(`ZIPのローカルヘッダが破損しています: ${entry.name}`);
    const nameLength = local.getUint16(26, true), extraLength = local.getUint16(28, true);
    const sameName = nameLength === name.length && 30 + nameLength <= local.byteLength && name.every((byte, index) => local.getUint8(30 + index) === byte);
    if ((local.getUint16(6, true) & 0x0049) || local.getUint16(8, true) !== 0 || local.getUint32(14, true) !== entry.crc || local.getUint32(18, true) !== entry.size || local.getUint32(22, true) !== entry.size || !sameName) fail(`ZIPのローカルヘッダと中央ディレクトリが一致しません: ${entry.name}`);
    entry.start = entry.header + 30 + nameLength + extraLength;
    if (entry.start + entry.size > directoryOffset) fail(`ZIPエントリが範囲外です: ${entry.name}`);
  }
  const ordered = [...entries].sort((a, b) => a.header - b.header);
  for (const [index, entry] of ordered.entries()) {
    const next = ordered[index + 1];
    if (next && entry.start + entry.size > next.header) fail('ZIPエントリが重なっています');
  }
  return entries.map(({ name, start, size, crc }) => ({ name, start, size, crc }));
}

/** Reads one entry (bounded) and verifies its CRC-32. */
export async function readZipEntry(file: Blob, entry: ZipEntry, maxBytes: number): Promise<Uint8Array> {
  if (entry.size > maxBytes) fail(`${entry.name}が上限（${Math.floor(maxBytes / 1048576)}MiB）を超えています`);
  const view = await slice(file, entry.start, entry.start + entry.size);
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (crc32(bytes) !== entry.crc) fail(`${entry.name}のCRCが一致しません（破損しています）`);
  return bytes;
}
/** A Blob view of one entry's bytes (not read into memory). */
export function zipEntryBlob(file: Blob, entry: ZipEntry, type: string): Blob {
  return file.slice(entry.start, entry.start + entry.size, type);
}
