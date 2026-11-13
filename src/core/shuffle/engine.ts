import { assignmentKey, enumerateAssignments, hasCompleteMatching, sampleAssignment } from './assignment';
import { shuffled, stepRng, type Rng } from './random';
import { pick } from './sampling';
import { categoryVocabulary, lockedCategories } from './tags';
import {
  CAMERA_CATEGORIES, CATEGORY_TARGET, MAX_AVOID_RECENT,
  type AxisState, type CharacterCategory, type CharacterDefinition, type Constrained, type PoolPick, type RoleAssignment,
  type SceneTemplate, type ShuffleCategory, type ShuffleCursor, type ShuffleLibrary, type ShuffleProfile, type ShuffleSelection,
  type Side, type TemplateKind,
} from './types';

/** Assignments are enumerated (and bag-able) only up to this many; beyond it they are sampled. */
export const ASSIGNMENT_ENUMERATION_CAP = 720;
const MAX_ATTEMPTS = 8;

export interface StepOutcome { selection: ShuffleSelection; cursor: ShuffleCursor; warnings: string[] }

export function emptyCursor(): ShuffleCursor { return { step: 0, axes: [], recent: [] }; }

export function constraintsSatisfied(item: Constrained, context: ReadonlySet<string>): boolean {
  return item.requires.every(tag => context.has(tag)) && !item.excludes.some(tag => context.has(tag));
}

export interface Slot { definition: CharacterDefinition; locked: Set<CharacterCategory>; claimed: Set<CharacterCategory> }
const free = (slot: Slot, category: CharacterCategory) => !slot.locked.has(category) && !slot.claimed.has(category);

export function templateEligibility(template: SceneTemplate, slots: readonly Slot[]): string[][] | null {
  if (!template.roles.length || template.roles.length > slots.length) return null;
  const eligibility = template.roles.map(role => slots
    .filter(slot => (role.allowedCharacterIds === null || role.allowedCharacterIds.includes(slot.definition.id)) && role.categories.every(category => free(slot, category)))
    .map(slot => slot.definition.id));
  return hasCompleteMatching(eligibility) ? eligibility : null;
}

function signatureOf(selection: Omit<ShuffleSelection, 'signature' | 'seed' | 'step'>): string {
  const pairs = (items: RoleAssignment[]) => items.map(item => `${item.roleId}=${item.characterId}`).sort().join(',');
  return [
    `r:${selection.roleTemplateId ?? '-'}[${pairs(selection.roleAssignments)}]`,
    `p:${selection.poseTemplateId ?? '-'}[${pairs(selection.poseAssignments)}]`,
    `c:${selection.cameraPresetId ?? '-'}`,
    `o:${selection.picks.map(item => `${item.poolId}/${item.characterId ?? '*'}=${item.optionId}`).sort().join(',')}`,
    `s:${selection.order.join(',')}`,
  ].join('|');
}

