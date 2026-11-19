import { useEffect, useState } from 'react';
import { createWorkspace } from '../core/commands';
import { applyPreset, comparePreset, deletePreset, diagnosePreset, duplicatePreset, overwritePreset, presetIdCount, presetStatus, renamePreset, savePreset } from '../core/presets';
import type { Workbench } from './useWorkbench';
import { Empty, newId, now } from './shared';
import { InfoTip } from './InfoTip';

export function PresetStatus({ workbench }: { workbench: Workbench }) {
  const data = workbench.data!;
  const workspace = data.workspaces.find(item => item.id === data.settings.activeWorkspaceId);
  if (!workspace) return null;
  const status = presetStatus(data, workspace);
  // Neutral when no preset is involved; highlighted only when an applied preset has unsaved edits.
  const dirty = !!status.preset && status.state !== 'clean';
  return <div className={`preset-status ${dirty ? 'dirty' : ''}`} role="status" aria-label="プリセット保存状態">
    <span className="state">{status.preset ? `適用元「${status.preset.name}」: ${status.state === 'clean' ? '保存済みプリセットと一致' : 'プリセットに未保存の変更があります'}` : 'この構成はプリセットに未保存です'}</span>
    <InfoTip label="プリセットの保存状態">作業中の構成はこの端末に自動保存されます。プリセットへの保存・上書きは「プリセット」タブまたはワークスペースのプリセット欄で明示的に行います。</InfoTip>
  </div>;
}

