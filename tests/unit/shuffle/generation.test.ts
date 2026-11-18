import { describe, expect, it } from 'vitest';
import { MAX_SETTLED, observeStatus, startCounter, startTracker, track, type Observation, type ObservedPhase } from '../../../src/core/shuffle/generation';

const o = (phase: ObservedPhase, jobId: string | null = null): Observation => ({ phase, jobId });
const run = (initial: Observation, steps: Observation[]) => steps.reduce(track, startTracker(initial));

describe('generation tracker state machine', () => {
  // Each row: initial observation, subsequent observations, expected counts.
  const table: { name: string; initial: Observation; steps: Observation[]; completed: number; failed: number; phase?: string }[] = [
    { name: 'job already generating at start is a baseline (regression)', initial: o('generating', 'job1'), steps: [o('succeeded', 'job1')], completed: 0, failed: 0, phase: 'idle' },
    { name: 'baseline generating job that fails is not counted either', initial: o('generating', 'job1'), steps: [o('failed', 'job1')], completed: 0, failed: 0 },
    { name: 'baseline job repeated re-renders never count', initial: o('generating', 'job1'), steps: [o('generating', 'job1'), o('succeeded', 'job1'), o('succeeded', 'job1'), o('idle'), o('succeeded', 'job1')], completed: 0, failed: 0 },
    { name: 'a new job after the baseline counts once', initial: o('generating', 'job1'), steps: [o('succeeded', 'job1'), o('generating', 'job2'), o('succeeded', 'job2'), o('succeeded', 'job2')], completed: 1, failed: 0 },
    { name: 'baseline settled at start is not counted', initial: o('succeeded', 'old'), steps: [o('succeeded', 'old'), o('idle'), o('succeeded', 'old')], completed: 0, failed: 0 },
    { name: 'ID-less generating at start: its first settle is the baseline', initial: o('generating'), steps: [o('succeeded', 'jobX')], completed: 0, failed: 0 },
    { name: 'ID-less generating at start: an ID revealed later is still the baseline', initial: o('generating'), steps: [o('generating', 'jobX'), o('succeeded', 'jobX')], completed: 0, failed: 0 },
    { name: 'ID-less baseline ends on idle; the next job counts', initial: o('generating'), steps: [o('idle'), o('generating', 'job2'), o('succeeded', 'job2')], completed: 1, failed: 0 },
    { name: 'ID-less baseline settles without ID; the next job counts', initial: o('generating'), steps: [o('succeeded'), o('generating', 'job2'), o('succeeded', 'job2')], completed: 1, failed: 0 },
    { name: 'success without a job ID is never counted', initial: o('idle'), steps: [o('generating'), o('succeeded'), o('succeeded'), o('failed')], completed: 0, failed: 0 },
    { name: 'failures count as failures, not completions', initial: o('idle'), steps: [o('generating', 'a'), o('failed', 'a'), o('generating', 'b'), o('succeeded', 'b')], completed: 1, failed: 1 },
    { name: 'a failed job ID reappearing as succeeded is not counted', initial: o('idle'), steps: [o('failed', 'a'), o('succeeded', 'a')], completed: 0, failed: 1 },
    { name: 'missing element mid-run keeps counts and becomes unknown', initial: o('idle'), steps: [o('generating', 'a'), o('missing'), o('succeeded', 'a'), o('missing')], completed: 1, failed: 0, phase: 'unknown' },
    { name: 'missing at start then an old job appears settled: counted only once by ID', initial: o('missing'), steps: [o('succeeded', 'a'), o('succeeded', 'a')], completed: 1, failed: 0 },
    { name: 'several distinct jobs each count once', initial: o('idle'), steps: ['a', 'b', 'c'].flatMap(id => [o('generating', id), o('succeeded', id), o('succeeded', id)]), completed: 3, failed: 0 },
  ];
  for (const row of table) it(row.name, () => {
    const state = run(row.initial, row.steps);
    expect({ completed: state.completed, failed: state.failed }).toEqual({ completed: row.completed, failed: row.failed });
    if (row.phase) expect(state.phase).toBe(row.phase);
  });

  it('is pure: tracking never mutates the previous state', () => {
    const start = startTracker(o('idle'));
    const frozen = JSON.stringify(start);
    track(start, o('succeeded', 'x'));
    expect(JSON.stringify(start)).toBe(frozen);
  });

  it('bounds the settled list without recounting recent jobs', () => {
    let state = startTracker(o('idle'));
    for (let index = 0; index < MAX_SETTLED + 50; index++) state = track(track(state, o('generating', `j${index}`)), o('succeeded', `j${index}`));
    expect(state.settled.length).toBe(MAX_SETTLED);
    expect(state.completed).toBe(MAX_SETTLED + 50);
    const again = track(state, o('succeeded', `j${MAX_SETTLED + 49}`));
    expect(again.completed).toBe(state.completed);
  });
});

describe('panel counter across observer restarts', () => {
  it('a restarted observer (page reload) rebases without counting, even if its counts are higher', () => {
    let update = observeStatus(startCounter(2), { observerId: 'a', completed: 0 });
    update = observeStatus(update.counter, { observerId: 'a', completed: 1 });
    expect(update).toMatchObject({ counted: 1, due: false });
    update = observeStatus(update.counter, { observerId: 'b', completed: 5 });
    expect(update).toMatchObject({ counted: 0, due: false, rebased: true });
    update = observeStatus(update.counter, { observerId: 'b', completed: 6 });
    expect(update).toMatchObject({ counted: 1, due: true });
  });
  it('a decreasing counter from the same observer rebases instead of counting negative', () => {
    let update = observeStatus(startCounter(3), { observerId: 'a', completed: 4 });
    update = observeStatus(update.counter, { observerId: 'a', completed: 2 });
    expect(update).toMatchObject({ counted: 0, rebased: true });
    expect(update.counter.count).toBe(0);
  });
});
