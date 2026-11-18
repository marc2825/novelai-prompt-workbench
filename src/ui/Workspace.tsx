import { useState } from 'react';
import { createWorkspace, moveById, removeMember, toggleMember, updateGroup } from '../core/commands';
import type { Channel, PromptGroup, PromptWorkspace, SelectionMode } from '../core/types';
import type { Workbench } from './useWorkbench';
import { Empty, newId, now, Rename, Reorder } from './shared';
import { PromptEditor } from './PromptEditor';
import { Presets } from './Presets';

export function Workspace({ workbench }: { workbench: Workbench }) {
  const data = workbench.data!;
  const workspace = data.workspaces.find(item => item.id === data.settings.activeWorkspaceId);
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<Channel>('positive');
  const [mode, setMode] = useState<SelectionMode>('multi');
  const change = (update: (workspace: PromptWorkspace) => PromptWorkspace) => {
    if (!workspace) return false;
    return workbench.commit(previous => ({ ...previous, workspaces: previous.workspaces.map(item => item.id === workspace.id ? { ...update(item), updatedAt: now() } : item) }));
  };
  const changeGroup = (id: string, update: (group: PromptGroup) => PromptGroup) => change(current => updateGroup(current, id, update));

  return <div className="stack">
    <div className="actions"><label>ワークスペース<select value={workspace?.id ?? ''} onChange={event => workbench.commit(previous => ({ ...previous, settings: { ...previous.settings, activeWorkspaceId: event.target.value || null } }))}><option value="" disabled>構成を選択</option>{data.workspaces.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button type="button" onClick={() => {
      const created = createWorkspace(newId(), '新しい構成', now());
      workbench.commit(previous => ({ ...previous, workspaces: [...previous.workspaces, created], settings: { ...previous.settings, activeWorkspaceId: created.id } }));
    }}>＋ ワークスペース</button></div>
    <Presets workbench={workbench} />
    {!workspace ? <Empty>ワークスペースを作成して、グループにライブラリの部品を追加してください。</Empty> : <>
      <section className="panel stack" key={workspace.id}>
        <Rename label="構成名" value={workspace.title} onSave={title => change(current => ({ ...current, title }))} />
        <button type="button" onClick={() => { if (confirm(`構成「${workspace.title}」を削除しますか？`)) workbench.commit(previous => { const workspaces = previous.workspaces.filter(item => item.id !== workspace.id); return { ...previous, workspaces, settings: { ...previous.settings, activeWorkspaceId: workspaces[0]?.id ?? null } }; }); }}>ワークスペースを削除</button>
        <PromptEditor label="自由入力 Positive" value={workspace.freeformPositive} spans={workspace.freeformPositiveSpans} undo={workbench.undo} redo={workbench.redo} onChange={(raw, spans) => change(current => {
          const { freeformPositiveSpans: _old, ...rest } = current;
          return { ...rest, freeformPositive: raw, ...(spans ? { freeformPositiveSpans: spans } : {}) };
        })} />
        <PromptEditor label="自由入力 Negative" rows={2} value={workspace.freeformNegative} spans={workspace.freeformNegativeSpans} undo={workbench.undo} redo={workbench.redo} onChange={(raw, spans) => change(current => {
          const { freeformNegativeSpans: _old, ...rest } = current;
          return { ...rest, freeformNegative: raw, ...(spans ? { freeformNegativeSpans: spans } : {}) };
        })} />
      </section>
      <form className="panel stack" aria-label="グループ作成" onSubmit={event => {
        event.preventDefault();
        if (!name.trim()) return;
        if (change(current => ({ ...current, groups: [...current.groups, { id: newId(), name, channel, mode, enabled: true, selectedMemberId: null, members: [] }] }))) setName('');
      }}>
        <h2>グループ作成</h2><label>グループ名<input required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label>
        <div className="columns"><label>チャンネル<select value={channel} onChange={event => setChannel(event.target.value as Channel)}><option value="positive">Positive</option><option value="negative">Negative</option></select></label><label>選択方式<select value={mode} onChange={event => setMode(event.target.value as SelectionMode)}><option value="multi">複数 (multi)</option><option value="exclusive">排他 (exclusive)</option></select></label></div><button type="submit">グループ追加</button>
      </form>
      {!workspace.groups.length && <Empty>グループを作成し、ライブラリタブで部品を追加してください。</Empty>}
      {workspace.groups.map((group, groupIndex) => <section className="panel stack" key={group.id} aria-label={group.name}>
        <div className="group-head"><strong>{group.name}</strong><span className="badge">{group.channel}</span><label className="inline"><input type="checkbox" checked={group.enabled} onChange={event => changeGroup(group.id, current => ({ ...current, enabled: event.target.checked }))} />グループ有効</label></div>
        <details open><summary>部品とグループ設定 ({group.members.length})</summary><div className="stack">
          <Rename label="グループの名前" value={group.name} onSave={value => changeGroup(group.id, current => ({ ...current, name: value }))} />
          <div className="columns"><label>グループのチャンネル<select value={group.channel} onChange={event => changeGroup(group.id, current => ({ ...current, channel: event.target.value as Channel }))}><option value="positive">Positive</option><option value="negative">Negative</option></select></label><label>グループの選択方式<select value={group.mode} onChange={event => changeGroup(group.id, current => ({ ...current, mode: event.target.value as SelectionMode }))}><option value="multi">複数 (multi)</option><option value="exclusive">排他 (exclusive)</option></select></label></div>
          <div className="actions"><Reorder name={group.name} first={groupIndex === 0} last={groupIndex === workspace.groups.length - 1} onMove={direction => change(current => ({ ...current, groups: moveById(current.groups, group.id, direction) }))} /><button type="button" onClick={() => { if (confirm(`グループ「${group.name}」を削除しますか？`)) change(current => ({ ...current, groups: current.groups.filter(item => item.id !== group.id) })); }}>グループ削除</button></div>
          {group.mode === 'exclusive' && <button type="button" disabled={!group.enabled || group.selectedMemberId === null} onClick={() => changeGroup(group.id, current => ({ ...current, selectedMemberId: null }))}>選択解除</button>}
          {!group.members.length && <Empty>ライブラリタブからこのグループへ追加できます。</Empty>}
          {group.members.map((member, index) => {
            const entry = data.libraryEntries.find(item => item.id === member.entryId);
            const active = group.enabled && (group.mode === 'exclusive' ? group.selectedMemberId === member.id : member.enabled);
            const title = entry?.title ?? '削除済み部品（保存原文を使用）';
            return <article key={member.id} className={`member ${active ? '' : 'inactive'}`} aria-label={title}>
              <label className="inline"><input type={group.mode === 'exclusive' ? 'radio' : 'checkbox'} name={`group-${group.id}`} disabled={!group.enabled} checked={group.mode === 'exclusive' ? group.selectedMemberId === member.id : member.enabled}
                onChange={event => { if (group.mode === 'multi') changeGroup(group.id, current => ({ ...current, members: current.members.map(item => item.id === member.id ? { ...item, enabled: event.target.checked } : item) })); }}
                onClick={() => { if (group.mode === 'exclusive') changeGroup(group.id, current => toggleMember(current, member.id)); }}
                onKeyDown={event => {
                  if (group.mode === 'exclusive' && event.key === ' ') {
                    event.preventDefault();
                    changeGroup(group.id, current => toggleMember(current, member.id));
                  }
                }}
              /><span className="member-title">{title}</span></label>
              <pre className="member-raw">{member.overrideRaw ?? member.rawSnapshot}</pre>
              {!entry && <small>参照先はありませんが原文を保持しています。</small>}
              <div className="actions"><Reorder name={`${title} (${index + 1})`} first={index === 0} last={index === group.members.length - 1} onMove={direction => changeGroup(group.id, current => ({ ...current, members: moveById(current.members, member.id, direction) }))} /><button type="button" onClick={() => { if (confirm(`構成から「${title}」を削除しますか？ライブラリ原本は残ります。`)) changeGroup(group.id, current => removeMember(current, member.id)); }}>部品削除</button></div>
              <details><summary>構成内の原文編集・移動</summary><div className="stack">
                <PromptEditor label="構成内の原文" value={member.overrideRaw ?? member.rawSnapshot} spans={member.overrideSpans} undo={workbench.undo} redo={workbench.redo} onChange={(raw, spans) => changeGroup(group.id, current => ({ ...current, members: current.members.map(item => {
                  if (item.id !== member.id) return item;
                  const { overrideSpans: _old, ...rest } = item;
                  return { ...rest, overrideRaw: raw, ...(spans ? { overrideSpans: spans } : {}) };
                }) }))} />
                <button type="button" disabled={member.overrideRaw === undefined && member.overrideSpans === undefined} onClick={() => changeGroup(group.id, current => ({ ...current, members: current.members.map(item => { if (item.id !== member.id) return item; const { overrideRaw: _override, overrideSpans: _spans, ...original } = item; return original; }) }))}>追加時の原文に戻す</button>
                <label>別グループへ移動<select value="" onChange={event => {
                  const targetId = event.target.value;
                  const target = workspace.groups.find(item => item.id === targetId);
                  if (!target || (target.channel !== group.channel && !confirm(`${target.channel}チャンネルへ部品を移動しますか？`))) return;
                  change(current => ({ ...current, groups: current.groups.map(item => item.id === group.id ? removeMember(item, member.id) : item.id === targetId ? { ...item, members: [...item.members, member] } : item) }));
                }}><option value="">移動先を選択</option>{workspace.groups.filter(item => item.id !== group.id).map(item => <option key={item.id} value={item.id}>{item.name} ({item.channel})</option>)}</select></label>
              </div></details>
            </article>;
          })}
        </div></details>
      </section>)}
    </>}
  </div>;
}
