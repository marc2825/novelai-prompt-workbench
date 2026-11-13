import { MODEL_IDS } from '../core/shuffle/models';
import {
  CAMERA_CATEGORIES, CHARACTER_CATEGORIES, MAX_AVOID_RECENT, MAX_HISTORY, SHUFFLE_CATEGORIES, SHUFFLE_SCHEMA_VERSION, SHUFFLE_TARGETS,
  type ShuffleData, type ShuffleRecovery,
} from '../core/shuffle/types';
import { recoveryJson } from './recovery';
import { MAX_BYTES, ValidationError, validateSafeJson } from './validation';

// Untrusted-input validation for Prompt Shuffle data (DB load, JSON import, every commit).

export const SHUFFLE_LIMITS = {
  characters: 100, templates: 1000, roles: 22, pools: 200, options: 5000, cameraPresets: 500, parts: 12, profiles: 50,
  participants: 100, labels: 50, label: 64, prompt: 100_000, name: 200, axes: 2000, axisUsed: 5000, totalRecords: 20_000,
  recoveries: 5, recoveryBytes: 2 * 1024 * 1024,
} as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;

function fail(path: string, reason: string): never { throw new ValidationError(`${path}: ${reason}`); }
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'オブジェクトが必要です');
  return value as Record<string, unknown>;
}
function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path, `配列が必要です（最大${max}件）`);
  return value;
}
function text(value: unknown, path: string, max: number = SHUFFLE_LIMITS.prompt): string {
  if (typeof value !== 'string' || value.length > max) fail(path, `文字列が必要です（最大${max}文字）`);
  return value;
}
function name(value: unknown, path: string) { if (!text(value, path, SHUFFLE_LIMITS.name).trim()) fail(path, '空の名前は使用できません'); }
function bool(value: unknown, path: string) { if (typeof value !== 'boolean') fail(path, '真偽値が必要です'); }
function oneOf(value: unknown, values: readonly (string | null)[], path: string) { if (!values.includes(value as string)) fail(path, `${values.map(String).join(' / ')} のいずれかが必要です`); }
function int(value: unknown, path: string, min: number, max: number) { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail(path, `${min}〜${max}の整数が必要です`); }
function uuid(value: unknown, path: string) { if (typeof value !== 'string' || !UUID.test(value)) fail(path, 'UUIDが必要です'); }
function date(value: unknown, path: string) { if (typeof value !== 'string' || !ISO.test(value) || !Number.isFinite(Date.parse(value))) fail(path, 'ISO 8601日時が必要です'); }
function uniqueList<T>(value: unknown, path: string, max: number, each: (item: unknown, path: string) => void): T[] {
  const items = list(value, path, max);
  items.forEach((item, index) => each(item, `${path}[${index}]`));
  if (new Set(items.map(item => JSON.stringify(item))).size !== items.length) fail(path, '重複した値があります');
  return items as T[];
}
function labels(value: unknown, path: string) {
  uniqueList(value, path, SHUFFLE_LIMITS.labels, (item, at) => { if (!text(item, at, SHUFFLE_LIMITS.label).trim() || (item as string) !== (item as string).trim()) fail(at, '前後に空白のない制約タグが必要です'); });
}
function weighted(item: Record<string, unknown>, path: string) {
  if (typeof item.weight !== 'number' || !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 1000) fail(`${path}.weight`, '0〜1000の有限数が必要です');
  bool(item.enabled, `${path}.enabled`);
  labels(item.tags, `${path}.tags`); labels(item.requires, `${path}.requires`); labels(item.excludes, `${path}.excludes`);
}
function side(value: unknown, path: string) { oneOf(value, [null, 'left', 'right'], path); }
function optionalIds(value: unknown, path: string, known: Set<string>) {
  if (value === null) return;
  uniqueList(value, path, SHUFFLE_LIMITS.participants, (item, at) => { uuid(item, at); if (!known.has(item as string)) fail(at, '存在しないキャラクターです'); });
}

