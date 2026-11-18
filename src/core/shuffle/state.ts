import type { WorkbenchData } from '../types';
import { composeShuffle, snapshotOf, type ComposeResult } from './compose';
import { createDefaultLibrary } from './defaults';
import { emptyCursor, shuffleStep, type StepOutcome } from './engine';
import {
  MAX_HISTORY, SHUFFLE_SCHEMA_VERSION,
  type CameraPreset, type CharacterDefinition, type OptionPool, type PromptOption, type SceneTemplate, type ShuffleCategory,
  type ShuffleData, type ShuffleHistoryEntry, type ShuffleProfile, type ShuffleSettings, type ShuffleTrigger, type TemplateKind,
} from './types';

// Immutable commands over ShuffleData. IDs, seeds and times are passed in as values.

export function emptyShuffle(): ShuffleData {
  return { schemaVersion: SHUFFLE_SCHEMA_VERSION, characters: [], templates: [], pools: [], cameraPresets: [], profiles: [], activeProfileId: null, history: [] };
}
export function getShuffle(data: WorkbenchData): ShuffleData { return data.shuffle ?? emptyShuffle(); }
export function withShuffle(data: WorkbenchData, change: (shuffle: ShuffleData) => ShuffleData): WorkbenchData {
  return { ...data, shuffle: change(getShuffle(data)) };
}

export function defaultSettings(seed: string): ShuffleSettings {
  return {
    enabled: true, targets: { role: true, pose: true, expression: false, camera: false, position: false },
    mode: 'bag', avoidRepeat: true, avoidRecent: 0, seed, model: 'unknown', outputMode: 'fields', autoEvery: null,
    positionHints: { left: '', right: '' },
  };
}
export function createProfile(id: string, name: string, seed: string): ShuffleProfile {
  return { id, name, characterIds: [], settings: defaultSettings(seed), cursor: emptyCursor(), current: null };
}
export function activeProfile(shuffle: ShuffleData): ShuffleProfile | undefined {
  return shuffle.profiles.find(item => item.id === shuffle.activeProfileId);
}
export function addProfile(shuffle: ShuffleData, profile: ShuffleProfile): ShuffleData {
  return { ...shuffle, profiles: [...shuffle.profiles, profile], activeProfileId: profile.id };
}
export function removeProfile(shuffle: ShuffleData, id: string): ShuffleData {
  const profiles = shuffle.profiles.filter(item => item.id !== id);
  return { ...shuffle, profiles, activeProfileId: shuffle.activeProfileId === id ? profiles[0]?.id ?? null : shuffle.activeProfileId, history: shuffle.history.filter(entry => entry.profileId !== id) };
}
export function updateProfile(shuffle: ShuffleData, id: string, change: (profile: ShuffleProfile) => ShuffleProfile): ShuffleData {
  return { ...shuffle, profiles: shuffle.profiles.map(item => item.id === id ? change(item) : item) };
}
/** Settings change. A new seed restarts the reproducible sequence from step 0. */
export function updateSettings(profile: ShuffleProfile, patch: Partial<ShuffleSettings>): ShuffleProfile {
  const settings = { ...profile.settings, ...patch };
  return { ...profile, settings, cursor: patch.seed !== undefined && patch.seed !== profile.settings.seed ? emptyCursor() : profile.cursor };
}
export function resetCursor(profile: ShuffleProfile): ShuffleProfile { return { ...profile, cursor: emptyCursor() }; }

export function createCharacter(id: string, name: string): CharacterDefinition {
  return { id, name, fixedPrompt: '', lockedTags: [], variables: [], negativePrompt: null, allowedCategories: ['action', 'pose', 'expression', 'gaze'], side: null };
}
export function upsert<T extends { id: string }>(items: readonly T[], item: T): T[] {
  return items.some(current => current.id === item.id) ? items.map(current => current.id === item.id ? item : current) : [...items, item];
}
/** Deleting a character also removes every reference to it (participants, role and pool limits). */
export function removeCharacter(shuffle: ShuffleData, id: string): ShuffleData {
  const without = (ids: string[] | null) => ids === null ? null : ids.filter(item => item !== id);
  return {
    ...shuffle,
    characters: shuffle.characters.filter(item => item.id !== id),
    profiles: shuffle.profiles.map(profile => ({ ...profile, characterIds: profile.characterIds.filter(item => item !== id) })),
    templates: shuffle.templates.map(template => ({ ...template, roles: template.roles.map(role => ({ ...role, allowedCharacterIds: without(role.allowedCharacterIds) })) })),
    pools: shuffle.pools.map(pool => ({ ...pool, characterIds: without(pool.characterIds) })),
  };
}

