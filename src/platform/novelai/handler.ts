import { fieldLabel, parseFieldKey } from '../../core/shuffle/fields';
import type { NovelAIAdapter } from './adapter';
import {
  failure, GENERATION_REASON, isImageUrl, isSiteRequest, planSiteText, POSITION_REASON,
  type FieldSnapshot, type FieldsPreview, type FieldValue, type SiteResponse, type Target, type WritePreview,
} from './protocol';

export interface MessageSender { id?: string; url?: string; tab?: unknown }
export interface HandlerEnvironment {
  extensionId: string;
  panelUrl: string;
  documentId: string;
  isTopFrame: boolean;
  url: () => string;
  title: () => string;
  now: () => number;
  ticket: () => string;
  /** Timer used to end an unused generation-observer lease. Returns a cancel function. */
  schedule?: (callback: () => void, ms: number) => () => void;
}

/** A panel must poll within this window to keep the generation observer running. */
export const LEASE_MS = 15_000;
const NO_FIELDS = 'このサイト連携は複数欄の操作に対応していません。コピーを使用してください';

/**
 * The sender must be the extension's own panel page. Its fragment/query may vary
 * (the wide Lab tab opens `sidepanel.html#lab`), so only scheme, host and path are
 * compared. `URL.origin` is opaque for non-special schemes, hence the explicit parts.
 */
export function isPanelSender(senderUrl: string | undefined, panelUrl: string): boolean {
  if (typeof senderUrl !== 'string') return false;
  try {
    const url = new URL(senderUrl); const panel = new URL(panelUrl);
    return url.protocol === panel.protocol && url.host === panel.host && url.pathname === panel.pathname && !url.username && !url.password;
  } catch { return false; }
}

