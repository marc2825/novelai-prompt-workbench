import type { NovelAIAdapter } from './adapter';
import { failure, isImageUrl, isSiteRequest, planSiteText, type FieldSnapshot, type SiteResponse, type Target, type WritePreview } from './protocol';

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
}

export function createSiteHandler(adapter: NovelAIAdapter, environment: HandlerEnvironment) {
  let prepared: { preview: WritePreview; snapshot: FieldSnapshot } | null = null;
  let writing = false;
  return async (input: unknown, sender: MessageSender): Promise<SiteResponse> => {
    if (sender.id !== environment.extensionId || sender.url !== environment.panelUrl || sender.tab !== undefined) return failure('UNAUTHORIZED', '拡張パネルからの操作だけを受け付けます');
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
      const pending = prepared;
      prepared = null; // Single-use; failures also consume the confirmation ticket.
      if (!pending || request.ticket !== pending.preview.ticket || request.tabId !== pending.preview.tabId) return failure('EXPIRED', '反映プレビューは無効です。作成し直してください');
      if (environment.now() >= pending.preview.expiresAt) return failure('EXPIRED', '反映プレビューの有効期限が切れました');
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
      return failure('WRITE_FAILED', 'サイトとの操作に失敗しました。現在値を再読取りし、コピーを使用してください');
    }
  };
}
