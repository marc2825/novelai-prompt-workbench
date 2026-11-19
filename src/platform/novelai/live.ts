import type { Channel } from '../../core/types';
import { parseFieldKey } from '../../core/shuffle/fields';
import type { NovelAIAdapter, PromptFieldsAdapter } from './adapter';
import { visible } from './dom-visibility';
import { failure, MAX_PROMPT_LENGTH, type Capabilities, type FieldSnapshot, type Result } from './protocol';

// The editor wrapper is `[data-prompt-input="true"]` with the class
// `prompt-input-box-<visible field label>`, so the class depends on the UI language.
// Only labels observed on the real site are listed — never guessed translations;
// an unlisted language fails safely with NOT_FOUND. See DOM_ADAPTER_CHECKLIST.
// No hashed classes, positional selectors, private editor state, or write profile.
export const VERIFIED_FIELD_LABELS: Record<Channel, readonly string[]> = {
  positive: [
    'prompt', // English UI, public /image page, observed 2026-11-03
    'ベースプロンプト', // Japanese UI, logged in, observed 2026-11-19 (issue #4)
  ],
  negative: [
    'undesired-content', // English UI, public /image page, observed 2026-11-03
    '除外したい要素', // Japanese UI, logged in, observed 2026-11-19 (issue #4)
  ],
};
// Exact class tokens (`~=`), so character wrappers such as
// `prompt-input-box-キャラクタープロンプト-1-除外したい要素` never match a base channel.
export const SELECTORS: Record<Channel, string> = {
  positive: VERIFIED_FIELD_LABELS.positive.map(label => `[data-prompt-input="true"][class~="prompt-input-box-${label}"] .ProseMirror[contenteditable="true"]`).join(', '),
  negative: VERIFIED_FIELD_LABELS.negative.map(label => `[data-prompt-input="true"][class~="prompt-input-box-${label}"] .ProseMirror[contenteditable="true"]`).join(', '),
};
const READ_ONLY = '実NovelAIのProseMirror書込み・内部状態保持は未検証です。コピーを使用してください';
// Character Prompts / model selector / generation state were not observed (DOM_ADAPTER_CHECKLIST).
const NO_CHARACTERS = '実NovelAIのCharacter Prompts欄のDOMは未検証のため、読取り・書込みとも行いません。キャラクター別にコピーしてください';
const NO_MODEL = '実NovelAIのモデル表示のDOMは未検証のため、モデルは手動で選択してください';

export class LiveReadOnlyAdapter implements NovelAIAdapter {
  private readonly tokens = new WeakMap<Element, string>();
  readonly fields: PromptFieldsAdapter = {
    describe: async () => {
      const capabilities = await this.capabilities();
      return { base: capabilities, characters: { slots: 0, canRead: false, canWrite: false, reason: NO_CHARACTERS }, model: { label: null, reason: NO_MODEL } };
    },
    readField: async field => {
      const parsed = parseFieldKey(field);
      return parsed.kind === 'base' ? this.read(parsed.channel) : failure('UNSUPPORTED', NO_CHARACTERS);
    },
    writeField: async () => failure('UNSUPPORTED', READ_ONLY),
  };
  constructor(private readonly document: Document) {}

  async read(channel: Channel): Promise<Result<{ snapshot: FieldSnapshot }>> {
    const matches = Array.from(this.document.querySelectorAll(SELECTORS[channel])).filter(visible);
    if (!matches.length) return failure('NOT_FOUND', '確認済みの入力欄構造を検出できません（読取りを確認済みのNovelAI表示言語は英語・日本語です）。コピーを使用してください');
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
