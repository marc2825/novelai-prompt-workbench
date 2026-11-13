import type { Channel } from '../../core/types';
import type { FieldKey } from '../../core/shuffle/fields';
import type { GenerationStatus } from '../../core/shuffle/generation';
import type { Capabilities, FieldSnapshot, FieldsDescription, Result, WriteMode } from './protocol';

export interface NovelAIAdapter {
  capabilities(): Promise<Capabilities>;
  read(channel: Channel): Promise<Result<{ snapshot: FieldSnapshot }>>;
  write(channel: Channel, expected: FieldSnapshot, next: string, mode: WriteMode): Promise<Result<{ snapshot: FieldSnapshot }>>;
  /** Multi-field access (base + character prompts). Absent = only the two base channels exist. */
  fields?: PromptFieldsAdapter;
  /** Generation observation. Absent = generation cannot be detected on this site profile. */
  generation?: GenerationObserverPort;
}

/** Replace-only field access with compare-and-swap. Selectors stay inside the adapter. */
export interface PromptFieldsAdapter {
  describe(): Promise<Omit<FieldsDescription, 'positions' | 'generation'>>;
  readField(field: FieldKey): Promise<Result<{ snapshot: FieldSnapshot }>>;
  writeField(field: FieldKey, expected: FieldSnapshot, next: string): Promise<Result<{ snapshot: FieldSnapshot }>>;
}

/** Observes generation state only while started. Never clicks or triggers generation. */
export interface GenerationObserverPort {
  readonly supported: boolean;
  readonly reason: string;
  start(): void;
  stop(): void;
  readonly running: boolean;
  /** Synchronously re-reads the verified element, then reports counts since start(). */
  status(): GenerationStatus;
}
