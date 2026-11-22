import { createWorkspace, emptyData, snapshotMember } from '../../../src/core/commands';
import { savePreset } from '../../../src/core/presets';
import type { WorkbenchData } from '../../../src/core/types';
import { MAX_BYTES, validateData } from '../../../src/data/validation';

export const T = '2026-11-03T00:00:00.000Z';
export interface DatasetOptions {
  /** Workspaces with 20 groups × up to 10 members each (default 1). */
  workspaces?: number;
  /** Presets of the first workspace (default size / 100). */
  presets?: number;
  /** Extra ASCII characters appended to every library entry's raw text (default 0). */
  pad?: number;
}
/** Deterministic large dataset: `size` library entries, one big workspace, size/100 presets (by default). */
export function dataset(size: number, options: DatasetOptions = {}): WorkbenchData {
  let counter = 0;
  const id = () => `eeeeeeee-eeee-4eee-8eee-${String(++counter).padStart(12, '0')}`;
  const padding = options.pad ? `, ${'detail '.repeat(Math.ceil(options.pad / 7)).slice(0, options.pad)}` : '';
  let data = emptyData();
  for (let index = 0; index < size; index++) data.libraryEntries.push({ id: id(), title: `部品 ${index}`, raw: `tag ${index}, {{weighted ${index}}}, 1.2::detail ${index}::${padding}`, description: '性能計測用', categoryId: null, tags: ['perf'], defaultChannel: index % 7 ? 'positive' : 'negative', previewImageIds: [], createdAt: T, updatedAt: T });
  const members = data.libraryEntries.slice(0, Math.min(size, 200));
  for (let count = 0; count < (options.workspaces ?? 1); count++) {
    const workspace = createWorkspace(id(), count ? `大規模構成 ${count + 1}` : '大規模構成', T);
    for (let group = 0; group < 20; group++) {
      const items = members.slice(group * 10, group * 10 + 10).map(entry => snapshotMember(entry, id()));
      if (items.length) workspace.groups.push({ id: id(), name: `グループ${group}`, channel: 'positive', enabled: true, mode: group % 2 ? 'multi' : 'exclusive', members: items, selectedMemberId: group % 2 ? null : items[0]!.id });
    }
    data.workspaces.push(workspace);
  }
  data.settings.activeWorkspaceId = data.workspaces[0]!.id;
  for (let preset = 0; preset < (options.presets ?? Math.floor(size / 100)); preset++) data = savePreset(data, data.workspaces[0]!.id, id(), `プリセット${preset}`, T);
  return validateData(data);
}
const bytes = (data: WorkbenchData) => new TextEncoder().encode(JSON.stringify(data)).byteLength;
/**
 * Close to both limits: 5,000 entries, 5 workspaces and 15 presets (≈9,400 of 10,000
 * records), raw texts padded until the payload is about 95% of MAX_BYTES (10 MiB).
 */
export function nearLimitDataset(target = MAX_BYTES * 0.95): WorkbenchData {
  const shape = { workspaces: 5, presets: 15 };
  const base = bytes(dataset(5000, shape));
  // Every padded character appears once per entry and once per member snapshot of the first 200 entries.
  const pad = Math.floor((target - base) / (5000 + 200 * (shape.workspaces + shape.presets)));
  return dataset(5000, { ...shape, pad });
}
/** The smallest typical edit: one library entry's text changes. */
export function editOne(data: WorkbenchData, round: number): WorkbenchData {
  return { ...data, libraryEntries: data.libraryEntries.map((entry, index) => index === 0 ? { ...entry, raw: `edited ${round}` } : entry) };
}
