import { compileWorkspace } from './compose';
import { captureWorkspace, comparePreset } from './presets';
import type { Experiment, ExperimentVariant, GenerationSettings, PromptWorkspace } from './types';

export const SETTING_LABELS = { model: 'モデル', seed: 'Seed', width: '幅', height: '高さ', steps: 'Steps', sampler: 'Sampler', guidance: 'Guidance / CFG', cfgRescale: 'CFG Rescale', imageCount: '生成枚数', imageToImage: 'Image2Image条件（不使用も明記）', referenceImages: '参照画像条件（不使用も明記）' } as const;
export function unknownSettings(): GenerationSettings {
  return { model: null, seed: null, width: null, height: null, steps: null, sampler: null, guidance: null, cfgRescale: null, imageCount: null, imageToImage: null, referenceImages: null, extra: {}, extrasConfirmed: false, evidence: 'unknown' };
}
export function captureVariant(id: string, label: 'A' | 'B', workspace: PromptWorkspace, presetId: string | null): ExperimentVariant {
  const snapshot = captureWorkspace(workspace);
  const { positive, negative } = compileWorkspace(snapshot);
  return { id, label, presetId, workspaceSnapshot: snapshot, compiled: { positive, negative }, settings: unknownSettings(), imageId: null };
}
export function createExperiment(id: string, aId: string, bId: string, name: string, workspace: PromptWorkspace, presetId: string | null, now: string): Experiment {
  return { id, name, variantA: captureVariant(aId, 'A', workspace, presetId), variantB: captureVariant(bId, 'B', workspace, presetId), createdAt: now, updatedAt: now };
}
export function duplicateExperiment(source: Experiment, id: string, aId: string, bId: string, now: string): Experiment {
  return { ...structuredClone(source), id, name: `${source.name.slice(0, 190)} のコピー`, variantA: { ...structuredClone(source.variantA), id: aId }, variantB: { ...structuredClone(source.variantB), id: bId }, createdAt: now, updatedAt: now };
}
export function compareSettings(a: GenerationSettings, b: GenerationSettings) {
  const rows: { label: string; a: string | number | boolean | null; b: string | number | boolean | null }[] = Object.entries(SETTING_LABELS).map(([key, label]) => ({ label, a: a[key as keyof typeof SETTING_LABELS], b: b[key as keyof typeof SETTING_LABELS] }));
  for (const key of new Set([...Object.keys(a.extra), ...Object.keys(b.extra)])) rows.push({ label: `追加: ${key}`, a: a.extra[key] ?? null, b: b.extra[key] ?? null });
  const unknown = rows.filter(row => row.a === null || row.b === null).map(row => row.label);
  if (!a.extrasConfirmed || !b.extrasConfirmed) unknown.push('モデル固有の追加条件が未確認');
  if (a.evidence === 'unknown' || b.evidence === 'unknown') unknown.push('設定の取得元が不明');
  const known = new Set([...Object.keys(SETTING_LABELS), 'extra', 'extrasConfirmed', 'evidence']);
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (!known.has(key)) unknown.push(`未対応の設定: ${key}（extraへ明示的に記録してください）`);
  return { rows, unknown, different: rows.filter(row => row.a !== null && row.b !== null && row.a !== row.b), status: unknown.length ? '検証不能' : rows.some(row => row.a !== row.b) ? '設定不一致' : '記録した条件は一致' };
}
// Compare raw strings, without interpreting commas/braces/weighting as a grammar.
export function textDifference(a: string, b: string) {
  const aa = Array.from(a); const bb = Array.from(b);
  let start = 0; let end = 0;
  while (start < aa.length && start < bb.length && aa[start] === bb[start]) start++;
  while (end < aa.length - start && end < bb.length - start && aa[aa.length - end - 1] === bb[bb.length - end - 1]) end++;
  return { prefix: aa.slice(0, start).join(''), removed: aa.slice(start, aa.length - end).join(''), added: bb.slice(start, bb.length - end).join(''), suffix: end ? aa.slice(-end).join('') : '' };
}
export function experimentDifferences(item: Experiment) { return comparePreset(item.variantA.workspaceSnapshot, item.variantB.workspaceSnapshot); }
export const MAX_DIFF_PIXELS = 4_194_304;
export function pixelDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): { pixels: Uint8ClampedArray; changed: number; mean: number } {
  if (a.length !== b.length || a.length % 4 || a.length / 4 > MAX_DIFF_PIXELS) throw new Error('ピクセル差分のサイズ上限または配列が不正です');
  const pixels = new Uint8ClampedArray(a.length); let changed = 0; let total = 0;
  for (let i = 0; i < a.length; i += 4) {
    let different = false;
    for (let c = 0; c < 4; c++) { const delta = Math.abs(a[i + c]! - b[i + c]!); total += delta; different ||= delta !== 0; if (c < 3) pixels[i + c] = delta; }
    if (different) changed++;
    // Show alpha differences as white as well; output is always opaque.
    const alphaDelta = Math.abs(a[i + 3]! - b[i + 3]!);
    for (let c = 0; c < 3; c++) pixels[i + c] = Math.max(pixels[i + c]!, alphaDelta);
    pixels[i + 3] = 255;
  }
  return { pixels, changed, mean: a.length ? total / a.length : 0 };
}
