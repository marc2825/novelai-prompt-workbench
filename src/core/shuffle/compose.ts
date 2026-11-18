import { appendFragment } from '../compose';
import { MODEL_PROFILES } from './models';
import { categoryVocabulary, hasLonePipe, simpleTags } from './tags';
import {
  CAMERA_CATEGORIES, CHARACTER_CATEGORIES,
  type CharacterCategory, type ComposedCharacter, type ComposedSnapshot, type SceneTemplate, type ShuffleCategory,
  type ShuffleLibrary, type ShuffleProfile, type ShuffleSelection,
} from './types';

export interface ComposeInput {
  library: ShuffleLibrary;
  profile: Pick<ShuffleProfile, 'characterIds' | 'settings'>;
  /** null = no shuffle applied: the original composition. */
  selection: ShuffleSelection | null;
  /** Compiled workspace output (the user's own base prompt). Never modified. */
  base: { positive: string; negative: string };
}
export interface ComposeResult extends ComposedSnapshot {
  /** Single-string pipe syntax; only in pipe mode and only when it is safe. */
  pipe: string | null;
  warnings: string[];
  /** Blocking problems. A result with errors must not be applied to the site. */
  errors: string[];
  notes: string[];
}

export const CATEGORY_LABELS: Record<ShuffleCategory, string> = {
  action: '行動', pose: 'ポーズ', expression: '表情', gaze: '視線', angle: 'アングル', framing: 'フレーミング', view: '視点',
};

const join = (fragments: readonly string[]) => fragments.reduce(appendFragment, '');

/** Template structure warnings: roles and interaction tags must correspond. */
export function templateWarnings(template: SceneTemplate): string[] {
  const warnings: string[] = [];
  if (!template.roles.length) warnings.push(`「${template.name}」に役割がありません`);
  const marks = template.roles.map(role => role.interaction);
  const has = (mark: string) => marks.includes(mark as never);
  if (template.action.trim()) {
    if (!marks.some(Boolean)) warnings.push(`「${template.name}」: 行動「${template.action}」が設定されていますが、source/target/mutualの役割がありません`);
    if (has('source') !== has('target')) warnings.push(`「${template.name}」: source#とtarget#は対で設定してください`);
    if (has('mutual') && (has('source') || has('target'))) warnings.push(`「${template.name}」: mutual#とsource#/target#が混在しています`);
  }
  const raw = template.roles.map(role => role.prompt.toLowerCase());
  const rawSource = raw.some(prompt => prompt.includes('source#'));
  const rawTarget = raw.some(prompt => prompt.includes('target#'));
  if ((rawSource || has('source')) !== (rawTarget || has('target'))) warnings.push(`「${template.name}」: 原文のsource#/target#の対応が取れていません`);
  return [...new Set(warnings)];
}

/**
 * Compose NovelAI prompt text from the original sources every time. The user's
 * base prompt and each fixed prompt are emitted verbatim; shuffle values only fill
 * categories, so composing twice never grows the text.
 */
