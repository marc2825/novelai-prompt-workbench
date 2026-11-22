// Tag-level difference between two prompts (issue #30), for display only: the
// prompts themselves are never rewritten. A prompt is split at top-level commas;
// weight wrappers are recognised only in their plain forms (`1.2::tag::`,
// `{tag}`, `[tag]`). Anything that cannot be read safely — unbalanced brackets,
// `||randomizer||` macros, a weight block that is not closed — makes the result
// `null`, and callers fall back to the raw character difference.

export interface PromptTag { raw: string; core: string; weight: string }
export interface TagDiff {
  added: PromptTag[];
  removed: PromptTag[];
  /** Same tag (core text) with a different weight wrapper. */
  reweighted: { core: string; before: string; after: string }[];
  /** Tags present in both whose relative order changed. */
  moved: string[];
  unchanged: number;
}

const WEIGHT = /^(-?\d+(?:\.\d+)?)::([\s\S]*)::$/;

/** Splits at top-level commas. Returns null when the syntax is not plainly balanced. */
export function splitTags(prompt: string): PromptTag[] | null {
  if (prompt.includes('||')) return null;
  const parts: string[] = []; let depth = 0; let start = 0; let weightOpen = false;
  for (let index = 0; index < prompt.length; index++) {
    const char = prompt[index]!;
    if (char === '{' || char === '[' || char === '(') depth++;
    else if (char === '}' || char === ']' || char === ')') { depth--; if (depth < 0) return null; }
    else if (char === ':' && prompt[index + 1] === ':') {
      // `n::` opens a weight block, the next `::` closes it; commas inside belong to the block.
      if (!weightOpen && /^\s*-?\d+(?:\.\d+)?\s*$/.test(prompt.slice(start, index))) weightOpen = true;
      else if (weightOpen) weightOpen = false;
      else return null;
      index++;
    } else if (char === ',' && depth === 0 && !weightOpen) { parts.push(prompt.slice(start, index)); start = index + 1; }
  }
  if (depth !== 0 || weightOpen) return null;
  parts.push(prompt.slice(start));
  return parts.map(part => part.trim()).filter(Boolean).map(raw => {
    let core = raw; let weight = '';
    const numeric = WEIGHT.exec(core);
    if (numeric) { weight = `${numeric[1]}::`; core = numeric[2]!.trim(); }
    else {
      while (/^\{[\s\S]*\}$/.test(core) || /^\[[\s\S]*\]$/.test(core)) { weight += core[0]; core = core.slice(1, -1).trim(); }
    }
    return { raw, core, weight };
  });
}

/** Longest common subsequence of two key lists (indexes into `a`). */
function lcs(a: readonly string[], b: readonly string[]): Set<number> {
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const kept = new Set<number>(); let i = 0; let j = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { kept.add(i); i++; j++; } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++; else j++; }
  return kept;
}

const MAX_TAGS = 1000;

/** Tag-level difference, or null when either prompt cannot be split safely (use the raw text difference). */
export function diffTags(before: string, after: string): TagDiff | null {
  const a = splitTags(before); const b = splitTags(after);
  if (!a || !b || a.length > MAX_TAGS || b.length > MAX_TAGS) return null;
  // Pair identical tags first (same core and weight), then the same core with a different weight.
  const remaining = new Map<string, PromptTag[]>();
  for (const tag of b) remaining.set(tag.core, [...(remaining.get(tag.core) ?? []), tag]);
  const pairs = new Map<PromptTag, PromptTag>();
  for (const tag of a) {
    const match = remaining.get(tag.core); const same = match?.findIndex(item => item.weight === tag.weight) ?? -1;
    if (match && same >= 0) pairs.set(tag, match.splice(same, 1)[0]!);
  }
  for (const tag of a) {
    if (pairs.has(tag)) continue;
    const match = remaining.get(tag.core);
    if (match?.length) pairs.set(tag, match.shift()!);
  }
  const removed: PromptTag[] = []; const reweighted: TagDiff['reweighted'] = []; const common: { core: string; reweighted: boolean }[] = [];
  for (const tag of a) {
    const used = pairs.get(tag);
    if (!used) { removed.push(tag); continue; }
    if (used.weight !== tag.weight) reweighted.push({ core: tag.core, before: tag.raw, after: used.raw });
    common.push({ core: tag.core, reweighted: used.weight !== tag.weight });
  }
  const leftover = new Set([...remaining.values()].flat());
  const commonAfter = b.filter(tag => !leftover.has(tag)).map(tag => tag.core);
  const kept = lcs(common.map(item => item.core), commonAfter);
  return {
    added: b.filter(tag => leftover.has(tag)), removed, reweighted,
    moved: common.filter((_, index) => !kept.has(index)).map(item => item.core),
    unchanged: common.filter((item, index) => kept.has(index) && !item.reweighted).length,
  };
}
