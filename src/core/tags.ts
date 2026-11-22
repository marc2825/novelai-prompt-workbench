import type { LibraryEntry, TagDictionaryEntry } from './types';

/*
 * Local tag dictionary, completion and spelling-variant (表記ゆれ) review.
 *
 * Pure functions only. Normalized forms are used for matching and never written
 * back: completion returns one range replacement that the UI applies only when the
 * user explicitly accepts a suggestion, and the review only reports candidates.
 * No external tag data is bundled; suggestions come from the user's dictionary
 * and from tags that already appear in the user's own library entries.
 */

export const TAG_DICTIONARY_SCHEMA_VERSION = 1;
export const TAG_LIMITS = {
  entries: 10_000,
  aliasesPerEntry: 20,
  totalAliases: 50_000,
  tag: 200,
  note: 1_000,
  /** Library tokens longer than this are free text, not tags. */
  libraryToken: 100,
  suggestions: 8,
  /** Index keys inspected per ranking tier: bounds the work per keystroke. */
  scan: 1_000,
} as const;

/** Word-start keys per tag ("long hair" is also found by "hair"). */
const MAX_WORD_KEYS = 4;
/** A completion segment longer than this is free text; do not scan further. */
const MAX_SEGMENT = 256;

function fold(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
}

/**
 * Matching form for 表記ゆれ: full-width → half-width (NFKC), case-fold,
 * `_` ↔ space, collapsed and trimmed whitespace. Never shown or saved.
 */
export function normalizeTag(text: string): string {
  return fold(text).trim();
}

const TAG_FORBIDDEN = /[,{}[\]|\\\u0000-\u001f\u007f]/;

/** Why `text` cannot be a dictionary tag or alias (null when it can). */
export function tagTextIssue(text: string): string | null {
  if (!text.trim()) return '空のタグは登録できません';
  if (text !== text.trim()) return '前後に空白のない表記が必要です';
  if (text.length > TAG_LIMITS.tag) return `タグ・別名は${TAG_LIMITS.tag}文字までです`;
  if (TAG_FORBIDDEN.test(text) || text.includes('::')) return 'カンマ・改行・{ } [ ] | \\ と「::」は含められません（重みや括弧は入力欄で付けます）';
  if (!normalizeTag(text)) return '照合用の表記が空になります';
  return null;
}

// ---------------------------------------------------------------------------
// Completion position