function selection(value: unknown, path: string) {
  const item = record(value, path);
  text(item.seed, `${path}.seed`, 128); int(item.step, `${path}.step`, 0, 1_000_000_000);
  for (const key of ['roleTemplateId', 'poseTemplateId', 'cameraPresetId']) if (item[key] !== null) uuid(item[key], `${path}.${key}`);
  for (const key of ['roleAssignments', 'poseAssignments']) list(item[key], `${path}.${key}`, SHUFFLE_LIMITS.roles).forEach((entry, index) => {
    const assignment = record(entry, `${path}.${key}[${index}]`); uuid(assignment.roleId, `${path}.${key}.roleId`); uuid(assignment.characterId, `${path}.${key}.characterId`);
  });
  list(item.cameraCharacterIds, `${path}.cameraCharacterIds`, SHUFFLE_LIMITS.participants).forEach((id, index) => uuid(id, `${path}.cameraCharacterIds[${index}]`));
  list(item.picks, `${path}.picks`, SHUFFLE_LIMITS.totalRecords).forEach((entry, index) => {
    const pick = record(entry, `${path}.picks[${index}]`); uuid(pick.poolId, `${path}.picks.poolId`); uuid(pick.optionId, `${path}.picks.optionId`);
    if (pick.characterId !== null) uuid(pick.characterId, `${path}.picks.characterId`);
  });
  list(item.order, `${path}.order`, SHUFFLE_LIMITS.participants).forEach((id, index) => uuid(id, `${path}.order[${index}]`));
  list(item.sides, `${path}.sides`, SHUFFLE_LIMITS.participants).forEach((entry, index) => { const value = record(entry, `${path}.sides[${index}]`); uuid(value.characterId, `${path}.sides.characterId`); side(value.side, `${path}.sides.side`); });
  text(item.signature, `${path}.signature`, 200_000);
}

