import type { Category, LibraryEntry } from './types';

export interface SearchOptions { query: string; categoryId?: string; tag?: string; sort?: 'title' | 'updatedAt' }

export function searchLibrary(entries: LibraryEntry[], categories: Category[], options: SearchOptions): LibraryEntry[] {
  const query = options.query.trim().toLocaleLowerCase();
  const categoryNames = new Map(categories.map(category => [category.id, category.name]));
  return entries.filter(entry => {
    if (options.categoryId && entry.categoryId !== options.categoryId) return false;
    if (options.tag && !entry.tags.includes(options.tag)) return false;
    return !query || [entry.title, entry.raw, entry.description, ...entry.tags, categoryNames.get(entry.categoryId ?? '') ?? '']
      .some(value => value.toLocaleLowerCase().includes(query));
  }).sort((a, b) => options.sort === 'updatedAt' ? b.updatedAt.localeCompare(a.updatedAt) : a.title.localeCompare(b.title, 'ja'));
}
