import { describe, expect, it } from 'vitest';
import { CancelledError, decryptBackup, encryptBackup, isEncryptedBackup, MIN_ITERATIONS, passwordProblem, readEncryptedHeader } from '../../src/data/encrypted-backup';
import { exportFullBackup, inspectFullBackup } from '../../src/data/full-backup';
import { validateData } from '../../src/data/validation';
import { fixture, timestamp } from './helpers';

// Small chunks and the minimum iteration count keep the tests fast; the format is the same.
const fast = { iterations: MIN_ITERATIONS, chunkBytes: 64 * 1024 };
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const pattern = (size: number) => { const value = new Uint8Array(size); for (let index = 0; index < size; index++) value[index] = (index * 31 + 7) & 0xff; return new Blob([value]); };
const password = 'correct horse battery';

describe('encrypted complete backup (issue #33)', () => {
  it('round-trips a real complete backup and still verifies it after decryption', async () => {
    const data = validateData(fixture());
    const zip = (await exportFullBackup(data, { image: async () => undefined }, timestamp)).blob;
    const encrypted = await encryptBackup(zip, password, fast);
    expect(isEncryptedBackup(await bytesOf(encrypted.slice(0, 8)))).toBe(true);
    expect(isEncryptedBackup(await bytesOf(zip.slice(0, 8)))).toBe(false);
    // Nothing of the plaintext is visible.
    expect(new TextDecoder().decode(await bytesOf(encrypted))).not.toContain(data.libraryEntries[0]!.raw);
    const decrypted = await decryptBackup(encrypted, password);
    expect(await bytesOf(decrypted)).toEqual(await bytesOf(zip));
    expect((await inspectFullBackup(decrypted)).document.payload).toEqual(data);
  });
  it('handles many chunks, an exact multiple of the chunk size and an empty input; reports progress', async () => {
    for (const size of [0, 1, 64 * 1024, 64 * 1024 * 3 + 17]) {
      const plain = pattern(size); const seen: number[] = [];
      const encrypted = await encryptBackup(plain, password, { ...fast, onProgress: done => seen.push(done) });
      expect(seen.at(-1)).toBe(Math.max(1, Math.ceil(size / (64 * 1024))));
      expect(await bytesOf(await decryptBackup(encrypted, password))).toEqual(await bytesOf(plain));
    }
  });
  it('uses a fresh salt and nonce every time', async () => {
    const plain = pattern(1000);
    const [a, b] = [await encryptBackup(plain, password, fast), await encryptBackup(plain, password, fast)];
    expect((await readEncryptedHeader(a)).header.kdf.salt).not.toBe((await readEncryptedHeader(b)).header.kdf.salt);
    expect(await bytesOf(a)).not.toEqual(await bytesOf(b));
  });
  it('rejects a wrong password without output', async () => {
    const encrypted = await encryptBackup(pattern(70_000), password, fast);
    await expect(decryptBackup(encrypted, 'wrong password!')).rejects.toThrow('パスワードが違うか');
  });
  it('detects edits to the header, to any chunk, truncation, appended data and reordered chunks', async () => {
    const plain = pattern(64 * 1024 * 2 + 100);
    const encrypted = await bytesOf(await encryptBackup(plain, password, fast));
    const { offset } = await readEncryptedHeader(new Blob([encrypted]));
    const flip = (position: number) => { const copy = encrypted.slice(); copy[position]! ^= 1; return new Blob([copy]); };
    // Header: change the iteration count digits without changing the length, or any other byte.
    const header = new TextDecoder().decode(encrypted.subarray(12, offset));
    const edited = header.replace(`"iterations":${MIN_ITERATIONS}`, `"iterations":${MIN_ITERATIONS + 1}`);
    expect(edited).not.toBe(header);
    await expect(decryptBackup(new Blob([encrypted.subarray(0, 12), new TextEncoder().encode(edited), encrypted.subarray(offset)]), password)).rejects.toThrow('改変');
    await expect(decryptBackup(flip(offset + 5), password)).rejects.toThrow('改変');
    await expect(decryptBackup(flip(offset + 64 * 1024 + 16 + 5), password)).rejects.toThrow('改変');
    await expect(decryptBackup(flip(encrypted.length - 1), password)).rejects.toThrow('改変');
    await expect(decryptBackup(new Blob([encrypted.subarray(0, encrypted.length - 1)]), password)).rejects.toThrow('サイズが一致しません');
    await expect(decryptBackup(new Blob([encrypted, new Uint8Array([0])]), password)).rejects.toThrow('サイズが一致しません');
    const chunk = 64 * 1024 + 16;
    const swapped = new Blob([encrypted.subarray(0, offset), encrypted.subarray(offset + chunk, offset + 2 * chunk), encrypted.subarray(offset, offset + chunk), encrypted.subarray(offset + 2 * chunk)]);
    await expect(decryptBackup(swapped, password)).rejects.toThrow('改変');
  });
  it('validates the header strictly before deriving any key', async () => {
    const encrypted = await bytesOf(await encryptBackup(pattern(10), password, fast));
    const { offset } = await readEncryptedHeader(new Blob([encrypted]));
    const withHeader = (change: (header: Record<string, unknown>) => unknown) => {
      const header = JSON.parse(new TextDecoder().decode(encrypted.subarray(12, offset))) as Record<string, unknown>;
      const text = new TextEncoder().encode(JSON.stringify(change(header)));
      const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, text.length);
      return new Blob([encrypted.subarray(0, 8), length, text, encrypted.subarray(offset)]);
    };
    await expect(readEncryptedHeader(withHeader(header => ({ ...header, version: 2 })))).rejects.toThrow('未対応の暗号化形式');
    await expect(readEncryptedHeader(withHeader(header => ({ ...header, kdf: { ...(header.kdf as object), iterations: 1 } })))).rejects.toThrow('鍵の導出方式');
    await expect(readEncryptedHeader(withHeader(header => ({ ...header, kdf: { ...(header.kdf as object), iterations: 1e12 } })))).rejects.toThrow('鍵の導出方式');
    await expect(readEncryptedHeader(withHeader(header => ({ ...header, cipher: { ...(header.cipher as object), name: 'AES-CBC' } })))).rejects.toThrow('暗号方式');
    await expect(readEncryptedHeader(withHeader(header => ({ ...header, format: 'other' })))).rejects.toThrow('このアプリの暗号化バックアップではありません');
    await expect(readEncryptedHeader(withHeader(() => [1, 2]))).rejects.toThrow();
    await expect(readEncryptedHeader(new Blob([new TextEncoder().encode('PK\u0003\u0004 not encrypted')]))).rejects.toThrow('暗号化されたバックアップではありません');
    const huge = new Uint8Array(12); huge.set(encrypted.subarray(0, 8)); new DataView(huge.buffer).setUint32(8, 1 << 30);
    await expect(readEncryptedHeader(new Blob([huge]))).rejects.toThrow('ヘッダの長さ');
  });
  it('can be cancelled between chunks', async () => {
    const controller = new AbortController();
    await expect(encryptBackup(pattern(64 * 1024 * 3), password, { ...fast, signal: controller.signal, onProgress: done => { if (done === 1) controller.abort(); } })).rejects.toBeInstanceOf(CancelledError);
    const encrypted = await encryptBackup(pattern(64 * 1024 * 3), password, fast);
    const again = new AbortController();
    await expect(decryptBackup(encrypted, password, { signal: again.signal, onProgress: done => { if (done === 1) again.abort(); } })).rejects.toBeInstanceOf(CancelledError);
  });
  it('requires a password of at least 8 characters confirmed twice', async () => {
    expect(passwordProblem('short', 'short')).toContain('8文字以上');
    expect(passwordProblem('long enough', 'long enougH')).toContain('一致しません');
    expect(passwordProblem('long enough', 'long enough')).toBe('');
    await expect(encryptBackup(pattern(1), 'short', fast)).rejects.toThrow('8文字以上');
  });
});
