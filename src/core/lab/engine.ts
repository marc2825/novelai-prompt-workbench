import { appendFragment } from '../compose';
import { AXIS_KINDS, emptyAxis, MAX_CONDITIONS, type Axis, type Condition, type Definition, type LabExperiment, type LabSettings } from './types';
import { distinct, numericValues, seedList, textValues } from './values';
import { transformPrompt } from './prompt';
export const SAMPLERS = ['Euler Ancestral', 'Euler', 'DPM++ 2M'];
const NUMERIC = ['weight', 'steps', 'guidance', 'rescale'];
export function axisValues(axis: Axis): string[] {
  if (!AXIS_KINDS.includes(axis.kind)) throw new Error('Unsupported axis');
  if (axis.kind === 'none') return ['Fixed'];
  if (axis.kind === 'seed') return seedList(axis.input);
  if (axis.kind === 'matrix') {
    const tags = textValues(axis.input, axis.format); if (tags.length > 6) throw new Error('Matrix supports at most 6 optional groups');
    return Array.from({ length: 2 ** tags.length }, (_, i) => String(i));
  }
  return NUMERIC.includes(axis.kind) ? numericValues(axis.input) : textValues(axis.input, axis.format);
}
export function axisValueLabel(axis: Axis, value: string): string {
  return axis.kind === 'matrix' ? textValues(axis.input, axis.format).filter((_, bit) => Number(value) & (1 << bit)).join(' + ') || '∅' : value;
}
export function validateSettings(settings: LabSettings, negative: string) {
  if (!['V5 Full', 'V5 Curated'].includes(settings.model) || !['high', 'medium'].includes(settings.effort)) throw new Error('Unsupported model/effort');
  if (!Number.isInteger(settings.steps) || settings.steps < 1 || settings.steps > 50) throw new Error('Steps: 1–50');
  if (!Number.isFinite(settings.guidance) || settings.guidance < 0 || settings.guidance > 10) throw new Error('Guidance: 0–10');
  if (settings.rescale !== null && (!Number.isFinite(settings.rescale) || settings.rescale < 0 || settings.rescale > 1)) throw new Error('Rescale: 0–1');
  if (!SAMPLERS.includes(settings.sampler)) throw new Error('Unsupported sampler');
  if (![settings.width, settings.height].every(n => Number.isInteger(n) && n >= 64 && n <= 2048 && n % 64 === 0) || settings.width * settings.height > 3_145_728) throw new Error('Resolution: multiples of 64, max 2048 per side / 3Mpx');
  if (typeof settings.quality !== 'boolean') throw new Error('Quality Tags must be boolean');
  if (settings.effort === 'medium' && (settings.model !== 'V5 Full' || settings.steps !== 14 || settings.sampler !== 'Euler Ancestral' || negative !== '' || settings.rescale !== null)) throw new Error('V5 Full Medium: 14 Steps, Euler Ancestral, no custom UC / Rescale');
}
export function expandDefinition(def: Definition): Omit<Condition, 'id'>[] {
  if (!def.name.trim() || def.name.length > 200 || def.description.length > 10_000 || def.positive.length > 100_000 || def.negative.length > 100_000) throw new Error('Invalid experiment name or text limit');
  if (def.axes.length !== 3 || !Number.isInteger(def.repeats) || def.repeats < 1 || def.repeats > 16) throw new Error('Three axes / 1–16 repeats required');
  if (def.costPerImage !== null && (!Number.isFinite(def.costPerImage) || def.costPerImage < 0 || def.costPerImage > 1e6)) throw new Error('Invalid estimated cost');
  distinct(def.seeds); def.seeds.forEach(seed => { if (!/^\d{1,100}$/.test(seed)) throw new Error('Each seed must be one digit string'); });
  distinct(def.seeds.map(seed => BigInt(seed).toString()));
  const seen = new Set<string>();
  for (const a of def.axes) {
    if (!['positive', 'negative'].includes(a.channel) || !['csv', 'lines'].includes(a.format) || !Number.isInteger(a.occurrence) || a.occurrence < 0 || a.occurrence > 1000 || a.input.length > 100_000 || a.target.length > 1000) throw new Error('Invalid axis configuration');
    if (a.kind === 'none') continue;
    const key = ['weight', 'onOff', 'replace', 'position', 'searchReplace'].includes(a.kind) ? `${a.channel}:${a.target}` : ['prompt','group','matrix'].includes(a.kind) ? `${a.channel}:whole` : a.kind;
    if (seen.has(key)) throw new Error('Axes conflict: same parameter or tag occurrence'); seen.add(key);
    if (def.settings.effort === 'medium' && ['steps', 'sampler', 'rescale', 'uc'].includes(a.kind)) throw new Error('Axis unavailable with Medium Effort');
  }
  // Full prompt replacements cannot silently erase another axis transformation.
  for (const channel of ['positive', 'negative'] as const) if (def.axes.some(a => ['prompt','searchReplace'].includes(a.kind) && a.channel === channel) && def.axes.filter(a => a.kind !== 'none' && a.channel === channel && ['weight','onOff','replace','searchReplace','position','group','matrix','prompt'].includes(a.kind)).length > 1) throw new Error('Prompt Variant conflicts with a text axis');
  if (def.axes.some(a => a.kind === 'uc') && def.axes.some(a => a.kind !== 'none' && a.kind !== 'uc' && a.channel === 'negative')) throw new Error('UC variant conflicts with negative text axis');
  const values = def.axes.map(axisValues);
  const seeds = def.axes.some(a => a.kind === 'seed') ? ['axis'] : def.seeds;
  if (seeds.length * def.repeats * values.reduce((n, a) => n * a.length, 1) > MAX_CONDITIONS) throw new Error(`Condition limit: ${MAX_CONDITIONS}`);
  const results: Omit<Condition, 'id'>[] = [];
  for (let repeat = 0; repeat < def.repeats; repeat++) for (let seedIndex = 0; seedIndex < seeds.length; seedIndex++) for (let z = 0; z < values[2]!.length; z++) for (let y = 0; y < values[1]!.length; y++) for (let x = 0; x < values[0]!.length; x++) {
    const coordinate: [number,number,number] = [x,y,z];
    let positive = def.positive; let negative = def.negative; let seed = seeds[seedIndex]!; const settings = { ...def.settings };
    const factors = def.axes.map((a, i) => ({ axis: (['X','Y','Z'] as const)[i]!, kind: a.kind, target: a.target, occurrence: a.occurrence, channel: a.channel, value: values[i]![coordinate[i]!]!, ...(a.kind === 'matrix' ? { members: textValues(a.input, a.format).map((text, bit) => ({ text, present: !!(Number(values[i]![coordinate[i]!]) & (1 << bit)) })) } : {}) }));
    for (const [i, a] of def.axes.entries()) {
      const v = factors[i]!.value;
      if (a.kind === 'none') continue;
      if (a.kind === 'seed') seed = v;
      else if (['steps','guidance','rescale'].includes(a.kind)) settings[a.kind as 'steps' | 'guidance' | 'rescale'] = Number(v);
      else if (a.kind === 'sampler') settings.sampler = v;
      else if (a.kind === 'model') settings.model = v as LabSettings['model'];
      else if (a.kind === 'resolution') { const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(v); if (!m) throw new Error('Resolution must be WIDTHxHEIGHT'); settings.width = Number(m[1]); settings.height = Number(m[2]); }
      else if (a.kind === 'quality') { if (!['On','Off'].includes(v)) throw new Error('Quality: On / Off'); settings.quality = v === 'On'; }
      else if (a.kind === 'uc') negative = v;
      else {
        const raw = a.channel === 'positive' ? positive : negative;
        const next = a.kind === 'matrix' ? textValues(a.input, a.format).reduce((out, text, bit) => Number(v) & (1 << bit) ? appendFragment(out, text) : out, raw) : transformPrompt(raw, a, v);
        if (next.length > 100_000) throw new Error('Expanded prompt exceeds 100k characters');
        if (a.channel === 'positive') positive = next; else negative = next;
      }
    }
    validateSettings(settings, negative); seedList(seed);
    results.push({ coordinate, seedIndex, repeat, positive, negative, seed, settings, factors, status: 'pending', imageId: null, error: '', favorite: false, rating: 0, note: '' });
  }
  return results;
}
export function createLab(id: string, definition: Definition, time: string): LabExperiment {
  return { id, definition: structuredClone(definition), createdAt: time, updatedAt: time, state: 'active', conditions: expandDefinition(definition).map((c, index) => ({ ...c, id: `${id}:${index}` })) };
}
export const PRESETS = ['Weight Sweep','Tag On/Off','Tag Interaction','Seed Robustness','Prompt Comparison','Guidance Sweep','Prompt Matrix'] as const;
export function applyTemplate(def: Definition, name: string): Definition {
  const axes: Definition['axes'] = [emptyAxis(), emptyAxis(), emptyAxis()];
  axes[0] = { ...emptyAxis(), kind: 'weight', target: 'blush', input: '0.5-1.5 [5]' };
  if (name === 'Tag Interaction') axes[1] = { ...axes[0], target: 'smile' };
  if (name === 'Seed Robustness') axes[1] = { ...emptyAxis(), kind: 'seed', input: '1001,1002,1003' };
  if (name === 'Tag On/Off') { axes[0] = { ...emptyAxis(), kind: 'onOff', target: 'glasses', input: 'Off\nOn' }; axes[1] = { ...axes[0], target: 'blush' }; }
  if (name === 'Prompt Comparison') axes[0] = { ...emptyAxis(), kind: 'prompt', input: `${def.positive}\n${appendFragment(def.positive, 'sunset')}` };
  if (name === 'Guidance Sweep') axes[0] = { ...emptyAxis(), kind: 'guidance', input: '3-7 (+1)' };
  if (name === 'Prompt Matrix') axes[0] = { ...emptyAxis(), kind: 'matrix', input: 'glasses\nblush\nsmile' };
  return { ...def, name, axes };
}
