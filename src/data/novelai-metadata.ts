// NovelAI's official PNG metadata *containers* (https://github.com/NovelAI/novelai-image-metadata,
// MIT): PNG text chunks `Title` / `Description` / `Software` / `Source` / `Generation time` /
// `Comment`, and the same keys (without Title) as gzip-compressed JSON in the alpha channel
// ("stealth pnginfo"). The meaning of the fields inside `Comment` is not officially documented and
// no real NovelAI sample has been checked, so nothing here becomes a confirmed generation setting:
// the mapped values are only *candidates* that the user may adopt explicitly.
import { unknownSettings } from '../core/experiments';
import type { InspectedPng } from '../core/png';
import { createAlphaLsbReader, MAX_STEALTH_PAYLOAD_BYTES, readStealthContainer, STEALTH_HEADER_BYTES, STEALTH_MAGIC } from '../core/png-stealth';
import type { GenerationSettings, ImageMetadata, NovelAIImageInfo } from '../core/types';
import { validateGenerationSettings, validateNovelAIInfo, validateSafeJson } from './validation';

export const NOVELAI_KEYS = ['Title', 'Description', 'Software', 'Source', 'Generation time', 'Comment'] as const;
/** Keys the official writer copies into the stealth payload (Title is dropped as static). */
const COMPARED_KEYS = NOVELAI_KEYS.filter(key => key !== 'Title');
const MAX_STEALTH_TEXT_BYTES = 262_144;

export type StealthRead =
  | { status: 'absent' }
  | { status: 'unchecked' }
  | { status: 'invalid'; warning: string }
  | { status: 'found'; fields: Record<string, string>; warnings: string[] };

const invalid = (reason: string): StealthRead => ({ status: 'invalid', warning: `アルファチャンネルにNovelAI形式の目印（stealth_pngcomp）がありますが、${reason}ため読み取りませんでした。` });

/** Bounded DecompressionStream: stops and throws as soon as the output exceeds `limit` bytes (gzip/zlib bombs). */
export async function inflateBounded(bytes: Uint8Array, format: 'deflate' | 'gzip', limit: number, error: string): Promise<Uint8Array> {
  const reader = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  const parts: Uint8Array[] = []; let length = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > limit) throw new Error(error); parts.push(part.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}

