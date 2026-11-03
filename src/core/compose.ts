import type { Channel, CompiledPrompts, PromptGroup, PromptWorkspace } from './types';
import { renderCommentSpans } from './comments';

// Keep user authored raw text intact in persistence; only trim at output boundaries.
function appendFragment(current: string, raw: string): string {
  const piece = raw.trim();
  if (piece === '') return current;
  if (current === '') return piece;
  // A trailing comma OR leading comma already supplies the separator.
  // Collapse exactly one duplicated boundary comma; never split/parse a fragment.
  if (current.endsWith(',') && piece.startsWith(',')) return current + ' ' + piece.slice(1).trimStart();
  if (piece.startsWith(',')) return current + piece;
  const separator = current.endsWith(',') ? ' ' : ', ';
  return current + separator + piece;
}

function getEffectiveMembers(group: PromptGroup, warnings: string[]) {
  if (!group.enabled) return [];
  if (group.mode === 'multi') return group.members.filter(member => member.enabled);
  if (group.selectedMemberId === null) return [];
  const selected = group.members.find(member => member.id === group.selectedMemberId);
  if (!selected) {
    warnings.push(`Group ${group.id}: missing selected member ${group.selectedMemberId}`);
    return [];
  }
  return [selected];
}

export function compileWorkspace(workspace: PromptWorkspace): CompiledPrompts {
  const warnings: string[] = [];
  const resolve = (raw: string, spans: Parameters<typeof renderCommentSpans>[1]) => {
    try { return renderCommentSpans(raw, spans); }
    catch { warnings.push('不正なコメント範囲を検出したため、この原文の出力を停止しました'); return ''; }
  };
  const channels: Record<Channel, string> = {
    positive: resolve(workspace.freeformPositive, workspace.freeformPositiveSpans).trim(),
    negative: resolve(workspace.freeformNegative, workspace.freeformNegativeSpans).trim(),
  };

  for (const group of workspace.groups) {
    for (const member of getEffectiveMembers(group, warnings)) {
      channels[group.channel] = appendFragment(
        channels[group.channel],
        resolve(member.overrideRaw ?? member.rawSnapshot, member.overrideSpans),
      );
    }
  }
  return { ...channels, warnings };
}
