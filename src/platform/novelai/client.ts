import type { Channel } from '../../core/types';
import { failure, isSiteResponse, PROTOCOL, type Result, type SiteInspection, type SiteRequest, type SiteResponse, type Target, type WriteMode, type WritePreview } from './protocol';

export interface TabTransport {
  listTabIds(): Promise<number[]>;
  send(tabId: number, request: SiteRequest): Promise<unknown>;
}
function sameTarget(a: Target, b: Target) { return a.tabId === b.tabId && a.documentId === b.documentId && a.url === b.url; }
function targetFields({ tabId, documentId, url }: Target): Target { return { tabId, documentId, url }; }

export class SiteClient {
  constructor(private readonly transport: TabTransport) {}

  private async send(request: SiteRequest): Promise<SiteResponse> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        this.transport.send(request.tabId, request),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 5000); }),
      ]);
      if (!isSiteResponse(response)) return failure('INVALID_MESSAGE', 'サイトからの応答を検証できません');
      if (!response.ok) return response;
      if (response.type !== request.type) return failure('INVALID_MESSAGE', '応答した操作の種類が一致しません');
      const target = response.type === 'inspect' ? response.inspection : response.type === 'prepare' ? response.preview : response.target;
      if (target.tabId !== request.tabId || (request.type !== 'inspect' && !sameTarget(target, request))) return failure('STALE_DOCUMENT', '応答したタブまたはページが選択先と一致しません');
      if (request.type === 'read' && response.type === 'read' && response.channel !== request.channel) return failure('INVALID_MESSAGE', '読取りチャンネルが一致しません');
      if (request.type === 'prepare' && response.type === 'prepare' && (response.preview.channel !== request.channel || response.preview.mode !== request.mode)) return failure('INVALID_MESSAGE', '反映プレビューのチャンネルまたは方法が一致しません');
      return response;
    } catch { return failure('DISCONNECTED', '対象タブに接続できません。ページを再読込し、コピーを使用してください'); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }

  async discover(): Promise<Result<{ sites: SiteInspection[] }>> {
    try {
      const ids = [...new Set(await this.transport.listTabIds())].filter(id => Number.isSafeInteger(id) && id >= 0);
      // Bound concurrency; no prompt text is requested while enumerating tabs.
      const sites: SiteInspection[] = [];
      for (let offset = 0; offset < ids.length; offset += 8) {
        const responses = await Promise.all(ids.slice(offset, offset + 8).map(tabId => this.send({ protocol: PROTOCOL, type: 'inspect', tabId })));
        for (const response of responses) if (response.ok && response.type === 'inspect') sites.push(response.inspection);
      }
      return { ok: true, sites };
    } catch { return failure('DISCONNECTED', 'タブの一覧を確認できません。コピーを使用してください'); }
  }

  read(target: Target, channel: Channel) {
    return this.send({ protocol: PROTOCOL, type: 'read', ...targetFields(target), channel });
  }
  prepare(target: Target, channel: Channel, mode: WriteMode, text: string) {
    return this.send({ protocol: PROTOCOL, type: 'prepare', ...targetFields(target), channel, mode, text });
  }
  async apply(preview: WritePreview) {
    const { tabId, documentId, url, ticket } = preview;
    const response = await this.send({ protocol: PROTOCOL, type: 'apply', tabId, documentId, url, ticket });
    if (response.ok && response.type === 'apply' && (response.channel !== preview.channel || response.raw !== preview.after)) return failure('VERIFY_FAILED', '反映したチャンネルまたは再読取り結果が確認内容と一致しません');
    return response;
  }
}
