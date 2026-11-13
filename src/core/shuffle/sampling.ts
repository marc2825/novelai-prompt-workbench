import { fingerprint, randomInt, type Rng } from './random';
import type { AxisState, SamplingMode } from './types';

export interface Candidate { key: string; weight: number }
export interface PickRequest {
  axisKey: string;
  axis: AxisState | undefined;
  /** Static candidate set of the axis (enabled candidates), used for the bag fingerprint. */
  universe: readonly string[];
  /** Candidates that also satisfy this step's constraints. Must be a subset of universe. */
  eligible: readonly Candidate[];
  mode: SamplingMode;
  avoidRepeat: boolean;
  rng: Rng;
}
export interface PickResult { key: string | null; axis: AxisState }

/** Invalid weights (NaN, ±Infinity, negative, non-number) are treated as 0 = never. */
export function sanitizeWeight(weight: unknown): number {
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : 0;
}

export function weightedIndex(weights: readonly number[], rng: Rng): number | null {
  const total = weights.reduce((sum, weight) => sum + sanitizeWeight(weight), 0);
  if (!(total > 0) || !Number.isFinite(total)) return null;
  let target = rng() * total;
  for (const [index, weight] of weights.entries()) {
    const value = sanitizeWeight(weight);
    if (value === 0) continue;
    if (target < value) return index;
    target -= value;
  }
  // Floating point remainder: return the last positive weight.
  for (let index = weights.length - 1; index >= 0; index--) if (sanitizeWeight(weights[index]) > 0) return index;
  return null;
}

/**
 * Draw one key for an axis. Pure: returns the next axis state instead of mutating.
 * - random: uniform over eligible candidates.
 * - bag: uniform over eligible candidates not yet drawn this cycle; a new cycle starts
 *   when the eligible ones are exhausted or the static candidate set changed.
 * - weighted: proportional to sanitized weights; weight 0 is never drawn.
 * avoidRepeat excludes the previous key whenever another candidate is available.
 * Returns key null (without consuming state) when no candidate can be drawn.
 */
export function pick(request: PickRequest): PickResult {
  const print = fingerprint([...request.universe].sort());
  const previous = request.axis && request.axis.fingerprint === print ? request.axis : undefined;
  const axis: AxisState = previous
    ? { ...previous, used: [...previous.used] }
    : { key: request.axisKey, fingerprint: print, used: [], last: request.axis?.last ?? null };
  let pool = request.mode === 'weighted'
    ? request.eligible.filter(candidate => sanitizeWeight(candidate.weight) > 0)
    : [...request.eligible];
  if (!pool.length) return { key: null, axis: request.axis ?? axis };
  if (request.avoidRepeat && axis.last !== null && pool.length > 1) {
    const without = pool.filter(candidate => candidate.key !== axis.last);
    if (without.length) pool = without;
  }
  let chosen: Candidate;
  if (request.mode === 'bag') {
    const used = new Set(axis.used);
    let available = pool.filter(candidate => !used.has(candidate.key));
    if (!available.length) { axis.used = []; available = pool; }
    chosen = available[randomInt(request.rng, available.length)]!;
    axis.used.push(chosen.key);
  } else if (request.mode === 'weighted') {
    chosen = pool[weightedIndex(pool.map(candidate => candidate.weight), request.rng) ?? 0]!;
  } else {
    chosen = pool[randomInt(request.rng, pool.length)]!;
  }
  axis.last = chosen.key;
  return { key: chosen.key, axis };
}
