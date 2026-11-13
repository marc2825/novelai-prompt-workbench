import type { Channel } from '../../core/types';
import { isFieldKey, MAX_CHARACTER_FIELDS, type FieldKey } from '../../core/shuffle/fields';
import type { GenerationStatus } from '../../core/shuffle/generation';

export const PROTOCOL = 'nai-prompt-workbench/site-v1';
export const MAX_PROMPT_LENGTH = 1_000_000;
export type WriteMode = 'insert' | 'replace';
export type ErrorCode = 'INVALID_MESSAGE' | 'UNAUTHORIZED' | 'UNSUPPORTED_PAGE' | 'UNSUPPORTED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'CONFLICT' | 'STALE_DOCUMENT' | 'EXPIRED' | 'WRITE_FAILED' | 'VERIFY_FAILED' | 'BUSY' | 'DISCONNECTED';
const ERROR_CODES: ErrorCode[] = ['INVALID_MESSAGE', 'UNAUTHORIZED', 'UNSUPPORTED_PAGE', 'UNSUPPORTED', 'NOT_FOUND', 'AMBIGUOUS', 'CONFLICT', 'STALE_DOCUMENT', 'EXPIRED', 'WRITE_FAILED', 'VERIFY_FAILED', 'BUSY', 'DISCONNECTED'];
export type Failure = { ok: false; code: ErrorCode; reason: string };
export type Result<T> = ({ ok: true } & T) | Failure;
export const failure = (code: ErrorCode, reason: string): Failure => ({ ok: false, code, reason });

export interface ChannelCapabilities { canRead: boolean; canWrite: boolean; reason: string }
export type Capabilities = Record<Channel, ChannelCapabilities>;
export interface FieldSnapshot { raw: string; start: number; end: number; token: string }
export interface Target { tabId: number; documentId: string; url: string }
export interface SiteInspection extends Target { title: string; capabilities: Capabilities }
export interface WritePreview extends Target { ticket: string; channel: Channel; mode: WriteMode; before: string; after: string; expiresAt: number }

// Multi-field protocol used by Prompt Shuffle. Replace-only, one ticket for all fields.
export interface FieldCapability { canRead: boolean; canWrite: boolean; reason: string }
export interface FieldsDescription {
  base: Record<Channel, FieldCapability>;
  characters: { slots: number; canRead: boolean; canWrite: boolean; reason: string };
  /** Raw model label read from a verified element, or null when unknown/unverified. */
  model: { label: string | null; reason: string };
  /** Character Positions coordinates are never written by any adapter. */
  positions: { supported: false; reason: string };
  generation: { supported: boolean; reason: string };
}
export interface FieldsInspection extends Target, FieldsDescription {}
export interface FieldValue { field: FieldKey; raw: string }
export interface FieldChange { field: FieldKey; before: string; after: string }
export interface FieldsPreview extends Target { ticket: string; writes: FieldChange[]; expiresAt: number }
export const MAX_FIELD_WRITES = 1 + MAX_CHARACTER_FIELDS * 2;
export const MAX_FIELD_TOTAL = 4_000_000;
export const POSITION_REASON = 'Character Positionsの座標操作は実サイトで未検証のため、どのモードでも変更しません。プロンプト順と補助テキストのみ扱います';
export const GENERATION_REASON = '生成の開始・完了を安定して判定できる要素が未確認のため、自動検知は行いません。手動記録を使用してください';

