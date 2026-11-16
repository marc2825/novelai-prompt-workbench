import { appendFragment } from '../compose';
import type { Axis } from './types';
interface Item { start: number; end: number; raw: string; tag: string }
/** Token spans only: unchanged regions are always copied from the original string. */
export function promptItems(raw: string): Item[] {
  if (/[|!\\]/.test(raw)) throw new Error('Tag edits cannot interpret mixing, randomizers, macros or escapes; use Prompt Variant');
  const items: Item[] = []; const stack: string[] = []; let numeric = false; let start = 0;
  const add = (end: number) => {
    const piece = raw.slice(start, end); const text = piece.trim(); let tag = text;
    for (let depth = 0; depth < 32; depth++) {
      const number = /^[-+]?\d+(?:\.\d+)?::([^:]*)::$/.exec(tag);
      if (number) { tag = number[1]!.trim(); continue; }
      if ((tag.startsWith('{') && tag.endsWith('}')) || (tag.startsWith('[') && tag.endsWith(']'))) { tag = tag.slice(1, -1).trim(); continue; }
      break;
    }
    if (text) items.push({ start: start + piece.length - piece.trimStart().length, end: end - (piece.length - piece.trimEnd().length), raw: text, tag });
  };
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (raw.slice(i, i + 2) === '::') {
      // Only balanced numeric regions are supported; :: that resets brackets is ambiguous.
      if (stack.length) throw new Error('Unbalanced/reset emphasis is not editable; use Prompt Variant');
      if (!numeric && !/[-+]?\d+(?:\.\d+)?$/.test(raw.slice(start, i))) throw new Error('Unmatched numeric emphasis');
      numeric = !numeric; i++; continue;
    }
    if (c === '{' || c === '[') { if (stack.length >= 32) throw new Error('Prompt nesting limit'); stack.push(c); }
    else if (c === '}' || c === ']') { if (stack.pop() !== (c === '}' ? '{' : '[')) throw new Error('Unbalanced prompt brackets'); }
    else if (c === ',' && !stack.length && !numeric) { add(i); start = i + 1; }
  }
  if (stack.length || numeric) throw new Error('Unclosed prompt emphasis');
  add(raw.length); return items;
}
export function transformPrompt(raw: string, axis: Axis, value: string): string {
  if (axis.kind === 'prompt' || axis.kind === 'uc') return value;
  if (axis.kind === 'group') return appendFragment(raw, value);
  if (axis.kind === 'searchReplace') {
    if (!axis.target || /[:{}\[\]|!\\]/.test(axis.target)) throw new Error('S/R search must be literal text, without syntax delimiters');
    const starts: number[] = []; let at = raw.indexOf(axis.target);
    while (at >= 0) { starts.push(at); at = raw.indexOf(axis.target, at + axis.target.length); }
    if (!starts.length) throw new Error('S/R target not found');
    let result = raw;
    const selected = axis.occurrence === 0 ? starts : [starts[axis.occurrence - 1]];
    if (selected.some(v => v === undefined)) throw new Error('Occurrence not found');
    for (const start of selected.reverse() as number[]) result = result.slice(0, start) + value + result.slice(start + axis.target.length);
    promptItems(result); return result;
  }
  if (!axis.target.trim() || /[,{}\[\]:|!\\\r\n]/.test(axis.target)) throw new Error('Target must be one plain tag');
  const items = promptItems(raw); const matches = items.filter(item => item.tag === axis.target);
  if (items.some(item => item.tag.includes(axis.target) && item.tag !== axis.target && /[,{}\[\]:]/.test(item.tag))) throw new Error('Target inside a nested group is ambiguous; use a complete Prompt Variant');
  if (axis.occurrence < 1) throw new Error('Choose an explicit tag occurrence (1-based)');
  const item = matches[axis.occurrence - 1];
  if (matches.length && !item) throw new Error('Occurrence not found');
  const remove = () => {
    if (!item) return raw;
    const index = items.indexOf(item); const next = items[index + 1]; const prev = items[index - 1];
    if (next) return raw.slice(0, item.start) + raw.slice(next.start);
    if (prev) return raw.slice(0, prev.end) + raw.slice(item.end);
    return raw.slice(0, item.start) + raw.slice(item.end);
  };
  let replacement = value;
  if (axis.kind === 'weight') {
    const n = Number(value); if (!Number.isFinite(n) || n < -10 || n > 10) throw new Error('Lab weight range: -10 to 10');
    replacement = `${n}::${axis.target}::`;
  } else if (axis.kind === 'onOff') {
    if (!['On', 'Off'].includes(value)) throw new Error('On/Off values must be On or Off');
    return value === 'Off' ? remove() : item ? raw : appendFragment(raw, axis.target);
  } else if (axis.kind === 'position') {
    if (!['first', 'last'].includes(value) || !item) throw new Error('Position requires an existing tag and first/last');
    return value === 'first' ? appendFragment(item.raw, remove()) : appendFragment(remove(), item.raw);
  }
  if (item) return raw.slice(0, item.start) + replacement + raw.slice(item.end);
  return appendFragment(raw, replacement);
}
