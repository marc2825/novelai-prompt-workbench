import { describe, expect, it } from 'vitest';
import { composeShuffle, diffComposed, templateWarnings } from '../../../src/core/shuffle/compose';
import { shuffleStep } from '../../../src/core/shuffle/engine';
import { characterField, fieldLabel, isFieldKey, parseFieldKey, planFieldWrites } from '../../../src/core/shuffle/fields';
import { detectModel, MODEL_PROFILES } from '../../../src/core/shuffle/models';
import { advanceShuffle, clearCurrent, getShuffle, reapplyHistory } from '../../../src/core/shuffle/state';
import { hasLonePipe, simpleTags } from '../../../src/core/shuffle/tags';
import type { CameraPreset, ShuffleData, ShuffleProfile, ShuffleSettings } from '../../../src/core/shuffle/types';
import type { WorkbenchData } from '../../../src/core/types';
import { fixture } from '../helpers';
import { BASE, character, idFactory, option, pointingSetup, pool, role, template } from './helpers';

const withSettings = (profile: ShuffleProfile, patch: Partial<ShuffleSettings>) => ({ ...profile, settings: { ...profile.settings, ...patch } });
const compose = (shuffle: ShuffleData, profile: ShuffleProfile, selection = profile.current, base = BASE) => composeShuffle({ library: shuffle, profile, selection, base });