export type SiteRequest = { protocol: typeof PROTOCOL; tabId: number } & (
  | { type: 'inspect' }
  | { type: 'read'; documentId: string; url: string; channel: Channel }
  | { type: 'prepare'; documentId: string; url: string; channel: Channel; mode: WriteMode; text: string }
  | { type: 'apply'; documentId: string; url: string; ticket: string }
  | { type: 'inspectFields'; documentId: string; url: string }
  | { type: 'readFields'; documentId: string; url: string; fields: FieldKey[] }
  | { type: 'prepareFields'; documentId: string; url: string; characterSlots: number; writes: { field: FieldKey; text: string }[] }
  | { type: 'applyFields'; documentId: string; url: string; ticket: string }
  | { type: 'generationStatus'; documentId: string; url: string; session: string }
  | { type: 'releaseGeneration'; documentId: string; url: string; session: string }
);
export type SiteResponse =
  | Failure
  | { ok: true; type: 'inspect'; inspection: SiteInspection }
  | { ok: true; type: 'read'; target: Target; channel: Channel; raw: string }
  | { ok: true; type: 'prepare'; preview: WritePreview }
  | { ok: true; type: 'apply'; target: Target; channel: Channel; raw: string }
  | { ok: true; type: 'inspectFields'; inspection: FieldsInspection }
  | { ok: true; type: 'readFields'; target: Target; values: FieldValue[] }
  | { ok: true; type: 'prepareFields'; preview: FieldsPreview }
  | { ok: true; type: 'applyFields'; target: Target; values: FieldValue[] }
  | { ok: true; type: 'generationStatus'; target: Target; status: GenerationStatus }
  | { ok: true; type: 'releaseGeneration'; target: Target };

