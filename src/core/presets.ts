import { compileWorkspace } from './compose';
import type { LibraryEntry, Preset, PresetRevision, PromptSpan, PromptWorkspace, WorkbenchData } from './types';

export function captureWorkspace(workspace: PromptWorkspace): PromptWorkspace {
  const { appliedPresetId: _binding, ...snapshot } = workspace;
  return structuredClone(snapshot);
}

function workspace(data: WorkbenchData, id: string): PromptWorkspace {
  const result = data.workspaces.find(item => item.id === id);
  if (!result) throw new Error('対象ワークスペースが存在しません');
  return result;
}
function preset(data: WorkbenchData, id: string): Preset {
  const result = data.presets.find(item => item.id === id);
  if (!result) throw new Error('プリセットが存在しません');
  return result;
}
function bind(data: WorkbenchData, workspaceId: string, presetId: string, now: string): WorkbenchData {
  return { ...data, workspaces: data.workspaces.map(item => item.id === workspaceId ? { ...item, appliedPresetId: presetId, updatedAt: now } : item) };
}

export function savePreset(data: WorkbenchData, workspaceId: string, id: string, name: string, now: string): WorkbenchData {
  if (data.presets.some(item => item.id === id)) throw new Error('プリセットIDが重複しています');
  const source = workspace(data, workspaceId);
  const saved: Preset = { id, name, sourceWorkspaceId: source.id, workspaceSnapshot: captureWorkspace(source), createdAt: now, updatedAt: now };
  return bind({ ...data, presets: [...data.presets, saved] }, source.id, id, now);
}

/** Versions kept per preset; older ones are dropped when a new version is recorded. */
export const MAX_PRESET_REVISIONS = 10;

function remember(saved: Preset, revisionId: string | undefined): PresetRevision[] | undefined {
  if (!revisionId) return saved.revisions;
  return [{ id: revisionId, savedAt: saved.updatedAt, workspaceSnapshot: saved.workspaceSnapshot }, ...(saved.revisions ?? [])].slice(0, MAX_PRESET_REVISIONS);
}
function withRevisions(saved: Preset, revisions: PresetRevision[] | undefined): Preset {
  const { revisions: _old, ...rest } = saved;
  return revisions?.length ? { ...rest, revisions } : rest;
}

/** Saves the workspace into the preset. With `revisionId`, the previous content is kept as a version (issue #30). */
export function overwritePreset(data: WorkbenchData, id: string, workspaceId: string, now: string, revisionId?: string): WorkbenchData {
  const saved = preset(data, id);
  const source = workspace(data, workspaceId);
  const next = withRevisions({ ...saved, sourceWorkspaceId: source.id, workspaceSnapshot: captureWorkspace(source), updatedAt: now }, remember(saved, revisionId));
  return bind({ ...data, presets: data.presets.map(item => item.id === id ? next : item) }, source.id, id, now);
}

/** Makes a kept version the preset's content again; the current content becomes a version itself (nothing is lost). */
export function restorePresetRevision(data: WorkbenchData, id: string, revisionId: string, newRevisionId: string, now: string): WorkbenchData {
  const saved = preset(data, id);
  const revision = saved.revisions?.find(item => item.id === revisionId);
  if (!revision) throw new Error('保存履歴が見つかりません');
  const others = (saved.revisions ?? []).filter(item => item.id !== revisionId);
  const kept = remember({ ...saved, revisions: others }, newRevisionId);
  const next = withRevisions({ ...saved, sourceWorkspaceId: revision.workspaceSnapshot.id, workspaceSnapshot: revision.workspaceSnapshot, updatedAt: now }, kept);
  return { ...data, presets: data.presets.map(item => item.id === id ? next : item) };
}

export function deletePresetRevision(data: WorkbenchData, id: string, revisionId: string): WorkbenchData {
  const saved = preset(data, id);
  if (!saved.revisions?.some(item => item.id === revisionId)) throw new Error('保存履歴が見つかりません');
  const next = withRevisions(saved, saved.revisions.filter(item => item.id !== revisionId));
  return { ...data, presets: data.presets.map(item => item.id === id ? next : item) };
}

export function renamePreset(data: WorkbenchData, id: string, name: string, now: string): WorkbenchData {
  preset(data, id);
  return { ...data, presets: data.presets.map(item => item.id === id ? { ...item, name, updatedAt: now } : item) };
}

