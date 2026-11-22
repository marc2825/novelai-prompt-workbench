import { createHash } from 'node:crypto';
import { gzipSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { unknownSettings } from '../../src/core/experiments';
import { inspectPng } from '../../src/core/png';
import { createAlphaLsbReader, MAX_STEALTH_PAYLOAD_BYTES, readStealthContainer, STEALTH_MAGIC } from '../../src/core/png-stealth';
import type { ImageRecord } from '../../src/core/types';
import { exportBackup } from '../../src/data/backup';
import { extractMetadata, readPngMetadata } from '../../src/data/images';
import { candidatePrompts, candidateSettings, describeNovelAI, hasPromptCandidates, hasSettingCandidates, inflateBounded, NOVELAI_MISMATCH_WARNING, NOVELAI_NOT_FOUND_UNCHECKED_WARNING, NOVELAI_NOT_FOUND_WARNING, novelaiView, readStealth } from '../../src/data/novelai-metadata';
import { parseBackup, validateData } from '../../src/data/validation';
import { embedAlpha, encodePng, pattern, stealthBytes, stealthPng } from '../fixtures/png';
import { fixture, timestamp } from './helpers';

// Synthetic data only: field names follow the official container format, values are invented test data.
const comment = { prompt: '1girl, {{blue}} hair, ||a|b||', uc: 'lowres, [text]', seed: 1234567890, steps: 28, width: 64, height: 64, scale: 5.5, cfg_rescale: 0, sampler: 'k_euler_ancestral', n_samples: 1, unknown_key: [1, { nested: true }], signed_hash: 'synthetic' };
const fields = { Description: '1girl', Software: 'NovelAI', Source: 'Synthetic Model 0000', 'Generation time': '1.5', Comment: JSON.stringify(comment) };
const texts = (values: Record<string, string> = fields): [string, string][] => [['Title', 'NovelAI generated image'], ...Object.entries(values)];
const metadataOf = async (bytes: Uint8Array) => (await readPngMetadata(bytes)).metadata;
const only = <T>(value: T | null | undefined): T => { expect(value).toBeTruthy(); return value!; };

describe('alpha LSB reader (pure, column-major, MSB first)', () => {
  const rawRows = (bytes: Uint8Array) => { const png = inspectPng(bytes); return new Uint8Array(inflateSync(Buffer.concat(png.idat))); };
  it('reads x outer / y inner and packs the most significant bit first', () => {
    const pixels = pattern(3, 8); pixels[(1 * 3 + 0) * 4 + 3] = 1; pixels[(0 * 3 + 1) * 4 + 3] = 3; // (x0,y1) -> bit 1; (x1,y0) -> bit 8
    for (let i = 3; i < pixels.length; i += 4) if (![(1 * 3 + 0) * 4 + 3, (0 * 3 + 1) * 4 + 3].includes(i)) pixels[i] = 254;
    const reader = createAlphaLsbReader(3, 8, { maxBytes: 100 }); expect(reader.push(rawRows(encodePng(3, 8, pixels)))).toBe('more');
    expect([...reader.finish()]).toEqual([0b0100_0000, 0b1000_0000, 0]);
  });
  it.each([0, 1, 2, 3, 4])('unfilters filter type %i byte by byte and drops trailing bits like the official reader', filter => {
    const bytes = Uint8Array.from({ length: 12 }, (_, i) => (i * 37 + 11) & 255);
    const raw = rawRows(encodePng(10, 10, embedAlpha(pattern(10, 10, filter + 3), 10, 10, bytes), { filter }));
    const reader = createAlphaLsbReader(10, 10, { maxBytes: 1000 }); for (const byte of raw) reader.push(Uint8Array.of(byte));
    expect([...reader.finish()]).toEqual([...bytes]); // 100 bits -> 12 whole bytes
  });
  it('stops as soon as the magic prefix is known to be absent, and caps the output', () => {
    const raw = rawRows(encodePng(4, 200, pattern(4, 200)));
    const reader = createAlphaLsbReader(4, 200, { maxBytes: 50, prefix: STEALTH_MAGIC });
    const rowBytes = 1 + 4 * 4; expect(reader.push(raw.subarray(0, rowBytes * 119))).toBe('more'); expect(reader.push(raw.subarray(rowBytes * 119, rowBytes * 120))).toBe('mismatch');
    const capped = createAlphaLsbReader(4, 200, { maxBytes: 3 }); expect(capped.push(raw)).toBe('more'); expect(capped.finish()).toHaveLength(3);
  });
  it('rejects invalid filters, extra data and incomplete pixel data', () => {
    const raw = rawRows(encodePng(2, 2, pattern(2, 2)));
    const bad = new Uint8Array(raw); bad[0] = 5; expect(() => createAlphaLsbReader(2, 2, { maxBytes: 10 }).push(bad)).toThrow('フィルタ');
    expect(() => createAlphaLsbReader(2, 2, { maxBytes: 10 }).push(Uint8Array.of(...raw, 0))).toThrow('長すぎ');
    const short = createAlphaLsbReader(2, 2, { maxBytes: 10 }); short.push(raw.subarray(0, raw.length - 1)); expect(() => short.finish()).toThrow('途中');
  });
});

describe('stealth container framing', () => {
  const header = (bits: number) => { const value = Buffer.alloc(4); value.writeUInt32BE(bits); return Buffer.concat([Buffer.from(STEALTH_MAGIC), value]); };
  it('splits magic, bit length and payload and ignores trailing FEC data', () => {
    expect(readStealthContainer(Buffer.concat([header(24), Buffer.from([1, 2, 3, 0xff, 0xff, 0xff, 0xff])]))).toEqual({ status: 'found', payload: Uint8Array.of(1, 2, 3) });
  });
  it.each([
    ['absent', Buffer.from('stealth_pngcomX....'), 'absent'],
    ['header cut', Buffer.from('stealth_pngcomp\0\0'), 'invalid'],
    ['empty', header(7), 'invalid'],
    ['truncated', Buffer.concat([header(80), Buffer.alloc(9)]), 'invalid'],
    ['oversized', header((MAX_STEALTH_PAYLOAD_BYTES + 1) * 8), 'invalid'],
  ])('%s', (_name, bytes, status) => { expect(readStealthContainer(bytes).status).toBe(status); });
});

describe('NovelAI official containers in synthetic PNGs', () => {
  it('text chunks only: recorded as text, settings stay unknown, candidates are typed and bounded', async () => {
    const metadata = await metadataOf(encodePng(16, 16, pattern(16, 16), { texts: texts() }));
    expect(metadata.novelai).toEqual({ sources: ['text'], agreement: 'single', stealth: null });
    expect(metadata.settings).toEqual(unknownSettings()); expect(metadata.positive).toBeNull(); expect(metadata.promptEvidence).toBe('unknown');
    expect(metadata.warnings.join('\n')).toContain('NovelAI固有メタデータは未検証です'); expect(metadata.warnings.join('\n')).toContain('PNGテキスト');
    const view = only(novelaiView(metadata)); expect(view.sources).toHaveLength(1); const [source] = view.sources;
    expect(source!.fields.map(([key]) => key)).toEqual(['Title', 'Description', 'Software', 'Source', 'Generation time', 'Comment']);
    expect(Object.fromEntries(source!.candidates.map(item => [item.field, item.value]))).toEqual({ seed: '1234567890', steps: 28, width: 64, height: 64, sampler: 'k_euler_ancestral', guidance: 5.5, cfgRescale: 0, model: 'Synthetic Model 0000', positive: comment.prompt, negative: comment.uc });
    expect(source!.candidates.find(item => item.field === 'guidance')!.from).toBe('Comment.scale');
    expect(candidateSettings(source!)).toEqual({ ...unknownSettings(), seed: '1234567890', steps: 28, width: 64, height: 64, sampler: 'k_euler_ancestral', guidance: 5.5, cfgRescale: 0, model: 'Synthetic Model 0000', evidence: 'png-metadata', extrasConfirmed: false });
    expect(candidatePrompts(source!)).toEqual({ positive: comment.prompt, negative: comment.uc });
  });
  it.each(['iTXt', 'zTXt'] as const)('reads the same keys from %s chunks', async type => {
    const metadata = await metadataOf(encodePng(4, 4, pattern(4, 4), { texts: texts().map(([key, value]) => [key, value, type]) }));
    expect(metadata.novelai?.sources).toEqual(['text']); expect(only(novelaiView(metadata)).sources[0]!.candidates[0]!.value).toBe('1234567890');
  });
  it('stealth only: stores the payload, PNG texts stay empty', async () => {
    const metadata = await metadataOf(stealthPng(stealthBytes(fields)));
    expect(metadata.texts).toEqual({}); expect(metadata.novelai).toEqual({ sources: ['stealth'], agreement: 'single', stealth: fields }); expect(metadata.settings.evidence).toBe('unknown');
    expect(metadata.warnings.join('\n')).toContain('アルファチャンネル');
    expect(only(novelaiView(metadata)).sources[0]!.candidates.filter(item => item.status === 'ok')).toHaveLength(10);
  });
  it('both agree: flagged as a match and the payload is not stored twice', async () => {
    const metadata = await metadataOf(stealthPng(stealthBytes(fields), { texts: texts() }));
    expect(metadata.novelai).toEqual({ sources: ['text', 'stealth'], agreement: 'match', stealth: null });
    const view = only(novelaiView(metadata)); expect(view.sources.map(item => item.id)).toEqual(['both']); expect(view.sources[0]!.fields).toEqual(Object.entries(fields));
    expect(metadata.warnings).not.toContain(NOVELAI_MISMATCH_WARNING);
  });
  it('both disagree: keeps both, warns and never picks one', async () => {
    const other = { ...fields, Comment: JSON.stringify({ ...comment, seed: 42 }) };
    const metadata = await metadataOf(stealthPng(stealthBytes(other), { texts: texts() }));
    expect(metadata.novelai).toEqual({ sources: ['text', 'stealth'], agreement: 'mismatch', stealth: other }); expect(metadata.warnings).toContain(NOVELAI_MISMATCH_WARNING);
    expect(metadata.settings).toEqual(unknownSettings());
    const view = only(novelaiView(metadata)); expect(view.sources.map(item => [item.id, item.candidates[0]!.value])).toEqual([['text', '1234567890'], ['stealth', '42']]);
  });
  it('a stealth payload with keys beyond the official ones is kept even when it matches', () => {
    const textValues = { ...fields, Extra: 'x' }; const result = describeNovelAI(textValues, { status: 'found', fields: textValues, warnings: [] });
    expect(result.info).toEqual({ sources: ['text', 'stealth'], agreement: 'match', stealth: textValues });
  });
  it('text without Comment is not a NovelAI container; a stealth payload without Comment still is', async () => {
    const { Comment: _comment, ...rest } = fields;
    const plain = await metadataOf(encodePng(4, 4, pattern(4, 4), { texts: texts(rest) }));
    expect(plain.novelai).toBeUndefined(); expect(plain.warnings).toContain(NOVELAI_NOT_FOUND_WARNING);
    const stealth = await metadataOf(stealthPng(stealthBytes(rest)));
    const source = only(novelaiView(stealth)).sources[0]!; expect(source.comment).toEqual({ status: 'missing' });
    expect(source.candidates.filter(item => item.status === 'ok').map(item => item.field)).toEqual(['model']);
  });
  it('Comment that is not JSON is shown as raw text with no Comment candidates', async () => {
    const metadata = await metadataOf(encodePng(4, 4, pattern(4, 4), { texts: [['Comment', 'Created with an editor']] }));
    const source = only(novelaiView(metadata)).sources[0]!; expect(source.comment.status).toBe('invalid'); expect(source.fields).toEqual([['Comment', 'Created with an editor']]);
    expect(hasSettingCandidates(source)).toBe(false); expect(hasPromptCandidates(source)).toBe(false);
  });
  it.each([
    ['wrong types', { seed: '123', steps: 28.5, width: 0, height: -5, scale: '5', cfg_rescale: 2_000_000, sampler: 7, prompt: 42, uc: null }],
    ['unsafe numbers', { seed: 2 ** 53, steps: 1_000_001, width: 1e300, sampler: '   ', prompt: 'a'.repeat(100_001) }],
    ['array', [1, 2, 3]],
  ])('Comment JSON with %s yields no candidate', async (_name, value) => {
    const metadata = await metadataOf(encodePng(4, 4, pattern(4, 4), { texts: [['Comment', JSON.stringify(value)]] }));
    const source = only(novelaiView(metadata)).sources[0]!;
    expect(source.candidates.filter(item => item.status === 'ok')).toEqual([]); expect(hasSettingCandidates(source)).toBe(false);
    if (!Array.isArray(value)) expect(source.candidates.filter(item => item.status === 'invalid').length).toBeGreaterThan(3);
  });
  it('Comment with __proto__ is rejected as unsafe without polluting prototypes', async () => {
    const metadata = await metadataOf(encodePng(4, 4, pattern(4, 4), { texts: [['Comment', '{"__proto__":{"polluted":true},"seed":1}']] }));
    const source = only(novelaiView(metadata)).sources[0]!; expect(source.comment.status).toBe('invalid'); expect(source.candidates.every(item => item.status === 'missing')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('keeps unknown keys: Comment keys, extra stealth keys and non-string stealth values (as JSON text)', async () => {
    const payload = { ...fields, Comment: comment, Extra: 'kept' };
    const metadata = await metadataOf(stealthPng(stealthBytes(payload), { width: 128, height: 64 }));
    expect(metadata.novelai?.stealth).toEqual({ ...fields, Comment: JSON.stringify(comment), Extra: 'kept' }); expect(metadata.warnings.join('\n')).toContain('JSON文字列として保持');
    const source = only(novelaiView(metadata)).sources[0]!; expect(source.fields.at(-1)).toEqual(['Extra', 'kept']);
    expect(source.comment.status === 'ok' && source.comment.value.unknown_key).toEqual([1, { nested: true }]); expect(source.candidates[0]!.value).toBe('1234567890');
  });
  it.each([
    ['truncated', stealthBytes(fields, { bitLength: 5000 * 8 }), '途中で切れて'],
    ['oversized length', stealthBytes(fields, { bitLength: (MAX_STEALTH_PAYLOAD_BYTES + 1) * 8 }), '上限'],
    ['not gzip', stealthBytes(Buffer.from('definitely not gzip')), '展開できない'],
    ['not JSON', stealthBytes(gzipSync('not json')), 'JSONとして読めない'],
    ['JSON array', stealthBytes(gzipSync('[1,2]')), '安全なJSONオブジェクト'],
    ['dangerous key', stealthBytes(gzipSync('{"__proto__":"x"}')), '安全なJSONオブジェクト'],
    ['long key', stealthBytes({ ['k'.repeat(80)]: 'x' }), 'キー名'],
  ])('a stealth payload that is %s is reported and ignored without rejecting the PNG', async (_name, bytes, warning) => {
    const metadata = await metadataOf(stealthPng(bytes));
    expect(metadata.novelai).toBeUndefined(); expect(metadata.warnings.join('\n')).toContain(warning); expect(metadata.warnings).toContain(NOVELAI_NOT_FOUND_WARNING);
  });
  it('bad magic means no container (no warning about the alpha channel)', async () => {
    const metadata = await metadataOf(stealthPng(stealthBytes(fields, { magic: 'stealth_pngcomX' })));
    expect(metadata.novelai).toBeUndefined(); expect(metadata.warnings).toEqual([NOVELAI_NOT_FOUND_WARNING]);
  });
  it('caps a gzip bomb at 256KiB instead of expanding it', async () => {
    const bomb = gzipSync(Buffer.alloc(4 * 1024 * 1024, 0x20)); expect(bomb.length).toBeLessThan(MAX_STEALTH_PAYLOAD_BYTES);
    const metadata = await metadataOf(stealthPng(stealthBytes(bomb), { width: 256, height: 256 }));
    expect(metadata.novelai).toBeUndefined(); expect(metadata.warnings.join('\n')).toContain('展開後のデータが256KiBを超える');
    await expect(inflateBounded(bomb, 'gzip', 262_144, 'cap')).rejects.toThrow('cap');
  });
  it.each<[string, { colorType?: number; interlace?: number }]>([
    ['RGB (no alpha)', { colorType: 2 }],
    ['interlaced RGBA', { interlace: 1 }],
  ])('%s PNG: the alpha channel is not checked and nothing is reported as found', async (_name, options) => {
    const width = 64; const height = 64; let pixels = embedAlpha(pattern(width, height), width, height, stealthBytes(fields));
    if (options.colorType === 2) pixels = pixels.filter((_, i) => i % 4 !== 3);
    const png = inspectPng(encodePng(width, height, pixels, options));
    expect(await readStealth(png)).toEqual({ status: 'unchecked' });
    const metadata = await extractMetadata(png.texts, undefined, await readStealth(png)); expect(metadata.novelai).toBeUndefined(); expect(metadata.warnings).toEqual([NOVELAI_NOT_FOUND_UNCHECKED_WARNING]);
  });
  it.each([
    ['None', 0], ['Sub', 1], ['Up', 2], ['Average', 3], ['Paeth', 4], ['mixed', (y: number) => y % 5],
  ])('decodes the alpha channel through %s filtering split across IDAT chunks', async (_name, filter) => {
    const metadata = await metadataOf(stealthPng(stealthBytes(fields), { filter, idatSize: 97, width: 48, height: 72 }));
    expect(metadata.novelai?.stealth).toEqual(fields);
  });
  it('corrupt pixel data leaves the alpha channel unchecked (the browser decode reports the error)', async () => {
    const bytes = stealthPng(stealthBytes(fields)); const png = inspectPng(bytes);
    expect(await readStealth({ ...png, idat: [Uint8Array.of(1, 2, 3)] })).toEqual({ status: 'unchecked' });
    expect(await readStealth({ ...png, idat: [png.idat[0]!.subarray(0, 200)] })).toEqual({ status: 'unchecked' });
  });
  it('keeps the workbench parser result and still records the NovelAI container next to it', async () => {
    const settings = { ...unknownSettings(), seed: '7', evidence: 'png-metadata' as const };
    const raw = JSON.stringify({ format: 'nai-prompt-workbench-generation', schemaVersion: 1, positive: 'p', negative: 'n', settings });
    const metadata = await metadataOf(encodePng(4, 4, pattern(4, 4), { texts: [['nai-prompt-workbench', raw, 'iTXt'], ...texts()] }));
    expect(metadata.settings).toEqual(settings); expect(metadata.positive).toBe('p'); expect(metadata.novelai?.sources).toEqual(['text']);
  });
  it('images imported before this field existed still show their PNG text Comment', () => {
    const view = only(novelaiView({ texts: { Comment: fields.Comment, Note: 'x' } })); expect(view.legacy).toBe(true); expect(view.sources[0]!.fields).toEqual([['Comment', fields.Comment]]);
    expect(novelaiView({ texts: { Note: 'x' } })).toBeNull();
  });
});

describe('metadata.novelai persistence', () => {
  const id = (n: number) => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`;
  async function dataWith(bytes: Uint8Array) {
    const data = fixture(); const { png, metadata } = await readPngMetadata(bytes);
    const image: ImageRecord = { id: id(1), hash: createHash('sha256').update(bytes).digest('hex'), mime: 'image/png', name: 'synthetic.png', width: png.width, height: png.height, byteLength: bytes.length, thumbnailBytes: 10, createdAt: timestamp, metadata };
    data.images.push(image); return data;
  }
  const mismatch = () => stealthPng(stealthBytes({ ...fields, Comment: '{"seed":1}' }), { texts: texts() });
  it('round-trips through validateData and JSON backup, keeping unknown safe fields', async () => {
    const data = await dataWith(mismatch()); (data.images[0]!.metadata.novelai as unknown as Record<string, unknown>).future = { safe: 1 };
    expect(validateData(data)).toEqual(data); expect(parseBackup(exportBackup(data, timestamp)).payload).toEqual(data);
    const matched = await dataWith(stealthPng(stealthBytes(fields), { texts: texts() })); expect(parseBackup(exportBackup(matched, timestamp)).payload).toEqual(matched);
  });
  it('old image metadata without the field stays valid', async () => {
    const data = await dataWith(encodePng(4, 4, pattern(4, 4))); expect(data.images[0]!.metadata.novelai).toBeUndefined(); expect(validateData(data)).toEqual(data);
  });
  it.each([
    ['not an object', (n: Record<string, unknown>) => { n.sources = 'text'; }],
    ['no source', (n: Record<string, unknown>) => { n.sources = []; }],
    ['duplicate source', (n: Record<string, unknown>) => { n.sources = ['text', 'text']; }],
    ['unknown source', (n: Record<string, unknown>) => { n.sources = ['text', 'exif']; }],
    ['agreement vs sources', (n: Record<string, unknown>) => { n.agreement = 'single'; }],
    ['unknown agreement', (n: Record<string, unknown>) => { n.agreement = 'maybe'; }],
    ['mismatch without payload', (n: Record<string, unknown>) => { n.stealth = null; }],
    ['stealth payload without stealth source', (n: Record<string, unknown>) => { n.sources = ['text']; n.agreement = 'single'; }],
    ['non-string value', (n: Record<string, unknown>) => { n.stealth = { Comment: 1 }; }],
    ['long key', (n: Record<string, unknown>) => { n.stealth = { ['k'.repeat(80)]: 'x' }; }],
    ['empty key', (n: Record<string, unknown>) => { n.stealth = { '': 'x' }; }],
    ['huge value', (n: Record<string, unknown>) => { n.stealth = { Comment: 'x'.repeat(262_145) }; }],
    ['array payload', (n: Record<string, unknown>) => { n.stealth = ['x']; }],
  ])('rejects corrupt metadata.novelai: %s', async (_name, mutate) => {
    const data = await dataWith(mismatch()); mutate(data.images[0]!.metadata.novelai as unknown as Record<string, unknown>); expect(() => validateData(data)).toThrow();
  });
  it('rejects a text source whose Comment is missing from texts, and __proto__ keys in an imported backup', async () => {
    const data = await dataWith(mismatch()); delete data.images[0]!.metadata.texts.Comment; expect(() => validateData(data)).toThrow('Comment');
    const text = exportBackup(await dataWith(mismatch()), timestamp); expect(text).toContain('"stealth": {');
    expect(() => parseBackup(text.replace('"stealth": {', '"stealth": {"__proto__": "x",'))).toThrow('危険');
  });
});
