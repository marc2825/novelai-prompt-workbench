export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_777_216;
export const MAX_TEXT_BYTES = 262_144;
export interface PngTextChunk { type: string; bytes: Uint8Array }
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let crc = index;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    table[index] = crc >>> 0;
  }
  return table;
})();
/** CRC-32 (IEEE, as used by PNG and ZIP). Table-driven; same result as the bitwise definition. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function inspectPng(bytes: Uint8Array) {
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('PNGは20MiBまでです');
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) throw new Error('PNG署名が不正です。対応形式はPNGです');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8; let width = 0; let height = 0; let count = 0; let textBytes = 0; let image = false; let end = false;
  const texts: PngTextChunk[] = [];
  while (offset < bytes.length) {
    if (++count > 4096 || offset + 12 > bytes.length) throw new Error('PNGチャンクが破損または過大です');
    const size = view.getUint32(offset); const next = offset + 12 + size;
    if (next > bytes.length) throw new Error('PNGチャンクの長さが不正です');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, next - 4)) !== view.getUint32(next - 4)) throw new Error('PNGのCRCまたはチャンク名が不正です');
    const chunk = bytes.subarray(offset + 8, next - 4);
    if (count === 1 && type !== 'IHDR') throw new Error('PNGの先頭にIHDRが必要です');
    if (type === 'IHDR') {
      if (count !== 1 || size !== 13) throw new Error('PNGのIHDRが不正です');
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
      if (!width || !height || width > 8192 || height > 8192 || width * height > MAX_IMAGE_PIXELS) throw new Error('画像は各辺8192px・合計16Mpxまでです');
      if (chunk[10] !== 0 || chunk[11] !== 0 || ![0, 1].includes(chunk[12]!)) throw new Error('未対応のPNG方式です');
    } else if (type === 'IDAT') image = true;
    else if (type === 'IEND') { if (size || !image || next !== bytes.length) throw new Error('PNG終端が不正です'); end = true; }
    else if (type === 'acTL') throw new Error('アニメーションPNGは未対応です');
    else if (['tEXt', 'zTXt', 'iTXt'].includes(type)) {
      textBytes += size;
      if (textBytes > MAX_TEXT_BYTES || texts.length >= 128) throw new Error('PNGメタデータが256KiBまたは128チャンクを超えています');
      texts.push({ type, bytes: chunk.slice() });
    } else if (type[0] === type[0]!.toUpperCase() && type !== 'PLTE') throw new Error('未知のPNG必須チャンクです');
    offset = next;
  }
  if (!end) throw new Error('PNGが途中で切れています');
  return { width, height, texts };
}
