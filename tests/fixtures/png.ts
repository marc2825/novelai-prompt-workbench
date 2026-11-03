import { deflateSync } from 'node:zlib';
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