/** One attempt of staged sampling. Never enumerates the Cartesian product of axes. */
function attempt(library: ShuffleLibrary, profile: ShuffleProfile, rng: Rng, axesIn: readonly AxisState[], warnings: string[]) {
  const { settings } = profile;
  const axes = new Map(axesIn.map(axis => [axis.key, axis]));
  const draw = (key: string, universe: string[], eligible: { key: string; weight: number }[], mode = settings.mode) => {
    const result = pick({ axisKey: key, axis: axes.get(key), universe, eligible, mode, avoidRepeat: settings.avoidRepeat, rng });
    if (result.key !== null) axes.set(key, result.axis);
    return result.key;
  };
  const characters = new Map(library.characters.map(item => [item.id, item]));
  const vocabulary = categoryVocabulary(library);
  const slots: Slot[] = [];
  for (const id of profile.characterIds) {
    const definition = characters.get(id);
    if (!definition) { warnings.push(`参加キャラクター ${id} が見つからないため除外しました`); continue; }
    slots.push({ definition, locked: lockedCategories(definition, vocabulary), claimed: new Set() });
  }
  const slotById = new Map(slots.map(slot => [slot.definition.id, slot]));
  const context = new Set<string>();
  const sides = new Map<string, Side>();
  const sceneClaimed = new Set<ShuffleCategory>();
  const picks: PoolPick[] = [];
  const enabled = (category: ShuffleCategory) => settings.targets[CATEGORY_TARGET[category]];

  const templateStage = (kind: TemplateKind): { templateId: string | null; assignments: RoleAssignment[] } => {
    const all = library.templates.filter(item => item.kind === kind && item.enabled);
    if (!all.length) return { templateId: null, assignments: [] };
    const eligibility = new Map<string, string[][]>();
    for (const item of all) {
      if (!constraintsSatisfied(item, context)) continue;
      const result = templateEligibility(item, slots);
      if (result) eligibility.set(item.id, result);
    }
    const label = kind === 'role' ? '役割テンプレート' : 'ポーズセット';
    if (!eligibility.size) { warnings.push(`人数・割当制約・タグ制約を満たす${label}がないため、${label}を適用しませんでした`); return { templateId: null, assignments: [] }; }
    const templateId = draw(`template:${kind}`, all.map(item => item.id), all.filter(item => eligibility.has(item.id)).map(item => ({ key: item.id, weight: item.weight })));
    if (templateId === null) { warnings.push(`有効な重みを持つ${label}がありません`); return { templateId: null, assignments: [] }; }
    const template = all.find(item => item.id === templateId)!;
    const roleIds = template.roles.map(role => role.id);
    const options = eligibility.get(templateId)!;
    let chosen: string[] | null;
    const enumerated = enumerateAssignments(options, ASSIGNMENT_ENUMERATION_CAP);
    if (enumerated) {
      const keys = enumerated.map(item => assignmentKey(roleIds, item));
      // Assignments have no weights; weighted mode draws them uniformly.
      const key = draw(`assign:${templateId}`, keys, keys.map(item => ({ key: item, weight: 1 })), settings.mode === 'weighted' ? 'random' : settings.mode);
      chosen = key === null ? null : enumerated[keys.indexOf(key)]!;
    } else {
      const axisKey = `assign:${templateId}`;
      const last = axes.get(axisKey)?.last ?? null;
      chosen = sampleAssignment(options, rng);
      for (let retry = 0; retry < 4 && chosen && settings.avoidRepeat && assignmentKey(roleIds, chosen) === last; retry++) chosen = sampleAssignment(options, rng);
      if (chosen) axes.set(axisKey, { key: axisKey, fingerprint: 'sampled', used: [], last: assignmentKey(roleIds, chosen) });
    }
    if (!chosen) return { templateId: null, assignments: [] };
    const assignments = template.roles.map((role, index) => ({ roleId: role.id, characterId: chosen[index]! }));
    for (const [index, role] of template.roles.entries()) {
      const slot = slotById.get(chosen[index]!)!;
      for (const category of role.categories) slot.claimed.add(category);
      if (role.side && !sides.has(slot.definition.id)) sides.set(slot.definition.id, role.side);
    }
    for (const tag of template.tags) context.add(tag);
    return { templateId, assignments };
  };

  const characterPools = (categories: readonly CharacterCategory[]) => {
    for (const pool of library.pools) {
      if (!(categories as readonly string[]).includes(pool.category) || !enabled(pool.category)) continue;
      const category = pool.category as CharacterCategory;
      const universe = pool.options.filter(option => option.enabled).map(option => option.id);
      for (const slot of slots) {
        if ((pool.characterIds !== null && !pool.characterIds.includes(slot.definition.id)) || !free(slot, category)) continue;
        const eligible = pool.options.filter(option => option.enabled && constraintsSatisfied(option, context)).map(option => ({ key: option.id, weight: option.weight }));
        const optionId = draw(`pool:${pool.id}:${slot.definition.id}`, universe, eligible);
        if (optionId === null) continue;
        picks.push({ poolId: pool.id, characterId: slot.definition.id, optionId });
        slot.claimed.add(category);
        for (const tag of pool.options.find(option => option.id === optionId)!.tags) context.add(tag);
      }
    }
  };

  const role = settings.targets.role ? templateStage('role') : { templateId: null, assignments: [] };
  const pose = settings.targets.pose ? templateStage('pose') : { templateId: null, assignments: [] };
  characterPools(['action', 'pose', 'expression']);

  let cameraPresetId: string | null = null;
  const cameraCharacterIds: string[] = [];
  if (settings.targets.camera) {
    const presets = library.cameraPresets.filter(item => item.enabled);
    if (presets.length) {
      cameraPresetId = draw('camera-preset', presets.map(item => item.id), presets.filter(item => constraintsSatisfied(item, context)).map(item => ({ key: item.id, weight: item.weight })));
      if (cameraPresetId === null) warnings.push('タグ制約を満たすカメラプリセットがありません');
      const preset = presets.find(item => item.id === cameraPresetId);
      if (preset) {
        for (const part of preset.parts) if ((CAMERA_CATEGORIES as readonly string[]).includes(part.category)) sceneClaimed.add(part.category);
        if (preset.parts.some(part => part.category === 'gaze')) for (const slot of slots) if (free(slot, 'gaze')) { slot.claimed.add('gaze'); cameraCharacterIds.push(slot.definition.id); }
        for (const tag of preset.tags) context.add(tag);
      }
    }
    for (const pool of library.pools) {
      if (!(CAMERA_CATEGORIES as readonly string[]).includes(pool.category) || sceneClaimed.has(pool.category)) continue;
      const optionId = draw(`pool:${pool.id}`, pool.options.filter(option => option.enabled).map(option => option.id), pool.options.filter(option => option.enabled && constraintsSatisfied(option, context)).map(option => ({ key: option.id, weight: option.weight })));
      if (optionId === null) continue;
      picks.push({ poolId: pool.id, characterId: null, optionId });
      sceneClaimed.add(pool.category);
      for (const tag of pool.options.find(option => option.id === optionId)!.tags) context.add(tag);
    }
  }
  characterPools(['gaze']);

  for (const slot of slots) if (!sides.has(slot.definition.id) && slot.definition.side) sides.set(slot.definition.id, slot.definition.side);
  let order = slots.map(slot => slot.definition.id);
  if (settings.targets.position) {
    const rank = (id: string) => sides.get(id) === 'left' ? 0 : sides.get(id) === 'right' ? 2 : 1;
    order = shuffled(order, rng).sort((a, b) => rank(a) - rank(b));
  }
  const core = {
    roleTemplateId: role.templateId, roleAssignments: role.assignments,
    poseTemplateId: pose.templateId, poseAssignments: pose.assignments,
    cameraPresetId, cameraCharacterIds, picks, order,
    sides: order.map(characterId => ({ characterId, side: settings.targets.position ? sides.get(characterId) ?? null : null })),
  };
  return { core, signature: signatureOf(core), axes: [...axes.values()] };
}