/** Strict structural and referential validation. Returns a deep copy; unknown safe fields are kept. */
export function validateShuffleData(input: unknown, path = 'shuffle'): ShuffleData {
  const data = record(input, path);
  if (data.schemaVersion !== SHUFFLE_SCHEMA_VERSION) fail(`${path}.schemaVersion`, `対応していないシャッフル設定のバージョンです（${String(data.schemaVersion)}）`);
  const ids = new Set<string>();
  let count = 0;
  const register = (value: unknown, at: string) => {
    uuid(value, at);
    if (ids.has(value as string)) fail(at, '重複IDです');
    ids.add(value as string);
    if (++count > SHUFFLE_LIMITS.totalRecords) fail(path, `シャッフル設定のレコード総数は${SHUFFLE_LIMITS.totalRecords}件までです`);
  };
  const characterIds = new Set<string>();
  list(data.characters, `${path}.characters`, SHUFFLE_LIMITS.characters).forEach((value, index) => {
    const at = `${path}.characters[${index}]`; const item = record(value, at);
    register(item.id, `${at}.id`); characterIds.add(item.id as string);
    name(item.name, `${at}.name`); text(item.fixedPrompt, `${at}.fixedPrompt`);
    uniqueList(item.lockedTags, `${at}.lockedTags`, SHUFFLE_LIMITS.labels, (tag, tagAt) => text(tag, tagAt, SHUFFLE_LIMITS.name));
    list(item.variables, `${at}.variables`, SHUFFLE_LIMITS.labels).forEach((part, partIndex) => {
      const value = record(part, `${at}.variables[${partIndex}]`); oneOf(value.category, CHARACTER_CATEGORIES, `${at}.variables.category`); text(value.prompt, `${at}.variables.prompt`);
    });
    if (item.negativePrompt !== null) text(item.negativePrompt, `${at}.negativePrompt`);
    uniqueList(item.allowedCategories, `${at}.allowedCategories`, CHARACTER_CATEGORIES.length, (category, categoryAt) => oneOf(category, CHARACTER_CATEGORIES, categoryAt));
    side(item.side, `${at}.side`);
  });
  list(data.templates, `${path}.templates`, SHUFFLE_LIMITS.templates).forEach((value, index) => {
    const at = `${path}.templates[${index}]`; const item = record(value, at);
    register(item.id, `${at}.id`); name(item.name, `${at}.name`); oneOf(item.kind, ['role', 'pose'], `${at}.kind`);
    text(item.action, `${at}.action`, SHUFFLE_LIMITS.name); text(item.basePrompt, `${at}.basePrompt`); weighted(item, at);
    const roles = list(item.roles, `${at}.roles`, SHUFFLE_LIMITS.roles);
    if (!roles.length) fail(`${at}.roles`, '役割が1つ以上必要です');
    roles.forEach((roleValue, roleIndex) => {
      const roleAt = `${at}.roles[${roleIndex}]`; const role = record(roleValue, roleAt);
      register(role.id, `${roleAt}.id`); name(role.name, `${roleAt}.name`); text(role.prompt, `${roleAt}.prompt`);
      uniqueList(role.categories, `${roleAt}.categories`, CHARACTER_CATEGORIES.length, (category, categoryAt) => oneOf(category, CHARACTER_CATEGORIES, categoryAt));
      oneOf(role.interaction, [null, 'source', 'target', 'mutual'], `${roleAt}.interaction`); side(role.side, `${roleAt}.side`);
      optionalIds(role.allowedCharacterIds, `${roleAt}.allowedCharacterIds`, characterIds);
    });
  });
  list(data.pools, `${path}.pools`, SHUFFLE_LIMITS.pools).forEach((value, index) => {
    const at = `${path}.pools[${index}]`; const item = record(value, at);
    register(item.id, `${at}.id`); name(item.name, `${at}.name`); oneOf(item.category, SHUFFLE_CATEGORIES, `${at}.category`);
    optionalIds(item.characterIds, `${at}.characterIds`, characterIds);
    list(item.options, `${at}.options`, SHUFFLE_LIMITS.options).forEach((optionValue, optionIndex) => {
      const optionAt = `${at}.options[${optionIndex}]`; const option = record(optionValue, optionAt);
      register(option.id, `${optionAt}.id`); text(option.prompt, `${optionAt}.prompt`); weighted(option, optionAt);
    });
  });
  list(data.cameraPresets, `${path}.cameraPresets`, SHUFFLE_LIMITS.cameraPresets).forEach((value, index) => {
    const at = `${path}.cameraPresets[${index}]`; const item = record(value, at);
    register(item.id, `${at}.id`); name(item.name, `${at}.name`); weighted(item, at);
    const parts = list(item.parts, `${at}.parts`, SHUFFLE_LIMITS.parts);
    parts.forEach((part, partIndex) => { const value = record(part, `${at}.parts[${partIndex}]`); oneOf(value.category, [...CAMERA_CATEGORIES, 'gaze'], `${at}.parts.category`); text(value.prompt, `${at}.parts.prompt`); });
    if (new Set(parts.map(part => (part as Record<string, unknown>).category)).size !== parts.length) fail(`${at}.parts`, '同じカテゴリは1つまでです');
  });
  const profileIds = new Set<string>();
  list(data.profiles, `${path}.profiles`, SHUFFLE_LIMITS.profiles).forEach((value, index) => {
    const at = `${path}.profiles[${index}]`; const item = record(value, at);
    register(item.id, `${at}.id`); profileIds.add(item.id as string); name(item.name, `${at}.name`);
    if (!Array.isArray(item.characterIds)) fail(`${at}.characterIds`, '配列が必要です');
    optionalIds(item.characterIds, `${at}.characterIds`, characterIds);
    const settings = record(item.settings, `${at}.settings`);
    bool(settings.enabled, `${at}.settings.enabled`);
    const targets = record(settings.targets, `${at}.settings.targets`);
    for (const target of SHUFFLE_TARGETS) bool(targets[target], `${at}.settings.targets.${target}`);
    oneOf(settings.mode, ['random', 'bag', 'weighted'], `${at}.settings.mode`); bool(settings.avoidRepeat, `${at}.settings.avoidRepeat`);
    int(settings.avoidRecent, `${at}.settings.avoidRecent`, 0, MAX_AVOID_RECENT);
    if (!text(settings.seed, `${at}.settings.seed`, 128).trim()) fail(`${at}.settings.seed`, 'Seedが必要です');
    oneOf(settings.model, MODEL_IDS, `${at}.settings.model`); oneOf(settings.outputMode, ['fields', 'pipe'], `${at}.settings.outputMode`);
    if (settings.autoEvery !== null) int(settings.autoEvery, `${at}.settings.autoEvery`, 1, 1000);
    const hints = record(settings.positionHints, `${at}.settings.positionHints`);
    text(hints.left, `${at}.settings.positionHints.left`, 1000); text(hints.right, `${at}.settings.positionHints.right`, 1000);
    const cursor = record(item.cursor, `${at}.cursor`);
    int(cursor.step, `${at}.cursor.step`, 0, 1_000_000_000);
    list(cursor.axes, `${at}.cursor.axes`, SHUFFLE_LIMITS.axes).forEach((axisValue, axisIndex) => {
      const axisAt = `${at}.cursor.axes[${axisIndex}]`; const axis = record(axisValue, axisAt);
      text(axis.key, `${axisAt}.key`, 300); text(axis.fingerprint, `${axisAt}.fingerprint`, 100);
      list(axis.used, `${axisAt}.used`, SHUFFLE_LIMITS.axisUsed).forEach((used, usedIndex) => text(used, `${axisAt}.used[${usedIndex}]`, 4000));
      if (axis.last !== null) text(axis.last, `${axisAt}.last`, 4000);
    });
    list(cursor.recent, `${at}.cursor.recent`, MAX_AVOID_RECENT).forEach((signature, signatureIndex) => text(signature, `${at}.cursor.recent[${signatureIndex}]`, 200_000));
    if (item.current !== null) selection(item.current, `${at}.current`);
  });
  if (data.activeProfileId !== null && !profileIds.has(data.activeProfileId as string)) fail(`${path}.activeProfileId`, '存在しないプロファイルです');
  list(data.history, `${path}.history`, MAX_HISTORY).forEach((value, index) => {
    const at = `${path}.history[${index}]`; const item = record(value, at);
    register(item.id, `${at}.id`);
    if (!profileIds.has(item.profileId as string)) fail(`${at}.profileId`, '存在しないプロファイルです');
    date(item.createdAt, `${at}.createdAt`); oneOf(item.trigger, ['manual', 'auto', 'manual-count'], `${at}.trigger`);
    selection(item.selection, `${at}.selection`);
    const composed = record(item.composed, `${at}.composed`); const base = record(composed.base, `${at}.composed.base`);
    text(base.positive, `${at}.composed.base.positive`, 1_000_000); text(base.negative, `${at}.composed.base.negative`, 1_000_000);
    list(composed.characters, `${at}.composed.characters`, SHUFFLE_LIMITS.participants).forEach((characterValue, characterIndex) => {
      const characterAt = `${at}.composed.characters[${characterIndex}]`; const character = record(characterValue, characterAt);
      uuid(character.characterId, `${characterAt}.characterId`); name(character.name, `${characterAt}.name`); text(character.positive, `${characterAt}.positive`, 1_000_000);
      if (character.negative !== null) text(character.negative, `${characterAt}.negative`, 1_000_000);
      side(character.side, `${characterAt}.side`);
    });
  });
  return structuredClone(data) as unknown as ShuffleData;
}

