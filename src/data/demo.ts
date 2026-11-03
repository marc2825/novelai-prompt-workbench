import { createWorkspace, emptyData, snapshotMember } from '../core/commands';
import type { WorkbenchData } from '../core/types';

// Called only by the user's explicit demo button, never on startup.
export function createDemo(id: () => string, now: string): WorkbenchData {
  const data = emptyData();
  const hair = { id: id(), name: '髪型' };
  data.categories.push(hair);
  for (const [title, raw] of [['黒髪ロング', '{{black hair}}, long hair'], ['金髪ショート', 'blonde hair, short hair'], ['赤髪', 'red hair'], ['夜の街 🌃', 'night, city lights'], ['透かし除外', '[watermark]']]) {
    data.libraryEntries.push({ id: id(), title: title!, raw: raw!, description: '操作確認用サンプル', categoryId: title!.includes('髪') ? hair.id : null, tags: [title!.includes('髪') ? 'hair' : 'sample'], defaultChannel: title === '透かし除外' ? 'negative' : 'positive', previewImageIds: [], createdAt: now, updatedAt: now });
  }
  const workspace = createWorkspace(id(), 'サンプル構成', now);
  workspace.freeformPositive = '1girl';
  const members = data.libraryEntries.slice(0, 3).map(entry => snapshotMember(entry, id()));
  workspace.groups.push({ id: id(), name: '髪型（排他）', channel: 'positive', enabled: true, mode: 'exclusive', members, selectedMemberId: members[0]!.id });
  for (const entry of data.libraryEntries.slice(3)) workspace.groups.push({ id: id(), name: entry.defaultChannel === 'positive' ? '背景' : '除外', channel: entry.defaultChannel, enabled: true, mode: 'multi', selectedMemberId: null, members: [snapshotMember(entry, id())] });
  data.workspaces.push(workspace);
  data.settings.activeWorkspaceId = workspace.id;
  return data;
}