export function duplicatePreset(data: WorkbenchData, id: string, copyId: string, name: string, now: string): WorkbenchData {
  if (data.presets.some(item => item.id === copyId)) throw new Error('プリセットIDが重複しています');
  const { revisions: _history, ...source } = preset(data, id);
  // Versions stay with the original: their IDs are unique across the data.
  const copy = { ...structuredClone(source), id: copyId, name, createdAt: now, updatedAt: now };
  return { ...data, presets: [...data.presets, copy] };
}

export function deletePreset(data: WorkbenchData, id: string): WorkbenchData {
  preset(data, id);
  return { ...data, presets: data.presets.filter(item => item.id !== id), workspaces: data.workspaces.map(item => {
    if (item.appliedPresetId !== id) return item;
    const { appliedPresetId: _binding, ...rest } = item;
    return rest;
  }) };
}

function declaredWorkspaceIds(item: PromptWorkspace): string[] {
  return [item.id, ...(item.freeformPositiveSpans ?? []).map(span => span.id), ...(item.freeformNegativeSpans ?? []).map(span => span.id), ...item.groups.flatMap(group => [group.id, ...group.members.flatMap(member => [member.id, ...(member.overrideSpans ?? []).map(span => span.id)])])];
}
export function presetIdCount(snapshot: PromptWorkspace): number { return declaredWorkspaceIds(snapshot).length; }

export function applyPreset(data: WorkbenchData, presetId: string, targetId: string | null, allocatedIds: readonly string[], now: string): WorkbenchData {
  const saved = preset(data, presetId);
  const target = targetId === null ? null : workspace(data, targetId);
  const occupied = new Set([
    ...data.libraryEntries.map(item => item.id), ...data.categories.map(item => item.id), ...data.presets.map(item => item.id),
    ...data.images.map(item => item.id), ...data.experiments.flatMap(item => [item.id, item.variantA.id, item.variantB.id]),
    ...data.workspaces.filter(item => item.id !== targetId).flatMap(declaredWorkspaceIds),
  ]);
  let allocationIndex = 0;
  const fresh = () => {
    while (allocationIndex < allocatedIds.length) { const id = allocatedIds[allocationIndex++]!; if (!occupied.has(id)) { occupied.add(id); return id; } }
    throw new Error('一意なIDを作成できません');
  };
  const rootId = target?.id ?? fresh();
  occupied.add(rootId);
  const mapping = new Map<string, string>();
  const claim = (id: string) => {
    const result = occupied.has(id) ? fresh() : id;
    occupied.add(result); mapping.set(id, result); return result;
  };
  const spans = (items: PromptSpan[]) => items.map(item => ({ ...item, id: claim(item.id) }));
  const source = captureWorkspace(saved.workspaceSnapshot);
  const restored: PromptWorkspace = {
    ...source, id: rootId, title: target?.title ?? source.title, updatedAt: now, appliedPresetId: presetId,
    ...(source.freeformPositiveSpans ? { freeformPositiveSpans: spans(source.freeformPositiveSpans) } : {}),
    ...(source.freeformNegativeSpans ? { freeformNegativeSpans: spans(source.freeformNegativeSpans) } : {}),
    groups: source.groups.map(group => {
      const id = claim(group.id);
      const members = group.members.map(member => ({ ...member, id: claim(member.id), ...(member.overrideSpans ? { overrideSpans: spans(member.overrideSpans) } : {}) }));
      const selectedMemberId = group.selectedMemberId === null ? null : mapping.get(group.selectedMemberId);
      if (selectedMemberId === undefined) throw new Error('プリセットの選択先が存在しません');
      return { ...group, id, members, selectedMemberId };
    }),
  };
  return { ...data, workspaces: target ? data.workspaces.map(item => item.id === rootId ? restored : item) : [...data.workspaces, restored], settings: { ...data.settings, activeWorkspaceId: rootId } };
}