export interface CompletionToken {
  /** UTF-16 range of the partial tag before the caret (end = caret). */
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

const BOUNDARY = /[,\n\r|]/;
// Leading syntax that stays outside the replaced range: spaces, braces/brackets, a numeric weight.
const OPENERS = /^[\s{[]*(?:-?\d+(?:\.\d+)?::)?[\s{[]*/;
// What may follow the caret inside the segment: only closers of the same tag.
const CLOSERS = /^[\s}\]]*(?:::)?[\s}\]]*$/;
const QUERY_FORBIDDEN = /[{}[\]|!\\\u0000-\u001f\u007f]/;

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

function insideRandomizer(text: string, caret: number): boolean {
  let count = 0;
  for (let index = text.indexOf('||'); index !== -1 && index + 2 <= caret; index = text.indexOf('||', index + 2)) count++;
  return count % 2 === 1;
}

/**
 * The partial tag that ends at `caret`, or null when the caret is not in a plain
 * tag position. Conservative: no completion inside `||randomizer||`, macros (`!`),
 * escapes, after a closing `}`/`]`/`::`, in the middle of a word, or across
 * mixed syntax. The weight/brace prefix (`1.2::`, `{{`, `[`) and the closers after
 * the caret are outside the range, so accepting keeps them unchanged.
 */
export function completionTokenAt(text: string, caret: number): CompletionToken | null {
  if (!Number.isInteger(caret) || caret <= 0 || caret > text.length) return null;
  if (caret < text.length && isHigh(text.charCodeAt(caret - 1)) && isLow(text.charCodeAt(caret))) return null;
  let start = caret;
  while (start > 0 && !BOUNDARY.test(text[start - 1]!)) {
    if (caret - start >= MAX_SEGMENT) return null;
    start--;
  }
  let end = caret;
  while (end < text.length && !BOUNDARY.test(text[end]!)) {
    if (end - caret >= MAX_SEGMENT) return null;
    end++;
  }
  if (!CLOSERS.test(text.slice(caret, end))) return null;
  const before = text.slice(start, caret);
  const query = before.slice(OPENERS.exec(before)![0].length);
  if (!query.trim() || query.length > TAG_LIMITS.tag || QUERY_FORBIDDEN.test(query) || query.includes('::')) return null;
  if (insideRandomizer(text, caret)) return null;
  return { start: caret - query.length, end: caret, query };
}

/** Replaces only the token's range with `tag`; everything else is copied unchanged. */
export function applyCompletion(text: string, token: CompletionToken, tag: string): { text: string; caret: number } {
  if (text.slice(token.start, token.end) !== token.query) throw new Error('入力欄が変わりました。もう一度入力してください');
  return { text: text.slice(0, token.start) + tag + text.slice(token.end), caret: token.start + tag.length };
}

// ---------------------------------------------------------------------------
// Tags that appear in library entries

const TOKEN_OPEN = /^[\s{[]*(?:-?\d+(?:\.\d+)?::)?[\s{[]*/;
const TOKEN_CLOSE = /[\s}\]]*(?:::)?[\s}\]]*$/;
const TOKEN_FORBIDDEN = /[{}[\]|!\\\u0000-\u001f\u007f]/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;

/**
 * Plain tags in a raw prompt, for matching only: comma/newline separated items with
 * weight and brace wrappers removed. Items with other syntax (randomizers, pipes,
 * macros, escapes, nested weights) and long free text are skipped, never guessed.
 */
export function extractPromptTags(raw: string): string[] {
  const result: string[] = [];
  let randomizer = false;
  for (const part of raw.split(/[,\n\r]/)) {
    const pipes = part.split('||').length - 1;
    const skip = randomizer || part.includes('|');
    if (pipes % 2 === 1) randomizer = !randomizer;
    if (skip) continue;
    const trimmed = part.trim();
    if (!trimmed || trimmed.length > TAG_LIMITS.libraryToken + 50) continue;
    const token = trimmed.replace(TOKEN_OPEN, '').replace(TOKEN_CLOSE, '');
    if (!token || token.length > TAG_LIMITS.libraryToken || TOKEN_FORBIDDEN.test(token) || token.includes('::') || NUMBER.test(token)) continue;
    if (normalizeTag(token)) result.push(token);
  }
  return result;
}

export interface LibraryTag {
  /** The most frequent spelling (ties: code-unit order). */
  readonly tag: string;
  readonly key: string;
  readonly count: number;
  readonly spellings: readonly { readonly text: string; readonly count: number }[];
}

/** Library tags grouped by normalized form, sorted by key. */
export function collectLibraryTags(entries: readonly Pick<LibraryEntry, 'raw'>[]): LibraryTag[] {
  const groups = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    for (const token of extractPromptTags(entry.raw)) {
      const key = normalizeTag(token);
      let spellings = groups.get(key);
      if (!spellings) groups.set(key, spellings = new Map());
      spellings.set(token, (spellings.get(token) ?? 0) + 1);
    }
  }
  const result: LibraryTag[] = [];
  for (const [key, spellings] of groups) {
    const list = [...spellings].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count || compareText(a.text, b.text));
    result.push({ tag: list[0]!.text, key, count: list.reduce((sum, item) => sum + item.count, 0), spellings: list });
  }
  return result.sort((a, b) => compareText(a.key, b.key));
}

// ---------------------------------------------------------------------------
// Suggestion index

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

interface Candidate { readonly tag: string; readonly source: 'dictionary' | 'library'; readonly note: string; readonly count: number }
interface IndexKey { readonly key: string; readonly candidate: number; readonly alias: string | null }