/** Inflates IDAT lazily (one chunk at a time) into the alpha reader; returns null when the magic is absent. */
async function alphaLsbBytes(png: InspectedPng): Promise<Uint8Array | null> {
  const available = Math.floor((png.width * png.height) / 8);
  if (available < STEALTH_MAGIC.length) return null;
  const collector = createAlphaLsbReader(png.width, png.height, { maxBytes: STEALTH_HEADER_BYTES + MAX_STEALTH_PAYLOAD_BYTES, prefix: STEALTH_MAGIC });
  let index = 0;
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({ pull(controller) { const part = png.idat[index++]; if (part) controller.enqueue(part.slice()); else controller.close(); } });
  const reader = source.pipeThrough(new DecompressionStream('deflate')).getReader();
  try {
    while (true) { const part = await reader.read(); if (part.done) break; if (collector.push(part.value) === 'mismatch') return null; }
    return collector.finish();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function stealthFields(value: unknown): { fields: Record<string, string>; converted: string[] } {
  validateSafeJson(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSONオブジェクトではありません');
  const fields: Record<string, string> = {}; const converted: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') fields[key] = item;
    else { fields[key] = JSON.stringify(item); converted.push(key); }
  }
  return { fields, converted };
}

/**
 * Reads the alpha-channel container of an inspected PNG. Only 8-bit RGBA, non-interlaced PNGs are
 * decoded ('unchecked' otherwise or when the pixel data cannot be decoded — the browser decode
 * that follows decides whether the PNG is valid). A found magic with a bad payload is reported as
 * 'invalid' with a warning; it never rejects the image.
 */
export async function readStealth(png: InspectedPng): Promise<StealthRead> {
  if (png.header.bitDepth !== 8 || png.header.colorType !== 6 || png.header.interlace !== 0 || !png.idat.length) return { status: 'unchecked' };
  let bytes: Uint8Array | null;
  try { bytes = await alphaLsbBytes(png); } catch { return { status: 'unchecked' }; }
  if (!bytes) return { status: 'absent' };
  const container = readStealthContainer(bytes);
  if (container.status === 'absent') return container;
  if (container.status === 'invalid') return invalid({ truncated: 'データが途中で切れている', oversized: `データ長が上限（${MAX_STEALTH_PAYLOAD_BYTES / 1024}KiB）を超える`, empty: 'データ長が0である' }[container.reason]);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(await inflateBounded(container.payload, 'gzip', MAX_STEALTH_TEXT_BYTES, 'too large')); }
  catch (cause) { return invalid(cause instanceof Error && cause.message === 'too large' ? `展開後のデータが${MAX_STEALTH_TEXT_BYTES / 1024}KiBを超える` : 'gzip圧縮のUTF-8テキストとして展開できない'); }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return invalid('JSONとして読めない'); }
  let result: ReturnType<typeof stealthFields>;
  try { result = stealthFields(parsed); } catch { return invalid('安全なJSONオブジェクトとして読めない'); }
  try { validateNovelAIInfo({ sources: ['stealth'], agreement: 'single', stealth: result.fields }, {}); } catch { return invalid('キー名または値の大きさが上限を超える'); }
  const warnings = result.converted.length ? [`アルファチャンネルの画像情報のうち文字列でない値（${result.converted.slice(0, 5).map(key => key.slice(0, 40)).join('、')}${result.converted.length > 5 ? ' ほか' : ''}）は、JSON文字列として保持しました。`] : [];
  return { status: 'found', fields: result.fields, warnings };
}

const sourceLabel = { text: 'PNGテキスト', stealth: 'アルファチャンネル' } as const;
export const NOVELAI_NOT_FOUND_WARNING = 'NovelAI固有メタデータは未検証です。NovelAI公式形式の画像情報（PNGテキストのComment・アルファチャンネル）は見つかりませんでした。生成条件を手入力してください。';
export const NOVELAI_NOT_FOUND_UNCHECKED_WARNING = 'NovelAI固有メタデータは未検証です。PNGテキストにNovelAI公式形式の画像情報（Comment）は見つかりませんでした。このPNG形式ではアルファチャンネルを確認していません。生成条件を手入力してください。';
export const NOVELAI_MISMATCH_WARNING = 'PNGテキストとアルファチャンネルのNovelAI画像情報が一致しません。両方を保持し、どちらも自動では採用しません。';
export const novelaiFoundWarning = (sources: NovelAIImageInfo['sources']) => `NovelAI固有メタデータは未検証です。NovelAI公式形式の画像情報（${sources.map(source => sourceLabel[source]).join('・')}）を検出しましたが、各項目の意味は公式に確認されていないため、生成条件には自動で採用しません。候補を確認して採用するか、手入力してください。`;

/**
 * Combines the PNG text chunks and the stealth read into the stored record. PNG text values stay in
 * `texts` (not duplicated). The stealth payload is stored unless it is identical to the text chunks.
 * Disagreement is flagged and both are kept; neither is picked silently.
 */
