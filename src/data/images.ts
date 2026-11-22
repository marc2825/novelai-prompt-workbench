import { unknownSettings } from '../core/experiments';
import { inspectPng, MAX_IMAGE_BYTES, MAX_TEXT_BYTES, type InspectedPng, type PngTextChunk } from '../core/png';
import type { ImageMetadata, ImageRecord } from '../core/types';
import { describeNovelAI, inflateBounded, NOVELAI_NOT_FOUND_UNCHECKED_WARNING, NOVELAI_NOT_FOUND_WARNING, readStealth, type StealthRead } from './novelai-metadata';
import { validateGenerationSettings, validateSafeJson } from './validation';

const inflate = (bytes: Uint8Array) => inflateBounded(bytes, 'deflate', MAX_TEXT_BYTES, '展開したメタデータが256KiBを超えています');
async function textChunk(chunk: PngTextChunk): Promise<[string, string]> {
  const bytes = chunk.bytes; const end = bytes.indexOf(0);
  if (end < 1 || end > 79) throw new Error('PNGテキストのキーワードが不正です');
  const latin = (value: Uint8Array) => Array.from(value, byte => String.fromCharCode(byte)).join('');
  const key = latin(bytes.subarray(0, end));
  if (/^[ ]|[ ]$|  /.test(key) || [...key].some(char => { const code = char.charCodeAt(0); return code < 32 || (code > 126 && code < 161); })) throw new Error('PNGキーワード文字が不正です');
  if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('危険なメタデータキーです');
  let content = bytes.subarray(end + 1);
  if (chunk.type === 'zTXt') { if (content[0] !== 0) throw new Error('PNG圧縮方式が不正です'); content = await inflate(content.subarray(1)); }
  if (chunk.type === 'iTXt') {
    const flag = content[0]; if (![0, 1].includes(flag!) || content[1] !== 0) throw new Error('PNG国際テキストが不正です');
    const language = content.indexOf(0, 2); const translated = content.indexOf(0, language + 1);
    if (language < 0 || translated < 0) throw new Error('PNG国際テキストが破損しています');
    content = content.subarray(translated + 1); if (flag) content = await inflate(content);
  }
  return [key, chunk.type === 'iTXt' ? new TextDecoder('utf-8', { fatal: true }).decode(content) : latin(content)];
}
// Replaceable parser contract for *confirmed* settings. NovelAI's official containers are read
// separately (novelai-metadata.ts) and only offered as unverified candidates: their field
// meanings are undocumented and no real, officially saved sample has been checked.
export interface GenerationMetadataParser { parse(texts: Readonly<Record<string, string>>): Partial<Pick<ImageMetadata, 'positive' | 'negative' | 'settings'>> }
export const workbenchMetadataParser: GenerationMetadataParser = {
  parse(texts) {
    const raw = texts['nai-prompt-workbench']; if (!raw) return {};
    const value: unknown = JSON.parse(raw); validateSafeJson(value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('生成メタデータが不正です');
    const data = value as Record<string, unknown>;
    if (data.format !== 'nai-prompt-workbench-generation' || data.schemaVersion !== 1) throw new Error('未知の生成メタデータ形式です');
    for (const field of ['positive', 'negative']) if (data[field] !== null && (typeof data[field] !== 'string' || (data[field] as string).length > 100_000)) throw new Error('メタデータのプロンプトが不正です');
    validateGenerationSettings(data.settings);
    return { positive: data.positive as string | null, negative: data.negative as string | null, settings: { ...structuredClone(data.settings), evidence: 'png-metadata' } as ImageMetadata['settings'] };
  },
};
/**
 * `stealth` is the alpha-channel read of the same PNG (readStealth). Callers that only have text
 * chunks get 'unchecked'. NovelAI containers are recorded in `metadata.novelai` but never change
 * `settings` / `positive` / `negative`: their field meanings are not officially documented.
 */
export async function extractMetadata(chunks: PngTextChunk[], parser: GenerationMetadataParser = workbenchMetadataParser, stealth: StealthRead = { status: 'unchecked' }): Promise<ImageMetadata> {
  const result: ImageMetadata = { positive: null, negative: null, settings: unknownSettings(), texts: {}, warnings: [] };
  let length = 0;
  for (const chunk of chunks) {
    const [key, text] = await textChunk(chunk); length += new TextEncoder().encode(text).length;
    if (length > MAX_TEXT_BYTES) throw new Error('展開したメタデータ合計が256KiBを超えています');
    if (Object.hasOwn(result.texts, key)) throw new Error('PNGメタデータキーが重複しています');
    result.texts[key] = text;
  }
  try { Object.assign(result, parser.parse(result.texts)); }
  catch { result.warnings.push('生成メタデータを検証できません。原文テキストを保持し、生成条件は不明とします。'); }
  const novelai = describeNovelAI(result.texts, stealth);
  if (novelai.info) result.novelai = novelai.info;
  result.warnings.push(...novelai.warnings);
  if (!novelai.info && result.settings.evidence === 'unknown') result.warnings.push(stealth.status === 'unchecked' ? NOVELAI_NOT_FOUND_UNCHECKED_WARNING : NOVELAI_NOT_FOUND_WARNING);
  result.promptEvidence = result.positive === null && result.negative === null ? 'unknown' : 'png-metadata';
  return result;
}
/** Structure check, alpha-channel read and text metadata of one PNG (no browser decode). */
export async function readPngMetadata(bytes: Uint8Array, parser: GenerationMetadataParser = workbenchMetadataParser): Promise<{ png: InspectedPng; metadata: ImageMetadata }> {
  const png = inspectPng(bytes);
  return { png, metadata: await extractMetadata(png.texts, parser, await readStealth(png)) };
}
export interface ImageWrite { id: string; original: Blob; thumbnail: Blob }
export interface PreparedImage extends ImageWrite { record: ImageRecord }
export async function prepareImage(file: File, id: string, now: string): Promise<PreparedImage> {
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error('画像は空でない20MiB以下のPNGを選択してください');
  const bytes = new Uint8Array(await file.arrayBuffer()); const { png, metadata } = await readPngMetadata(bytes);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('');
  const original = new Blob([bytes], { type: 'image/png' });
  const bitmap = await createImageBitmap(original);
  let thumbnail: Blob;
  try {
    if (bitmap.width !== png.width || bitmap.height !== png.height) throw new Error('PNG寸法とデコード結果が一致しません');
    const scale = Math.min(1, 256 / Math.max(png.width, png.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(png.width * scale)); canvas.height = Math.max(1, Math.round(png.height * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('サムネイルを生成できません'); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    thumbnail = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('サムネイルの生成に失敗しました')), 'image/png'));
  } finally { bitmap.close(); }
  return { id, original, thumbnail, record: { id, hash, name: file.name.slice(0, 200) || 'image.png', mime: 'image/png', width: png.width, height: png.height, byteLength: file.size, thumbnailBytes: thumbnail.size, createdAt: now, metadata } };
}
