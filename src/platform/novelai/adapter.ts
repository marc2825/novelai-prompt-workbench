import type { Channel } from '../../core/types';
import type { Capabilities, FieldSnapshot, Result, WriteMode } from './protocol';

export interface NovelAIAdapter {
  capabilities(): Promise<Capabilities>;
  read(channel: Channel): Promise<Result<{ snapshot: FieldSnapshot }>>;
  write(channel: Channel, expected: FieldSnapshot, next: string, mode: WriteMode): Promise<Result<{ snapshot: FieldSnapshot }>>;
}