export function describeNovelAI(texts: Readonly<Record<string, string>>, stealth: StealthRead): { info?: NovelAIImageInfo; warnings: string[] } {
  const warnings = stealth.status === 'invalid' ? [stealth.warning] : stealth.status === 'found' ? [...stealth.warnings] : [];
  const text = Object.hasOwn(texts, 'Comment'); const fields = stealth.status === 'found' ? stealth.fields : null;
  if (!text && !fields) return { warnings };
  const sources: NovelAIImageInfo['sources'] = [...(text ? ['text' as const] : []), ...(fields ? ['stealth' as const] : [])];
  let info: NovelAIImageInfo = { sources, agreement: 'single', stealth: fields };
  if (text && fields) {
    const keys = new Set([...COMPARED_KEYS, ...Object.keys(fields)]);
    const match = [...keys].every(key => (Object.hasOwn(texts, key) ? texts[key] : undefined) === (Object.hasOwn(fields, key) ? fields[key] : undefined));
    const onlyOfficial = Object.keys(fields).every(key => (COMPARED_KEYS as readonly string[]).includes(key));
    info = { sources, agreement: match ? 'match' : 'mismatch', stealth: match && onlyOfficial ? null : fields };
    if (!match) warnings.push(NOVELAI_MISMATCH_WARNING);
  }
  validateNovelAIInfo(info, texts);
  return { info, warnings: [novelaiFoundWarning(sources), ...warnings] };
}

// ---- Display / candidates (computed from stored data on demand) ----

export type CommentParse =
  | { status: 'missing' }
  | { status: 'invalid'; reason: string }
  | { status: 'ok'; value: Readonly<Record<string, unknown>> };

export function parseNovelAIComment(raw: string | undefined): CommentParse {
  if (raw === undefined) return { status: 'missing' };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { status: 'invalid', reason: 'JSONとして読めません' }; }
  try { validateSafeJson(value); } catch { return { status: 'invalid', reason: '安全なJSONの条件（深さ・要素数・危険なキー名）を満たしません' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'invalid', reason: 'JSONオブジェクトではありません' };
  return { status: 'ok', value: value as Record<string, unknown> };
}

type CandidateField = 'seed' | 'steps' | 'width' | 'height' | 'sampler' | 'guidance' | 'cfgRescale' | 'model' | 'positive' | 'negative';
type Kind = 'seed' | 'integer' | 'number' | 'text' | 'prompt';
/** Key-name based mapping. It is an assumption for display only, never a verified meaning. */
export const NOVELAI_CANDIDATE_MAP: readonly { field: CandidateField; label: string; key: string; comment: boolean; kind: Kind }[] = [
  { field: 'seed', label: 'Seed', key: 'seed', comment: true, kind: 'seed' },
  { field: 'steps', label: 'Steps', key: 'steps', comment: true, kind: 'integer' },
  { field: 'width', label: '幅', key: 'width', comment: true, kind: 'integer' },
  { field: 'height', label: '高さ', key: 'height', comment: true, kind: 'integer' },
  { field: 'sampler', label: 'Sampler', key: 'sampler', comment: true, kind: 'text' },
  { field: 'guidance', label: 'Guidance / CFG', key: 'scale', comment: true, kind: 'number' },
  { field: 'cfgRescale', label: 'CFG Rescale', key: 'cfg_rescale', comment: true, kind: 'number' },
  { field: 'model', label: 'モデル', key: 'Source', comment: false, kind: 'text' },
  { field: 'positive', label: 'Positive', key: 'prompt', comment: true, kind: 'prompt' },
  { field: 'negative', label: 'Negative', key: 'uc', comment: true, kind: 'prompt' },
];
export interface NovelAICandidate { field: CandidateField; label: string; from: string; status: 'ok' | 'missing' | 'invalid'; value: string | number | null; found: string | null }

const describeType = (value: unknown) => value === null ? 'null' : Array.isArray(value) ? '配列' : typeof value === 'object' ? 'オブジェクト' : typeof value;
// Same limits as validateGenerationSettings / image prompt annotations.
function candidateValue(kind: Kind, value: unknown): string | number | null {
  if (kind === 'seed') return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (kind === 'integer') return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000 ? value : null;
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000 ? value : null;
  if (kind === 'text') return typeof value === 'string' && value.trim() && value.length <= 10_000 ? value : null;
  return typeof value === 'string' && value.length <= 100_000 ? value : null;
}

export interface NovelAISourceView {
  id: 'text' | 'stealth' | 'both';
  label: string;
  fields: [string, string][];
  comment: CommentParse;
  candidates: NovelAICandidate[];
}
export interface NovelAIView { agreement: NovelAIImageInfo['agreement']; /** Imported before alpha-channel reading existed (only text chunks are shown). */ legacy: boolean; sources: NovelAISourceView[] }