export function createTemplate(kind: TemplateKind, id: string, name: string, roleIds: [string, string]): SceneTemplate {
  const role = (roleId: string, roleName: string) => ({ id: roleId, name: roleName, prompt: '', categories: kind === 'pose' ? ['pose' as const] : ['action' as const], interaction: null, side: null, allowedCharacterIds: null });
  return { id, name, kind, action: '', basePrompt: '', roles: [role(roleIds[0], kind === 'pose' ? 'A' : '行動する側'), role(roleIds[1], kind === 'pose' ? 'B' : '行動される側')], tags: [], requires: [], excludes: [], weight: 1, enabled: true };
}
export function createPool(id: string, name: string, category: ShuffleCategory): OptionPool { return { id, name, category, characterIds: null, options: [] }; }
export function createOption(id: string, prompt: string): PromptOption { return { id, prompt, tags: [], requires: [], excludes: [], weight: 1, enabled: true }; }
export function createCameraPreset(id: string, name: string): CameraPreset { return { id, name, parts: [], tags: [], requires: [], excludes: [], weight: 1, enabled: true }; }
export function removeById<T extends { id: string }>(items: readonly T[], id: string): T[] { return items.filter(item => item.id !== id); }

export function addDefaultLibrary(shuffle: ShuffleData, id: () => string): ShuffleData {
  const defaults = createDefaultLibrary(id);
  return { ...shuffle, templates: [...shuffle.templates, ...defaults.templates], pools: [...shuffle.pools, ...defaults.pools], cameraPresets: [...shuffle.cameraPresets, ...defaults.cameraPresets] };
}

export function composeCurrent(shuffle: ShuffleData, profile: ShuffleProfile, base: { positive: string; negative: string }, selection = profile.current): ComposeResult {
  return composeShuffle({ library: shuffle, profile, selection, base });
}
export function peekNext(shuffle: ShuffleData, profile: ShuffleProfile): StepOutcome { return shuffleStep(shuffle, profile); }

export interface AdvanceArgs { profileId: string; historyId: string; now: string; trigger: ShuffleTrigger; base: { positive: string; negative: string } }
/** Shuffle Now: advance the cursor, make the result current and record it in history. */
export function advanceShuffle(data: WorkbenchData, args: AdvanceArgs): { data: WorkbenchData; outcome: StepOutcome; composed: ComposeResult } {
  const shuffle = getShuffle(data);
  const profile = shuffle.profiles.find(item => item.id === args.profileId);
  if (!profile) throw new Error('シャッフルプロファイルが存在しません');
  if (!profile.settings.enabled) throw new Error('シャッフルが無効です');
  const outcome = shuffleStep(shuffle, profile);
  const composed = composeShuffle({ library: shuffle, profile, selection: outcome.selection, base: args.base });
  const entry: ShuffleHistoryEntry = { id: args.historyId, profileId: profile.id, createdAt: args.now, trigger: args.trigger, selection: outcome.selection, composed: snapshotOf(composed) };
  const next: ShuffleData = {
    ...updateProfile(shuffle, profile.id, current => ({ ...current, cursor: outcome.cursor, current: outcome.selection })),
    history: [entry, ...shuffle.history].slice(0, MAX_HISTORY),
  };
  return { data: { ...data, shuffle: next }, outcome, composed };
}

/** Make a past selection current again. The cursor (future sequence) is unchanged. */
export function reapplyHistory(shuffle: ShuffleData, entryId: string): ShuffleData {
  const entry = shuffle.history.find(item => item.id === entryId);
  if (!entry) throw new Error('履歴が存在しません');
  if (!shuffle.profiles.some(item => item.id === entry.profileId)) throw new Error('履歴のプロファイルが削除されています');
  return { ...updateProfile(shuffle, entry.profileId, profile => ({ ...profile, current: entry.selection })), activeProfileId: entry.profileId };
}
export function clearCurrent(shuffle: ShuffleData, profileId: string): ShuffleData {
  return updateProfile(shuffle, profileId, profile => ({ ...profile, current: null }));
}
