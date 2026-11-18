export const AXIS_KINDS = ['none', 'weight', 'onOff', 'replace', 'searchReplace', 'position', 'group', 'prompt', 'seed', 'steps', 'guidance', 'rescale', 'sampler', 'model', 'resolution', 'uc', 'quality', 'matrix'] as const;
export type AxisKind = typeof AXIS_KINDS[number];
export interface Axis {
  kind: AxisKind; target: string; occurrence: number; channel: 'positive' | 'negative';
  input: string; format: 'lines' | 'csv';
}
export interface LabSettings {
  model: 'V5 Full' | 'V5 Curated'; effort: 'high' | 'medium';
  steps: number; guidance: number; rescale: number | null; sampler: string;
  width: number; height: number; quality: boolean;
}
export interface Definition {
  name: string; description: string; positive: string; negative: string;
  settings: LabSettings; axes: [Axis, Axis, Axis];
  seeds: string[]; repeats: number; costPerImage: number | null;
}
export interface Factor { axis: 'X' | 'Y' | 'Z'; kind: AxisKind; target: string; occurrence: number; channel: 'positive' | 'negative'; value: string; members?: { text: string; present: boolean }[] }
export interface Condition {
  id: string; coordinate: [number, number, number]; seedIndex: number; repeat: number;
  positive: string; negative: string; seed: string; settings: LabSettings; factors: Factor[];
  status: 'pending' | 'awaiting' | 'completed' | 'failed' | 'skipped'; imageId: string | null;
  error: string; favorite: boolean; rating: number; note: string;
}
export interface LabExperiment {
  id: string; definition: Definition; conditions: Condition[];
  createdAt: string; updatedAt: string; state: 'active' | 'paused' | 'stopped';
}
export interface LabData { schemaVersion: 1; experiments: LabExperiment[] }
export const MAX_CONDITIONS = 512;
export const MAX_AXIS_VALUES = 64;
export const emptyAxis = (): Axis => ({ kind: 'none', target: '', occurrence: 1, channel: 'positive', input: '', format: 'lines' });
export function defaultDefinition(): Definition {
  return { name: 'Weight Sweep', description: '', positive: '1girl, solo, blush, smile', negative: '', settings: { model: 'V5 Full', effort: 'high', steps: 23, guidance: 5, rescale: 0, sampler: 'Euler Ancestral', width: 1024, height: 1024, quality: false }, axes: [{ ...emptyAxis(), kind: 'weight', target: 'blush', input: '0.5-1.5 [5]' }, emptyAxis(), emptyAxis()], seeds: ['1001'], repeats: 1, costPerImage: null };
}