export function composeShuffle(input: ComposeInput): ComposeResult {
  const { library, profile, selection, base } = input;
  const { settings } = profile;
  const warnings: string[] = [];
  const errors: string[] = [];
  const model = MODEL_PROFILES[settings.model];
  const notes = [...model.notes];
  const characters = new Map(library.characters.map(item => [item.id, item]));
  const templates = new Map(library.templates.map(item => [item.id, item]));
  const pools = new Map(library.pools.map(item => [item.id, item]));
  const vocabulary = categoryVocabulary(library);

  const participants = profile.characterIds.filter(id => {
    if (characters.has(id)) return true;
    warnings.push(`参加キャラクター ${id} が見つからないため出力しません`);
    return false;
  });
  const order = selection ? [...selection.order.filter(id => participants.includes(id)), ...participants.filter(id => !selection.order.includes(id))] : participants;
  const sides = new Map((selection?.sides ?? []).map(item => [item.characterId, item.side]));
  const cameraPreset = selection?.cameraPresetId ? library.cameraPresets.find(item => item.id === selection.cameraPresetId) : undefined;
  if (selection?.cameraPresetId && !cameraPreset) warnings.push('選択済みのカメラプリセットが削除されています');

  // Fragments per character, keyed by claimed categories.
  const shuffled = new Map<string, { prompt: string; categories: CharacterCategory[] }[]>();
  const add = (characterId: string, prompt: string, categories: CharacterCategory[]) => {
    const list = shuffled.get(characterId) ?? [];
    list.push({ prompt, categories });
    shuffled.set(characterId, list);
  };
  const applyTemplate = (templateId: string | null | undefined, assignments: ShuffleSelection['roleAssignments']) => {
    if (!templateId) return '';
    const template = templates.get(templateId);
    if (!template) { warnings.push('選択済みのテンプレートが削除されています。再シャッフルしてください'); return ''; }
    warnings.push(...templateWarnings(template));
    for (const assignment of assignments) {
      const role = template.roles.find(item => item.id === assignment.roleId);
      if (!role) { warnings.push(`「${template.name}」の役割が削除されています`); continue; }
      if (!participants.includes(assignment.characterId)) continue;
      const interaction = template.action.trim() && role.interaction ? `${role.interaction}#${template.action.trim()}` : '';
      add(assignment.characterId, join([role.prompt, interaction]), role.categories);
    }
    return template.basePrompt;
  };
  const roleBase = applyTemplate(selection?.roleTemplateId, selection?.roleAssignments ?? []);
  const poseBase = applyTemplate(selection?.poseTemplateId, selection?.poseAssignments ?? []);
  const cameraParts: { category: ShuffleCategory; prompt: string }[] = [];
  for (const part of cameraPreset?.parts ?? []) if ((CAMERA_CATEGORIES as readonly string[]).includes(part.category)) cameraParts.push(part);
  for (const characterId of selection?.cameraCharacterIds ?? []) for (const part of cameraPreset?.parts ?? []) if (part.category === 'gaze') add(characterId, part.prompt, ['gaze']);
  for (const item of selection?.picks ?? []) {
    const pool = pools.get(item.poolId);
    const option = pool?.options.find(candidate => candidate.id === item.optionId);
    if (!pool || !option) { warnings.push('選択済みの候補が削除されています。再シャッフルしてください'); continue; }
    if (item.characterId === null) cameraParts.push({ category: pool.category, prompt: option.prompt });
    else if (participants.includes(item.characterId)) add(item.characterId, option.prompt, [pool.category as CharacterCategory]);
  }
  cameraParts.sort((a, b) => SCENE_ORDER.indexOf(a.category) - SCENE_ORDER.indexOf(b.category));

  const composedCharacters: ComposedCharacter[] = order.map(id => {
    const character = characters.get(id)!;
    const fragments = shuffled.get(id) ?? [];
    const claimed = new Set(fragments.flatMap(fragment => fragment.categories));
    for (const category of claimed) if (!character.allowedCategories.includes(category)) warnings.push(`「${character.name}」の${CATEGORY_LABELS[category]}は変更不可に設定されています。再シャッフルしてください`);
    const fixedTags = new Set(simpleTags(character.fixedPrompt));
    const locked = character.lockedTags.filter(tag => tag.trim() && !fixedTags.has(tag.trim().replace(/\s+/g, ' ').toLowerCase()));
    const defaults = character.variables.filter(part => !claimed.has(part.category as CharacterCategory));
    const side = sides.get(id) ?? null;
    const hint = settings.targets.position && side ? settings.positionHints[side] : '';
    // Conflict warnings: user text is never deleted, only reported.
    const userTags = [...fixedTags, ...character.lockedTags.flatMap(simpleTags), ...defaults.flatMap(part => simpleTags(part.prompt))];
    for (const category of claimed) {
      const words = vocabulary.get(category);
      if (!words) continue;
      const own = new Set(fragments.filter(fragment => fragment.categories.includes(category)).flatMap(fragment => simpleTags(fragment.prompt)));
      for (const tag of userTags) if (words.has(tag) && !own.has(tag)) warnings.push(`「${character.name}」のユーザー記述「${tag}」は${CATEGORY_LABELS[category]}の候補と重なり、シャッフル値と矛盾する可能性があります（ユーザーのタグは削除しません）`);
    }
    return {
      characterId: id, name: character.name, side,
      positive: join([character.fixedPrompt, ...locked, ...fragments.map(fragment => fragment.prompt), ...defaults.map(part => part.prompt), hint]),
      negative: character.negativePrompt,
    };
  });

  const baseTags = simpleTags(base.positive);
  for (const part of cameraParts) {
    const words = vocabulary.get(part.category);
    const own = new Set(simpleTags(part.prompt));
    for (const tag of baseTags) if (words?.has(tag) && !own.has(tag)) warnings.push(`ベースプロンプトの「${tag}」は${CATEGORY_LABELS[part.category]}の候補と重なり、シャッフル値と矛盾する可能性があります（削除しません）`);
  }
  const composedBase = { positive: join([base.positive, roleBase, poseBase, ...cameraParts.map(part => part.prompt)]), negative: base.negative };

  if (composedCharacters.length && !model.characterPrompts) errors.push(`${model.label}ではキャラクタープロンプトを使用できません（V4以降の機能）`);
  if (composedCharacters.length > model.enforcedMaxCharacters && model.characterPrompts) errors.push(`${model.label}のキャラクター上限（${model.enforcedMaxCharacters}人）を超えています: ${composedCharacters.length}人`);
  const texts = [composedBase.positive, ...composedCharacters.flatMap(item => [item.positive, item.negative ?? ''])];
  if (model.asciiOnly && texts.some(text => /[^\x00-\x7F]/.test(text))) warnings.push(`${model.label}はT5トークナイザのため、日本語・絵文字など多くの非ASCII文字は非対応です（公式）`);

  let pipe: string | null = null;
  if (settings.outputMode === 'pipe') {
    if (!model.pipeSyntax) errors.push(`${model.label}では|区切りの複数キャラクター構文を使用しません。モデルを選択するか、キャラクター欄モードを使用してください`);
    else if ([composedBase.positive, ...composedCharacters.map(item => item.positive)].some(hasLonePipe)) errors.push('ランダマイザー（||…||）の外に単独の|があるため、|区切り構文を安全に作成できません');
    else {
      pipe = [composedBase.positive, ...composedCharacters.map(item => item.positive)].join(' | ');
      notes.push('|構文はNovelAIでキャラクター欄が1つでもあると無効になります（公式）。キャラクター欄を使わない場合だけ貼り付けてください。サイトへの自動反映は行いません。');
      if (composedCharacters.some(item => item.negative?.trim())) warnings.push('キャラクター別Undesired Contentは|構文に含められないため出力していません');
    }
  } else if (composedCharacters.length && hasLonePipe(base.positive)) {
    warnings.push('ベースプロンプトに単独の|があります。キャラクター欄がある場合、NovelAIは|構文を無効にします（公式）');
  }
  return { base: composedBase, characters: composedCharacters, pipe, warnings: [...new Set(warnings)], errors, notes };
}
const SCENE_ORDER: ShuffleCategory[] = [...CAMERA_CATEGORIES, ...CHARACTER_CATEGORIES];

