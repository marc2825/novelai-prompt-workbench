import { deflateSync, gzipSync } from 'node:zlib';
import { crc32 } from '../../src/core/png';
export function chunk(type: string, content: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type), content]); const size = Buffer.alloc(4); size.writeUInt32BE(content.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([size, body, crc]);
}
// Synthetic PNG only. This is NOT a NovelAI compatibility sample.
export function png(width = 2, height = 2, texts: Record<string, string> = {}, color = 64, compressed = false): Buffer {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = y * (width * 4 + 1) + 1 + x * 4; rows[i] = color; rows[i + 1] = 40; rows[i + 2] = 100; rows[i + 3] = 255; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...Object.entries(texts).map(([key, text]) => chunk(compressed ? 'zTXt' : 'iTXt', Buffer.concat([Buffer.from(key), compressed ? Buffer.from([0, 0]) : Buffer.from([0, 0, 0, 0, 0]), compressed ? deflateSync(Buffer.from(text)) : Buffer.from(text)]))), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- Synthetic NovelAI-container fixtures, built from the container format of the official
// MIT-licensed https://github.com/NovelAI/novelai-image-metadata. NOT real NovelAI images. ----

export interface EncodeOptions {
  /** Text chunks in file order. */
  texts?: [key: string, value: string, type?: 'tEXt' | 'iTXt' | 'zTXt'][];
  /** PNG filter per row (0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth); a number applies to every row. */
  filter?: number | ((y: number) => number);
  /** Split the zlib stream into IDAT chunks of this many bytes. */
  idatSize?: number;
  colorType?: number;
  interlace?: number;
}
function paeth(a: number, b: number, c: number) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
const textChunk = ([key, value, type = 'tEXt']: [string, string, ('tEXt' | 'iTXt' | 'zTXt')?]) => chunk(type, type === 'tEXt'
  ? Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')])
  : type === 'zTXt' ? Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0, 0]), deflateSync(Buffer.from(value, 'latin1'))])
    : Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(value, 'utf8')]));
/** Encodes 8-bit pixels (RGBA unless colorType says otherwise) as a PNG with real row filtering. The interlace flag is written as given (pixels are not Adam7-ordered). */
export function encodePng(width: number, height: number, pixels: Uint8Array, options: EncodeOptions = {}): Buffer {
  const colorType = options.colorType ?? 6; const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const stride = width * channels; if (pixels.length !== stride * height) throw new Error('pixel length');
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = colorType; header[12] = options.interlace ?? 0;
  const rows = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const filter = typeof options.filter === 'function' ? options.filter(y) : options.filter ?? 0; rows[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const raw = pixels[y * stride + i]!; const left = i >= channels ? pixels[y * stride + i - channels]! : 0; const up = y ? pixels[(y - 1) * stride + i]! : 0; const upLeft = y && i >= channels ? pixels[(y - 1) * stride + i - channels]! : 0;
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : 0;
      rows[y * (stride + 1) + 1 + i] = (raw - predictor) & 255;
    }
  }
  const zlib = deflateSync(rows); const size = options.idatSize ?? zlib.length; const idat: Buffer[] = [];
  for (let offset = 0; offset < zlib.length; offset += size) idat.push(chunk('IDAT', zlib.subarray(offset, offset + size)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...(options.texts ?? []).map(textChunk), ...idat, chunk('IEND', Buffer.alloc(0))]);
}
/** Deterministic RGBA test pattern (alpha 255) so that every filter type changes the bytes. */
export function pattern(width: number, height: number, seed = 1): Uint8Array {
  const pixels = new Uint8Array(width * height * 4); let state = seed >>> 0;
  for (let i = 0; i < pixels.length; i++) { state = (Math.imul(state, 1103515245) + 12345) >>> 0; pixels[i] = i % 4 === 3 ? 255 : state >>> 24; }
  return pixels;
}
/** Writes `bytes` into the alpha LSBs column-major (x outer, y inner), MSB first, like nai_meta_writer.py (unused alpha 255, used 254|bit). */
export function embedAlpha(pixels: Uint8Array, width: number, height: number, bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(pixels); if (bytes.length * 8 > width * height) throw new Error('image too small');
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
    const bit = x * height + y; const index = (y * width + x) * 4 + 3;
    out[index] = bit < bytes.length * 8 ? 0xfe | ((bytes[bit >> 3]! >> (7 - (bit & 7))) & 1) : 0xff;
  }
  return out;
}
/** `stealth_pngcomp` + 32-bit big-endian bit length + gzip(JSON). Overrides build corrupt containers. */
export function stealthBytes(payload: object | Buffer, options: { magic?: string; bitLength?: number } = {}): Buffer {
  const data = Buffer.isBuffer(payload) ? payload : gzipSync(Buffer.from(JSON.stringify(payload)));
  const length = Buffer.alloc(4); length.writeUInt32BE(options.bitLength ?? data.length * 8);
  return Buffer.concat([Buffer.from(options.magic ?? 'stealth_pngcomp', 'latin1'), length, data]);
}
/** RGBA PNG whose alpha channel carries `bytes` (plus optional text chunks). */
export function stealthPng(bytes: Uint8Array, options: EncodeOptions & { width?: number; height?: number } = {}): Buffer {
  const width = options.width ?? 64; const height = options.height ?? 64;
  return encodePng(width, height, embedAlpha(pattern(width, height), width, height, bytes), options);
}
