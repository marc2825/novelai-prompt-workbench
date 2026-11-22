// NovelAI "stealth pnginfo" container (alpha channel), as read by the official MIT-licensed
// scripts at https://github.com/NovelAI/novelai-image-metadata (nai_meta.py). Pure code:
// PNG unfiltering of already-inflated IDAT bytes and the container framing only. The meaning
// of the fields inside the payload is NOT documented and is not interpreted here.

/** ASCII `stealth_pngcomp`. */
export const STEALTH_MAGIC = Uint8Array.from('stealth_pngcomp', char => char.charCodeAt(0));
/** Magic + 32-bit big-endian payload length in bits. */
export const STEALTH_HEADER_BYTES = STEALTH_MAGIC.length + 4;
/** Upper bound for the gzip-compressed payload we are willing to read. */
export const MAX_STEALTH_PAYLOAD_BYTES = 262_144;

export type AlphaLsbStatus = 'more' | 'mismatch';
export interface AlphaLsbReader {
  /** Feeds inflated IDAT bytes. 'mismatch' means the expected prefix is already known to be absent (stop reading). */
  push(chunk: Uint8Array): AlphaLsbStatus;
  /** Returns the packed bytes once every row has been read. Throws when the pixel data is incomplete. */
  finish(): Uint8Array;
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Collects the least significant bit of each alpha value of a non-interlaced, 8-bit RGBA PNG
 * (colour type 6) in column-major order (x outer, y inner, like numpy `alpha.T.reshape(-1)`),
 * packed 8 bits per byte, most significant bit first. Trailing bits that do not fill a byte are
 * dropped, as in the official reader. Only the first `maxBytes` bytes are kept. Rows are
 * unfiltered one at a time (None/Sub/Up/Average/Paeth), so memory stays at two rows plus output.
 */
export function createAlphaLsbReader(width: number, height: number, options: { maxBytes: number; prefix?: Uint8Array }): AlphaLsbReader {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error('画像の寸法が不正です');
  const stride = width * 4;
  const length = Math.max(0, Math.min(Math.floor((width * height) / 8), options.maxBytes));
  const output = new Uint8Array(length);
  const prefix = options.prefix ?? new Uint8Array(0);
  // Row after which every bit of the prefix is known (bit i belongs to row i mod height).
  const prefixRow = prefix.length ? Math.min(height, prefix.length * 8) - 1 : -1;
  if (prefix.length > length) return { push: () => 'mismatch', finish: () => output };
  let previous = new Uint8Array(stride); let current = new Uint8Array(stride);
  let filled = -1; let filter = 0; let y = 0; let mismatch = false;
  const finishRow = () => {
    for (let index = 0; index < stride; index++) {
      const left = index >= 4 ? current[index - 4]! : 0; const up = previous[index]!; const upLeft = index >= 4 ? previous[index - 4]! : 0;
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : 0;
      current[index] = (current[index]! + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const bit = x * height + y; const byte = bit >> 3;
      if (byte >= length) break;
      if (current[x * 4 + 3]! & 1) output[byte] = output[byte]! | (0x80 >> (bit & 7));
    }
    if (y === prefixRow) mismatch = prefix.some((value, index) => output[index] !== value);
    [previous, current] = [current, previous]; y++; filled = -1;
  };
  return {
    push(chunk) {
      if (mismatch) return 'mismatch';
      let offset = 0;
      while (offset < chunk.length) {
        if (y >= height) throw new Error('PNGの画素データが長すぎます');
        if (filled < 0) { filter = chunk[offset++]!; if (filter > 4) throw new Error('PNGのフィルタ種別が不正です'); filled = 0; continue; }
        const count = Math.min(stride - filled, chunk.length - offset);
        current.set(chunk.subarray(offset, offset + count), filled); filled += count; offset += count;
        if (filled === stride) { finishRow(); if (mismatch) return 'mismatch'; }
      }
      return 'more';
    },
    finish() {
      if (y !== height) throw new Error('PNGの画素データが途中で切れています');
      return output;
    },
  };
}

export type StealthContainer =
  | { status: 'absent' }
  | { status: 'invalid'; reason: 'truncated' | 'oversized' | 'empty' }
  | { status: 'found'; payload: Uint8Array };

/** Splits `stealth_pngcomp` + bit length + payload. Any optional FEC data after the payload is ignored. */
export function readStealthContainer(bytes: Uint8Array, maxPayload = MAX_STEALTH_PAYLOAD_BYTES): StealthContainer {
  if (bytes.length < STEALTH_MAGIC.length || STEALTH_MAGIC.some((value, index) => bytes[index] !== value)) return { status: 'absent' };
  if (bytes.length < STEALTH_HEADER_BYTES) return { status: 'invalid', reason: 'truncated' };
  const bits = new DataView(bytes.buffer, bytes.byteOffset + STEALTH_MAGIC.length, 4).getUint32(0);
  // The official reader floors the bit count to whole bytes.
  const size = Math.floor(bits / 8);
  if (!size) return { status: 'invalid', reason: 'empty' };
  if (size > maxPayload) return { status: 'invalid', reason: 'oversized' };
  if (STEALTH_HEADER_BYTES + size > bytes.length) return { status: 'invalid', reason: 'truncated' };
  return { status: 'found', payload: new Uint8Array(bytes.subarray(STEALTH_HEADER_BYTES, STEALTH_HEADER_BYTES + size)) };
}
