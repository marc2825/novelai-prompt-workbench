import type { Channel } from '../../core/types';

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

export type SiteRequest = { protocol: typeof PROTOCOL; tabId: number } & (
  | { type: 'inspect' }
  | { type: 'read'; documentId: string; url: string; channel: Channel }
  | { type: 'prepare'; documentId: string; url: string; channel: Channel; mode: WriteMode; text: string }
  | { type: 'apply'; documentId: string; url: string; ticket: string }
);
export type SiteResponse =
  | Failure
  | { ok: true; type: 'inspect'; inspection: SiteInspection }
  | { ok: true; type: 'read'; target: Target; channel: Channel; raw: string }
  | { ok: true; type: 'prepare'; preview: WritePreview }
  | { ok: true; type: 'apply'; target: Target; channel: Channel; raw: string };

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
  return value.type === 'apply' && keys.length === 6 && small(value.ticket);
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