export type ShuffleMigration = (input: Record<string, unknown>) => Record<string, unknown>;
/** Registry keyed by source version (N -> N+1). v1 is the first shipped version. */
export const SHUFFLE_MIGRATIONS: Readonly<Record<number, ShuffleMigration>> = {};

export function migrateShuffle(input: unknown, migrations: Readonly<Record<number, ShuffleMigration>> = SHUFFLE_MIGRATIONS, target: number = SHUFFLE_SCHEMA_VERSION): { data: unknown; migratedFrom: number | null } {
  const data = record(input, 'shuffle');
  const from = data.schemaVersion;
  if (!Number.isSafeInteger(from) || (from as number) < 0) fail('shuffle.schemaVersion', 'schemaVersionが不正です');
  if ((from as number) > target) fail('shuffle.schemaVersion', `未知の将来版（v${String(from)}）のシャッフル設定には対応していません`);
  let current: Record<string, unknown> = structuredClone(data);
  for (let version = from as number; version < target; version++) {
    const step = migrations[version];
    if (!step) fail('shuffle.schemaVersion', `v${version}からの移行手順がありません`);
    current = { ...step(current), schemaVersion: version + 1 };
  }
  return { data: current, migratedFrom: from === target ? null : from as number };
}

export function normalizeShuffle(input: unknown): ShuffleData { return validateShuffleData(migrateShuffle(input).data); }

export function validateRecoveries(input: unknown): ShuffleRecovery[] {
  return list(input, 'shuffleRecovery', SHUFFLE_LIMITS.recoveries).map((value, index) => {
    const item = record(value, `shuffleRecovery[${index}]`);
    date(item.savedAt, `shuffleRecovery[${index}].savedAt`); text(item.reason, `shuffleRecovery[${index}].reason`, 2000);
    return item as unknown as ShuffleRecovery;
  });
}

