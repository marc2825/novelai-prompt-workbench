// Optional password encryption of a complete backup ZIP (issue #33).
//
// Only standard primitives from Web Crypto: PBKDF2-HMAC-SHA-256 derives an
// AES-256-GCM key from the password and a random salt. The ZIP is encrypted in
// fixed-size chunks (a backup can be up to 2 GiB and Web Crypto has no streaming
// API); every chunk is authenticated separately with a nonce made of a random
// prefix, the chunk index and a "last chunk" flag, and the header is bound as
// additional data. Wrong passwords, edits, truncation, reordering and appended
// data are therefore all detected. The password is never stored or logged.
//
//   "NAIWBENC" (8 bytes) | header length (uint32 BE) | header JSON (UTF-8) | chunk 0 | chunk 1 | ...
//   chunk i = AES-GCM(key, nonce_i, plaintext[i*chunkBytes ..], aad = header bytes) (ciphertext + 16-byte tag)
//   nonce_i = noncePrefix (7 bytes) | i (uint32 BE) | last ? 1 : 0

import { FULL_BACKUP_MAX_BYTES } from './full-backup';

export const ENCRYPTED_FORMAT = 'nai-prompt-workbench-encrypted-backup';
const MAGIC = new TextEncoder().encode('NAIWBENC');
export const DEFAULT_ITERATIONS = 600_000;
export const MIN_ITERATIONS = 100_000;
export const MAX_ITERATIONS = 10_000_000;
export const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
const MIN_CHUNK_BYTES = 64 * 1024; const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_HEADER_BYTES = 4096;
const TAG_BYTES = 16;
export const MIN_PASSWORD_LENGTH = 8;

export interface EncryptedHeader {
  format: typeof ENCRYPTED_FORMAT;
  version: 1;
  contents: 'full-backup-zip';
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; keyBits: 256; chunkBytes: number; noncePrefix: string };
  plaintextBytes: number;
}

export class EncryptionError extends Error {}
export class CancelledError extends Error { constructor() { super('中止しました'); } }
const fail = (message: string): never => { throw new EncryptionError(message); };

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function unbase64(value: unknown, length: number, name: string): Uint8Array {
  if (typeof value !== 'string' || value.length > 64) return fail(`暗号化ヘッダの${name}が不正です`);
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0)); } catch { return fail(`暗号化ヘッダの${name}が不正です`); }
  if (bytes.length !== length) fail(`暗号化ヘッダの${name}が不正です`);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function nonce(prefix: Uint8Array, index: number, last: boolean): Uint8Array {
  const value = new Uint8Array(12); value.set(prefix, 0);
  new DataView(value.buffer).setUint32(7, index); value[11] = last ? 1 : 0;
  return value;
}
const chunkCount = (plaintextBytes: number, chunkBytes: number) => Math.max(1, Math.ceil(plaintextBytes / chunkBytes));

export function isEncryptedBackup(head: Uint8Array): boolean { return head.length >= MAGIC.length && MAGIC.every((value, index) => head[index] === value); }

export interface CryptoOptions { iterations?: number; chunkBytes?: number; onProgress?: (done: number, total: number) => void; signal?: AbortSignal }

export function passwordProblem(password: string, confirmation: string): string {
  if (password.length < MIN_PASSWORD_LENGTH) return `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`;
  if (password.length > 1024) return 'パスワードが長すぎます';
  if (password !== confirmation) return '確認用のパスワードが一致しません';
  return '';
}