export function Presets({ workbench, onEdit }: { workbench: Workbench; onEdit?: () => void }) {
  const data = workbench.data!;
  const workspace = data.workspaces.find(item => item.id === data.settings.activeWorkspaceId);
  const [choice, setChoice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [rename, setRename] = useState('');
  const selectedId = choice ?? workspace?.appliedPresetId ?? '';
  const selected = data.presets.find(item => item.id === selectedId);
  const filtered = data.presets.filter(item => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) || item.id === selectedId);
  const comparison = selected ? comparePreset(workspace ?? createWorkspace(selected.sourceWorkspaceId, '', selected.createdAt), selected.workspaceSnapshot) : null;
  const diagnoses = selected ? diagnosePreset(selected, data.libraryEntries, data.workspaces) : [];
  const state = workspace ? presetStatus(data, workspace) : null;
  const blocked = !!workbench.storageError;
  useEffect(() => setRename(selected?.name ?? ''), [selected?.id, selected?.name]);
  useEffect(() => { setChoice(null); }, [workspace?.id, workspace?.appliedPresetId]);

  const apply = (newWorkspace: boolean, edit: boolean) => {
    if (!selected) return;
    const dirty = state?.state !== 'clean';
    if (!confirm(`「${selected.name}」を${newWorkspace || !workspace ? '新しい構成に復元' : `「${workspace.title}」へ適用`}しますか？${!newWorkspace && workspace ? `${dirty ? 'プリセットに未保存の編集を含む' : '現在の'}構成を置き換えます。1回のUndoで戻せます。` : ''}`)) return;
    const allocatedIds = Array.from({ length: presetIdCount(selected.workspaceSnapshot) + 8 }, newId);
    if (workbench.commit(previous => applyPreset(previous, selected.id, newWorkspace ? null : workspace?.id ?? null, allocatedIds, now()))) {
      setChoice(selected.id);
      if (edit) onEdit?.();
    }
  };

  return <section className="panel stack" aria-label="プリセット管理">
    <div className="section-title"><h2>プリセット</h2><InfoTip label="プリセット">グループ・候補・原文・コメント・自由入力をまとめてスナップショットとして保存します。一覧から選ぶだけでは構成もNovelAIのページも変更せず、「プリセットを適用」で切り替えます（1回の「元に戻す」で戻せます）。</InfoTip></div>
    <form className="stack" aria-label="プリセット作成" onSubmit={event => {
      event.preventDefault();
      if (!workspace) return;
      const id = newId();
      if (workbench.commit(previous => savePreset(previous, workspace.id, id, newName, now()))) { setNewName(''); setChoice(id); }
    }}>
      <label>新しいプリセット名<input required maxLength={200} value={newName} onChange={event => setNewName(event.target.value)} /></label>
      {newName && <small>新しいプリセットはまだ保存していません。</small>}
      <button type="submit" className="primary" disabled={!workspace || blocked}>現在の構成をプリセット保存</button>
    </form>
    {!workspace && <Empty>保存するにはワークスペースを選択してください。保存済みプリセットは新しい構成に復元できます。</Empty>}
    <label>プリセット検索<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <label>プリセットを選択<select value={selected?.id ?? ''} onChange={event => setChoice(event.target.value)}><option value="">適用候補を選択</option>{filtered.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {!data.presets.length && <Empty>現在の構成に名前を付けて、最初のプリセットを保存してください。</Empty>}
    {selected && <>
      <form className="actions" aria-label="プリセットの名前変更" onSubmit={event => {
        event.preventDefault(); workbench.commit(previous => renamePreset(previous, selected.id, rename, now()));
      }}><label>プリセット名の変更<input required maxLength={200} value={rename} onChange={event => setRename(event.target.value)} /></label><button type="submit" disabled={blocked || rename === selected.name}>名前を変更</button></form>
      {rename !== selected.name && <small>名前の変更はまだ保存していません。</small>}
      <div className="actions"><button type="button" disabled={blocked} onClick={() => {
        const id = newId();
        if (workbench.commit(previous => duplicatePreset(previous, selected.id, id, `${selected.name.slice(0, 195)} のコピー`, now()))) setChoice(id);
      }}>プリセットを複製</button><button type="button" className="danger" disabled={blocked} onClick={() => {
        if (confirm(`プリセット「${selected.name}」を削除しますか？作業中の構成と辞書原本は残ります。`)) {
          if (workbench.commit(previous => deletePreset(previous, selected.id))) setChoice(null);
        }
      }}>プリセットを削除</button></div>
      {diagnoses.length > 0 && <div className="notice" role="status" aria-label="プリセット参照診断"><strong>参照診断: {diagnoses.length}件</strong><p>保存原文を使うため出力は再現できます。</p><ul>{diagnoses.slice(0, 100).map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>{diagnoses.length > 100 && <p>先頭100件を表示しています。</p>}</div>}
      {comparison && <div className="stack" aria-label="プリセット適用前プレビュー">
        <h3>現在の構成 → 「{selected.name}」</h3>
        <p>{comparison.total ? `設定の差分: ${comparison.total}件` : '設定の差分はありません'}</p>
        {comparison.total > 0 && <div className="table-scroll"><table><thead><tr><th>設定</th><th>現在</th><th>適用後</th></tr></thead><tbody>{comparison.differences.map((difference, index) => <tr key={index}><td>{difference.label}</td><td>{difference.before}</td><td>{difference.after}</td></tr>)}</tbody></table>{comparison.total > 100 && <p className="hint">先頭100件の差分を表示しています。</p>}</div>}
        {(['positive', 'negative'] as const).map(channel => <div className="columns" key={channel}><label>現在の{channel}<textarea readOnly value={comparison.before[channel]} rows={3} /></label><label>適用後の{channel}<textarea readOnly value={comparison.after[channel]} rows={3} /></label></div>)}
        {(comparison.before.warnings.length > 0 || comparison.after.warnings.length > 0) && <p role="alert">コンパイル警告があります。内容を確認してください。</p>}
        <div className="actions"><button type="button" className="primary" disabled={blocked || !!comparison.after.warnings.length} onClick={() => apply(false, false)}>プリセットを適用</button><button type="button" disabled={blocked || !!comparison.after.warnings.length} onClick={() => apply(true, false)}>新しいワークスペースに復元</button>
          {onEdit && <button type="button" disabled={blocked || !!comparison.after.warnings.length} onClick={() => apply(false, true)}>適用してグループを編集</button>}
        </div>
        <button type="button" disabled={blocked || !workspace} onClick={() => {
          if (!workspace || !confirm(`「${selected.name}」を現在の構成で上書き保存しますか？保存済みの状態を変更します。Undoで戻せます。`)) return;
          workbench.commit(previous => overwritePreset(previous, selected.id, workspace.id, now()));
        }}>現在の構成で上書き保存</button>
        <InfoTip label="プリセットの上書き保存">ワークスペースでグループを編集してから上書き保存すると、このプリセットの内容を更新します。辞書の原本やNovelAIの入力欄は変更しません。</InfoTip>
      </div>}
    </>}
  </section>;
}