export interface TagIndex {
  readonly candidates: readonly Candidate[];
  /** Sorted keys per tier: dictionary prefix, dictionary word, library prefix, library word. */
  readonly tiers: readonly (readonly IndexKey[])[];
}

export interface TagSuggestion {
  /** Text inserted on accept. */
  readonly tag: string;
  readonly source: 'dictionary' | 'library';
  /** The alias the query matched (dictionary only). */
  readonly alias?: string;
  readonly note?: string;
  /** Occurrences in the library (library only). */
  readonly count?: number;
}

const compareKeys = (a: IndexKey, b: IndexKey) => compareText(a.key, b.key) || a.candidate - b.candidate;

/**
 * Builds a sorted index once (when the dictionary or library changes) so each
 * keystroke is a binary search plus a bounded scan. Library tags whose normalized
 * form is a dictionary tag or alias are left out: the dictionary takes precedence.
 */
export function buildTagIndex(dictionary: readonly TagDictionaryEntry[], library: readonly LibraryTag[]): TagIndex {
  const candidates: Candidate[] = [];
  const tiers: IndexKey[][] = [[], [], [], []];
  const reserved = new Set<string>();
  const add = (candidate: number, key: string, alias: string | null, full: IndexKey[], words: IndexKey[]) => {
    if (!key) return;
    full.push({ key, candidate, alias });
    let count = 0;
    for (let index = key.indexOf(' '); index !== -1 && count < MAX_WORD_KEYS; index = key.indexOf(' ', index + 1), count++) {
      if (index + 1 < key.length) words.push({ key: key.slice(index + 1), candidate, alias });
    }
  };
  for (const entry of dictionary) {
    const candidate = candidates.push({ tag: entry.tag, source: 'dictionary', note: entry.note, count: 0 }) - 1;
    const key = normalizeTag(entry.tag);
    reserved.add(key);
    add(candidate, key, null, tiers[0]!, tiers[1]!);
    for (const alias of entry.aliases) {
      const aliasKey = normalizeTag(alias);
      reserved.add(aliasKey);
      add(candidate, aliasKey, alias, tiers[0]!, tiers[1]!);
    }
  }
  for (const tag of library) {
    if (reserved.has(tag.key)) continue;
    const candidate = candidates.push({ tag: tag.tag, source: 'library', note: '', count: tag.count }) - 1;
    add(candidate, tag.key, null, tiers[2]!, tiers[3]!);
  }
  for (const tier of tiers) tier.sort(compareKeys);
  return { candidates, tiers };
}

function lowerBound(keys: readonly IndexKey[], query: string): number {
  let low = 0; let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle]!.key < query) low = middle + 1; else high = middle;
  }
  return low;
}

/**
 * Up to `limit` suggestions for a partial tag. Ranking: dictionary (tag/alias
 * prefix, then word start) before library (prefix, then word start); within a tier
 * an exact match first, library tags by frequency, the dictionary tag before an
 * alias, then shorter keys. A suggestion identical to the typed text is omitted.
 */
