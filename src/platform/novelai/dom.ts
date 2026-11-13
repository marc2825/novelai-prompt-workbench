import type { Channel } from '../../core/types';
import { parseFieldKey, type FieldKey } from '../../core/shuffle/fields';
import type { NovelAIAdapter, PromptFieldsAdapter } from './adapter';
import { visible } from './dom-visibility';
import { DomGenerationObserver, type GenerationProfile } from './generation';
import { failure, MAX_PROMPT_LENGTH, type Capabilities, type FieldCapability, type FieldSnapshot, type FieldsDescription, type Result, type WriteMode } from './protocol';

export { visible };

export interface VerifiedTextareaProfile {
  id: string;
  evidence: string;
  selectors: Record<Channel, string>;
  /** Character prompt textareas; `{n}` is replaced by the 1-based slot number. */
  characters?: { max: number; selectors: Record<Channel, string> };
  /** Element whose trimmed text is the model label. */
  model?: { selector: string };
  generation?: GenerationProfile;
}

// Only verified profiles may use this adapter. Production has no textarea profile.
export class TextareaAdapter implements NovelAIAdapter {
  private readonly tokens = new WeakMap<Element, string>();
  readonly fields: PromptFieldsAdapter;
  readonly generation?: DomGenerationObserver;
  constructor(private readonly document: Document, private readonly profile: VerifiedTextareaProfile) {
    this.fields = {
      describe: () => this.describe(),
      readField: async field => this.readElement(this.findField(field)),
      writeField: (field, expected, next) => this.writeElement(() => this.findField(field), expected, next, 'replace'),
    };
    if (profile.generation) this.generation = new DomGenerationObserver(document, profile.generation);
  }

  private selector(field: FieldKey): string | null {
    const parsed = parseFieldKey(field);
    if (parsed.kind === 'base') return this.profile.selectors[parsed.channel];
    const characters = this.profile.characters;
    if (!characters || parsed.index > characters.max) return null;
    return characters.selectors[parsed.channel].replaceAll('{n}', String(parsed.index));
  }
  private other(field: FieldKey): string | null {
    const parsed = parseFieldKey(field);
    const flipped: Channel = parsed.channel === 'positive' ? 'negative' : 'positive';
    return this.selector(parsed.kind === 'base' ? `base:${flipped}` : `character:${parsed.index}:${flipped}`);
  }
  private findField(field: FieldKey): Result<{ element: HTMLTextAreaElement }> {
    const selector = this.selector(field);
    if (!selector) return failure('UNSUPPORTED', 'このサイト連携ではキャラクター欄を扱えません');
    return this.findBy(selector, this.other(field));
  }
  private find(channel: Channel): Result<{ element: HTMLTextAreaElement }> {
    return this.findBy(this.profile.selectors[channel], this.profile.selectors[channel === 'positive' ? 'negative' : 'positive']);
  }
  private findBy(selector: string, otherSelector: string | null): Result<{ element: HTMLTextAreaElement }> {
    const matches = Array.from(this.document.querySelectorAll(selector)).filter(visible);
    if (!matches.length) return failure('NOT_FOUND', '入力欄が見つかりません。コピーを使用してください');
    if (matches.length !== 1) return failure('AMBIGUOUS', '入力欄の候補が複数あるため書き込みません');
    const element = matches[0]!;
    if (!(element instanceof this.document.defaultView!.HTMLTextAreaElement)) return failure('UNSUPPORTED', '確認済みのtextareaではありません');
    if (otherSelector && Array.from(this.document.querySelectorAll(otherSelector)).includes(element)) return failure('AMBIGUOUS', 'チャンネルの入力欄が重複しています');
    if (element.disabled || element.readOnly) return failure('UNSUPPORTED', '入力欄は無効または読取り専用です');
    return { ok: true, element };
  }

  private snapshot(element: HTMLTextAreaElement): FieldSnapshot {
    let token = this.tokens.get(element);
    if (!token) { token = crypto.randomUUID(); this.tokens.set(element, token); }
    return { raw: element.value, start: element.selectionStart, end: element.selectionEnd, token };
  }
  private readElement(found: Result<{ element: HTMLTextAreaElement }>): Result<{ snapshot: FieldSnapshot }> {
    if (!found.ok) return found;
    if (found.element.value.length > MAX_PROMPT_LENGTH) return failure('UNSUPPORTED', '入力が100万文字を超えています');
    return { ok: true, snapshot: this.snapshot(found.element) };
  }