export function isImageUrl(value: string): boolean {
  try { const url = new URL(value); return url.origin === 'https://novelai.net' && !url.username && !url.password && (url.pathname === '/image' || url.pathname.startsWith('/image/')); }
  catch { return false; }
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
const small = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const channel = (value: unknown): value is Channel => value === 'positive' || value === 'negative';
const prompt = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_PROMPT_LENGTH;
export function isTarget(value: unknown): value is Target {
  return record(value) && Number.isSafeInteger(value.tabId) && (value.tabId as number) >= 0 && small(value.documentId) && typeof value.url === 'string' && value.url.length <= 4096 && isImageUrl(value.url);
}
export function isSiteRequest(value: unknown): value is SiteRequest {
  if (!record(value) || value.protocol !== PROTOCOL || !Number.isSafeInteger(value.tabId) || (value.tabId as number) < 0) return false;
  const keys = Object.keys(value);
  if (value.type === 'inspect') return keys.length === 3;
  if (!isTarget(value)) return false;
  if (value.type === 'read') return keys.length === 6 && channel(value.channel);
  if (value.type === 'prepare') return keys.length === 8 && channel(value.channel) && (value.mode === 'insert' || value.mode === 'replace') && prompt(value.text);
  if (value.type === 'inspectFields') return keys.length === 5;
  if (value.type === 'readFields') return keys.length === 6 && fieldList(value.fields);
  if (value.type === 'prepareFields') {
    if (keys.length !== 7 || !Number.isSafeInteger(value.characterSlots) || (value.characterSlots as number) < 0 || (value.characterSlots as number) > MAX_CHARACTER_FIELDS || !Array.isArray(value.writes)) return false;
    const writes = value.writes as unknown[];
    let total = 0;
    return writes.every(item => record(item) && Object.keys(item).length === 2 && isFieldKey(item.field) && prompt(item.text) && (total += (item.text as string).length) <= MAX_FIELD_TOTAL)
      && fieldList(writes.map(item => (item as Record<string, unknown>).field));
  }
  if (value.type === 'generationStatus' || value.type === 'releaseGeneration') return keys.length === 6 && small(value.session) && (value.session as string).length <= 64;
  return (value.type === 'apply' || value.type === 'applyFields') && keys.length === 6 && small(value.ticket);
}
function fieldList(value: unknown): value is FieldKey[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_FIELD_WRITES && value.every(isFieldKey) && new Set(value).size === value.length;
}
function capability(value: unknown): boolean {
  return record(value) && typeof value.canRead === 'boolean' && typeof value.canWrite === 'boolean' && typeof value.reason === 'string' && value.reason.length <= 4096;
}
function fieldValues(value: unknown): boolean {
  return Array.isArray(value) && value.length <= MAX_FIELD_WRITES && value.every(item => record(item) && isFieldKey(item.field) && prompt(item.raw));
}
function isFieldsInspection(value: unknown): boolean {
  if (!isTarget(value) || !record(value)) return false;
  const base = value.base; const characters = value.characters; const model = value.model; const positions = value.positions; const generation = value.generation;
  return record(base) && capability(base.positive) && capability(base.negative)
    && record(characters) && Number.isSafeInteger(characters.slots) && (characters.slots as number) >= 0 && (characters.slots as number) <= MAX_CHARACTER_FIELDS && capability(characters)
    && record(model) && (model.label === null || (typeof model.label === 'string' && model.label.length <= 200)) && typeof model.reason === 'string' && model.reason.length <= 4096
    && record(positions) && positions.supported === false && typeof positions.reason === 'string' && positions.reason.length <= 4096
    && record(generation) && typeof generation.supported === 'boolean' && typeof generation.reason === 'string' && generation.reason.length <= 4096;
}
function isGenerationStatus(value: unknown): value is GenerationStatus {
  return record(value) && typeof value.supported === 'boolean' && typeof value.reason === 'string' && value.reason.length <= 4096 && typeof value.observerId === 'string' && value.observerId.length <= 64
    && typeof value.generating === 'boolean' && Number.isSafeInteger(value.completed) && (value.completed as number) >= 0 && Number.isSafeInteger(value.failed) && (value.failed as number) >= 0;
}
export function isSiteResponse(value: unknown): value is SiteResponse {
  if (!record(value)) return false;
  if (value.ok === false) return ERROR_CODES.includes(value.code as ErrorCode) && typeof value.reason === 'string' && value.reason.length <= 4096;
  if (value.ok !== true) return false;
  if (value.type === 'inspect') {
    const inspection = value.inspection;
    if (!isTarget(inspection) || !record(inspection) || typeof inspection.title !== 'string' || inspection.title.length > 200 || !record(inspection.capabilities)) return false;
    return ['positive', 'negative'].every(key => {
      const capability = (inspection.capabilities as Record<string, unknown>)[key];
      return record(capability) && typeof capability.canRead === 'boolean' && typeof capability.canWrite === 'boolean' && typeof capability.reason === 'string' && capability.reason.length <= 4096;
    });
  }
  if (value.type === 'prepare') {
    const preview = value.preview;
    return isTarget(preview) && record(preview) && small(preview.ticket) && channel(preview.channel) && (preview.mode === 'insert' || preview.mode === 'replace') && prompt(preview.before) && prompt(preview.after) && typeof preview.expiresAt === 'number' && Number.isFinite(preview.expiresAt);
  }
  if (value.type === 'inspectFields') return isFieldsInspection(value.inspection);
  if (value.type === 'prepareFields') {
    const preview = value.preview;
    return isTarget(preview) && record(preview) && small(preview.ticket) && typeof preview.expiresAt === 'number' && Number.isFinite(preview.expiresAt) && Array.isArray(preview.writes) && preview.writes.length > 0 && preview.writes.length <= MAX_FIELD_WRITES
      && preview.writes.every(item => record(item) && isFieldKey(item.field) && prompt(item.before) && prompt(item.after));
  }
  if (value.type === 'readFields' || value.type === 'applyFields') return isTarget(value.target) && fieldValues(value.values);
  if (value.type === 'generationStatus') return isTarget(value.target) && isGenerationStatus(value.status);
  if (value.type === 'releaseGeneration') return isTarget(value.target);
  return (value.type === 'read' || value.type === 'apply') && isTarget(value.target) && channel(value.channel) && prompt(value.raw);
}

export function planSiteText(snapshot: FieldSnapshot, text: string, mode: WriteMode): string {
  if (!prompt(snapshot.raw) || !prompt(text) || !Number.isInteger(snapshot.start) || !Number.isInteger(snapshot.end) || snapshot.start < 0 || snapshot.end < snapshot.start || snapshot.end > snapshot.raw.length) throw new Error('入力値または選択範囲が不正です');
  for (const offset of [snapshot.start, snapshot.end]) {
    if (offset > 0 && offset < snapshot.raw.length && /[\uD800-\uDBFF]/.test(snapshot.raw[offset - 1]!) && /[\uDC00-\uDFFF]/.test(snapshot.raw[offset]!)) throw new Error('Unicode文字の途中には挿入できません');
  }
  const result = mode === 'replace' ? text : snapshot.raw.slice(0, snapshot.start) + text + snapshot.raw.slice(snapshot.end);
  if (!prompt(result)) throw new Error('反映結果が100万文字を超えています');
  return result;
}
