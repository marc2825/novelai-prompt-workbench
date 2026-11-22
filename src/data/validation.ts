import { validateLab } from './lab';
import type { BackupDocument, PromptSpan, WorkbenchData } from '../core/types';
import { compileWorkspace } from '../core/compose';
import { assertCommentSpans } from '../core/comments';
import { normalizeShuffle, validateRecoveries } from './shuffle';
import { normalizeTag, TAG_DICTIONARY_SCHEMA_VERSION, TAG_LIMITS, tagTextIssue } from '../core/tags';

export const FORMAT = 'nai-prompt-workbench';
export const SCHEMA_VERSION = 3;
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_RECORDS = 10_000;
export const MAX_DEPTH = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ValidationError extends Error {}

// Objects returned by validateData. The code base treats data as immutable, so an
// object in this set is still valid and the save path need not validate it again.
// Dev/E2E builds deep-freeze it, turning any accidental mutation into an error.
const validated = new WeakSet<object>();
const FREEZE_VALIDATED = typeof window !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
export function isValidated(value: unknown): value is WorkbenchData { return typeof value === 'object' && value !== null && validated.has(value); }
function deepFreeze(root: object) {
  const stack: object[] = [root];
  while (stack.length) {
    const value = stack.pop()!;
    if (Object.isFrozen(value)) continue;
    Object.freeze(value);
    for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child as object);
  }
}
function fail(path: string, reason: string): never { throw new ValidationError(`${path}: ${reason}`); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'オブジェクトが必要です');
  return value as Record<string, unknown>;
}
function string(value: unknown, path: string, max = 1_000_000): asserts value is string {
  if (typeof value !== 'string' || value.length > max) fail(path, `文字列が必要です（最大${max}文字）`);
}
function title(value: unknown, path: string) {
  string(value, path, 200);
  if (!value.trim()) fail(path, '空の名前は使用できません');
}
function id(value: unknown, path: string) {
  if (typeof value !== 'string' || !UUID.test(value)) fail(path, 'UUIDが必要です');
}
function date(value: unknown, path: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) fail(path, 'ISO 8601日時が必要です');
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) fail(path, '存在しない日時です');
}
function boolean(value: unknown, path: string) { if (typeof value !== 'boolean') fail(path, '真偽値が必要です'); }
function oneOf(value: unknown, values: string[], path: string) { if (typeof value !== 'string' || !values.includes(value)) fail(path, `${values.join(' / ')} のいずれかが必要です`); }
function array(value: unknown, path: string, max = MAX_RECORDS): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path, `配列が必要です（最大${max}件）`);
  return value;
}

// Iterative traversal also checks unknown fields. No property assignment or execution.
export function validateSafeJson(value: unknown) {
  const queue: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }];
  const ancestors = new WeakSet<object>();
  let nodes = 1;
  while (queue.length) {
    const node = queue.pop()!;
    if (node.exit) { ancestors.delete(node.value as object); continue; }
    if (node.depth > MAX_DEPTH) fail('JSON', '深さの上限を超えています');
    if (node.value === null || typeof node.value === 'string' || typeof node.value === 'boolean') continue;
    if (typeof node.value === 'number' && Number.isFinite(node.value)) continue;
    if (typeof node.value !== 'object' || !node.value) fail('JSON', 'JSONで表現できない値です');
    if (ancestors.has(node.value)) fail('JSON', '循環参照は保存・取込できません');
    ancestors.add(node.value);
    queue.push({ ...node, exit: true });
    if (Array.isArray(node.value) && node.value.length > MAX_RECORDS) fail('JSON', `配列の要素数は${MAX_RECORDS}件までです`);
    if (!Array.isArray(node.value) && ![Object.prototype, null].includes(Object.getPrototypeOf(node.value) as object | null)) fail('JSON', '通常のオブジェクトが必要です');
    for (const [key, child] of Object.entries(node.value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('JSON', '危険なプロパティ名です');
      if (++nodes > 400_000) fail('JSON', '要素数の上限を超えています');
      queue.push({ value: child, depth: node.depth + 1 });
    }
  }
}