export interface CategoryDifference { label: string; before: string; after: string }
/** Category-level difference between two compositions, for previews. */
export function diffComposed(before: ComposedSnapshot, after: ComposedSnapshot): CategoryDifference[] {
  const differences: CategoryDifference[] = [];
  if (before.base.positive !== after.base.positive) differences.push({ label: 'ベース Prompt', before: before.base.positive, after: after.base.positive });
  const ids = [...new Set([...before.characters, ...after.characters].map(item => item.characterId))];
  for (const id of ids) {
    const a = before.characters.find(item => item.characterId === id);
    const b = after.characters.find(item => item.characterId === id);
    const name = (b ?? a)!.name;
    if (a?.positive !== b?.positive) differences.push({ label: `${name} Prompt`, before: a?.positive ?? '（なし）', after: b?.positive ?? '（なし）' });
    const position = (list: ComposedSnapshot['characters'], item?: ComposedCharacter) => item ? `${list.indexOf(item) + 1}番目${item.side ? ` / ${item.side === 'left' ? '左' : '右'}` : ''}` : '（なし）';
    if (position(before.characters, a) !== position(after.characters, b)) differences.push({ label: `${name} 順序`, before: position(before.characters, a), after: position(after.characters, b) });
  }
  return differences;
}

export function snapshotOf(result: ComposedSnapshot): ComposedSnapshot {
  return { base: { ...result.base }, characters: result.characters.map(item => ({ ...item })) };
}

/** Human-readable summary of a selection (role → character, picks, camera, order). */
export function describeSelection(library: ShuffleLibrary, selection: ShuffleSelection | null): string[] {
  if (!selection) return ['シャッフルなし（元の構成）'];
  const names = new Map(library.characters.map(item => [item.id, item.name]));
  const name = (id: string) => names.get(id) ?? '（削除済み）';
  const lines: string[] = [];
  for (const [label, templateId, assignments] of [['役割', selection.roleTemplateId, selection.roleAssignments], ['ポーズセット', selection.poseTemplateId, selection.poseAssignments]] as const) {
    if (!templateId) continue;
    const template = library.templates.find(item => item.id === templateId);
    if (!template) { lines.push(`${label}: （削除済みテンプレート）`); continue; }
    lines.push(`${label}: ${template.name} — ${assignments.map(item => `${template.roles.find(role => role.id === item.roleId)?.name ?? '?'}=${name(item.characterId)}`).join(', ')}`);
  }
  const byPool = new Map<string, string[]>();
  for (const item of selection.picks) {
    const pool = library.pools.find(candidate => candidate.id === item.poolId);
    const option = pool?.options.find(candidate => candidate.id === item.optionId);
    if (!pool || !option) continue;
    const key = `${CATEGORY_LABELS[pool.category]}（${pool.name}）`;
    byPool.set(key, [...byPool.get(key) ?? [], item.characterId ? `${name(item.characterId)}=${option.prompt}` : option.prompt]);
  }
  for (const [key, values] of byPool) lines.push(`${key}: ${values.join(', ')}`);
  if (selection.cameraPresetId) lines.push(`カメラ: ${library.cameraPresets.find(item => item.id === selection.cameraPresetId)?.name ?? '（削除済み）'}`);
  const sides = new Map(selection.sides.map(item => [item.characterId, item.side]));
  if (selection.order.length) lines.push(`順序: ${selection.order.map(id => `${name(id)}${sides.get(id) ? `（${sides.get(id) === 'left' ? '左' : '右'}）` : ''}`).join(' → ')}`);
  return lines;
}
