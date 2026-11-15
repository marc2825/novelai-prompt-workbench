/** Explicit range editing only: never tokenize/rejoin the user's prompt. */
export const MIN_TAG_WEIGHT = 0;
export const MAX_TAG_WEIGHT = 2;
export const TAG_WEIGHT_STEP = 0.05;
const MAX_RAW_LENGTH = 1_000_000;
const WEIGHTED_TAG = /^(\d+(?:\.\d+)?)::([^,:{}\[\]|!\\\r\n]+)::$/;
const CONTEXT_WEIGHTS = /(?:^|(?<=,))\s*\d+(?:\.\d+)?::[^,:{}\[\]|!\\\r\n]+::\s*(?=,|$)/g;
const SPECIAL = /[:{}\[\]|!\\\r\n]/;

export interface TagWeightTarget {
  readonly source: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly weight: number;
}

function validOffset(raw: string, offset: number): boolean {
  return Number.isInteger(offset) && offset >= 0 && offset <= raw.length &&
    !(offset > 0 && offset < raw.length && /[\uD800-\uDBFF]/.test(raw[offset - 1]!) && /[\uDC00-\uDFFF]/.test(raw[offset]!));
}

export function selectTagWeight(raw: string, start: number, end: number): TagWeightTarget {
  if (!validOffset(raw, start) || !validOffset(raw, end) || start >= end || !raw.slice(start, end).trim()) {
    throw new Error('重みを調整するタグ全体を選択してください');
  }
  const selection = raw.slice(start, end);
  start += selection.length - selection.trimStart().length;
  end -= selection.length - selection.trimEnd().length;
  const before = raw.slice(0, start); const after = raw.slice(end);
  if ((before.trim() && !before.trimEnd().endsWith(',')) || (after.trim() && !after.trimStart().startsWith(','))) {
    throw new Error('タグ全体を選択してください。既存の数値重みは「1.2::tag::」全体を選択します');
  }
  // Validation only. Plain, independent numeric-weight items elsewhere are safe;
  // nesting, macros, mixing, escapes and multiline contexts remain untouched.
  if (SPECIAL.test(before.replace(CONTEXT_WEIGHTS, '')) || SPECIAL.test(after.replace(CONTEXT_WEIGHTS, ''))) {
    throw new Error('複雑構文を含む欄は重みを調整できません。対象タグを独立した部品に分けてください');
  }
  const selected = raw.slice(start, end);
  const weighted = WEIGHTED_TAG.exec(selected);
  const text = weighted ? weighted[2]! : selected;
  if (!text.trim() || text.includes(',') || SPECIAL.test(text)) {
    throw new Error('単純なタグ1つ、または「1.2::tag::」全体を選択してください');
  }
  const weight = weighted ? Number(weighted[1]) : 1;
  if (!Number.isFinite(weight) || weight < MIN_TAG_WEIGHT || weight > MAX_TAG_WEIGHT) {
    throw new Error('スライダーで編集できる重みは0〜2です。この値は本文で編集してください');
  }
  return { source: raw, start, end, text, weight };
}

export function previewTagWeight(target: TagWeightTarget, weight: number): string {
  if (!Number.isFinite(weight) || weight < MIN_TAG_WEIGHT || weight > MAX_TAG_WEIGHT) throw new Error('重みは0〜2で指定してください');
  // Preserve spelling/precision and whitespace exactly when no change was made.
  if (weight === target.weight) return target.source;
  const number = Number(weight.toFixed(2));
  if (Math.abs(number - weight) > 1e-10) throw new Error('重みの数値は小数第2位までで指定してください');
  const replacement = number === 1 ? target.text : `${number}::${target.text}::`;
  const next = target.source.slice(0, target.start) + replacement + target.source.slice(target.end);
  if (next.length > MAX_RAW_LENGTH) throw new Error('重みを追加すると原文の上限（100万文字）を超えます');
  return next;
}

export function applyTagWeight(current: string, target: TagWeightTarget, weight: number): string {
  if (current !== target.source) throw new Error('原文が変わりました。対象タグを選び直してください');
  return previewTagWeight(target, weight);
}
