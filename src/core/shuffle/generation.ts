// Generation-aware counting. Pure state machines: the Site Adapter feeds observations,
// the panel feeds status snapshots. Nothing here clicks, generates or reads the DOM.

/** What a verified adapter can observe about the generate control at one instant. */
export type ObservedPhase = 'idle' | 'generating' | 'succeeded' | 'failed' | 'missing';
export interface Observation { phase: ObservedPhase; jobId: string | null }

export interface TrackerState {
  phase: 'idle' | 'generating' | 'unknown';
  /**
   * Job IDs that must never be counted (bounded): jobs already settled, and the
   * baseline job that was visible when observation started. A re-render showing
   * the same job therefore never counts twice.
   */
  settled: string[];
  completed: number;
  failed: number;
  lastJobId: string | null;
  /**
   * A job was already generating when observation started but had no ID. Its
   * eventual settle cannot be told apart from a new job, so the first settle
   * (or idle) after start is treated as that baseline job and is not counted.
   */
  baselinePending: boolean;
}
export const MAX_SETTLED = 500;
const remember = (settled: readonly string[], id: string) => settled.includes(id) ? [...settled] : [...settled, id].slice(-MAX_SETTLED);

/**
 * The job visible when observation starts is a baseline and is never counted —
 * whether it is already settled or still generating. A job that is generating
 * without an ID at start also becomes a baseline (see `baselinePending`).
 */
export function startTracker(initial: Observation): TrackerState {
  const phase = initial.phase === 'generating' ? 'generating' : initial.phase === 'missing' ? 'unknown' : 'idle';
  const settled = initial.jobId && initial.phase !== 'missing' ? [initial.jobId] : [];
  return { phase, settled, completed: 0, failed: 0, lastJobId: initial.jobId, baselinePending: initial.phase === 'generating' && !initial.jobId };
}

/**
 * Count one successful job exactly once. A settled state without a job ID is not
 * counted: without an identity it cannot be distinguished from a re-render.
 * Ambiguous observations are resolved by not counting (an under-count only delays
 * the next shuffle; an over-count would change prompts unexpectedly).
 */
export function track(state: TrackerState, observation: Observation): TrackerState {
  switch (observation.phase) {
    case 'missing': return { ...state, phase: 'unknown' };
    // The baseline job ended without a visible settled state.
    case 'idle': return { ...state, phase: 'idle', baselinePending: false };
    case 'generating': {
      const id = observation.jobId;
      // While the ID-less baseline job is still running, an ID that appears may be its own.
      if (state.baselinePending && id) return { ...state, phase: 'generating', settled: remember(state.settled, id), lastJobId: id };
      return { ...state, phase: 'generating', lastJobId: id ?? state.lastJobId };
    }
    case 'succeeded':
    case 'failed': {
      const id = observation.jobId;
      if (state.baselinePending) return { ...state, phase: 'idle', baselinePending: false, settled: id ? remember(state.settled, id) : [...state.settled], lastJobId: id ?? state.lastJobId };
      if (!id || state.settled.includes(id)) return { ...state, phase: 'idle' };
      return {
        ...state, phase: 'idle', settled: remember(state.settled, id), lastJobId: id,
        completed: state.completed + (observation.phase === 'succeeded' ? 1 : 0),
        failed: state.failed + (observation.phase === 'failed' ? 1 : 0),
      };
    }
  }
}

/** Status reported by the content script for one document. */
export interface GenerationStatus {
  supported: boolean;
  reason: string;
  /** Changes whenever the observer restarts; counts from different observers are never mixed. */
  observerId: string;
  generating: boolean;
  completed: number;
  failed: number;
}

/** Panel-side counter bound to one target document. */
export interface AutoCounter {
  every: number;
  observerId: string | null;
  lastCompleted: number;
  /** Successful jobs since the last shuffle. */
  count: number;
}
export function startCounter(every: number): AutoCounter {
  if (!Number.isSafeInteger(every) || every < 1) throw new RangeError('every must be a positive integer');
  return { every, observerId: null, lastCompleted: 0, count: 0 };
}
export interface CounterUpdate { counter: AutoCounter; due: boolean; counted: number; rebased: boolean }

/**
 * Apply a status snapshot. A new observer (page reload, restart) rebases without
 * counting; a decreasing counter is treated the same way. Several completions that
 * arrive at once still produce a single shuffle.
 */
export function observeStatus(counter: AutoCounter, status: Pick<GenerationStatus, 'observerId' | 'completed'>): CounterUpdate {
  if (counter.observerId !== status.observerId || status.completed < counter.lastCompleted) {
    const next = { ...counter, observerId: status.observerId, lastCompleted: status.completed };
    return { counter: next, due: next.count >= next.every, counted: 0, rebased: true };
  }
  const counted = status.completed - counter.lastCompleted;
  const next = { ...counter, lastCompleted: status.completed, count: counter.count + counted };
  return { counter: next, due: next.count >= next.every, counted, rebased: false };
}
/** Manual fallback: the user records one finished generation. */
export function recordManual(counter: AutoCounter): CounterUpdate {
  const next = { ...counter, count: counter.count + 1 };
  return { counter: next, due: next.count >= next.every, counted: 1, rebased: false };
}
export function resetAfterShuffle(counter: AutoCounter): AutoCounter { return { ...counter, count: 0 }; }

export const AUTO_EVERY_CHOICES = [1, 3, 5, 10] as const;
