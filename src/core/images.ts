import type { ImageRecord, ImageReview, WorkbenchData } from './types';

// Pure helpers for the image library (issue #21): search, sort, paging, usage,
// and removing an image asset together with every reference to it.

export type ImageSort = 'newest' | 'oldest' | 'name' | 'size';
export const IMAGE_SORTS: Record<ImageSort, string> = { newest: '新しい順', oldest: '古い順', name: '名前順', size: '大きい順' };

/** Where an image is used: A/B comparison slots and Experiment Lab conditions. */
export function imageUsage(data: WorkbenchData): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  const add = (id: string | null, label: string) => { if (!id) return; const list = usage.get(id) ?? []; if (!list.includes(label)) list.push(label); usage.set(id, list); };
  for (const experiment of data.experiments) { add(experiment.variantA.imageId, `${experiment.name} A`); add(experiment.variantB.imageId, `${experiment.name} B`); }
  for (const experiment of data.lab?.experiments ?? []) for (const condition of experiment.conditions) add(condition.imageId, `Lab: ${experiment.definition.name}`);
  return usage;
}

const fold = (value: string) => value.normalize('NFKC').toLowerCase();

export const IMAGE_REVIEWS: Record<ImageReview, string> = { adopted: '採用', pending: '保留', rejected: '不採用' };
export type ReviewFilter = 'all' | 'none' | ImageReview;
export interface ImageFilter { review?: ReviewFilter; tag?: string }

/** Every user tag on images, sorted, for the tag filter. */
export function imageTags(images: readonly ImageRecord[]): string[] { return [...new Set(images.flatMap(image => image.tags ?? []))].sort((a, b) => a.localeCompare(b, 'ja')); }

/** Parses a comma / 、 separated tag list: trimmed, de-duplicated, at most `max` tags of 50 characters. */
export function parseImageTags(input: string, max = 20): string[] {
  const tags = [...new Set(input.split(/[,、\n]/).map(tag => tag.trim()).filter(Boolean))];
  if (tags.some(tag => tag.length > 50)) throw new Error('タグは50文字以内にしてください');
  if (tags.length > max) throw new Error(`タグは${max}個までです`);
  return tags;
}

/** Sets review / tags / note of one image; empty values remove the optional fields. */
export function updateImageInfo(data: WorkbenchData, imageId: string, change: { review?: ImageReview | null; tags?: string[]; note?: string }): WorkbenchData {
  return { ...data, images: data.images.map(image => {
    if (image.id !== imageId) return image;
    const { review: _review, tags: _tags, note: _note, ...rest } = image;
    const review = change.review === undefined ? image.review : change.review ?? undefined;
    const tags = change.tags === undefined ? image.tags : change.tags;
    const note = change.note === undefined ? image.note : change.note;
    return { ...rest, ...(review ? { review } : {}), ...(tags?.length ? { tags } : {}), ...(note ? { note } : {}) };
  }) };
}

/** Case/width-insensitive search over the file name, SHA-256 prefix, prompt notes and where the image is used. */
export function searchImages(images: readonly ImageRecord[], query: string, usage: ReadonlyMap<string, readonly string[]> = new Map(), sort: ImageSort = 'newest', filter: ImageFilter = {}): ImageRecord[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const review = filter.review ?? 'all';
  const matches = images.filter(image => {
    if (review !== 'all' && (review === 'none' ? !!image.review : image.review !== review)) return false;
    if (filter.tag && !(image.tags ?? []).includes(filter.tag)) return false;
    if (!terms.length) return true;
    const text = fold([image.name, image.metadata.positive ?? '', image.metadata.negative ?? '', image.note ?? '', ...(image.tags ?? []), ...(usage.get(image.id) ?? [])].join('\n'));
    return terms.every(term => text.includes(term) || (/^[0-9a-f]{4,64}$/.test(term) && image.hash.startsWith(term)));
  });
  const order = images.map(image => image.id);
  const position = new Map(order.map((id, index) => [id, index]));
  const byTime = (a: ImageRecord, b: ImageRecord) => a.createdAt.localeCompare(b.createdAt) || position.get(a.id)! - position.get(b.id)!;
  switch (sort) {
    case 'newest': return matches.sort((a, b) => byTime(b, a));
    case 'oldest': return matches.sort(byTime);
    case 'name': return matches.sort((a, b) => a.name.localeCompare(b.name, 'ja') || byTime(a, b));
    case 'size': return matches.sort((a, b) => b.byteLength - a.byteLength || byTime(a, b));
  }
}

export function pageOf<T>(items: readonly T[], page: number, size: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { items: items.slice(current * size, (current + 1) * size), page: current, pages };
}

/** Removes the image record and clears every comparison slot / Lab condition that pointed to it. Binaries stay (Undo). */
export function removeImage(data: WorkbenchData, imageId: string): WorkbenchData {
  return {
    ...data,
    images: data.images.filter(item => item.id !== imageId),
    experiments: data.experiments.map(item => item.variantA.imageId !== imageId && item.variantB.imageId !== imageId ? item : {
      ...item,
      variantA: item.variantA.imageId === imageId ? { ...item.variantA, imageId: null } : item.variantA,
      variantB: item.variantB.imageId === imageId ? { ...item.variantB, imageId: null } : item.variantB,
    }),
    ...(data.lab ? { lab: { ...data.lab, experiments: data.lab.experiments.map(experiment => experiment.conditions.some(condition => condition.imageId === imageId) ? { ...experiment, conditions: experiment.conditions.map(condition => condition.imageId === imageId ? { ...condition, imageId: null, status: 'pending' as const } : condition) } : experiment) } } : {}),
  };
}

/** Accessible label of one image: its name, plus a hash prefix when another image has the same name. */
export function imageLabel(image: ImageRecord, images: readonly ImageRecord[]): string {
  return images.some(other => other.id !== image.id && other.name === image.name) ? `${image.name}（${image.hash.slice(0, 8)}）` : image.name;
}