// Identity/timestamps do not make a saved configuration dirty. Selection is
// normalized to the corresponding member position so cross-workspace ID remaps
// still compare correctly; array order and every raw/flag/span remain significant.
function workspaceContent(item: PromptWorkspace): unknown {
  const { id: _id, title: _title, updatedAt: _time, appliedPresetId: _binding, ...content } = item;
  const spans = (items: PromptSpan[]) => items.map(({ id: _spanId, ...span }) => span);
  return { ...content,
    ...(item.freeformPositiveSpans ? { freeformPositiveSpans: spans(item.freeformPositiveSpans) } : {}),
    ...(item.freeformNegativeSpans ? { freeformNegativeSpans: spans(item.freeformNegativeSpans) } : {}),
    groups: item.groups.map(({ id: _groupId, ...group }) => ({ ...group,
      selectedMemberId: group.selectedMemberId === null ? null : group.members.findIndex(member => member.id === group.selectedMemberId) + 1,
      members: group.members.map(({ id: _memberId, ...member }) => ({ ...member, ...(member.overrideSpans ? { overrideSpans: spans(member.overrideSpans) } : {}) })),
    })),
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? '（なし）';
}

export function samePresetState(current: PromptWorkspace, snapshot: PromptWorkspace): boolean {
  return canonical(workspaceContent(current)) === canonical(workspaceContent(snapshot));
}
export function presetStatus(data: WorkbenchData, item: PromptWorkspace): { state: 'unbound' | 'missing' | 'clean' | 'dirty'; preset?: Preset } {
  if (!item.appliedPresetId) return { state: 'unbound' };
  const saved = data.presets.find(preset => preset.id === item.appliedPresetId);
  if (!saved) return { state: 'missing' };
  return { state: samePresetState(item, saved.workspaceSnapshot) ? 'clean' : 'dirty', preset: saved };
}

export interface PresetDifference { label: string; before: string; after: string }
const LABELS: Record<string, string> = { groups: 'グループ', name: '名前', members: '部品', channel: 'チャンネル', mode: '選択方式', enabled: '有効', selectedMemberId: '選択候補', rawSnapshot: '保存原文', overrideRaw: '構成内原文', overrideSpans: '範囲コメント', entryId: '辞書参照', freeformPositive: '自由入力 Positive', freeformNegative: '自由入力 Negative', freeformPositiveSpans: 'Positiveコメント', freeformNegativeSpans: 'Negativeコメント', text: '原文' };
export function comparePreset(current: PromptWorkspace, snapshot: PromptWorkspace) {
  const differences: PresetDifference[] = [];
  let total = 0;
  const display = (value: unknown) => value === undefined ? '（なし）' : typeof value === 'boolean' ? value ? 'ON' : 'OFF' : String(typeof value === 'object' ? canonical(value) : value).slice(0, 200);
  const walk = (before: unknown, after: unknown, path: string[]) => {
    if (canonical(before) === canonical(after)) return;
    if (before !== null && after !== null && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
      const a = before as Record<string, unknown>; const b = after as Record<string, unknown>;
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], [...path, Array.isArray(before) ? String(Number(key) + 1) : LABELS[key] ?? key]);
    } else {
      total++;
      if (differences.length < 100) differences.push({ label: path.join(' / '), before: display(before), after: display(after) });
    }
  };
  walk(workspaceContent(current), workspaceContent(snapshot), []);
  return { total, differences, before: compileWorkspace(current), after: compileWorkspace(snapshot) };
}

export function diagnosePreset(saved: Preset, entries: LibraryEntry[], workspaces: PromptWorkspace[]): { code: 'MISSING_SOURCE' | 'MISSING_ENTRY' | 'CHANGED_ENTRY'; message: string }[] {
  const issues: ReturnType<typeof diagnosePreset> = [];
  if (!workspaces.some(item => item.id === saved.sourceWorkspaceId)) issues.push({ code: 'MISSING_SOURCE', message: '作成元ワークスペースがありません。スナップショットから復元できます。' });
  const library = new Map(entries.map(entry => [entry.id, entry]));
  for (const group of saved.workspaceSnapshot.groups) for (const member of group.members) {
    const entry = library.get(member.entryId);
    if (!entry) issues.push({ code: 'MISSING_ENTRY', message: `${group.name}: 辞書ID ${member.entryId} がありません。保存原文を使用します。` });
    else if (entry.raw !== member.rawSnapshot) issues.push({ code: 'CHANGED_ENTRY', message: `${group.name} / ${entry.title}: 辞書原文が変更されています。保存原文を使用します。` });
  }
  return issues;
}
