import { describe, expect, it } from 'vitest';
import { enumerateAssignments, hasCompleteMatching, sampleAssignment } from '../../../src/core/shuffle/assignment';
import { emptyCursor, replay, shuffleStep } from '../../../src/core/shuffle/engine';
import { createRng, hashString, randomInt, shuffled, stepRng } from '../../../src/core/shuffle/random';
import { pick, sanitizeWeight, weightedIndex } from '../../../src/core/shuffle/sampling';
import { advanceShuffle, createProfile, emptyShuffle, updateSettings } from '../../../src/core/shuffle/state';
import type { ShuffleData, ShuffleProfile, ShuffleSettings } from '../../../src/core/shuffle/types';
import { fixture } from '../helpers';
import { BASE, character, idFactory, option, pointingSetup, pool, role, template } from './helpers';

function run(shuffle: ShuffleData, profile: ShuffleProfile, steps: number) {
  const outcomes = [];
  let current = profile;
  for (let index = 0; index < steps; index++) {
    const outcome = shuffleStep(shuffle, current);
    outcomes.push(outcome);
    current = { ...current, cursor: outcome.cursor };
  }
  return { outcomes, profile: current };
}
const withSettings = (profile: ShuffleProfile, patch: Partial<ShuffleSettings>) => ({ ...profile, settings: { ...profile.settings, ...patch } });