export function validateData(input: unknown): WorkbenchData {
  validateSafeJson(input);
  const data = object(input, 'payload');
  const entries = array(data.libraryEntries, 'libraryEntries');
  const categories = array(data.categories ?? [], 'categories');
  const workspaces = array(data.workspaces, 'workspaces');
  const presets = array(data.presets ?? [], 'presets');
  const experiments = array(data.experiments ?? [], 'experiments');
  const images = array(data.images ?? [], 'images');
  let count = 0;
  const allIds = new Set<string>();
  const register = (value: unknown, path: string, scope = allIds) => {
    id(value, path);
    if (scope.has(value as string)) fail(path, '重複IDです');
    scope.add(value as string);
    if (++count > MAX_RECORDS) fail('payload', `レコード総数は${MAX_RECORDS}件までです`);
  };
  const comments = (value: unknown, raw: unknown, path: string, scope = allIds) => {
    if (value === undefined) return;
    const spans = array(value, path);
    for (const item of spans) {
      const span = object(item, path);
      register(span.id, `${path}.id`, scope);
      string(span.text, `${path}.text`);
      boolean(span.enabled, `${path}.enabled`);
    }
    assertCommentSpans(raw as string, spans as PromptSpan[]);
  };
  for (const [i, item] of entries.entries()) {
    const path = `libraryEntries[${i}]`;
    const entry = object(item, path);
    register(entry.id, `${path}.id`);
    title(entry.title, `${path}.title`);
    string(entry.raw, `${path}.raw`);
    string(entry.description, `${path}.description`, 10_000);
    oneOf(entry.defaultChannel, ['positive', 'negative'], `${path}.defaultChannel`);
    if (entry.categoryId !== null) id(entry.categoryId, `${path}.categoryId`);
    array(entry.tags, `${path}.tags`, 100).forEach(tag => string(tag, `${path}.tags`, 100));
    array(entry.previewImageIds, `${path}.previewImageIds`, 100).forEach(imageId => id(imageId, `${path}.previewImageIds`));
    date(entry.createdAt, `${path}.createdAt`);
    date(entry.updatedAt, `${path}.updatedAt`);
  }
  const categoryIds = new Set<unknown>();
  for (const item of categories) {
    const category = object(item, 'category');
    register(category.id, 'category.id');
    categoryIds.add(category.id);
    title(category.name, 'category.name');
  }
  for (const entry of entries) {
    const categoryId = object(entry, 'entry').categoryId;
    if (categoryId !== null && !categoryIds.has(categoryId)) fail('entry.categoryId', 'カテゴリが存在しません');
  }
  const workspaceIds = new Set<unknown>();
  const validateWorkspace = (item: unknown, path: string, scope: Set<string>, snapshot = false) => {
    const workspace = object(item, path);
    register(workspace.id, `${path}.id`, scope);
    if (snapshot && workspace.appliedPresetId !== undefined) fail(path, 'スナップショットからプリセットへの参照は循環の原因になるため禁止です');
    if (workspace.appliedPresetId !== undefined) id(workspace.appliedPresetId, `${path}.appliedPresetId`);
    title(workspace.title, `${path}.title`);
    date(workspace.updatedAt, `${path}.updatedAt`);
    string(workspace.freeformPositive, `${path}.freeformPositive`);
    string(workspace.freeformNegative, `${path}.freeformNegative`);
    comments(workspace.freeformPositiveSpans, workspace.freeformPositive, `${path}.freeformPositiveSpans`, scope);
    comments(workspace.freeformNegativeSpans, workspace.freeformNegative, `${path}.freeformNegativeSpans`, scope);
    for (const item of array(workspace.groups, `${path}.groups`)) {
      const group = object(item, 'group');
      register(group.id, `${path}.group.id`, scope);
      title(group.name, 'group.name');
      oneOf(group.channel, ['positive', 'negative'], 'group.channel');
      oneOf(group.mode, ['multi', 'exclusive'], 'group.mode');
      boolean(group.enabled, 'group.enabled');
      const members = array(group.members, 'group.members');
      const memberIds = new Set<unknown>();
      for (const item of members) {
        const member = object(item, 'member');
        register(member.id, `${path}.member.id`, scope);
        memberIds.add(member.id);
        id(member.entryId, 'member.entryId');
        boolean(member.enabled, 'member.enabled');
        string(member.rawSnapshot, 'member.rawSnapshot');
        if (member.overrideRaw !== undefined) string(member.overrideRaw, 'member.overrideRaw');
        comments(member.overrideSpans, member.overrideRaw ?? member.rawSnapshot, 'member.overrideSpans', scope);
        // A removed library entry is valid: the complete snapshot is authoritative.
      }
      if (group.selectedMemberId !== null && !memberIds.has(group.selectedMemberId)) fail('group.selectedMemberId', '選択先の部品が存在しません');
    }
  };
  for (const [i, item] of workspaces.entries()) {
    validateWorkspace(item, `workspaces[${i}]`, allIds);
    workspaceIds.add(object(item, 'workspace').id);
  }
  const presetIds = new Set<unknown>();
  for (const [index, item] of presets.entries()) {
    const path = `presets[${index}]`;
    const preset = object(item, path);
    register(preset.id, `${path}.id`);
    presetIds.add(preset.id);
    title(preset.name, `${path}.name`);
    id(preset.sourceWorkspaceId, `${path}.sourceWorkspaceId`);
    date(preset.createdAt, `${path}.createdAt`);
    date(preset.updatedAt, `${path}.updatedAt`);
    const snapshot = object(preset.workspaceSnapshot, `${path}.workspaceSnapshot`);
    if (snapshot.id !== preset.sourceWorkspaceId) fail(path, '作成元IDとスナップショットIDが一致しません');
    // Snapshot IDs live in their own scope and deliberately reproduce the source.
    validateWorkspace(snapshot, `${path}.workspaceSnapshot`, new Set(), true);
  }
  for (const item of workspaces) {
    const binding = object(item, 'workspace').appliedPresetId;
    if (binding !== undefined && !presetIds.has(binding)) fail('workspace.appliedPresetId', '適用元プリセットが存在しません');
  }
  const imageIds = new Set<unknown>(); const hashes = new Set<unknown>();
  for (const item of images) {
    const image = object(item, 'image'); register(image.id, 'image.id'); imageIds.add(image.id);
    if (typeof image.hash !== 'string' || !/^[0-9a-f]{64}$/.test(image.hash) || hashes.has(image.hash)) fail('image.hash', '不正または重複ハッシュです');
    hashes.add(image.hash); title(image.name, 'image.name'); oneOf(image.mime, ['image/png'], 'image.mime'); date(image.createdAt, 'image.createdAt');
    for (const key of ['width', 'height']) integer(image[key], `image.${key}`, 1, 8192);
    if ((image.width as number) * (image.height as number) > 16_777_216) fail('image', '画素数上限を超えています');
    integer(image.byteLength, 'image.byteLength', 1, 20 * 1024 * 1024); integer(image.thumbnailBytes, 'image.thumbnailBytes', 1, 1024 * 1024);
    const meta = object(image.metadata, 'image.metadata');
    if (meta.promptEvidence !== undefined) oneOf(meta.promptEvidence, ['unknown', 'manual', 'png-metadata'], 'metadata.promptEvidence');
    for (const key of ['positive', 'negative']) if (meta[key] !== null) string(meta[key], `metadata.${key}`, 100_000);
    validateGenerationSettings(meta.settings);
    const texts = object(meta.texts, 'metadata.texts');
    if (Object.keys(texts).length > 128 || JSON.stringify(texts).length > 524_288) fail('metadata.texts', '大きすぎるメタデータです');
    for (const [key, value] of Object.entries(texts)) { string(key, 'metadata.key', 79); string(value, 'metadata.value', 262_144); }
    array(meta.warnings, 'metadata.warnings', 128).forEach(value => string(value, 'metadata.warning', 1000));
  }
  for (const item of experiments) {
    const experiment = object(item, 'experiment'); register(experiment.id, 'experiment.id'); title(experiment.name, 'experiment.name');
    date(experiment.createdAt, 'experiment.createdAt'); date(experiment.updatedAt, 'experiment.updatedAt');
    for (const [key, label] of [['variantA', 'A'], ['variantB', 'B']] as const) {
      const variant = object(experiment[key], key); register(variant.id, `${key}.id`);
      if (variant.label !== label) fail(key, 'A/Bラベルが不正です');
      if (variant.presetId !== null) id(variant.presetId, `${key}.presetId`);
      if (variant.imageId !== null && !imageIds.has(variant.imageId)) fail(key, '画像参照が存在しません');
      validateGenerationSettings(variant.settings);
      validateWorkspace(variant.workspaceSnapshot, `${key}.workspaceSnapshot`, new Set(), true);
      const compiled = object(variant.compiled, `${key}.compiled`);
      string(compiled.positive, 'compiled.positive'); string(compiled.negative, 'compiled.negative');
      const expected = compileWorkspace(variant.workspaceSnapshot as unknown as import('../core/types').PromptWorkspace);
      if (compiled.positive !== expected.positive || compiled.negative !== expected.negative) fail(key, '固定プロンプトとスナップショットが一致しません');
    }
  }
  if (data.lab !== undefined) validateLab(data.lab, imageIds);
  // Dictionary IDs share the global ID scope (no collisions with any asset) but have
  // their own entry limit, so a large dictionary does not crowd out the library.
  if (data.tagDictionary !== undefined) validateTagDictionary(data.tagDictionary, (value, path) => {
    id(value, path);
    if (allIds.has(value as string)) fail(path, '重複IDです');
    allIds.add(value as string);
  });
  const settings = object(data.settings ?? { activeWorkspaceId: null, librarySort: 'title' }, 'settings');
  oneOf(settings.librarySort, ['title', 'updatedAt'], 'settings.librarySort');
  if (settings.tagCompletion !== undefined) boolean(settings.tagCompletion, 'settings.tagCompletion');
  if (settings.activeWorkspaceId !== null && !workspaceIds.has(settings.activeWorkspaceId)) fail('settings.activeWorkspaceId', 'ワークスペースが存在しません');
  // Prompt Shuffle data is optional and versioned independently (docs/shuffle/data-model.md).
  const shuffle = data.shuffle === undefined ? undefined : normalizeShuffle(data.shuffle);
  const shuffleRecovery = data.shuffleRecovery === undefined ? undefined : validateRecoveries(data.shuffleRecovery);
  const result = { ...data, categories, presets, experiments, images, settings, ...(shuffle ? { shuffle } : {}), ...(shuffleRecovery ? { shuffleRecovery } : {}) } as unknown as WorkbenchData;
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_BYTES) fail('payload', '10MiBを超えています');
  const output = structuredClone(result);
  if (FREEZE_VALIDATED) deepFreeze(output);
  validated.add(output);
  return output;
}

