import { describe, expect, it } from 'vitest';
import { createExperiment, unknownSettings } from '../../src/core/experiments';
import { imageLabel, imageUsage, pageOf, removeImage, searchImages } from '../../src/core/images';
import type { ImageRecord, WorkbenchData } from '../../src/core/types';
import { validateData } from '../../src/data/validation';
import { fixture, timestamp } from './helpers';

const id = (n: number) => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`;
const image = (n: number, extra: Partial<ImageRecord> = {}): ImageRecord => ({ id: id(n), hash: `${n.toString(16).padStart(8, '0')}${'a'.repeat(56)}`, mime: 'image/png', name: `image-${n}.png`, width: 2, height: 2, byteLength: 100 + n, thumbnailBytes: 10, createdAt: `2026-11-${String(1 + (n % 28)).padStart(2, '0')}T00:00:00.000Z`, metadata: { positive: null, negative: null, settings: unknownSettings(), texts: {}, warnings: [] }, ...extra });

describe('image library (issue #21)', () => {
  const many = Array.from({ length: 130 }, (_, index) => image(index + 1));
  it('pages through every image, including the last ones beyond the old 50-item cut-off', () => {
    const sorted = searchImages(many, '', new Map(), 'oldest');
    expect(sorted).toHaveLength(130);
    const last = pageOf(sorted, 99, 24);
    expect(last.pages).toBe(6); expect(last.page).toBe(5); expect(last.items).toHaveLength(130 - 5 * 24);
    expect(pageOf([], 3, 24)).toEqual({ items: [], page: 0, pages: 1 });
  });
  it('searches by name (width/case-insensitive), hash prefix, prompt notes and usage', () => {
    const items = [...many, image(200, { name: 'ＦＩＮＡＬ_ポーズ.png', metadata: { positive: 'blue eyes, smile', negative: null, settings: unknownSettings(), texts: {}, warnings: [] } })];
    expect(searchImages(items, 'final').map(item => item.id)).toEqual([id(200)]);
    expect(searchImages(items, 'BLUE smile').map(item => item.id)).toEqual([id(200)]);
    expect(searchImages(items, (130).toString(16).padStart(8, '0')).map(item => item.id)).toEqual([id(130)]);
    expect(searchImages(items, '比較 A', new Map([[id(7), ['比較 A']]])).map(item => item.id)).toEqual([id(7)]);
    expect(searchImages(items, 'image-130.png')).toHaveLength(1);
    expect(searchImages(items, 'nothing-matches')).toEqual([]);
  });
  it('sorts deterministically by time, name and size', () => {
    const items = [image(1, { name: 'b.png', createdAt: '2026-11-02T00:00:00.000Z', byteLength: 5 }), image(2, { name: 'a.png', createdAt: '2026-11-03T00:00:00.000Z', byteLength: 9 }), image(3, { name: 'c.png', createdAt: '2026-11-02T00:00:00.000Z', byteLength: 7 })];
    expect(searchImages(items, '', new Map(), 'newest').map(item => item.name)).toEqual(['a.png', 'c.png', 'b.png']);
    expect(searchImages(items, '', new Map(), 'oldest').map(item => item.name)).toEqual(['b.png', 'c.png', 'a.png']);
    expect(searchImages(items, '', new Map(), 'name').map(item => item.name)).toEqual(['a.png', 'b.png', 'c.png']);
    expect(searchImages(items, '', new Map(), 'size').map(item => item.name)).toEqual(['a.png', 'c.png', 'b.png']);
  });
  it('removes an image with every comparison reference and keeps the data valid; labels are unique', () => {
    const data: WorkbenchData = fixture();
    const experiment = createExperiment(id(900), id(901), id(902), '比較', data.workspaces[0]!, null, timestamp);
    const withImages = validateData({ ...data, images: [image(1), image(2, { name: 'image-1.png' })], experiments: [{ ...experiment, variantA: { ...experiment.variantA, imageId: id(1) }, variantB: { ...experiment.variantB, imageId: id(2) } }] });
    expect(imageUsage(withImages).get(id(1))).toEqual(['比較 A']);
    const removed = validateData(removeImage(withImages, id(1)));
    expect(removed.images.map(item => item.id)).toEqual([id(2)]);
    expect(removed.experiments[0]!.variantA.imageId).toBeNull();
    expect(removed.experiments[0]!.variantB.imageId).toBe(id(2));
    expect(imageLabel(withImages.images[0]!, withImages.images)).not.toBe(imageLabel(withImages.images[1]!, withImages.images));
    expect(imageLabel(removed.images[0]!, removed.images)).toBe('image-1.png');
  });
});
