import type { BackupDocument, WorkbenchData } from '../core/types';
import { FORMAT, SCHEMA_VERSION, serializeDocument, validateData } from './validation';
import { mergeShuffle } from './shuffle';
import { TAG_DICTIONARY_SCHEMA_VERSION } from '../core/tags';

export function exportBackup(data: WorkbenchData, now: string): string {
  const document: BackupDocument = { format: FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: now, imageBinariesIncluded: false, payload: validateData(data) };
  return serializeDocument(document);
}

export function prepareImport(current: WorkbenchData, incoming: WorkbenchData, mode: 'merge' | 'replace'): WorkbenchData {
  const validated = validateData(incoming);
  if (mode === 'replace') return validated;
  // Duplicate IDs are explicitly rejected, including identical records. Never overwrite silently.
  return validateData({ ...validated, ...current,
    libraryEntries: [...current.libraryEntries, ...validated.libraryEntries],
    categories: [...current.categories, ...validated.categories],
    workspaces: [...current.workspaces, ...validated.workspaces],
    presets: [...current.presets, ...validated.presets],
    experiments: [...current.experiments, ...validated.experiments],
    images: [...current.images, ...validated.images],
    settings: { ...validated.settings, ...current.settings },
    ...(current.lab || validated.lab ? { lab: { ...validated.lab, ...current.lab, schemaVersion: 1, experiments: [...(current.lab?.experiments ?? []), ...(validated.lab?.experiments ?? [])] } } : {}),
    // Shuffle collections merge like other assets; ID collisions are rejected.
    ...(current.shuffle || validated.shuffle ? { shuffle: mergeShuffle(current.shuffle, validated.shuffle) } : {}),
    // Dictionary entries are appended; ID collisions and the same tag twice are rejected by validation.
    ...(current.tagDictionary || validated.tagDictionary ? { tagDictionary: { ...validated.tagDictionary, ...current.tagDictionary, schemaVersion: TAG_DICTIONARY_SCHEMA_VERSION, entries: [...(current.tagDictionary?.entries ?? []), ...(validated.tagDictionary?.entries ?? [])] } } : {}),
  });
}