export function validateLegacyData(input: unknown): WorkbenchData {
  const data = object(input, 'v1 payload');
  if (data.presets !== undefined && array(data.presets, 'v1 presets').length) fail('v1 presets', 'v1のプリセット実データには対応していません。v2形式を使用してください');
  return validatePreImageData(data);
}

export function validatePreImageData(input: unknown): WorkbenchData {
  const data = object(input, 'legacy payload');
  for (const key of ['images', 'experiments']) if (data[key] !== undefined && array(data[key], key).length) fail(key, 'P1/P2/P3では未対応の画像・比較データです');
  return validateData(data);
}

export function parseBackup(text: string): BackupDocument {
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) fail('JSON', '10MiBを超えています');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { fail('JSON', 'JSONの構文が不正です'); }
  validateSafeJson(parsed);
  const document = object(parsed, 'JSON');
  if (document.format !== FORMAT) fail('format', '対応していない形式です');
  if (document.imageBinariesIncluded !== undefined && document.imageBinariesIncluded !== false) fail('imageBinariesIncluded', 'バイナリ同梱形式には対応していません');
  if (document.schemaVersion !== 1 && document.schemaVersion !== 2 && document.schemaVersion !== SCHEMA_VERSION) fail('schemaVersion', '対応していないバージョンです');
  date(document.exportedAt, 'exportedAt');
  return { ...document, schemaVersion: SCHEMA_VERSION, payload: document.schemaVersion === 1 ? validateLegacyData(document.payload) : document.schemaVersion === 2 ? validatePreImageData(document.payload) : validateData(document.payload) } as BackupDocument;
}