describe('seeded random', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = createRng('seed'); const b = createRng('seed'); const c = createRng('other');
    const first = Array.from({ length: 20 }, a);
    expect(Array.from({ length: 20 }, b)).toEqual(first);
    expect(Array.from({ length: 20 }, c)).not.toEqual(first);
    expect(first.every(value => value >= 0 && value < 1)).toBe(true);
    expect(hashString('seed')).toEqual(hashString('seed'));
    // Pinned values guard against accidental algorithm changes that would break reproducibility.
    expect(Array.from({ length: 3 }, createRng('nai-shuffle')).map(value => value.toFixed(8))).toEqual(['0.50948182', '0.37400823', '0.16195846']);
  });
  it('derives independent per-step streams and rejects invalid ranges', () => {
    expect(stepRng('s', 1)()).toBe(stepRng('s', 1)());
    expect(stepRng('s', 1)()).not.toBe(stepRng('s', 2)());
    expect(() => randomInt(createRng('x'), 0)).toThrow();
    const items = [1, 2, 3, 4, 5];
    expect(shuffled(items, createRng('x')).sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('sampling strategies', () => {
  const keys = ['a', 'b', 'c', 'd', 'e'];
  const eligible = keys.map(key => ({ key, weight: 1 }));
  it('Shuffle Bag never repeats within a cycle and avoids a repeat across the cycle boundary', () => {
    const rng = createRng('bag');
    let axis;
    const drawn: string[] = [];
    for (let index = 0; index < 25; index++) {
      const result = pick({ axisKey: 'x', axis, universe: keys, eligible, mode: 'bag', avoidRepeat: true, rng });
      axis = result.axis; drawn.push(result.key!);
    }
    for (let cycle = 0; cycle < 5; cycle++) expect(new Set(drawn.slice(cycle * 5, cycle * 5 + 5)).size).toBe(5);
    for (let index = 1; index < drawn.length; index++) expect(drawn[index]).not.toBe(drawn[index - 1]);
  });
  it('restarts the bag when the candidate set changes', () => {
    const rng = createRng('reset');
    const first = pick({ axisKey: 'x', axis: undefined, universe: keys, eligible, mode: 'bag', avoidRepeat: false, rng });
    const changed = pick({ axisKey: 'x', axis: first.axis, universe: ['z'], eligible: [{ key: 'z', weight: 1 }], mode: 'bag', avoidRepeat: false, rng });
    expect(changed.key).toBe('z');
    expect(changed.axis.used).toEqual(['z']);
  });
  it('treats invalid weights as zero and never draws weight 0', () => {
    for (const value of [Number.NaN, -1, Number.POSITIVE_INFINITY, '3' as unknown as number, undefined as unknown as number]) expect(sanitizeWeight(value)).toBe(0);
    expect(weightedIndex([0, 0, Number.NaN], createRng('w'))).toBeNull();
    const rng = createRng('weighted');
    const counts = { a: 0, b: 0, c: 0 };
    for (let index = 0; index < 2000; index++) {
      const result = pick({ axisKey: 'w', axis: undefined, universe: ['a', 'b', 'c'], eligible: [{ key: 'a', weight: 0 }, { key: 'b', weight: 1 }, { key: 'c', weight: 3 }], mode: 'weighted', avoidRepeat: false, rng });
      counts[result.key as 'a' | 'b' | 'c']++;
    }
    expect(counts.a).toBe(0);
    expect(counts.c / counts.b).toBeGreaterThan(2.3);
    expect(counts.c / counts.b).toBeLessThan(3.9);
  });
  it('returns null without consuming state for zero candidates, and repeats a single candidate safely', () => {
    const empty = pick({ axisKey: 'x', axis: undefined, universe: [], eligible: [], mode: 'bag', avoidRepeat: true, rng: createRng('0') });
    expect(empty.key).toBeNull();
    let axis;
    for (let index = 0; index < 3; index++) {
      const result = pick({ axisKey: 'one', axis, universe: ['only'], eligible: [{ key: 'only', weight: 1 }], mode: 'bag', avoidRepeat: true, rng: createRng(String(index)) });
      expect(result.key).toBe('only'); axis = result.axis;
    }
    const allZero = pick({ axisKey: 'z', axis: undefined, universe: ['a'], eligible: [{ key: 'a', weight: 0 }], mode: 'weighted', avoidRepeat: false, rng: createRng('z') });
    expect(allZero.key).toBeNull();
  });
});

describe('role assignment', () => {
  it('enumerates only valid injective assignments and samples beyond the cap without enumerating', () => {
    expect(enumerateAssignments([['A', 'B'], ['A', 'B']], 10)).toEqual([['A', 'B'], ['B', 'A']]);
    expect(enumerateAssignments([['A'], ['A']], 10)).toEqual([]);
    expect(hasCompleteMatching([['A', 'B'], ['A']])).toBe(true);
    const many = Array.from({ length: 22 }, (_, index) => `C${index}`);
    expect(enumerateAssignments([many, many, many], 720)).toBeNull();
    const sampled = sampleAssignment([many, many, many], createRng('big'))!;
    expect(new Set(sampled).size).toBe(3);
    expect(sampleAssignment([['A'], ['A']], createRng('none'))).toBeNull();
    const constrained = sampleAssignment([['A', 'B'], ['A']], createRng('c'))!;
    expect(constrained).toEqual(['B', 'A']);
  });
});

describe('shuffle engine', () => {
  it('produces identical sequences for the same settings, seed and step count', () => {
    const { shuffle, profile } = pointingSetup();
    const first = replay(shuffle, profile, 30).map(outcome => outcome.selection);
    const second = replay(shuffle, profile, 30).map(outcome => outcome.selection);
    expect(second).toEqual(first);
    const id = idFactory('x');
    const rich: ShuffleData = { ...shuffle, pools: [pool(id(), 'expression', 'expression', ['smile', 'blush', 'serious', 'surprised', 'crying', 'laughing'].map(text => option(id(), text)))] };
    const expressive = withSettings(profile, { targets: { role: true, pose: false, expression: true, camera: false, position: false } });
    const signatures = (seed: string) => replay(rich, withSettings(expressive, { seed }), 30).map(outcome => outcome.selection.signature);
    expect(signatures('seed-1')).toEqual(signatures('seed-1'));
    expect(signatures('seed-2')).not.toEqual(signatures('seed-1'));
  });

  it('swaps actor/recipient between A and B, keeping role pairs consistent and both orders equally often', () => {
    const { shuffle, profile, A, B, actor, recipient } = pointingSetup();
    const { outcomes } = run(shuffle, profile, 40);
    const keys = outcomes.map(outcome => outcome.selection.roleAssignments.map(item => `${item.roleId}=${item.characterId}`).sort().join());
    const aActor = [`${actor.id}=${A.id}`, `${recipient.id}=${B.id}`].sort().join();
    const bActor = [`${actor.id}=${B.id}`, `${recipient.id}=${A.id}`].sort().join();
    expect(new Set(keys)).toEqual(new Set([aActor, bActor]));
    // Shuffle Bag: every 2-step cycle contains both orders exactly once.
    for (let cycle = 0; cycle < 20; cycle++) expect(new Set(keys.slice(cycle * 2, cycle * 2 + 2)).size).toBe(2);
    for (const outcome of outcomes) {
      const assignments = outcome.selection.roleAssignments;
      expect(assignments).toHaveLength(2);
      expect(new Set(assignments.map(item => item.characterId)).size).toBe(2);
      expect(new Set(assignments.map(item => item.roleId))).toEqual(new Set([actor.id, recipient.id]));
    }
  });

  it('never changes character definitions (fixed prompts have no side effects)', () => {
    const { shuffle, profile } = pointingSetup();
    const before = structuredClone(shuffle);
    run(shuffle, profile, 10);
    advanceShuffle({ ...fixture(), shuffle }, { profileId: profile.id, historyId: idFactory('h')(), now: '2026-11-14T00:00:00.000Z', trigger: 'manual', base: BASE });
    expect(shuffle).toEqual(before);
  });

  it('excludes candidates that violate tag constraints, at every step', () => {
    const id = idFactory('c');
    const A = character(id(), 'A'); const B = character(id(), 'B');
    const poseSet = template(id(), 'stand/sit', [role(id(), 'x', 'standing', { categories: ['pose'] }), role(id(), 'y', 'sitting', { categories: ['pose'] })], { kind: 'pose', tags: ['height-difference'] });
    const closeUp = option(id(), 'close-up', { excludes: ['height-difference'] });
    const full = option(id(), 'full body');
    const needsSeated = option(id(), 'from above', { requires: ['seated'] });
    const eye = option(id(), 'eye level');
    const profile = withSettings({ ...createProfile(id(), 'p', 's'), characterIds: [A.id, B.id] }, { targets: { role: false, pose: true, expression: false, camera: true, position: false }, mode: 'random' });
    const shuffle: ShuffleData = { ...emptyShuffle(), characters: [A, B], templates: [poseSet], pools: [pool(id(), 'framing', 'framing', [closeUp, full]), pool(id(), 'angle', 'angle', [needsSeated, eye])], profiles: [profile] };
    for (const outcome of run(shuffle, profile, 100).outcomes) {
      const optionIds = outcome.selection.picks.map(item => item.optionId);
      expect(optionIds).toContain(full.id);
      expect(optionIds).not.toContain(closeUp.id);
      expect(optionIds).not.toContain(needsSeated.id);
    }
  });

  it('is safe with empty libraries, zero participants and impossible templates', () => {
    const id = idFactory('e');
    const lonely = character(id(), 'solo');
    const profile = { ...createProfile(id(), 'p', 's'), characterIds: [lonely.id] };
    const empty = shuffleStep(emptyShuffle(), { ...profile, characterIds: [] });
    expect(empty.selection.roleTemplateId).toBeNull();
    expect(empty.selection.order).toEqual([]);
    const twoRoles = template(id(), 'needs two', [role(id(), 'a', 'x'), role(id(), 'b', 'y')]);
    const outcome = shuffleStep({ ...emptyShuffle(), characters: [lonely], templates: [twoRoles] }, profile);
    expect(outcome.selection.roleTemplateId).toBeNull();
    expect(outcome.warnings.join()).toContain('人数');
    const missing = shuffleStep(emptyShuffle(), profile);
    expect(missing.warnings.join()).toContain('見つからない');
    const noTargets = shuffleStep({ ...emptyShuffle() }, withSettings({ ...profile, characterIds: [] }, { targets: { role: false, pose: false, expression: false, camera: false, position: false } }));
    expect(noTargets.warnings.join()).toContain('対象のカテゴリ');
  });

  it('handles 1, 2, 3 and 22 characters with partial role assignment', () => {
    const id = idFactory('n');
    const people = Array.from({ length: 22 }, (_, index) => character(id(), `C${index}`));
    const duo = template(id(), 'duo', [role(id(), 'a', 'source#hug'), role(id(), 'b', 'target#hug')]);
    const trio = template(id(), 'trio', [role(id(), 'x', 'x'), role(id(), 'y', 'y'), role(id(), 'z', 'z')]);
    for (const count of [1, 2, 3, 22]) {
      const profile = { ...createProfile(id(), 'p', `s${count}`), characterIds: people.slice(0, count).map(item => item.id) };
      const shuffle: ShuffleData = { ...emptyShuffle(), characters: people, templates: [duo, trio], profiles: [profile] };
      for (const outcome of run(shuffle, profile, 20).outcomes) {
        const assigned = outcome.selection.roleAssignments.map(item => item.characterId);
        expect(new Set(assigned).size).toBe(assigned.length);
        expect(assigned.every(characterId => profile.characterIds.includes(characterId))).toBe(true);
        if (count === 1) expect(outcome.selection.roleTemplateId).toBeNull();
        else if (count === 2) expect(outcome.selection.roleTemplateId).toBe(duo.id);
        else expect(assigned.length).toBeGreaterThanOrEqual(2);
        expect(outcome.selection.order).toHaveLength(count);
      }
    }
  });

  it('stays fast and bounded with thousands of candidates and 22 characters', () => {
    const id = idFactory('l');
    const people = Array.from({ length: 22 }, (_, index) => character(id(), `C${index}`));
    const options = Array.from({ length: 5000 }, (_, index) => option(id(), `pose ${index}`));
    const templates = Array.from({ length: 50 }, (_, index) => template(id(), `t${index}`, [role(id(), 'a', 'a'), role(id(), 'b', 'b'), role(id(), 'c', 'c')]));
    const profile = withSettings({ ...createProfile(id(), 'p', 'big'), characterIds: people.map(item => item.id) }, { targets: { role: true, pose: true, expression: false, camera: false, position: true } });
    const shuffle: ShuffleData = { ...emptyShuffle(), characters: people, templates, pools: [pool(id(), 'pose', 'pose', options)], profiles: [profile] };
    const started = performance.now();
    const { profile: last } = run(shuffle, profile, 30);
    expect(performance.now() - started).toBeLessThan(5000);
    for (const axis of last.cursor.axes) expect(axis.used.length).toBeLessThanOrEqual(5000);
    expect(JSON.stringify(last.cursor).length).toBeLessThan(5_000_000);
  });

  it('respects allowed categories, locked tags and per-role character limits', () => {
    const id = idFactory('r');
    const A = character(id(), 'A'); const B = character(id(), 'B', { allowedCategories: ['action', 'expression', 'gaze'] }); const C = character(id(), 'C', { lockedTags: ['sitting'] });
    const sitStand = template(id(), 'sit/stand', [role(id(), 'x', 'standing', { categories: ['pose'] }), role(id(), 'y', 'sitting', { categories: ['pose'] })], { kind: 'pose' });
    const onlyA = role(id(), 'boss', 'pointing', { allowedCharacterIds: [A.id] });
    const lead = template(id(), 'lead', [onlyA, role(id(), 'follower', 'following')]);
    const profile = { ...createProfile(id(), 'p', 'lock'), characterIds: [A.id, B.id, C.id] };
    const shuffle: ShuffleData = { ...emptyShuffle(), characters: [A, B, C], templates: [sitStand, lead], profiles: [profile] };
    for (const outcome of run(shuffle, profile, 40).outcomes) {
      expect(outcome.selection.poseAssignments.map(item => item.characterId)).not.toContain(B.id);
      expect(outcome.selection.poseAssignments.map(item => item.characterId)).not.toContain(C.id);
      expect(outcome.selection.roleAssignments.find(item => item.roleId === onlyA.id)?.characterId).toBe(A.id);
    }
  });

  it('avoids recent compositions and resets the sequence when the seed changes', () => {
    const { shuffle, profile } = pointingSetup();
    const random = withSettings(profile, { mode: 'random', avoidRepeat: false, avoidRecent: 1 });
    const signatures = run(shuffle, random, 12).outcomes.map(outcome => outcome.selection.signature);
    for (let index = 1; index < signatures.length; index++) expect(signatures[index]).not.toBe(signatures[index - 1]);
    const advanced = { ...profile, cursor: run(shuffle, profile, 3).profile.cursor };
    expect(updateSettings(advanced, { seed: 'new' }).cursor).toEqual(emptyCursor());
    expect(updateSettings(advanced, { mode: 'random' }).cursor.step).toBe(3);
  });

  it('accepts a duplicate with a warning when every attempt repeats', () => {
    const id = idFactory('d');
    const A = character(id(), 'A');
    const profile = withSettings({ ...createProfile(id(), 'p', 'dup'), characterIds: [A.id] }, { avoidRecent: 5, targets: { role: false, pose: true, expression: false, camera: false, position: false } });
    const shuffle: ShuffleData = { ...emptyShuffle(), characters: [A], pools: [pool(id(), 'pose', 'pose', [option(id(), 'standing')])], profiles: [profile] };
    const outcomes = run(shuffle, profile, 2).outcomes;
    expect(outcomes[1]!.selection.signature).toBe(outcomes[0]!.selection.signature);
    expect(outcomes[1]!.warnings.join()).toContain('重複を許可');
  });

  it('orders characters by role side when position shuffle is enabled', () => {
    const { shuffle, profile, actor } = pointingSetup();
    const sided = { ...shuffle, templates: shuffle.templates.map(item => ({ ...item, roles: item.roles.map(current => current.id === actor.id ? { ...current, side: 'right' as const } : current) })) };
    const positioned = withSettings(profile, { targets: { role: true, pose: false, expression: false, camera: false, position: true } });
    for (const outcome of run(sided, positioned, 10).outcomes) {
      const actorId = outcome.selection.roleAssignments.find(item => item.roleId === actor.id)!.characterId;
      expect(outcome.selection.order.at(-1)).toBe(actorId);
      expect(outcome.selection.sides.find(item => item.characterId === actorId)?.side).toBe('right');
    }
  });
});
