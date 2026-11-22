import type { WorkbenchData } from '../core/types';
import { validateData } from './validation';

// Unsaved-changes journal (issue #17). Saving is asynchronous (one IndexedDB
// transaction per save), so closing the side panel while a save is queued, in
// flight or failed could drop the last edits. When the page is hidden or
// unloaded with unsaved work, the panel writes the current state here
// synchronously (localStorage of this extension's own origin; nothing leaves
// the browser). The next panel offers to restore it. Image binaries cannot be
// stored here: images whose binaries were not yet committed are listed instead.

export const JOURNAL_FORMAT = 'nai-prompt-workbench-unsaved';
export const JOURNAL_PREFIX = 'nai-prompt-workbench:unsaved:';
/** localStorage holds about 5M UTF-16 code units per origin in Chrome; stay well below it. */
export const JOURNAL_MAX_CHARS = 4_500_000;

export interface UnsavedJournal {
  format: typeof JOURNAL_FORMAT;
  version: 1;
  windowId: string;
  savedAt: string;
  /** Revision of the last save this window knows was committed. */
  baseRevision: number;
  /** Why the work was unsaved: still queued/in flight, or saving had failed. */
  reason: 'pending' | 'failed';
  /** Images in `data` whose binaries had not been stored when the journal was written. */
  missingImageIds: string[];
  data: WorkbenchData;
}

export interface StoredJournal { key: string; journal: UnsavedJournal }
export interface UnreadableJournal { key: string; error: string }

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export function journalKey(windowId: string) { return `${JOURNAL_PREFIX}${windowId}`; }

/** Synchronous by design (runs in pagehide). Returns false when it could not be written (quota or size). */
export function writeJournal(storage: StorageLike, journal: UnsavedJournal): boolean {
  try {
    const text = JSON.stringify(journal);
    if (text.length > JOURNAL_MAX_CHARS) return false;
    storage.setItem(journalKey(journal.windowId), text);
    return true;
  } catch { return false; }
}

export function removeJournal(storage: StorageLike, key: string) { try { storage.removeItem(key); } catch { /* Best effort. */ } }

/** Reads every journal left by other windows. Contents are validated like an import (the storage is not trusted). */
export function readJournals(storage: StorageLike, exceptWindowId?: string): { journals: StoredJournal[]; unreadable: UnreadableJournal[] } {
  const journals: StoredJournal[] = []; const unreadable: UnreadableJournal[] = [];
  let keys: string[] = [];
  try { keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => !!key && key.startsWith(JOURNAL_PREFIX)); } catch { return { journals, unreadable }; }
  for (const key of keys) {
    if (exceptWindowId && key === journalKey(exceptWindowId)) continue;
    try {
      const value = JSON.parse(storage.getItem(key) ?? 'null') as Partial<UnsavedJournal> | null;
      if (!value || value.format !== JOURNAL_FORMAT || value.version !== 1) throw new Error('形式が不正です');
      if (typeof value.windowId !== 'string' || key !== journalKey(value.windowId)) throw new Error('画面IDが一致しません');
      if (typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))) throw new Error('日時が不正です');
      if (!Number.isSafeInteger(value.baseRevision) || (value.baseRevision as number) < 0) throw new Error('revisionが不正です');
      if (value.reason !== 'pending' && value.reason !== 'failed') throw new Error('理由が不正です');
      if (!Array.isArray(value.missingImageIds) || value.missingImageIds.some(id => typeof id !== 'string')) throw new Error('画像の一覧が不正です');
      const data = validateData(value.data);
      const imageIds = new Set(data.images.map(image => image.id));
      journals.push({ key, journal: { format: JOURNAL_FORMAT, version: 1, windowId: value.windowId, savedAt: value.savedAt, baseRevision: value.baseRevision as number, reason: value.reason, missingImageIds: value.missingImageIds.filter(id => imageIds.has(id)), data } });
    } catch (error) { unreadable.push({ key, error: error instanceof Error ? error.message : '読み取れません' }); }
  }
  journals.sort((a, b) => b.journal.savedAt.localeCompare(a.journal.savedAt));
  return { journals, unreadable };
}

/** Same content as the stored data: nothing was lost, the journal can be dropped silently. */
export function sameData(a: WorkbenchData, b: WorkbenchData) { return JSON.stringify(a) === JSON.stringify(b); }