describe('prompt composer', () => {
  it('keeps fixed prompts verbatim and maps actor/recipient prompts to the assigned characters', () => {
    const { shuffle, profile, A, B, actor } = pointingSetup();
    for (let step = 0; step < 6; step++) {
      const outcome = shuffleStep(shuffle, { ...profile, cursor: { step, axes: [], recent: [] } });
      const result = compose(shuffle, profile, outcome.selection);
      const actorId = outcome.selection.roleAssignments.find(item => item.roleId === actor.id)!.characterId;
      for (const item of result.characters) {
        const source = item.characterId === A.id ? A : B;
        expect(item.positive.startsWith(source.fixedPrompt)).toBe(true);
        if (item.characterId === actorId) {
          expect(item.positive).toBe(`${source.fixedPrompt}, standing, source#pointing at another`);
        } else {
          expect(item.positive).toBe(`${source.fixedPrompt}, sitting, target#pointing`);
        }
      }
      expect(result.base).toEqual(BASE);
      expect(result.errors).toEqual([]);
    }
  });

  it('composes from the original sources every time: no tag growth on repeated application', () => {
    const { shuffle, profile } = pointingSetup();
    const id = idFactory('g');
    const camera: ShuffleData = { ...shuffle, pools: [pool(id(), 'angle', 'angle', [option(id(), 'from above'), option(id(), 'from below')])] };
    let data: WorkbenchData = { ...fixture(), shuffle: { ...camera, profiles: [withSettings(profile, { targets: { role: true, pose: false, expression: false, camera: true, position: false } })] } };
    const lengths = new Set<number>();
    for (let index = 0; index < 20; index++) {
      const result = advanceShuffle(data, { profileId: profile.id, historyId: id(), now: '2026-11-14T00:00:00.000Z', trigger: 'manual', base: BASE });
      data = result.data;
      expect(result.composed.base.positive.split('2girls').length).toBe(2);
      expect(result.composed.base.positive.match(/from (above|below)/g)).toHaveLength(1);
      lengths.add(result.composed.characters.map(item => item.positive).join('|').length);
      const shuffleState = getShuffle(data);
      const again = compose(shuffleState, shuffleState.profiles[0]!);
      expect(again.base).toEqual(compose(shuffleState, shuffleState.profiles[0]!).base);
    }
    expect(lengths.size).toBeLessThanOrEqual(2);
  });

  it('restores the original composition (no selection) and re-applies history snapshots', () => {
    const { shuffle, profile, A, B } = pointingSetup();
    const variable = { ...shuffle, characters: [{ ...A, variables: [{ category: 'pose' as const, prompt: 'standing' }, { category: 'expression' as const, prompt: 'smiling' }] }, B] };
    const original = compose(variable, profile, null);
    expect(original.characters[0]!.positive).toBe(`${A.fixedPrompt}, standing, smiling`);
    expect(original.characters[1]!.positive).toBe(B.fixedPrompt);
    const advanced = advanceShuffle({ ...fixture(), shuffle: variable }, { profileId: profile.id, historyId: idFactory('h')(), now: '2026-11-14T00:00:00.000Z', trigger: 'manual', base: BASE });
    const state = getShuffle(advanced.data);
    // The pose variable is replaced by the shuffled pose; the expression variable remains.
    const composedA = advanced.composed.characters.find(item => item.characterId === A.id)!.positive;
    expect(composedA).toContain('smiling');
    expect(composedA.match(/standing|sitting/g)).toHaveLength(1);
    const cleared = clearCurrent(state, profile.id);
    expect(compose(cleared, cleared.profiles[0]!)).toMatchObject({ base: original.base, characters: original.characters });
    const reapplied = reapplyHistory(cleared, state.history[0]!.id);
    expect(reapplied.profiles[0]!.current).toEqual(state.profiles[0]!.current);
    expect(state.history[0]!.composed.characters.map(item => item.positive)).toEqual(advanced.composed.characters.map(item => item.positive));
  });

  it('enforces model limits and never assumes undocumented features', () => {
    const id = idFactory('m');
    const people = Array.from({ length: 7 }, (_, index) => character(id(), `C${index}`, { fixedPrompt: 'girl' }));
    const profile: ShuffleProfile = { ...pointingSetup().profile, characterIds: people.map(item => item.id) };
    const shuffle: ShuffleData = { ...pointingSetup().shuffle, characters: people, templates: [] };
    expect(compose(shuffle, withSettings(profile, { model: 'v4' })).errors.join()).toContain('上限（6人）');
    expect(compose(shuffle, withSettings(profile, { model: 'v4.5' })).errors.join()).toContain('上限（6人）');
    expect(compose(shuffle, withSettings(profile, { model: 'unknown' })).errors.join()).toContain('上限（6人）');
    expect(compose(shuffle, withSettings(profile, { model: 'v5' })).errors).toEqual([]);
    expect(compose(shuffle, withSettings(profile, { model: 'v3' })).errors.join()).toContain('V4以降');
    expect(compose(shuffle, withSettings({ ...profile, characterIds: [] }, { model: 'v3' })).errors).toEqual([]);
    expect(MODEL_PROFILES['v4.5'].documentedMaxCharacters).toBeNull();
    expect(MODEL_PROFILES.v5.positionGrid).toBeNull();
    const japanese = { ...shuffle, characters: people.map(item => ({ ...item, fixedPrompt: '少女' })) };
    expect(compose(japanese, withSettings({ ...profile, characterIds: [people[0]!.id] }, { model: 'v4' })).warnings.join()).toContain('非ASCII');
    expect(compose(japanese, withSettings({ ...profile, characterIds: [people[0]!.id] }, { model: 'v5' })).warnings.join()).not.toContain('非ASCII');
    expect(detectModel('NAI Diffusion V4.5 Full')).toBe('v4.5');
    expect(detectModel('NovelAI Diffusion V4 Curated')).toBe('v4');
    expect(detectModel('NovelAI Diffusion V5')).toBe('v5');
    expect(detectModel('Anime V3')).toBe('v3');
    expect(detectModel('something else')).toBe('unknown');
    expect(detectModel(null)).toBe('unknown');
  });

  it('preserves the NovelAI randomizer and refuses unsafe pipe output', () => {
    const { shuffle, profile, A } = pointingSetup();
    const randomized = { ...shuffle, characters: shuffle.characters.map(item => item.id === A.id ? { ...item, fixedPrompt: 'girl, ||red|blue|green|| hair, {{smile}}, 1.2::star::' } : item) };
    const fields = compose(randomized, withSettings(profile, { model: 'v4' }), null);
    expect(fields.characters[0]!.positive).toBe('girl, ||red|blue|green|| hair, {{smile}}, 1.2::star::');
    const pipe = compose(randomized, withSettings(profile, { model: 'v4', outputMode: 'pipe' }), null);
    expect(pipe.errors).toEqual([]);
    expect(pipe.pipe).toBe(`2girls, indoors | girl, ||red|blue|green|| hair, {{smile}}, 1.2::star:: | ${shuffle.characters[1]!.fixedPrompt}`);
    const lone = compose({ ...randomized, characters: randomized.characters.map(item => ({ ...item, fixedPrompt: 'girl | cat' })) }, withSettings(profile, { model: 'v4', outputMode: 'pipe' }), null);
    expect(lone.pipe).toBeNull();
    expect(lone.errors.join()).toContain('単独の|');
    expect(compose(randomized, withSettings(profile, { outputMode: 'pipe' }), null).errors.join()).toContain('使用しません');
    expect(hasLonePipe('||a|b||')).toBe(false);
    expect(hasLonePipe('a | b')).toBe(true);
    expect(hasLonePipe('||a|b')).toBe(true);
    const negative = compose({ ...randomized, characters: randomized.characters.map(item => ({ ...item, negativePrompt: 'bad hands' })) }, withSettings(profile, { model: 'v4', outputMode: 'pipe' }), null);
    expect(negative.warnings.join()).toContain('Undesired Content');
  });

  it('warns about conflicting user tags without deleting them', () => {
    const { shuffle, profile, A, B } = pointingSetup();
    const id = idFactory('w');
    const conflicting = { ...shuffle, templates: [], characters: [{ ...A, fixedPrompt: 'girl, sitting' }, B], pools: [pool(id(), 'pose', 'pose', [option(id(), 'standing'), option(id(), 'sitting')])] };
    const posed = withSettings(profile, { targets: { role: false, pose: true, expression: false, camera: false, position: false }, mode: 'random' });
    let warned = false;
    for (let step = 0; step < 10; step++) {
      const outcome = shuffleStep(conflicting, { ...posed, cursor: { step, axes: [], recent: [] } });
      const result = compose(conflicting, posed, outcome.selection);
      expect(result.characters[0]!.positive.startsWith('girl, sitting')).toBe(true);
      if (result.characters[0]!.positive.endsWith('standing')) { expect(result.warnings.join()).toContain('「sitting」'); warned = true; }
    }
    expect(warned).toBe(true);
    expect(simpleTags('{{a}}, b ,  C  D, 1.2::x::, ||p|q||, !macro:M!')).toEqual(['b', 'c d']);
  });

  it('generates interaction tags, emits camera presets and position hints, and validates templates', () => {
    const id = idFactory('i');
    const A = character(id(), 'A', { fixedPrompt: 'girl' }); const B = character(id(), 'B', { fixedPrompt: 'boy' });
    const hug = template(id(), 'hug', [role(id(), 'hugger', '', { interaction: 'source', side: 'left' }), role(id(), 'hugged', '', { interaction: 'target' })], { action: 'hug', basePrompt: 'embrace' });
    const preset: CameraPreset = { id: id(), name: 'close', parts: [{ category: 'framing', prompt: 'close-up' }, { category: 'gaze', prompt: 'looking at viewer' }], tags: [], requires: [], excludes: [], weight: 1, enabled: true };
    const profile = withSettings({ ...pointingSetup().profile, characterIds: [A.id, B.id] }, { targets: { role: true, pose: false, expression: false, camera: true, position: true }, positionHints: { left: 'on the left', right: '' } });
    const shuffle: ShuffleData = { ...pointingSetup().shuffle, characters: [A, B], templates: [hug], cameraPresets: [preset], profiles: [profile] };
    const outcome = shuffleStep(shuffle, profile);
    const result = compose(shuffle, profile, outcome.selection);
    const hugger = outcome.selection.roleAssignments.find(item => item.roleId === hug.roles[0]!.id)!.characterId;
    expect(result.characters[0]!.characterId).toBe(hugger);
    expect(result.characters[0]!.positive).toMatch(/^(girl|boy), source#hug, looking at viewer, on the left$/);
    expect(result.characters[1]!.positive).toMatch(/^(girl|boy), target#hug, looking at viewer$/);
    expect(result.base.positive).toBe('2girls, indoors, embrace, close-up');
    expect(templateWarnings(template(id(), 'bad', [role(id(), 'a', '', { interaction: 'source' }), role(id(), 'b', '')], { action: 'hug' })).join()).toContain('対で');
    expect(templateWarnings(template(id(), 'mixed', [role(id(), 'a', '', { interaction: 'mutual' }), role(id(), 'b', '', { interaction: 'target' })], { action: 'hug' })).join()).toContain('混在');
    expect(templateWarnings(template(id(), 'raw', [role(id(), 'a', 'source#wave'), role(id(), 'b', 'waving')])).join()).toContain('原文');
    expect(templateWarnings(hug)).toEqual([]);
  });

  it('reports deleted references instead of emitting stale text, and diffs by category', () => {
    const { shuffle, profile } = pointingSetup();
    const outcome = shuffleStep(shuffle, profile);
    const before = compose(shuffle, profile, null);
    const after = compose(shuffle, profile, outcome.selection);
    const differences = diffComposed(before, after);
    expect(differences.map(item => item.label)).toEqual(expect.arrayContaining(['A Prompt', 'B Prompt']));
    const deleted = compose({ ...shuffle, templates: [] }, profile, outcome.selection);
    expect(deleted.warnings.join()).toContain('削除');
    expect(deleted.characters.every(item => !item.positive.includes('#'))).toBe(true);
  });
});

describe('field keys and write plans', () => {
  it('validates field keys and never plans a base Undesired Content write', () => {
    for (const key of ['base:positive', 'base:negative', 'character:1:positive', 'character:22:negative']) expect(isFieldKey(key)).toBe(true);
    for (const key of ['character:0:positive', 'character:23:positive', 'character:01:positive', 'base:other', 'x', 5]) expect(isFieldKey(key)).toBe(false);
    expect(parseFieldKey('character:3:negative')).toEqual({ kind: 'character', index: 3, channel: 'negative' });
    expect(fieldLabel(characterField(2, 'positive'))).toBe('キャラクター2 Prompt');
    const plan = planFieldWrites({ base: { positive: 'p', negative: 'n' }, characters: [
      { characterId: 'a', name: 'A', positive: 'a', negative: null, side: null },
      { characterId: 'b', name: 'B', positive: 'b', negative: 'bad', side: null },
    ] });
    expect(plan).toEqual([
      { field: 'base:positive', text: 'p' },
      { field: 'character:1:positive', text: 'a' },
      { field: 'character:2:positive', text: 'b' },
      { field: 'character:2:negative', text: 'bad' },
    ]);
  });
});
