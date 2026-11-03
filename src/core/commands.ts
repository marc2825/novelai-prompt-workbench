import type { GroupMember, LibraryEntry, PromptGroup, PromptWorkspace, WorkbenchData } from './types';

export function emptyData(): WorkbenchData {
  return { libraryEntries: [], categories: [], workspaces: [], presets: [], experiments: [], images: [], settings: { activeWorkspaceId: null, librarySort: 'title' } };
}

export function createWorkspace(id: string, title: string, now: string): PromptWorkspace {
  return { id, title, groups: [], freeformPositive: '', freeformNegative: '', updatedAt: now };
}

export function snapshotMember(entry: LibraryEntry, instanceId: string): GroupMember {
  return { id: instanceId, entryId: entry.id, enabled: true, rawSnapshot: entry.raw };
}

export function updateGroup(workspace: PromptWorkspace, id: string, change: (group: PromptGroup) => PromptGroup): PromptWorkspace {
  return { ...workspace, groups: workspace.groups.map(group => group.id === id ? change(group) : group) };
}

export function toggleMember(group: PromptGroup, id: string): PromptGroup {
  if (!group.members.some(member => member.id === id)) return group;
  return group.mode === 'exclusive'
    ? { ...group, selectedMemberId: group.selectedMemberId === id ? null : id }
    : { ...group, members: group.members.map(member => member.id === id ? { ...member, enabled: !member.enabled } : member) };
}

export function removeMember(group: PromptGroup, id: string): PromptGroup {
  return { ...group, members: group.members.filter(member => member.id !== id), selectedMemberId: group.selectedMemberId === id ? null : group.selectedMemberId };
}

export function moveById<T extends { id: string }>(items: T[], id: string, direction: -1 | 1): T[] {
  const index = items.findIndex(item => item.id === id);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= items.length) return items;
  const result = [...items];
  const item = result.splice(index, 1)[0]!;
  result.splice(destination, 0, item);
  return result;
}