function safeRaw(raw: unknown): unknown {
  try {
    validateSafeJson(raw);
    if (new TextEncoder().encode(JSON.stringify(raw)).byteLength <= SHUFFLE_LIMITS.recoveryBytes) return raw;
  } catch { /* Fall through to a diagnostic string. */ }
  const dump = recoveryJson(raw);
  return dump.length > SHUFFLE_LIMITS.recoveryBytes ? `${dump.slice(0, SHUFFLE_LIMITS.recoveryBytes)}…[切り詰め]` : dump;
}
function message(error: unknown) { return (error instanceof Error ? error.message : '不明なエラー').slice(0, 1000); }

/**
 * Load-time isolation. Invalid shuffle data never blocks the library: it is moved
 * (not deleted) to shuffleRecovery and the shuffle starts empty. A successful
 * schema migration keeps the pre-migration copy there as a backup.
 */
export function quarantineShuffle(input: unknown, now: string): { data: unknown; notice: string | null } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { data: input, notice: null };
  const data = input as Record<string, unknown>;
  if (data.shuffle === undefined) return { data, notice: null };
  let previous: ShuffleRecovery[] = [];
  try { if (data.shuffleRecovery !== undefined) previous = validateRecoveries(data.shuffleRecovery); } catch { previous = []; }
  const keep = (entry: ShuffleRecovery) => [...previous, entry].slice(-SHUFFLE_LIMITS.recoveries);
  try {
    const migrated = migrateShuffle(data.shuffle);
    const shuffle = validateShuffleData(migrated.data);
    if (migrated.migratedFrom === null) return { data, notice: null };
    return { data: { ...data, shuffle, shuffleRecovery: keep({ savedAt: now, reason: `移行前バックアップ（シャッフル設定 v${migrated.migratedFrom}）`, raw: safeRaw(data.shuffle) }) }, notice: `シャッフル設定をv${migrated.migratedFrom}から移行しました。移行前の内容を保持しています。` };
  } catch (error) {
    const { shuffle: _broken, ...rest } = data;
    return { data: { ...rest, shuffleRecovery: keep({ savedAt: now, reason: `読込失敗: ${message(error)}`, raw: safeRaw(data.shuffle) }) }, notice: 'シャッフル設定を読み込めなかったため隔離し、空の設定で起動しました。復旧用データを保存できます。' };
  }
}

/** Merge import: concatenates collections; any ID collision is rejected by validation. */
export function mergeShuffle(current: ShuffleData | undefined, incoming: ShuffleData | undefined): ShuffleData | undefined {
  if (!incoming) return current;
  if (!current) return incoming;
  return validateShuffleData({
    ...incoming, ...current,
    characters: [...current.characters, ...incoming.characters],
    templates: [...current.templates, ...incoming.templates],
    pools: [...current.pools, ...incoming.pools],
    cameraPresets: [...current.cameraPresets, ...incoming.cameraPresets],
    profiles: [...current.profiles, ...incoming.profiles],
    activeProfileId: current.activeProfileId ?? incoming.activeProfileId,
    history: [...current.history, ...incoming.history].slice(0, MAX_HISTORY),
  });
}

export const SHUFFLE_EXPORT_FORMAT = 'nai-prompt-workbench-shuffle';
/** Shuffle-only file for sharing templates/characters. History is omitted. */
export function exportShuffle(shuffle: ShuffleData, now: string): string {
  const { history: _history, ...rest } = validateShuffleData(shuffle);
  const profiles = rest.profiles.map(profile => ({ ...profile, current: null }));
  return JSON.stringify({ format: SHUFFLE_EXPORT_FORMAT, exportedAt: now, shuffle: { ...rest, profiles, history: [] } }, null, 2);
}
export function parseShuffleExport(input: string): ShuffleData {
  if (new TextEncoder().encode(input).byteLength > MAX_BYTES) fail('JSON', '10MiBを超えています');
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { fail('JSON', 'JSONの構文が不正です'); }
  validateSafeJson(parsed);
  const document = record(parsed, 'JSON');
  if (document.format !== SHUFFLE_EXPORT_FORMAT) fail('format', 'シャッフル設定ファイルではありません');
  date(document.exportedAt, 'exportedAt');
  return normalizeShuffle(document.shuffle);
}
export function importShuffle(current: ShuffleData | undefined, incoming: ShuffleData, mode: 'merge' | 'replace'): ShuffleData {
  return mode === 'replace' ? validateShuffleData(incoming) : mergeShuffle(current, incoming)!;
}
