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
  /** Earlier explicitly saved versions, newest first (issue #30). Optional; absent in older data. */
  revisions?: PresetRevision[];
}

/** A version of a preset kept when it was overwritten or restored. The snapshot's id is the workspace it was taken from. */
export interface PresetRevision {
  id: string;
  savedAt: string;
  workspaceSnapshot: PromptWorkspace;
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

export interface ImageMetadata {
  promptEvidence?: 'manual' | 'png-metadata' | 'unknown';
  positive: string | null;
  negative: string | null;
  settings: GenerationSettings;
  texts: Record<string, string>;
  warnings: string[];
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
}