export function suggestTags(index: TagIndex, query: string, limit: number = TAG_LIMITS.suggestions): TagSuggestion[] {
  const normalized = fold(query).trimStart();
  if (!normalized.trim() || limit <= 0) return [];
  const typed = query.trimEnd();
  const results: TagSuggestion[] = [];
  const seen = new Set<number>();
  for (const [tierIndex, tier] of index.tiers.entries()) {
    const matches: IndexKey[] = [];
    for (let at = lowerBound(tier, normalized); at < tier.length && matches.length < TAG_LIMITS.scan && tier[at]!.key.startsWith(normalized); at++) matches.push(tier[at]!);
    const library = tierIndex >= 2;
    matches.sort((a, b) => Number(b.key === normalized) - Number(a.key === normalized)
      || (library ? index.candidates[b.candidate]!.count - index.candidates[a.candidate]!.count : 0)
      || Number(a.alias !== null) - Number(b.alias !== null)
      || a.key.length - b.key.length || compareKeys(a, b));
    for (const match of matches) {
      if (seen.has(match.candidate)) continue;
      seen.add(match.candidate);
      const candidate = index.candidates[match.candidate]!;
      if (candidate.tag === typed) continue;
      results.push({
        tag: candidate.tag, source: candidate.source,
        ...(match.alias !== null ? { alias: match.alias } : {}),
        ...(candidate.note ? { note: candidate.note } : {}),
        ...(library ? { count: candidate.count } : {}),
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 表記ゆれ・重複 review (read-only)

export interface TagVariant {
  readonly key: string;
  /** Spellings found in the library, most frequent first. */
  readonly spellings: readonly { readonly text: string; readonly count: number; readonly entryIds: readonly string[] }[];
  /** Dictionary tags this form belongs to (as the tag itself or as an alias). */
  readonly preferred: readonly string[];
}
export interface DuplicateTag { readonly entryId: string; readonly tag: string; readonly count: number }
export interface TagReview { readonly variants: readonly TagVariant[]; readonly duplicates: readonly DuplicateTag[]; readonly truncated: boolean }

/**
 * Candidates for the user to review; nothing is rewritten. A variant is a
 * normalized form spelled more than one way in the library, spelled differently
 * from its dictionary tag, or written as a dictionary alias. A duplicate is the
 * same normalized tag more than once inside one library entry.
 */
export function reviewLibraryTags(entries: readonly Pick<LibraryEntry, 'id' | 'raw'>[], dictionary: readonly TagDictionaryEntry[], limit = 200): TagReview {
  const forms = new Map<string, Map<string, { count: number; entryIds: string[] }>>();
  const duplicates: DuplicateTag[] = [];
  for (const entry of entries) {
    const local = new Map<string, { tag: string; count: number }>();
    for (const token of extractPromptTags(entry.raw)) {
      const key = normalizeTag(token);
      const seen = local.get(key);
      if (seen) seen.count++; else local.set(key, { tag: token, count: 1 });
      let spellings = forms.get(key);
      if (!spellings) forms.set(key, spellings = new Map());
      const spelling = spellings.get(token);
      if (!spelling) spellings.set(token, { count: 1, entryIds: [entry.id] });
      else { spelling.count++; if (spelling.entryIds[spelling.entryIds.length - 1] !== entry.id) spelling.entryIds.push(entry.id); }
    }
    for (const { tag, count } of local.values()) if (count > 1) duplicates.push({ entryId: entry.id, tag, count });
  }
  const tagByKey = new Map<string, string>();
  const aliasOwners = new Map<string, string[]>();
  for (const entry of dictionary) {
    tagByKey.set(normalizeTag(entry.tag), entry.tag);
    for (const alias of entry.aliases) {
      const key = normalizeTag(alias);
      const owners = aliasOwners.get(key);
      if (owners) owners.push(entry.tag); else aliasOwners.set(key, [entry.tag]);
    }
  }
  const variants: TagVariant[] = [];
  for (const [key, spellings] of forms) {
    const canonical = tagByKey.get(key);
    const preferred = canonical !== undefined ? [canonical] : aliasOwners.get(key) ?? [];
    const list = [...spellings].map(([text, value]) => ({ text, count: value.count, entryIds: value.entryIds }))
      .sort((a, b) => b.count - a.count || compareText(a.text, b.text));
    if (list.length > 1 || (preferred.length > 0 && list.some(item => !preferred.includes(item.text)))) variants.push({ key, spellings: list, preferred });
  }
  const total = (variant: TagVariant) => variant.spellings.reduce((sum, item) => sum + item.count, 0);
  variants.sort((a, b) => total(b) - total(a) || compareText(a.key, b.key));
  return { variants: variants.slice(0, limit), duplicates: duplicates.slice(0, limit), truncated: variants.length > limit || duplicates.length > limit };
}