export function createSiteHandler(adapter: NovelAIAdapter, environment: HandlerEnvironment) {
  let prepared: { preview: WritePreview; snapshot: FieldSnapshot } | null = null;
  let preparedFields: { preview: FieldsPreview; snapshots: FieldSnapshot[] } | null = null;
  let writing = false;
  let lease: { session: string; expiresAt: number } | null = null;
  let cancelLease: (() => void) | null = null;
  const schedule = environment.schedule ?? ((callback, ms) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); });
  const releaseLease = () => { lease = null; cancelLease?.(); cancelLease = null; adapter.generation?.stop(); };
  // Writes are refused while a running observer reports an active generation.
  const generating = () => !!adapter.generation?.running && adapter.generation.status().generating;

  return async (input: unknown, sender: MessageSender): Promise<SiteResponse> => {
    if (sender.id !== environment.extensionId || !isPanelSender(sender.url, environment.panelUrl) || sender.tab !== undefined) return failure('UNAUTHORIZED', '拡張パネルからの操作だけを受け付けます');
    if (!isSiteRequest(input)) return failure('INVALID_MESSAGE', '操作メッセージが不正です');
    const request = input;
    const url = environment.url();
    if (!environment.isTopFrame || !isImageUrl(url)) return failure('UNSUPPORTED_PAGE', 'NovelAI画像生成ページ以外は操作しません');
    const target: Target = { tabId: request.tabId, url, documentId: environment.documentId };
    if (request.type !== 'inspect' && (request.documentId !== target.documentId || request.url !== url)) return failure('STALE_DOCUMENT', 'ページが移動・再読込されています。接続を確認し直してください');
    if (writing) return failure('BUSY', '反映を検証中です。完了後に操作してください');
    try {
      if (request.type === 'inspect') return { ok: true, type: 'inspect', inspection: { ...target, title: environment.title().slice(0, 200), capabilities: await adapter.capabilities() } };
      if (request.type === 'read') {
        const read = await adapter.read(request.channel);
        if (!read.ok) return read;
        if (environment.url() !== url) return failure('STALE_DOCUMENT', '読取り中にページが移動しました');
        return { ok: true, type: 'read', target, channel: request.channel, raw: read.snapshot.raw };
      }
      if (request.type === 'prepare') {
        prepared = null;
        const capabilities = await adapter.capabilities();
        if (!capabilities[request.channel].canWrite) return failure('UNSUPPORTED', capabilities[request.channel].reason);
        const read = await adapter.read(request.channel);
        if (!read.ok) return read;
        if (environment.url() !== url) return failure('STALE_DOCUMENT', 'プレビュー中にページが移動しました');
        const preview: WritePreview = { ...target, ticket: environment.ticket(), channel: request.channel, mode: request.mode, before: read.snapshot.raw, after: planSiteText(read.snapshot, request.text, request.mode), expiresAt: environment.now() + 60_000 };
        prepared = { preview, snapshot: read.snapshot };
        return { ok: true, type: 'prepare', preview };
      }
      if (request.type === 'inspectFields') {
        const generation = adapter.generation ? { supported: adapter.generation.supported, reason: adapter.generation.reason } : { supported: false, reason: GENERATION_REASON };
        const positions = { supported: false as const, reason: POSITION_REASON };
        if (!adapter.fields) {
          const base = await adapter.capabilities();
          return { ok: true, type: 'inspectFields', inspection: { ...target, base, characters: { slots: 0, canRead: false, canWrite: false, reason: NO_FIELDS }, model: { label: null, reason: NO_FIELDS }, positions, generation } };
        }
        return { ok: true, type: 'inspectFields', inspection: { ...target, ...await adapter.fields.describe(), positions, generation } };
      }
      if (request.type === 'readFields') {
        if (!adapter.fields) return failure('UNSUPPORTED', NO_FIELDS);
        const values: FieldValue[] = [];
        for (const field of request.fields) {
          const read = await adapter.fields.readField(field);
          if (!read.ok) return read;
          values.push({ field, raw: read.snapshot.raw });
        }
        if (environment.url() !== url) return failure('STALE_DOCUMENT', '読取り中にページが移動しました');
        return { ok: true, type: 'readFields', target, values };
      }
      if (request.type === 'prepareFields') {
        preparedFields = null;
        if (!adapter.fields) return failure('UNSUPPORTED', NO_FIELDS);
        if (generating()) return failure('BUSY', '生成中のためプロンプトを書き換えません。完了後に作成し直してください');
        const description = await adapter.fields.describe();
        if (description.characters.slots !== request.characterSlots) return failure('CONFLICT', `NovelAIのキャラクター欄（${description.characters.slots}個）と構成（${request.characterSlots}人）が一致しません。サイト側で欄を追加・削除してから再試行してください`);
        for (const write of request.writes) {
          const parsed = parseFieldKey(write.field);
          const capability = parsed.kind === 'base' ? description.base[parsed.channel] : parsed.index <= description.characters.slots ? description.characters : { canWrite: false, reason: '存在しないキャラクター欄です' };
          if (!capability.canWrite) return failure('UNSUPPORTED', `${fieldLabel(write.field)}: ${capability.reason}`);
        }
        const snapshots: FieldSnapshot[] = [];
        const writes: FieldsPreview['writes'] = [];
        for (const write of request.writes) {
          const read = await adapter.fields.readField(write.field);
          if (!read.ok) return read;
          snapshots.push(read.snapshot);
          writes.push({ field: write.field, before: read.snapshot.raw, after: write.text });
        }
        if (environment.url() !== url) return failure('STALE_DOCUMENT', 'プレビュー中にページが移動しました');
        const preview: FieldsPreview = { ...target, ticket: environment.ticket(), writes, expiresAt: environment.now() + 60_000 };
        preparedFields = { preview, snapshots };
        return { ok: true, type: 'prepareFields', preview };
      }
      if (request.type === 'applyFields') {
        const pending = preparedFields;
        preparedFields = null; // Single-use, like the channel ticket.
        if (!pending || request.ticket !== pending.preview.ticket || request.tabId !== pending.preview.tabId) return failure('EXPIRED', '反映プレビューは無効です。作成し直してください');
        if (environment.now() >= pending.preview.expiresAt) return failure('EXPIRED', '反映プレビューの有効期限が切れました');
        const fields = adapter.fields;
        if (!fields) return failure('UNSUPPORTED', NO_FIELDS);
        if (generating()) return failure('BUSY', '生成中のためプロンプトを書き換えません。完了後に作成し直してください');
        writing = true;
        try {
          // Compare every field before writing anything: a user edit aborts with zero writes.
          for (const [index, change] of pending.preview.writes.entries()) {
            const current = await fields.readField(change.field);
            if (!current.ok) return current;
            const expected = pending.snapshots[index]!;
            if (current.snapshot.token !== expected.token || current.snapshot.raw !== expected.raw) return failure('CONFLICT', `${fieldLabel(change.field)}がプレビュー後に変更されました。上書きせず中止しました`);
          }
          const written: { field: FieldsPreview['writes'][number]; snapshot: FieldSnapshot }[] = [];
          const rollback = async () => {
            // Restore only our own still-unchanged writes; never undo someone else's edit.
            for (const item of written.reverse()) {
              const current = await fields.readField(item.field.field);
              if (current.ok && current.snapshot.token === item.snapshot.token && current.snapshot.raw === item.field.after) await fields.writeField(item.field.field, current.snapshot, item.field.before);
            }
          };
          for (const [index, change] of pending.preview.writes.entries()) {
            const result = await fields.writeField(change.field, pending.snapshots[index]!, change.after);
            if (!result.ok || environment.url() !== url) {
              if (result.ok) written.push({ field: change, snapshot: result.snapshot });
              await rollback();
              // Always WRITE_FAILED once writing has started: the panel treats every
              // other applyFields code as "nothing was written" (site-session NO_WRITE_CODES).
              return failure('WRITE_FAILED', `${fieldLabel(change.field)}: ${result.ok ? '反映中にページが移動しました' : result.reason}。反映済みの欄は、他の編集がない場合だけ元に戻しました`);
            }
            written.push({ field: change, snapshot: result.snapshot });
          }
          const values: FieldValue[] = [];
          for (const change of pending.preview.writes) {
            const verified = await fields.readField(change.field);
            if (!verified.ok || verified.snapshot.raw !== change.after) return failure('VERIFY_FAILED', `${fieldLabel(change.field)}の書込み後の再読取りで一致を確認できませんでした`);
            values.push({ field: change.field, raw: verified.snapshot.raw });
          }
          return { ok: true, type: 'applyFields', target, values };
        } finally { writing = false; }
      }
      if (request.type === 'generationStatus') {
        const observer = adapter.generation;
        if (!observer?.supported) return { ok: true, type: 'generationStatus', target, status: { supported: false, reason: observer?.reason ?? GENERATION_REASON, observerId: '', generating: false, completed: 0, failed: 0 } };
        const now = environment.now();
        if (lease && lease.session !== request.session && lease.expiresAt > now) return failure('BUSY', '別のパネルがこのタブの自動シャッフルを使用中です');
        lease = { session: request.session, expiresAt: now + LEASE_MS };
        cancelLease?.();
        cancelLease = schedule(() => { if (lease && environment.now() >= lease.expiresAt) releaseLease(); }, LEASE_MS);
        observer.start();
        return { ok: true, type: 'generationStatus', target, status: observer.status() };
      }
      if (request.type === 'releaseGeneration') {
        if (lease?.session === request.session) releaseLease();
        return { ok: true, type: 'releaseGeneration', target };
      }
      const pending = prepared;
      prepared = null; // Single-use; failures also consume the confirmation ticket.
      if (!pending || request.ticket !== pending.preview.ticket || request.tabId !== pending.preview.tabId) return failure('EXPIRED', '反映プレビューは無効です。作成し直してください');
      if (environment.now() >= pending.preview.expiresAt) return failure('EXPIRED', '反映プレビューの有効期限が切れました');
      if (generating()) return failure('BUSY', '生成中のためプロンプトを書き換えません。完了後に作成し直してください');
      writing = true;
      try {
        const result = await adapter.write(pending.preview.channel, pending.snapshot, pending.preview.after, pending.preview.mode);
        if (!result.ok) return result;
        if (environment.url() !== url) return failure('STALE_DOCUMENT', '反映中にページが移動したため、結果を確定できません');
        const verified = await adapter.read(pending.preview.channel);
        if (!verified.ok || verified.snapshot.token !== pending.snapshot.token || verified.snapshot.raw !== pending.preview.after) return failure('VERIFY_FAILED', '書込み後の再読取りで一致を確認できませんでした');
        return { ok: true, type: 'apply', target, channel: pending.preview.channel, raw: verified.snapshot.raw };
      } finally { writing = false; }
    } catch {
      prepared = null;
      preparedFields = null;
      return failure('WRITE_FAILED', 'サイトとの操作に失敗しました。現在値を再読取りし、コピーを使用してください');
    }
  };
}
