import type { LabData } from './lab/types';
import type { ShuffleData, ShuffleRecovery } from './shuffle/types';

export type Channel = 'positive' | 'negative';
export type SelectionMode = 'multi' | 'exclusive';

export interface PromptSpan {
  id: string;
  text: string;
  enabled: boolean;
}

export interface LibraryEntry {
  id: string;
  title: string;
  raw: string;
  defaultChannel: Channel;
  categoryId: string | null;
  tags: string[];
  description: string;
  previewImageIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface Settings {
  activeWorkspaceId: string | null;
  librarySort: 'title' | 'updatedAt';
  /** Tag completion in prompt editors. Absent = on. */
  tagCompletion?: boolean;
}

/** One user-defined tag. `tag` is what completion inserts; aliases only help find it. */
export interface TagDictionaryEntry {
  id: string;
  tag: string;
  aliases: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** Local tag dictionary (optional; absent = empty). Has its own schemaVersion. */
export interface TagDictionary {
  schemaVersion: 1;
  entries: TagDictionaryEntry[];
}

export interface WorkbenchData {
  libraryEntries: LibraryEntry[];
  categories: Category[];
  workspaces: PromptWorkspace[];
  presets: Preset[];
  experiments: Experiment[];
  images: ImageRecord[];
  settings: Settings;
  /** Prompt Shuffle state (optional; absent = empty). Has its own schemaVersion. */
  shuffle?: ShuffleData;
  lab?: LabData;
  /** User tag dictionary for completion and spelling-variant review. */
  tagDictionary?: TagDictionary;
  /** Quarantined unreadable shuffle data found at load time, kept for manual recovery. */
  shuffleRecovery?: ShuffleRecovery[];
  // Forward-compatible, inert JSON fields survive backup/restore.
  [key: string]: unknown;
}

export interface BackupDocument {
  format: 'nai-prompt-workbench';
  schemaVersion: 3;
  imageBinariesIncluded?: false;
  exportedAt: string;
  payload: WorkbenchData;
  [key: string]: unknown;
}

export interface GroupMember {
  id: string;
  entryId: string;
  enabled: boolean;
  rawSnapshot: string;
  overrideRaw?: string;
  overrideSpans?: PromptSpan[];
}

export interface PromptGroup {
  id: string;
  name: string;
  channel: Channel;
  mode: SelectionMode;
  enabled: boolean;
  members: GroupMember[];
  selectedMemberId: string | null;
}

export interface PromptWorkspace {
  id: string;
  title: string;
  groups: PromptGroup[];
  freeformPositive: string;
  freeformNegative: string;
  freeformPositiveSpans?: PromptSpan[];
  freeformNegativeSpans?: PromptSpan[];
  appliedPresetId?: string;
  updatedAt: string;
}

export interface CompiledPrompts {
  positive: string;
  negative: string;
  warnings: string[];
}

export interface Preset {
  id: string;
  name: string;
  sourceWorkspaceId: string;
  workspaceSnapshot: PromptWorkspace;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationSettings {
  seed: string | null;
  model: string | null;
  width: number | null;
  height: number | null;
  steps: number | null;
  sampler: string | null;
  guidance: number | null;
  cfgRescale: number | null;
  imageCount: number | null;
  imageToImage: string | null;
  referenceImages: string | null;
  extrasConfirmed: boolean;
  extra: Record<string, string | number | boolean | null>;
  evidence: 'manual' | 'png-metadata' | 'unknown';
}

export interface ExperimentVariant {
  id: string;
  label: 'A' | 'B';
  presetId: string | null;
  workspaceSnapshot: PromptWorkspace;
  compiled: Pick<CompiledPrompts, 'positive' | 'negative'>;
  settings: GenerationSettings;
  imageId: string | null;
}

export interface Experiment {
  id: string;
  name: string;
  variantA: ExperimentVariant;
  variantB: ExperimentVariant;
  createdAt: string;
  updatedAt: string;
}

/**
 * NovelAI's official PNG metadata containers found at import (docs/DATA_MODEL.md). The meaning of
 * the fields is unverified: they are shown as candidates and never become settings by themselves.
 */
export interface NovelAIImageInfo {
  /** 'text' = PNG text chunks with a `Comment` key (values stay in ImageMetadata.texts); 'stealth' = alpha-channel `stealth_pngcomp` payload. */
  sources: ('text' | 'stealth')[];
  /** 'single' with one container; with both, whether every stealth key equals the PNG text chunk of the same key. */
  agreement: 'single' | 'match' | 'mismatch';
  /** Stealth payload (values as strings). null when absent, or when identical to the PNG text chunks (not duplicated). */
  stealth: Record<string, string> | null;
}
export interface ImageMetadata {
  promptEvidence?: 'manual' | 'png-metadata' | 'unknown';
  positive: string | null;
  negative: string | null;
  settings: GenerationSettings;
  texts: Record<string, string>;
  warnings: string[];
  /** Absent for PNGs without NovelAI containers and for images imported before this field existed. */
  novelai?: NovelAIImageInfo;
}
export interface ImageRecord {
  id: string;
  hash: string;
  name: string;
  mime: 'image/png';
  width: number;
  height: number;
  byteLength: number;
  thumbnailBytes: number;
  createdAt: string;
  metadata: ImageMetadata;
  /** Review of the result (issue #28). Optional; absent means not reviewed. */
  review?: ImageReview;
  /** User tags for sorting results (not prompt tags). */
  tags?: string[];
  note?: string;
}

export type ImageReview = 'adopted' | 'pending' | 'rejected';
