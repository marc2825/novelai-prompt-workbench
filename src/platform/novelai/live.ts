import type { Channel } from '../../core/types';
import type { NovelAIAdapter } from './adapter';
import { visible } from './dom';
import { failure, MAX_PROMPT_LENGTH, type Capabilities, type FieldSnapshot, type Result } from './protocol';

// Observed read-only on the public /image page, 2026-11-03. See DOM_ADAPTER_CHECKLIST.
// No hashed classes, positional selectors, private editor state, or write profile.
const SELECTORS: Record<Channel, string> = {
  positive: '.prompt-input-box-prompt[data-prompt-input="true"] .ProseMirror[contenteditable="true"]',
  negative: '.prompt-input-box-undesired-content[data-prompt-input="true"] .ProseMirror[contenteditable="true"]',
};
const READ_ONLY = '実NovelAIのProseMirror書込み・内部状態保持は未検証です。コピーを使用してください';

export class LiveReadOnlyAdapter implements NovelAIAdapter {
  private readonly tokens = new WeakMap<Element, string>();
  constructor(private readonly document: Document) {}

  async read(channel: Channel): Promise<Result<{ snapshot: FieldSnapshot }>> {
    const matches = Array.from(this.document.querySelectorAll(SELECTORS[channel])).filter(visible);
    if (!matches.length) return failure('NOT_FOUND', '確認済みの入力欄構造を検出できません。コピーを使用してください');
    if (matches.length !== 1) return failure('AMBIGUOUS', '表示中の編集欄が複数あるため読み取りません');
    const element = matches[0]!;
    if (Array.from(this.document.querySelectorAll(SELECTORS[channel === 'positive' ? 'negative' : 'positive'])).includes(element)) return failure('AMBIGUOUS', 'チャンネルの編集欄が重複しているため読み取りません');
    const paragraphs = Array.from(element.childNodes);
    if (!paragraphs.length || paragraphs.some(node => !(node instanceof this.document.defaultView!.HTMLElement) || node.tagName !== 'P' || node.attributes.length !== 0)) return failure('UNSUPPORTED', '原文を安全に抽出できないエディタ構造です');
    const lines: string[] = [];
    for (const paragraph of paragraphs) {
      let line = '';
      for (const [index, node] of Array.from(paragraph.childNodes).entries()) {
        if (node.nodeType === 3) line += node.textContent ?? '';
        else if (!(node instanceof this.document.defaultView!.HTMLBRElement) || node.className !== 'ProseMirror-trailingBreak' || node.attributes.length !== 1 || index !== paragraph.childNodes.length - 1) return failure('UNSUPPORTED', '装飾・マクロ等のDOMから原文を推測しません。コピーを使用してください');
      }
      lines.push(line);
    }
    const raw = lines.join('\n');
    if (raw.length > MAX_PROMPT_LENGTH) return failure('UNSUPPORTED', '入力が100万文字を超えています');
    let token = this.tokens.get(element);
    if (!token) { token = crypto.randomUUID(); this.tokens.set(element, token); }
    return { ok: true, snapshot: { raw, start: raw.length, end: raw.length, token } };
  }
  async capabilities(): Promise<Capabilities> {
    const positive = await this.read('positive');
    const negative = await this.read('negative');
    return {
      positive: { canRead: positive.ok, canWrite: false, reason: positive.ok ? READ_ONLY : positive.reason },
      negative: { canRead: negative.ok, canWrite: false, reason: negative.ok ? READ_ONLY : negative.reason },
    };
  }
  async write(): Promise<Result<{ snapshot: FieldSnapshot }>> { return failure('UNSUPPORTED', READ_ONLY); }
}
