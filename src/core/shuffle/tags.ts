import type { CharacterCategory, CharacterDefinition, ShuffleCategory, ShuffleLibrary } from './types';

const COMPLEX = /[{}[\]|]|::|!macro:|^@/i;

/**
 * Read-only, conservative tag extraction used ONLY for conflict warnings and
 * category locks. Segments containing NovelAI syntax (emphasis, weights,
 * randomizer, macros) are ignored instead of being parsed. The result is never
 * used to rewrite or delete user text.
 */
export function simpleTags(text: string): string[] {
  const tags: string[] = [];
  for (const segment of text.split(/[,\n]/)) {
    const tag = segment.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!tag || COMPLEX.test(tag)) continue;
    tags.push(tag);
  }
  return tags;
}

/** Simple tags each category can emit, collected from single-category sources. */
export function categoryVocabulary(library: Pick<ShuffleLibrary, 'templates' | 'pools' | 'cameraPresets'>): Map<ShuffleCategory, Set<string>> {
  const vocabulary = new Map<ShuffleCategory, Set<string>>();
  const add = (category: ShuffleCategory, prompt: string) => {
    let set = vocabulary.get(category);
    if (!set) { set = new Set(); vocabulary.set(category, set); }
    for (const tag of simpleTags(prompt)) set.add(tag);
  };
  for (const pool of library.pools) for (const option of pool.options) add(pool.category, option.prompt);
  for (const preset of library.cameraPresets) for (const part of preset.parts) add(part.category, part.prompt);
  for (const template of library.templates) for (const role of template.roles) if (role.categories.length === 1) add(role.categories[0]!, role.prompt);
  return vocabulary;
}

/** Categories the shuffle must not touch for this character. */
export function lockedCategories(character: CharacterDefinition, vocabulary: Map<ShuffleCategory, Set<string>>): Set<CharacterCategory> {
  const locked = new Set<CharacterCategory>();
  const lockedTags = character.lockedTags.map(tag => tag.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean);
  for (const category of ['action', 'pose', 'expression', 'gaze'] as const) {
    if (!character.allowedCategories.includes(category)) locked.add(category);
    const words = vocabulary.get(category);
    if (words && lockedTags.some(tag => words.has(tag))) locked.add(category);
  }
  return locked;
}

/**
 * True when text contains a single `|` outside a `||...||` randomizer section, or an
 * unbalanced randomizer. Such text cannot be embedded in the pipe multi-character syntax.
 */
export function hasLonePipe(text: string): boolean {
  let inRandomizer = false;
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '|') continue;
    if (text[index + 1] === '|') { inRandomizer = !inRandomizer; index++; continue; }
    if (!inRandomizer) return true;
  }
  return inRandomizer;
}