  async capabilities(): Promise<Capabilities> {
    const result = {} as Capabilities;
    for (const channel of ['positive', 'negative'] as const) {
      const field = this.find(channel);
      result[channel] = { canRead: field.ok, canWrite: field.ok, reason: field.ok ? this.profile.evidence : field.reason };
    }
    return result;
  }

  private async describe(): Promise<Omit<FieldsDescription, 'positions' | 'generation'>> {
    const capability = (field: FieldKey): FieldCapability => {
      const found = this.findField(field);
      return { canRead: found.ok, canWrite: found.ok, reason: found.ok ? this.profile.evidence : found.reason };
    };
    let slots = 0;
    let writable = true;
    const max = this.profile.characters?.max ?? 0;
    while (slots < max && this.findField(`character:${slots + 1}:positive`).ok) {
      slots++;
      writable &&= this.findField(`character:${slots}:negative`).ok;
    }
    const modelElements = this.profile.model ? Array.from(this.document.querySelectorAll(this.profile.model.selector)).filter(visible) : [];
    const label = modelElements.length === 1 ? (modelElements[0]!.textContent ?? '').trim().slice(0, 200) || null : null;
    return {
      base: { positive: capability('base:positive'), negative: capability('base:negative') },
      characters: { slots, canRead: slots > 0, canWrite: slots > 0 && writable, reason: !this.profile.characters ? 'このサイト連携ではキャラクター欄を扱えません' : slots ? this.profile.evidence : 'キャラクター欄が見つかりません' },
      model: { label, reason: label ? this.profile.evidence : 'モデル表示を一意に特定できません' },
    };
  }

  async read(channel: Channel): Promise<Result<{ snapshot: FieldSnapshot }>> {
    return this.readElement(this.find(channel));
  }

  async write(channel: Channel, expected: FieldSnapshot, next: string, mode: WriteMode): Promise<Result<{ snapshot: FieldSnapshot }>> {
    return this.writeElement(() => this.find(channel), expected, next, mode);
  }

  private async writeElement(locate: () => Result<{ element: HTMLTextAreaElement }>, expected: FieldSnapshot, next: string, mode: WriteMode): Promise<Result<{ snapshot: FieldSnapshot }>> {
    const found = locate();
    if (!found.ok) return found;
    const element = found.element;
    const current = this.snapshot(element);
    if (current.token !== expected.token || current.raw !== expected.raw || (mode === 'insert' && (current.start !== expected.start || current.end !== expected.end))) return failure('CONFLICT', 'プレビュー後に入力欄・原文・選択範囲が変わりました。再読取りしてください');
    if (next.length > MAX_PROMPT_LENGTH || (element.maxLength >= 0 && next.length > element.maxLength)) return failure('WRITE_FAILED', '入力欄の文字数上限を超えています');
    const view = this.document.defaultView!;
    const setter = Object.getOwnPropertyDescriptor(view.HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) return failure('UNSUPPORTED', '入力欄を安全に更新できません');
    const dispatch = (text: string) => {
      setter.call(element, text);
      element.dispatchEvent(new view.InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
      element.dispatchEvent(new view.Event('change', { bubbles: true }));
    };
    try {
      dispatch(next);
      // Verify after controlled state has had time to restore/rerender the input.
      await new Promise<void>(resolve => view.setTimeout(resolve, 80));
      const after = locate();
      if (!after.ok || after.element !== element || element.value !== next) return failure('VERIFY_FAILED', '再読取りが反映内容と一致しません。自動再試行せず、サイトの現在値を確認してください');
      element.setSelectionRange(Math.min(current.start, next.length), Math.min(current.end, next.length));
      return { ok: true, snapshot: this.snapshot(element) };
    } catch {
      // Restore only our own unchanged write; never overwrite a concurrent edit.
      const after = locate();
      if (after.ok && after.element === element && element.value === next) {
        try { dispatch(expected.raw); } catch { /* Report failure, never retry generation. */ }
      }
      return failure('WRITE_FAILED', '書込みに失敗しました。現在値を再確認し、コピーを使用してください');
    }
  }
}
