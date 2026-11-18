import { createCharacter, createProfile, emptyShuffle } from '../../../src/core/shuffle/state';
import type { CharacterDefinition, OptionPool, PromptOption, RoleDefinition, SceneTemplate, ShuffleCategory, ShuffleData, ShuffleProfile } from '../../../src/core/shuffle/types';

export function idFactory(prefix = 'a') {
  let counter = 0;
  const hex = prefix.charCodeAt(0).toString(16).padStart(4, '0');
  return () => `00000000-${hex}-4000-8000-${String(++counter).padStart(12, '0')}`;
}

export function character(id: string, name: string, patch: Partial<CharacterDefinition> = {}): CharacterDefinition {
  return { ...createCharacter(id, name), ...patch };
}
export function role(id: string, name: string, prompt: string, patch: Partial<RoleDefinition> = {}): RoleDefinition {
  return { id, name, prompt, categories: ['action'], interaction: null, side: null, allowedCharacterIds: null, ...patch };
}
export function template(id: string, name: string, roles: RoleDefinition[], patch: Partial<SceneTemplate> = {}): SceneTemplate {
  return { id, name, kind: 'role', action: '', basePrompt: '', roles, tags: [], requires: [], excludes: [], weight: 1, enabled: true, ...patch };
}
export function option(id: string, prompt: string, patch: Partial<PromptOption> = {}): PromptOption {
  return { id, prompt, tags: [], requires: [], excludes: [], weight: 1, enabled: true, ...patch };
}
export function pool(id: string, name: string, category: ShuffleCategory, options: PromptOption[], patch: Partial<OptionPool> = {}): OptionPool {
  return { id, name, category, characterIds: null, options, ...patch };
}

/** Two characters A/B and the "Pointing" template from the requirements. */
export function pointingSetup() {
  const id = idFactory('p');
  const A = character(id(), 'A', { fixedPrompt: 'girl, blonde hair, blue eyes, white dress' });
  const B = character(id(), 'B', { fixedPrompt: 'girl, black hair, red jacket' });
  const actor = role(id(), 'actor', 'standing, source#pointing at another', { categories: ['action', 'pose'] });
  const recipient = role(id(), 'recipient', 'sitting, target#pointing', { categories: ['action', 'pose'] });
  const pointing = template(id(), 'Pointing', [actor, recipient]);
  const profile: ShuffleProfile = { ...createProfile(id(), 'P', 'seed-1'), characterIds: [A.id, B.id] };
  const shuffle: ShuffleData = { ...emptyShuffle(), characters: [A, B], templates: [pointing], profiles: [profile], activeProfileId: profile.id };
  return { id, A, B, actor, recipient, pointing, profile, shuffle };
}

export const BASE = { positive: '2girls, indoors', negative: 'lowres' };
