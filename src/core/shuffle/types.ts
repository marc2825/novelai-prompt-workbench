// Prompt Shuffle domain types. Pure data only: no DOM, Chrome API or clock.
// The canonical description of every invariant lives in docs/shuffle/data-model.md.

export const SHUFFLE_SCHEMA_VERSION = 1;

/** Character-scope categories are emitted inside a character prompt. */
export const CHARACTER_CATEGORIES = ['action', 'pose', 'expression', 'gaze'] as const;
/** Camera categories are emitted in the base prompt. */
export const CAMERA_CATEGORIES = ['angle', 'framing', 'view'] as const;
export const SHUFFLE_CATEGORIES = [...CHARACTER_CATEGORIES, ...CAMERA_CATEGORIES] as const;
export type CharacterCategory = typeof CHARACTER_CATEGORIES[number];
export type CameraCategory = typeof CAMERA_CATEGORIES[number];
export type ShuffleCategory = typeof SHUFFLE_CATEGORIES[number];

export const SHUFFLE_TARGETS = ['role', 'pose', 'expression', 'camera', 'position'] as const;
export type ShuffleTarget = typeof SHUFFLE_TARGETS[number];
/** Which user-facing target switch enables a category. */
export const CATEGORY_TARGET: Record<ShuffleCategory, ShuffleTarget> = {
  action: 'role', pose: 'pose', expression: 'expression', gaze: 'camera', angle: 'camera', framing: 'camera', view: 'camera',
};

export type Side = 'left' | 'right';
export type InteractionMark = 'source' | 'target' | 'mutual';
export type SamplingMode = 'random' | 'bag' | 'weighted';
export type ModelId = 'unknown' | 'v3' | 'v4' | 'v4.5' | 'v5';
export type OutputMode = 'fields' | 'pipe';

/** Constraint labels are internal metadata and are never emitted to NovelAI. */
export interface Constrained {
  tags: string[];
  /** Every listed tag must already be present in the step context. */
  requires: string[];
  /** None of the listed tags may be present in the step context. */
  excludes: string[];
}
export interface Weighted {
  /** Used by Weighted Random only. 0 means "never" in that mode. */
  weight: number;
  /** Disabled candidates are never drawn in any mode. */
  enabled: boolean;
}

export interface PromptPart { category: ShuffleCategory; prompt: string }

export interface CharacterDefinition {
  id: string;
  name: string;
  /** Appearance / identity. Emitted verbatim and never altered by the shuffle. */
  fixedPrompt: string;
  /** Always emitted after fixedPrompt; a locked tag also locks every category whose vocabulary contains it. */
  lockedTags: string[];
  /** Per-category defaults. Replaced (omitted) only when the shuffle sets that category. */
  variables: PromptPart[];
  /** Character Undesired Content. null = the shuffle never writes this field. */
  negativePrompt: string | null;
  /** Categories the shuffle may change for this character (変更を許可する項目). */
  allowedCategories: CharacterCategory[];
  /** Preferred side when position shuffle is on. null = any. */
  side: Side | null;
}

export interface RoleDefinition {
  /** Role ID. Never interchangeable with a character ID. */
  id: string;
  name: string;
  prompt: string;
  /** Character categories claimed by this role for the assigned character. */
  categories: CharacterCategory[];
  /** Generates `${interaction}#${template.action}` when the template has an action. */
  interaction: InteractionMark | null;
  side: Side | null;
  /** Characters allowed to take this role. null = every participant. */
  allowedCharacterIds: string[] | null;
}

export type TemplateKind = 'role' | 'pose';
/** Shared structure for Role Templates (kind 'role') and multi-character Pose Sets (kind 'pose'). */
export interface SceneTemplate extends Constrained, Weighted {
  id: string;
  name: string;
  kind: TemplateKind;
  /** Interaction action used for generated source#/target#/mutual# tags. '' = none. */
  action: string;
  /** Added to the base prompt when this template is selected. */
  basePrompt: string;
  roles: RoleDefinition[];
}