/**
 * Advance one shuffle step. Deterministic: the same library, profile settings,
 * seed and cursor always produce the same selection and next cursor.
 */
export function shuffleStep(library: ShuffleLibrary, profile: ShuffleProfile): StepOutcome {
  const { settings, cursor } = profile;
  const warnings: string[] = [];
  if (!Object.values(settings.targets).some(Boolean)) warnings.push('シャッフル対象のカテゴリが選択されていません');
  const recent = settings.avoidRecent > 0 ? new Set(cursor.recent.slice(-Math.min(settings.avoidRecent, MAX_AVOID_RECENT))) : new Set<string>();
  let result: ReturnType<typeof attempt> | null = null;
  let attemptWarnings: string[] = [];
  for (let index = 0; index < MAX_ATTEMPTS; index++) {
    attemptWarnings = [];
    result = attempt(library, profile, stepRng(settings.seed, cursor.step, index), cursor.axes, attemptWarnings);
    if (!recent.has(result.signature)) break;
    if (index === MAX_ATTEMPTS - 1) attemptWarnings.push(`直近${settings.avoidRecent}件と異なる構図を${MAX_ATTEMPTS}回の試行で見つけられなかったため、重複を許可しました`);
  }
  warnings.push(...attemptWarnings);
  const { core, signature, axes } = result!;
  const selection: ShuffleSelection = { seed: settings.seed, step: cursor.step, ...core, signature };
  return {
    selection,
    cursor: { step: cursor.step + 1, axes, recent: [...cursor.recent, signature].slice(-MAX_AVOID_RECENT) },
    warnings: [...new Set(warnings)],
  };
}

/** Recompute the cursor after `steps` steps from scratch (reproduction / verification). */
export function replay(library: ShuffleLibrary, profile: ShuffleProfile, steps: number): StepOutcome[] {
  const outcomes: StepOutcome[] = [];
  let current: ShuffleProfile = { ...profile, cursor: emptyCursor() };
  for (let index = 0; index < steps; index++) {
    const outcome = shuffleStep(library, current);
    outcomes.push(outcome);
    current = { ...current, cursor: outcome.cursor };
  }
  return outcomes;
}