function tagText(value: unknown, path: string): string {
  string(value, path, TAG_LIMITS.tag);
  const issue = tagTextIssue(value);
  if (issue) fail(path, issue);
  return value;
}

/** Optional tag dictionary (own schemaVersion). Unknown safe fields are kept by the caller's copy. */
function validateTagDictionary(input: unknown, register: (value: unknown, path: string) => void) {
  const dictionary = object(input, 'tagDictionary');
  if (dictionary.schemaVersion !== TAG_DICTIONARY_SCHEMA_VERSION) fail('tagDictionary.schemaVersion', `対応していないタグ辞書のバージョンです（${String(dictionary.schemaVersion)}）`);
  const tags = new Map<string, string>();
  const aliases: { key: string; alias: string; path: string }[] = [];
  for (const [index, item] of array(dictionary.entries, 'tagDictionary.entries', TAG_LIMITS.entries).entries()) {
    const path = `tagDictionary.entries[${index}]`;
    const entry = object(item, path);
    register(entry.id, `${path}.id`);
    const tag = tagText(entry.tag, `${path}.tag`);
    const key = normalizeTag(tag);
    const existing = tags.get(key);
    if (existing !== undefined) fail(`${path}.tag`, `「${tag}」は「${existing}」と同じタグです（大文字小文字・_と空白・全角半角の違いは同じとみなします）`);
    tags.set(key, tag);
    const own = new Set([key]);
    for (const [aliasIndex, value] of array(entry.aliases, `${path}.aliases`, TAG_LIMITS.aliasesPerEntry).entries()) {
      const alias = tagText(value, `${path}.aliases[${aliasIndex}]`);
      const aliasKey = normalizeTag(alias);
      if (own.has(aliasKey)) fail(`${path}.aliases[${aliasIndex}]`, `別名「${alias}」はタグ「${tag}」またはその別名と同じ表記です（表記ゆれは自動で照合します）`);
      own.add(aliasKey);
      aliases.push({ key: aliasKey, alias, path: `${path}.aliases[${aliasIndex}]` });
      if (aliases.length > TAG_LIMITS.totalAliases) fail('tagDictionary', `別名は合計${TAG_LIMITS.totalAliases}件までです`);
    }
    string(entry.note, `${path}.note`, TAG_LIMITS.note);
    date(entry.createdAt, `${path}.createdAt`);
    date(entry.updatedAt, `${path}.updatedAt`);
  }
  for (const alias of aliases) {
    const owner = tags.get(alias.key);
    if (owner !== undefined) fail(alias.path, `別名「${alias.alias}」は別の項目のタグ「${owner}」と同じです`);
  }
}