export async function encryptBackup(zip: Blob, password: string, options: CryptoOptions = {}): Promise<Blob> {
  if (password.length < MIN_PASSWORD_LENGTH) fail(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`);
  if (zip.size > FULL_BACKUP_MAX_BYTES) fail('バックアップが2GiBを超えています');
  const iterations = options.iterations ?? DEFAULT_ITERATIONS; const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS || chunkBytes < MIN_CHUNK_BYTES || chunkBytes > MAX_CHUNK_BYTES) fail('暗号化の設定が範囲外です');
  const salt = crypto.getRandomValues(new Uint8Array(16)); const prefix = crypto.getRandomValues(new Uint8Array(7));
  const header: EncryptedHeader = { format: ENCRYPTED_FORMAT, version: 1, contents: 'full-backup-zip', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: base64(salt) }, cipher: { name: 'AES-GCM', keyBits: 256, chunkBytes, noncePrefix: base64(prefix) }, plaintextBytes: zip.size };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, headerBytes.length);
  const key = await deriveKey(password, salt, iterations);
  const total = chunkCount(zip.size, chunkBytes); const parts: BlobPart[] = [MAGIC, length, headerBytes];
  for (let index = 0; index < total; index++) {
    if (options.signal?.aborted) throw new CancelledError();
    options.onProgress?.(index, total);
    const plain = new Uint8Array(await zip.slice(index * chunkBytes, (index + 1) * chunkBytes).arrayBuffer());
    parts.push(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(nonce(prefix, index, index === total - 1)), additionalData: headerBytes }, key, plain)));
  }
  options.onProgress?.(total, total);
  return new Blob(parts, { type: 'application/octet-stream' });
}

/** Reads and strictly validates the header; nothing is decrypted yet. */
export async function readEncryptedHeader(file: Blob): Promise<{ header: EncryptedHeader; headerBytes: Uint8Array; offset: number }> {
  const head = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer());
  if (!isEncryptedBackup(head) || head.length < MAGIC.length + 4) fail('暗号化されたバックアップではありません');
  const size = new DataView(head.buffer, head.byteOffset).getUint32(MAGIC.length);
  if (size < 2 || size > MAX_HEADER_BYTES) fail('暗号化ヘッダの長さが不正です');
  const headerBytes = new Uint8Array(await file.slice(MAGIC.length + 4, MAGIC.length + 4 + size).arrayBuffer());
  if (headerBytes.length !== size) fail('ファイルが途中で切れています');
  let value: Record<string, unknown>;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(headerBytes)) as Record<string, unknown>; } catch { return fail('暗号化ヘッダが壊れています'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('暗号化ヘッダが壊れています');
  if (value.format !== ENCRYPTED_FORMAT) fail('このアプリの暗号化バックアップではありません');
  if (value.version !== 1) fail(`未対応の暗号化形式です（${String(value.version)}）。新しい版のアプリで作成された可能性があります`);
  if (value.contents !== 'full-backup-zip') fail('暗号化された内容の種類が不正です');
  const kdf = value.kdf as Record<string, unknown> | undefined; const cipher = value.cipher as Record<string, unknown> | undefined;
  if (!kdf || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || !Number.isSafeInteger(kdf.iterations) || (kdf.iterations as number) < MIN_ITERATIONS || (kdf.iterations as number) > MAX_ITERATIONS) fail('鍵の導出方式が不正です');
  if (!cipher || cipher.name !== 'AES-GCM' || cipher.keyBits !== 256 || !Number.isSafeInteger(cipher.chunkBytes) || (cipher.chunkBytes as number) < MIN_CHUNK_BYTES || (cipher.chunkBytes as number) > MAX_CHUNK_BYTES) fail('暗号方式が不正です');
  const salt = unbase64(kdf!.salt, 16, 'salt'); const prefix = unbase64(cipher!.noncePrefix, 7, 'nonce');
  if (!Number.isSafeInteger(value.plaintextBytes) || (value.plaintextBytes as number) < 0 || (value.plaintextBytes as number) > FULL_BACKUP_MAX_BYTES) fail('元のサイズが不正です');
  const header: EncryptedHeader = { format: ENCRYPTED_FORMAT, version: 1, contents: 'full-backup-zip', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: kdf!.iterations as number, salt: base64(salt) }, cipher: { name: 'AES-GCM', keyBits: 256, chunkBytes: cipher!.chunkBytes as number, noncePrefix: base64(prefix) }, plaintextBytes: value.plaintextBytes as number };
  const offset = MAGIC.length + 4 + size;
  const chunks = chunkCount(header.plaintextBytes, header.cipher.chunkBytes);
  if (file.size !== offset + header.plaintextBytes + chunks * TAG_BYTES) fail('ファイルのサイズが一致しません（途中で切れているか、データが追加されています）');
  return { header, headerBytes, offset };
}

/** Decrypts to the original ZIP. Fails without partial output on a wrong password or any modification. */
export async function decryptBackup(file: Blob, password: string, options: Omit<CryptoOptions, 'iterations' | 'chunkBytes'> = {}): Promise<Blob> {
  const { header, headerBytes, offset } = await readEncryptedHeader(file);
  const key = await deriveKey(password, unbase64(header.kdf.salt, 16, 'salt'), header.kdf.iterations);
  const prefix = unbase64(header.cipher.noncePrefix, 7, 'nonce');
  const { chunkBytes } = header.cipher; const total = chunkCount(header.plaintextBytes, chunkBytes);
  const parts: BlobPart[] = []; let position = offset;
  for (let index = 0; index < total; index++) {
    if (options.signal?.aborted) throw new CancelledError();
    options.onProgress?.(index, total);
    const plainLength = index === total - 1 ? header.plaintextBytes - index * chunkBytes : chunkBytes;
    const cipher = new Uint8Array(await file.slice(position, position + plainLength + TAG_BYTES).arrayBuffer()); position += plainLength + TAG_BYTES;
    try { parts.push(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(nonce(prefix, index, index === total - 1)), additionalData: new Uint8Array(headerBytes) }, key, cipher))); }
    catch { fail(index === 0 ? 'パスワードが違うか、ファイルが改変・破損しています' : 'ファイルが改変・破損しています（途中のデータを検証できません）'); }
  }
  options.onProgress?.(total, total);
  return new Blob(parts, { type: 'application/zip' });
}
