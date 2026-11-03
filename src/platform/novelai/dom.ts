import type { Channel } from '../../core/types';
import type { NovelAIAdapter } from './adapter';
import { failure, MAX_PROMPT_LENGTH, type Capabilities, type FieldSnapshot, type Result, type WriteMode } from './protocol';

export interface VerifiedTextareaProfile {
  id: string;
  evidence: string;
  selectors: Record<Channel, string>;
}

export function visible(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view || !element.isConnected || !element.getClientRects().length || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = view.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
}

// Only verified profiles may use this adapter. Production has no textarea profile.
export class TextareaAdapter implements NovelAIAdapter {
  private readonly tokens = new WeakMap<Element, string>();
  constructor(private readonly document: Document, private readonly profile: VerifiedTextareaProfile) {}

  private find(channel: Channel): Result<{ element: HTMLTextAreaElement }> {
    const matches = Array.from(this.document.querySelectorAll(this.profile.selectors[channel])).filter(visible);
    if (!matches.length) return failure('NOT_FOUND', '入力欄が見つかりません。コピーを使用してください');
    if (matches.length !== 1) return failure('AMBIGUOUS', '入力欄の候補が複数あるため書き込みません');
    const element = matches[0]!;
    if (!(element instanceof this.document.defaultView!.HTMLTextAreaElement)) return failure('UNSUPPORTED', '確認済みのtextareaではありません');
    const other = Array.from(this.document.querySelectorAll(this.profile.selectors[channel === 'positive' ? 'negative' : 'positive']));
    if (other.includes(element)) return failure('AMBIGUOUS', 'チャンネルの入力欄が重複しています');
    if (element.disabled || element.readOnly) return failure('UNSUPPORTED', '入力欄は無効または読取り専用です');
    return { ok: true, element };
  }

  private snapshot(element: HTMLTextAreaElement): FieldSnapshot {
    let token = this.tokens.get(element);
    if (!token) { token = crypto.randomUUID(); this.tokens.set(element, token); }
    return { raw: element.value, start: element.selectionStart, end: element.selectionEnd, token };
  }

  async capabilities(): Promise<Capabilities> {
    const result = {} as Capabilities;
    for (const channel of ['positive', 'negative'] as const) {
      const field = this.find(channel);
      result[channel] = { canRead: field.ok, canWrite: field.ok, reason: field.ok ? this.profile.evidence : field.reason };
    }
    return result;
  }

  async read(channel: Channel): Promise<Result<{ snapshot: FieldSnapshot }>> {
    const found = this.find(channel);
    if (!found.ok) return found;
    if (found.element.value.length > MAX_PROMPT_LENGTH) return failure('UNSUPPORTED', '入力が100万文字を超えています');
    return { ok: true, snapshot: this.snapshot(found.element) };
  }

  async write(channel: Channel, expected: FieldSnapshot, next: string, mode: WriteMode): Promise<Result<{ snapshot: FieldSnapshot }>> {
    const found = this.find(channel);
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
      const after = this.find(channel);
      if (!after.ok || after.element !== element || element.value !== next) return failure('VERIFY_FAILED', '再読取りが反映内容と一致しません。自動再試行せず、サイトの現在値を確認してください');
      element.setSelectionRange(Math.min(current.start, next.length), Math.min(current.end, next.length));
      return { ok: true, snapshot: this.snapshot(element) };
    } catch {
      // Restore only our own unchanged write; never overwrite a concurrent edit.
      const after = this.find(channel);
      if (after.ok && after.element === element && element.value === next) {
        try { dispatch(expected.raw); } catch { /* Report failure, never retry generation. */ }
      }
      return failure('WRITE_FAILED', '書込みに失敗しました。現在値を再確認し、コピーを使用してください');
    }
  }
}
