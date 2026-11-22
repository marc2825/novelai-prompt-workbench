import { useEffect, useState } from 'react';
import { createWorkspace } from '../core/commands';
import { applyPreset, comparePreset, deletePreset, deletePresetRevision, diagnosePreset, duplicatePreset, overwritePreset, presetIdCount, presetStatus, renamePreset, restorePresetRevision, savePreset } from '../core/presets';
import { compileWorkspace } from '../core/compose';
import { PromptDiffView } from './PromptDiffView';
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
  return <div className={`preset-status ${dirty ? 'dirty' : ''} ${status.preset ? '' : 'sr-only'}`} role="status" aria-label="プリセット保存状態">
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
  const [viewing, setViewing] = useState<string | null>(null);
  const selectedId = choice ?? workspace?.appliedPresetId ?? '';
  const selected = data.presets.find(item => item.id === selectedId);
  const filtered = data.presets.filter(item => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) || item.id === selectedId);
  const comparison = selected ? comparePreset(workspace ?? createWorkspace(selected.sourceWorkspaceId, '', selected.createdAt), selected.workspaceSnapshot) : null;
  const diagnoses = selected ? diagnosePreset(selected, data.libraryEntries, data.workspaces) : [];
  const state = workspace ? presetStatus(data, workspace) : null;
  const blocked = !!workbench.storageError;
  // In the Workspace tab only select / apply / save stay visible; the Presets tab opens the details.
  const compact = !onEdit;
  useEffect(() => setRename(selected?.name ?? ''), [selected?.id, selected?.name]);
  useEffect(() => setViewing(null), [selected?.id]);
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
    <div className="section-title"><h2>プリセット</h2><InfoTip label="プリセット">グループ・候補・原文・コメント・自由入力をまとめてスナップショットとして保存します。一覧から選ぶだけでは構成もNovelAIのページも変更せず、「プリセットを適用」で切り替えます（1回の「元に戻す」で戻せます）。「現在の構成で上書き保存」は、選んだプリセットの内容を今の構成で更新します。辞書の原本やNovelAIの入力欄は変更しません。</InfoTip></div>
    <label>プリセットを選択<select value={selected?.id ?? ''} onChange={event => setChoice(event.target.value)}><option value="">適用候補を選択</option>{filtered.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {selected && comparison && <>
      <p className="hint">{comparison.total ? `現在の構成との差分: ${comparison.total}件` : '現在の構成と同じ設定です'}{diagnoses.length > 0 ? ` ・ 参照診断 ${diagnoses.length}件` : ''}</p>
      {(comparison.before.warnings.length > 0 || comparison.after.warnings.length > 0) && <p role="alert">コンパイル警告があります。内容を確認してください。</p>}
      <div className="actions"><button type="button" className="primary" disabled={blocked || !!comparison.after.warnings.length} onClick={() => apply(false, false)}>プリセットを適用</button>
        <button type="button" disabled={blocked || !workspace} onClick={() => {
          if (!workspace || !confirm(`「${selected.name}」を現在の構成で上書き保存しますか？保存済みの状態を変更します。Undoで戻せます。`)) return;
          workbench.commit(previous => overwritePreset(previous, selected.id, workspace.id, now(), newId()));
        }}>現在の構成で上書き保存</button></div>
    </>}
    <form className="actions" aria-label="プリセット作成" onSubmit={event => {
      event.preventDefault();
      if (!workspace) return;
      const id = newId();
      if (workbench.commit(previous => savePreset(previous, workspace.id, id, newName, now()))) { setNewName(''); setChoice(id); }
    }}>
      <label>新しいプリセット名<input required maxLength={200} value={newName} placeholder="現在の構成に名前を付けて保存" onChange={event => setNewName(event.target.value)} /></label>
      <button type="submit" disabled={!workspace || blocked} aria-label="現在の構成をプリセット保存">プリセット保存</button>
    </form>
    {!workspace && <Empty>保存するにはワークスペースを選択してください。保存済みプリセットは新しい構成に復元できます。</Empty>}
    {data.presets.length > 0 && <details className="fold" open={!compact}><summary>詳細（差分の内容・検索・名前変更・複製・削除）</summary><div className="stack">
      <label>プリセット検索<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {selected && <>
        <form className="actions" aria-label="プリセットの名前変更" onSubmit={event => {
          event.preventDefault(); workbench.commit(previous => renamePreset(previous, selected.id, rename, now()));
        }}><label>プリセット名の変更<input required maxLength={200} value={rename} onChange={event => setRename(event.target.value)} /></label><button type="submit" disabled={blocked || rename === selected.name}>名前を変更</button></form>
        <div className="actions"><button type="button" className="small" disabled={blocked} onClick={() => {
          const id = newId();
          if (workbench.commit(previous => duplicatePreset(previous, selected.id, id, `${selected.name.slice(0, 195)} のコピー`, now()))) setChoice(id);
        }}>プリセットを複製</button><button type="button" className="small danger" disabled={blocked} onClick={() => {
          if (confirm(`プリセット「${selected.name}」を削除しますか？作業中の構成と辞書原本は残ります。`)) {
            if (workbench.commit(previous => deletePreset(previous, selected.id))) setChoice(null);
          }
        }}>プリセットを削除</button>
          {comparison && <button type="button" className="small" disabled={blocked || !!comparison.after.warnings.length} onClick={() => apply(true, false)}>新しいワークスペースに復元</button>}
          {comparison && onEdit && <button type="button" className="small" disabled={blocked || !!comparison.after.warnings.length} onClick={() => apply(false, true)}>適用してグループを編集</button>}
        </div>
        {diagnoses.length > 0 && <div className="notice" role="status" aria-label="プリセット参照診断"><strong>参照診断: {diagnoses.length}件</strong><p>保存原文を使うため出力は再現できます。</p><ul>{diagnoses.slice(0, 100).map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>{diagnoses.length > 100 && <p>先頭100件を表示しています。</p>}</div>}
        {comparison && <div className="stack" aria-label="プリセット適用前プレビュー">
          <h3>現在の構成 → 「{selected.name}」</h3>
          {comparison.total > 0 && <div className="table-scroll"><table><thead><tr><th>設定</th><th>現在</th><th>適用後</th></tr></thead><tbody>{comparison.differences.map((difference, index) => <tr key={index}><td>{difference.label}</td><td>{difference.before}</td><td>{difference.after}</td></tr>)}</tbody></table>{comparison.total > 100 && <p className="hint">先頭100件の差分を表示しています。</p>}</div>}
          {(['positive', 'negative'] as const).map(channel => <div className="columns" key={channel}><label>現在の{channel}<textarea readOnly value={comparison.before[channel]} rows={3} /></label><label>適用後の{channel}<textarea readOnly value={comparison.after[channel]} rows={3} /></label></div>)}
          {(['positive', 'negative'] as const).map(channel => <PromptDiffView key={channel} label={`適用による${channel}の変化`} before={comparison.before[channel]} after={comparison.after[channel]} />)}
        </div>}
        {!!selected.revisions?.length && <div className="stack" aria-label="プリセットの保存履歴">
          <div className="section-title"><h3>保存履歴（{selected.revisions.length}）</h3><InfoTip label="プリセットの保存履歴">「現在の構成で上書き保存」したときの直前の内容を、新しい順に最大10件残します。「この版に戻す」は今の内容も履歴に残してから入れ替えるので、何も失われません。どちらも「元に戻す」で戻せます。完全バックアップ・JSONバックアップにも含まれます。</InfoTip></div>
          {selected.revisions.map((revision, index) => {
            const number = index + 1; const open = viewing === revision.id;
            return <div key={revision.id} className="member">
              <div className="member-row"><span>版{number}: {new Date(revision.savedAt).toLocaleString()}（グループ{revision.workspaceSnapshot.groups.length}）</span>
                <span className="toolbar"><button type="button" className="small" aria-expanded={open} onClick={() => setViewing(open ? null : revision.id)}>{open ? `版${number}の比較を閉じる` : `版${number}と比較`}</button>
                  <button type="button" className="small" disabled={blocked} onClick={() => { if (confirm(`「${selected.name}」を版${number}（${new Date(revision.savedAt).toLocaleString()}）の内容に戻しますか？今の内容は履歴に残ります。「元に戻す」でも戻せます。`)) workbench.commit(previous => restorePresetRevision(previous, selected.id, revision.id, newId(), now())); }}>版{number}に戻す</button>
                  <button type="button" className="small danger" disabled={blocked} onClick={() => { if (confirm(`版${number}を保存履歴から削除しますか？「元に戻す」で戻せます。`)) workbench.commit(previous => deletePresetRevision(previous, selected.id, revision.id)); }}>版{number}を削除</button></span></div>
              {open && (() => { const old = compileWorkspace(revision.workspaceSnapshot); const now_ = compileWorkspace(selected.workspaceSnapshot); return <>{(['positive', 'negative'] as const).map(channel => <PromptDiffView key={channel} label={`版${number} → 今のプリセットの${channel}`} before={old[channel]} after={now_[channel]} />)}</>; })()}
            </div>;
          })}
        </div>}
      </>}
    </div></details>}
    {!data.presets.length && <Empty>現在の構成に名前を付けて保存すると、ここから切り替えられます。</Empty>}
  </section>;
}
