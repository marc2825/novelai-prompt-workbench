import { describe, expect, it } from 'vitest';
import { chunk, png } from '../fixtures/png';
import { inspectPng } from '../../src/core/png';
import { extractMetadata, prepareImage } from '../../src/data/images';
import { unknownSettings } from '../../src/core/experiments';

describe('P4 bounded PNG and untrusted metadata', () => {
  it('extracts dimensions with no metadata without guessing generation settings', async () => {
    const parsed = inspectPng(png(3, 2)); const metadata = await extractMetadata(parsed.texts);
    expect(parsed.width).toBe(3); expect(metadata.positive).toBeNull(); expect(metadata.settings.width).toBeNull(); expect(metadata.settings.evidence).toBe('unknown');
  });
  it.each([false, true])('safely decodes standard UTF-8 and compressed text (%s)', async compressed => {
    const parsed = inspectPng(png(2, 2, { Description: '<img onerror=alert(1)>', Note: compressed ? 'ascii' : '日本語 🌟' }, 64, compressed));
    const result = await extractMetadata(parsed.texts); expect(result.texts.Description).toBe('<img onerror=alert(1)>'); expect(result.positive).toBeNull();
  });
  it('supports the explicit workbench parser contract, exact string Seed and prompts', async () => {
    const settings = { ...unknownSettings(), seed: '900719925474099312345', model: 'synthetic', evidence: 'png-metadata' as const };
    const raw = JSON.stringify({ format: 'nai-prompt-workbench-generation', schemaVersion: 1, positive: '{{a|b}}', negative: '[text]', settings });
    const result = await extractMetadata(inspectPng(png(2, 2, { 'nai-prompt-workbench': raw })).texts);
    expect(result.positive).toBe('{{a|b}}'); expect(result.settings.seed).toBe(settings.seed); expect(result.settings.width).toBeNull();
  });
  it.each(['{"__proto__":{"polluted":true}}', '{broken', JSON.stringify({ format: 'unknown' })])('keeps unverified structured metadata inert: %s', async raw => {
    const result = await extractMetadata(inspectPng(png(2, 2, { 'nai-prompt-workbench': raw })).texts); expect(result.settings).toEqual(unknownSettings()); expect(result.texts['nai-prompt-workbench']).toBe(raw); expect(result.warnings.length).toBeGreaterThan(0);
  });
  it('refuses decompression bombs before storing expanded text', async () => { const parsed = inspectPng(png(2, 2, { Comment: 'a'.repeat(262_145) }, 64, true)); await expect(extractMetadata(parsed.texts)).rejects.toThrow('256KiB'); });
  it.each(['signature', 'crc', 'truncated', 'giant', 'animation', 'trailing', 'metadata'] as const)('rejects %s PNG input', kind => {
    let bytes: Buffer = png();
    if (kind === 'signature') bytes[0] = 0;
    if (kind === 'crc') bytes[30] = bytes[30]! ^ 1;
    if (kind === 'truncated') bytes = bytes.subarray(0, bytes.length - 5);
    if (kind === 'giant') { const header = Buffer.alloc(13); header.writeUInt32BE(100_000); header.writeUInt32BE(100_000, 4); bytes = Buffer.concat([bytes.subarray(0, 8), chunk('IHDR', header), bytes.subarray(33)]); }
    if (kind === 'animation') bytes = Buffer.concat([bytes.subarray(0, 33), chunk('acTL', Buffer.alloc(8)), bytes.subarray(33)]);
    if (kind === 'trailing') bytes = Buffer.concat([bytes, Buffer.from('extra')]);
    if (kind === 'metadata') bytes = png(2, 2, { Comment: 'a'.repeat(262_145) });
    expect(() => inspectPng(bytes)).toThrow();
  });
  it('rejects huge/empty files before buffering or attempting browser decode', async () => {
    await expect(prepareImage({ size: 20 * 1048576 + 1 } as File, 'unused', '')).rejects.toThrow('20MiB');
    await expect(prepareImage({ size: 0 } as File, 'unused', '')).rejects.toThrow('空でない');
  });
  it('preserves PNG Latin-1 bytes without Windows-1252 substitution', async () => {
    const result = await extractMetadata([{ type: 'tEXt', bytes: new Uint8Array([78, 111, 116, 101, 0, 128, 255]) }]);
    expect(result.texts.Note).toBe('\u0080\u00ff');
  });
  it('rejects duplicate or dangerous text keys', async () => {
    const text = { type: 'tEXt', bytes: new TextEncoder().encode('Note\0test') };
    await expect(extractMetadata([text, text])).rejects.toThrow('重複');
    await expect(extractMetadata([{ type: 'tEXt', bytes: new TextEncoder().encode('__proto__\0test') }])).rejects.toThrow('危険');
  });
});