function sourceView(id: NovelAISourceView['id'], label: string, fields: Record<string, string>): NovelAISourceView {
  const ordered = [...NOVELAI_KEYS.filter(key => Object.hasOwn(fields, key)), ...Object.keys(fields).filter(key => !(NOVELAI_KEYS as readonly string[]).includes(key))];
  const comment = parseNovelAIComment(Object.hasOwn(fields, 'Comment') ? fields.Comment : undefined);
  const candidates = NOVELAI_CANDIDATE_MAP.map(({ field, label, key, comment: inComment, kind }): NovelAICandidate => {
    const from = inComment ? `Comment.${key}` : key;
    const source = inComment ? comment.status === 'ok' ? comment.value : null : fields;
    if (!source || !Object.hasOwn(source, key)) return { field, label, from, status: 'missing', value: null, found: null };
    const raw = source[key]; const value = candidateValue(kind, raw);
    return value === null ? { field, label, from, status: 'invalid', value: null, found: describeType(raw) } : { field, label, from, status: 'ok', value, found: null };
  });
  return { id, label, fields: ordered.map(key => [key, fields[key]!]), comment, candidates };
}

/** What to show for an image's NovelAI containers, or null when none was found. */
export function novelaiView(metadata: Pick<ImageMetadata, 'texts' | 'novelai'>): NovelAIView | null {
  const texts = metadata.texts; const info = metadata.novelai;
  const textFields = () => Object.fromEntries(NOVELAI_KEYS.filter(key => Object.hasOwn(texts, key)).map(key => [key, texts[key]!]));
  if (!info) return Object.hasOwn(texts, 'Comment') ? { agreement: 'single', legacy: true, sources: [sourceView('text', 'PNGテキスト', textFields())] } : null;
  const views: NovelAISourceView[] = [];
  if (info.agreement === 'match') views.push(sourceView('both', 'PNGテキスト・アルファチャンネル（内容が一致）', info.stealth ?? Object.fromEntries(COMPARED_KEYS.filter(key => Object.hasOwn(texts, key)).map(key => [key, texts[key]!]))));
  else {
    if (info.sources.includes('text')) views.push(sourceView('text', 'PNGテキスト', textFields()));
    if (info.sources.includes('stealth') && info.stealth) views.push(sourceView('stealth', 'アルファチャンネル', info.stealth));
  }
  return { agreement: info.agreement, legacy: false, sources: views };
}

const SETTING_FIELDS = ['seed', 'steps', 'width', 'height', 'sampler', 'guidance', 'cfgRescale', 'model'] as const;
export const hasSettingCandidates = (view: NovelAISourceView) => view.candidates.some(item => item.status === 'ok' && (SETTING_FIELDS as readonly string[]).includes(item.field));
export const hasPromptCandidates = (view: NovelAISourceView) => view.candidates.some(item => item.status === 'ok' && (item.field === 'positive' || item.field === 'negative'));

/** Settings built only from valid candidates; everything else stays unknown (null). */
export function candidateSettings(view: NovelAISourceView): GenerationSettings {
  const settings: GenerationSettings = { ...unknownSettings(), evidence: 'png-metadata', extrasConfirmed: false };
  const values: Record<string, string | number | null> = {};
  for (const item of view.candidates) if (item.status === 'ok' && (SETTING_FIELDS as readonly string[]).includes(item.field)) values[item.field] = item.value;
  const next = { ...settings, ...values } as GenerationSettings;
  validateGenerationSettings(next);
  return next;
}
export function candidatePrompts(view: NovelAISourceView): { positive: string | null; negative: string | null } {
  const pick = (field: 'positive' | 'negative') => { const item = view.candidates.find(candidate => candidate.field === field && candidate.status === 'ok'); return typeof item?.value === 'string' ? item.value : null; };
  return { positive: pick('positive'), negative: pick('negative') };
}
