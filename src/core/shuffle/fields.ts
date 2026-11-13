import type { Channel } from '../types';
import type { ComposedSnapshot } from './types';

/**
 * Logical NovelAI prompt fields. Base = main Prompt / Undesired Content; character
 * fields are 1-based in on-screen order. This is a pure naming scheme: whether a
 * site actually exposes a field is decided only by a verified Site Adapter.
 */
export type FieldKey = `base:${Channel}` | `character:${number}:${Channel}`;
export const MAX_CHARACTER_FIELDS = 22;
const PATTERN = /^(?:base:(positive|negative)|character:([1-9]\d?):(positive|negative))$/;

export function isFieldKey(value: unknown): value is FieldKey {
  if (typeof value !== 'string') return false;
  const match = PATTERN.exec(value);
  return !!match && (match[2] === undefined || Number(match[2]) <= MAX_CHARACTER_FIELDS);
}
export function parseFieldKey(key: FieldKey): { kind: 'base'; channel: Channel } | { kind: 'character'; index: number; channel: Channel } {
  const match = PATTERN.exec(key);
  if (!match) throw new Error('不正なフィールドです');
  return match[1] ? { kind: 'base', channel: match[1] as Channel } : { kind: 'character', index: Number(match[2]), channel: match[3] as Channel };
}
export function characterField(index: number, channel: Channel): FieldKey { return `character:${index}:${channel}`; }
export function fieldLabel(key: FieldKey): string {
  const parsed = parseFieldKey(key);
  const channel = parsed.channel === 'positive' ? 'Prompt' : 'Undesired Content';
  return parsed.kind === 'base' ? `ベース ${channel}` : `キャラクター${parsed.index} ${channel}`;
}

export interface FieldWrite { field: FieldKey; text: string }
/**
 * Fields a shuffle result may write. The base Undesired Content is never written
 * (the shuffle does not manage it); a character UC is written only when the
 * character defines one (negativePrompt !== null).
 */
export function planFieldWrites(composed: ComposedSnapshot): FieldWrite[] {
  const writes: FieldWrite[] = [{ field: 'base:positive', text: composed.base.positive }];
  composed.characters.forEach((character, index) => {
    writes.push({ field: characterField(index + 1, 'positive'), text: character.positive });
    if (character.negative !== null) writes.push({ field: characterField(index + 1, 'negative'), text: character.negative });
  });
  return writes;
}
