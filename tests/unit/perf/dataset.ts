import { createWorkspace, emptyData, snapshotMember } from '../../../src/core/commands';
import { savePreset } from '../../../src/core/presets';
import type { WorkbenchData } from '../../../src/core/types';
import { validateData } from '../../../src/data/validation';

export const T = '2026-11-03T00:00:00.000Z';
/** Deterministic large dataset: `size` library entries, one big workspace, size/100 presets. */
export function dataset(size: number): WorkbenchData {
  let counter = 0;
  const id = () => `eeeeeeee-eeee-4eee-8eee-${String(++counter).padStart(12, '0')}`;
  let data = emptyData();
  for (let index = 0; index < size; index++) data.libraryEntries.push({ id: id(), title: `部品 ${index}`, raw: `tag ${index}, {{weighted ${index}}}, 1.2::detail ${index}::`, description: '性能計測用', categoryId: null, tags: ['perf'], defaultChannel: index % 7 ? 'positive' : 'negative', previewImageIds: [], createdAt: T, updatedAt: T });
  const workspace = createWorkspace(id(), '大規模構成', T);
  const members = data.libraryEntries.slice(0, Math.min(size, 200));
  for (let group = 0; group < 20; group++) {
    const items = members.slice(group * 10, group * 10 + 10).map(entry => snapshotMember(entry, id()));
    if (items.length) workspace.groups.push({ id: id(), name: `グループ${group}`, channel: 'positive', enabled: true, mode: group % 2 ? 'multi' : 'exclusive', members: items, selectedMemberId: group % 2 ? null : items[0]!.id });
  }
  data.workspaces.push(workspace);
  data.settings.activeWorkspaceId = workspace.id;
  for (let preset = 0; preset < Math.floor(size / 100); preset++) data = savePreset(data, workspace.id, id(), `プリセット${preset}`, T);
  return validateData(data);
}
/** The smallest typical edit: one library entry's text changes. */
export function editOne(data: WorkbenchData, round: number): WorkbenchData {
  return { ...data, libraryEntries: data.libraryEntries.map((entry, index) => index === 0 ? { ...entry, raw: `edited ${round}` } : entry) };
}