function integer(value: unknown, path: string, min: number, max: number) {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail(path, '整数の範囲が不正です');
}
export function validateGenerationSettings(input: unknown): asserts input is import('../core/types').GenerationSettings {
  validateSafeJson(input);
  const settings = object(input, 'generationSettings');
  for (const key of ['seed', 'model', 'sampler', 'imageToImage', 'referenceImages']) {
    if (settings[key] !== null) { string(settings[key], `settings.${key}`, 10_000); if (!(settings[key] as string).trim()) fail(key, '空欄はnullで保存してください'); }
  }
  if (settings.seed !== null && !/^[0-9]{1,100}$/.test(settings.seed as string)) fail('seed', 'Seedは最大100桁の数字文字列です');
  for (const key of ['width', 'height', 'steps', 'imageCount']) if (settings[key] !== null) integer(settings[key], key, 1, 1_000_000);
  for (const key of ['guidance', 'cfgRescale']) if (settings[key] !== null && (typeof settings[key] !== 'number' || !Number.isFinite(settings[key]) || (settings[key] as number) < 0 || (settings[key] as number) > 1_000_000)) fail(key, '非負の有限数が必要です');
  boolean(settings.extrasConfirmed, 'extrasConfirmed'); oneOf(settings.evidence, ['unknown', 'manual', 'png-metadata'], 'settings.evidence');
  const extra = object(settings.extra, 'settings.extra');
  if (Object.keys(extra).length > 100) fail('extra', '追加設定は100項目までです');
  for (const [key, value] of Object.entries(extra)) {
    string(key, 'extra.key', 200);
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) fail('extra', '追加設定はプリミティブ値のみです');
    if (typeof value === 'string') string(value, 'extra.value', 10_000);
  }
}