export interface PromptOption extends Constrained, Weighted {
  id: string;
  prompt: string;
}
/** Independently sampled axis. Character-scope pools draw once per eligible character. */
export interface OptionPool {
  id: string;
  name: string;
  category: ShuffleCategory;
  /** Character-scope pools only. null = every participant. Ignored for camera categories. */
  characterIds: string[] | null;
  options: PromptOption[];
}

/** Linked camera combination. Camera parts go to the base prompt, gaze parts to each eligible character. */
export interface CameraPreset extends Constrained, Weighted {
  id: string;
  name: string;
  parts: PromptPart[];
}

export interface ShuffleSettings {
  enabled: boolean;
  targets: Record<ShuffleTarget, boolean>;
  mode: SamplingMode;
  avoidRepeat: boolean;
  /** Reject a composition whose signature appeared in the last N results (0 = off, max 20). */
  avoidRecent: number;
  /** Shuffle seed. Independent from (and never written to) the NovelAI generation seed. */
  seed: string;
  model: ModelId;
  outputMode: OutputMode;
  /** Shuffle after this many successful generation jobs. null = auto shuffle disabled. */
  autoEvery: number | null;
  positionHints: Record<Side, string>;
}

export interface AxisState {
  key: string;
  /** Fingerprint of the static candidate set. A change starts a fresh bag. */
  fingerprint: string;
  /** Shuffle Bag: keys drawn in the current cycle. */
  used: string[];
  last: string | null;
}
export interface ShuffleCursor {
  /** Number of completed steps for the current seed. */
  step: number;
  axes: AxisState[];
  /** Recent composition signatures, newest last. */
  recent: string[];
}

export interface RoleAssignment { roleId: string; characterId: string }
export interface PoolPick { poolId: string; characterId: string | null; optionId: string }
export interface SideAssignment { characterId: string; side: Side | null }
export interface ShuffleSelection {
  seed: string;
  /** Step index that produced this selection. */
  step: number;
  roleTemplateId: string | null;
  roleAssignments: RoleAssignment[];
  poseTemplateId: string | null;
  poseAssignments: RoleAssignment[];
  cameraPresetId: string | null;
  /** Characters that received the camera preset's character-scope (gaze) parts. */
  cameraCharacterIds: string[];
  picks: PoolPick[];
  /** Character prompt output order (character IDs). */
  order: string[];
  sides: SideAssignment[];
  signature: string;
}

export interface ShuffleProfile {
  id: string;
  name: string;
  /** Participants in base order. */
  characterIds: string[];
  settings: ShuffleSettings;
  cursor: ShuffleCursor;
  current: ShuffleSelection | null;
}

export interface ComposedCharacter { characterId: string; name: string; positive: string; negative: string | null; side: Side | null }
export interface ComposedSnapshot {
  base: { positive: string; negative: string };
  characters: ComposedCharacter[];
}
export type ShuffleTrigger = 'manual' | 'auto' | 'manual-count';
export interface ShuffleHistoryEntry {
  id: string;
  profileId: string;
  createdAt: string;
  trigger: ShuffleTrigger;
  selection: ShuffleSelection;
  /** Exact text at shuffle time, reproducible even after the library is edited. */
  composed: ComposedSnapshot;
}

export interface ShuffleData {
  schemaVersion: typeof SHUFFLE_SCHEMA_VERSION;
  characters: CharacterDefinition[];
  templates: SceneTemplate[];
  pools: OptionPool[];
  cameraPresets: CameraPreset[];
  profiles: ShuffleProfile[];
  activeProfileId: string | null;
  /** Newest first, bounded by MAX_HISTORY. */
  history: ShuffleHistoryEntry[];
}
export type ShuffleLibrary = Pick<ShuffleData, 'characters' | 'templates' | 'pools' | 'cameraPresets'>;

export interface ShuffleRecovery { savedAt: string; reason: string; raw: unknown }

export const MAX_HISTORY = 50;
export const MAX_AVOID_RECENT = 20;
