import type { PromptSpan } from './types';

const COMPLEX = /[{}\[\]|\r\n]|::|!macro:/i;

function validOffset(raw: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > raw.length) return false;
  // DOM textarea selections use UTF-16 offsets. Never split a surrogate pair.
  return !(offset > 0 && offset < raw.length && /[\uD800-\uDBFF]/.test(raw[offset - 1]!) && /[\uDC00-\uDFFF]/.test(raw[offset]!));
}

export function assertSafeCommentRange(raw: string, start: number, end: number): void {
  if (!validOffset(raw, start) || !validOffset(raw, end) || start >= end || !raw.slice(start, end).trim()) throw new Error('コメントにするテキスト範囲を選択してください');
  if (start === 0 && end === raw.length) return;
  if (COMPLEX.test(raw)) throw new Error('複雑構文・改行を含む原文は範囲を安全に判定できません。全文選択または部品トグルを使用してください');
  const before = raw.slice(0, start).trimEnd();
  const selected = raw.slice(start, end).trim();
  const after = raw.slice(end).trimStart();
  if ((before && !before.endsWith(',') && !selected.startsWith(',')) || (after && !after.startsWith(',') && !selected.endsWith(','))) throw new Error('語の途中はコメントにできません。カンマで区切られた項目全体を選択してください');
  if (!selected.replace(/,/g, '').trim()) throw new Error('区切り記号だけはコメントにできません');
}

export function assertCommentSpans(raw: string, spans: PromptSpan[]): void {
  if (!spans.length || spans.map(span => span.text).join('') !== raw) throw new Error('コメント範囲と原文が一致しません');
  let offset = 0;
  let inactiveStart: number | null = null;
  for (const span of spans) {
    if (!span.text || typeof span.enabled !== 'boolean') throw new Error('コメント範囲が不正です');
    if (!span.enabled && inactiveStart === null) inactiveStart = offset;
    if (span.enabled && inactiveStart !== null) { assertSafeCommentRange(raw, inactiveStart, offset); inactiveStart = null; }
    offset += span.text.length;
  }
  if (inactiveStart !== null) assertSafeCommentRange(raw, inactiveStart, offset);
}

export function commentRange(raw: string, previous: PromptSpan[] | undefined, start: number, end: number, ids: [string, string, string]): PromptSpan[] {
  assertSafeCommentRange(raw, start, end);
  if (previous) assertCommentSpans(raw, previous);
  const original = previous ?? [{ id: ids[0], text: raw, enabled: true }];
  let offset = 0;
  const before: PromptSpan[] = [];
  const after: PromptSpan[] = [];
  for (const span of original) {
    const nextOffset = offset + span.text.length;
    if (nextOffset <= start) before.push(span);
    else if (offset >= end) after.push(span);
    else {
      if (!span.enabled) throw new Error('既存のOFF範囲と重なっています。範囲トグルで解除してください');
      if (offset < start) before.push({ ...span, text: span.text.slice(0, start - offset) });
      if (nextOffset > end) after.push({ ...span, id: ids[2], text: span.text.slice(end - offset) });
    }
    offset = nextOffset;
  }
  const result = [...before, { id: ids[1], text: raw.slice(start, end), enabled: false }, ...after];
  assertCommentSpans(raw, result);
  return result;
}

export function toggleCommentSpan(raw: string, spans: PromptSpan[], id: string): PromptSpan[] {
  const result = spans.map(span => span.id === id ? { ...span, enabled: !span.enabled } : span);
  assertCommentSpans(raw, result);
  return result;
}

export function renderCommentSpans(raw: string, spans?: PromptSpan[]): string {
  if (!spans) return raw;
  assertCommentSpans(raw, spans);
  let result = '';
  let gap = false;
  for (const span of spans) {
    if (!span.enabled) { gap = true; continue; }
    let piece = span.text;
    if (gap) {
      if (!result.trim()) piece = piece.replace(/^\s*,\s*/, '');
      else if (/,\s*$/.test(result) && /^\s*,/.test(piece)) {
        result = result.trimEnd() + ' ';
        piece = piece.replace(/^\s*,\s*/, '');
      }
    }
    result += piece;
    gap = false;
  }
  if (gap) result = result.replace(/,\s*$/, '');
  // Only the exact boundaries introduced by disabled spans are cleaned.
  return result;
}
