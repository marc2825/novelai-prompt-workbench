import { createLab, expandDefinition } from '../core/lab/engine';
import type { Definition, LabData, LabExperiment } from '../core/lab/types';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function obj(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Lab: object required'); return v as Record<string, unknown>; }
function str(v: unknown, max: number) { if (typeof v !== 'string' || v.length > max) throw new Error('Lab: invalid text'); }
export function validateLab(input: unknown, imageIds: Set<unknown>): LabData {
  const data = obj(input);
  if (data.schemaVersion !== 1 || !Array.isArray(data.experiments) || data.experiments.length > 32) throw new Error('Lab: unsupported version or experiment limit (32)');
  const ids = new Set<string>(); let total = 0;
  for (const raw of data.experiments) {
    const e = obj(raw); const d = obj(e.definition);
    if (typeof e.id !== 'string' || !UUID.test(e.id) || ids.has(e.id)) throw new Error('Lab: invalid/duplicate experiment ID'); ids.add(e.id);
    for (const k of ['createdAt','updatedAt']) if (typeof e[k] !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(e[k] as string) || !Number.isFinite(Date.parse(e[k] as string))) throw new Error('Lab: invalid timestamp');
    if (!['active','paused','stopped'].includes(e.state as string)) throw new Error('Lab: invalid execution state');
    for (const k of ['name','description','positive','negative']) str(d[k], 100_000);
    if (!Array.isArray(d.axes) || d.axes.length !== 3 || !Array.isArray(d.seeds) || !d.seeds.length || d.seeds.length > 64 || d.seeds.some(s => typeof s !== 'string')) throw new Error('Lab: invalid axes/seeds');
    for (const a of d.axes) { const axis = obj(a); for (const k of ['kind','target','channel','input','format']) str(axis[k],100_000); }
    obj(d.settings);
    const expected = expandDefinition(d as unknown as Definition);
    if (!Array.isArray(e.conditions) || e.conditions.length !== expected.length || (total += e.conditions.length) > 2048) throw new Error('Lab: invalid condition count (total max 2048)');
    for (const [i, rawCondition] of e.conditions.entries()) {
      const c = obj(rawCondition); const correct = expected[i]!;
      if (c.id !== `${e.id}:${i}`) throw new Error('Lab: condition ID mismatch');
      for (const k of ['coordinate','seedIndex','repeat','positive','negative','seed','settings','factors'] as const) if (JSON.stringify(c[k]) !== JSON.stringify(correct[k])) throw new Error(`Lab: condition snapshot mismatch (${k})`);
      if (!['pending','awaiting','completed','failed','skipped'].includes(c.status as string)) throw new Error('Lab: invalid condition status');
      if (c.imageId !== null && !imageIds.has(c.imageId)) throw new Error('Lab: missing image reference');
      if (c.status === 'completed' && c.imageId === null) throw new Error('Lab: completed condition needs an image');
      if (typeof c.favorite !== 'boolean' || !Number.isInteger(c.rating) || Number(c.rating) < 0 || Number(c.rating) > 5) throw new Error('Lab: invalid rating');
      str(c.note, 10_000); str(c.error, 10_000);
    }
  }
  return structuredClone(data) as unknown as LabData;
}
export function duplicateLab(source: LabExperiment, id: string, time: string): LabExperiment {
  const copy = createLab(id, { ...source.definition, name: `${source.definition.name.slice(0,180)} copy` }, time);
  // A duplicate is a new run: results and evaluations stay attached to their original conditions.
  return copy;
}
