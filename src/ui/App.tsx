import { Lab } from './lab/Lab';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { compileWorkspace } from '../core/compose';
import { snapshotMember } from '../core/commands';
import type { LibraryEntry } from '../core/types';
import { Library } from './Library';
import { Workspace } from './Workspace';
import { Settings } from './Settings';
import { Recovery } from './Recovery';
import { downloadText, newId, now } from './shared';
import { message, useWorkbench } from './useWorkbench';
import type { SiteClient } from '../platform/novelai/client';
import { SiteConnection } from './SiteConnection';
import { Presets, PresetStatus } from './Presets';
import { recoveryJson } from '../data/recovery';
import { Comparisons } from './Comparisons';
import { Shuffle } from './Shuffle';

type Tab = 'ライブラリ' | 'ワークスペース' | 'プリセット' | '比較' | '設定' | 'シャッフル' | 'Experiment Lab';
// Ordered by workflow: build prompts → save/vary them → compare results → settings & backup.
const TABS: Tab[] = ['ライブラリ', 'ワークスペース', 'プリセット', 'シャッフル', '比較', 'Experiment Lab', '設定'];

export function App({ siteClient }: { siteClient?: SiteClient } = {}) {
  const workbench = useWorkbench();
  const [tab, setTab] = useState<Tab>(location.hash === '#lab' ? 'Experiment Lab' : 'ライブラリ');
  const [notice, setNotice] = useState('');
  const [comparisonDraft, setComparisonDraft] = useState(false);
  const data = workbench.data;
  const workspace = data?.workspaces.find(item => item.id === data.settings.activeWorkspaceId);
  const compiled = useMemo(() => workspace ? compileWorkspace(workspace) : { positive: '', negative: '', warnings: [] }, [workspace]);
  function addToGroup(entry: LibraryEntry, groupId: string) {
    const member = snapshotMember(entry, newId());
    if (workbench.commit(previous => ({ ...previous, workspaces: previous.workspaces.map(item => item.id === previous.settings.activeWorkspaceId ? { ...item, updatedAt: now(), groups: item.groups.map(group => group.id === groupId ? { ...group, members: [...group.members, member], selectedMemberId: group.mode === 'exclusive' && group.selectedMemberId === null ? member.id : group.selectedMemberId } : group) } : item) }))) setNotice(`「${entry.title}」を構成に追加しました。`);
  }
  function keyboard(event: KeyboardEvent) {
    const target = event.target;
    if (target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey || comparisonDraft) return;
    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'y') { event.preventDefault(); if (key === 'y' || event.shiftKey) workbench.redo(); else workbench.undo(); }
  }
  function select(value: Tab) {
    if (tab === value) return true;
    if (comparisonDraft && !confirm('未保存の変更案を破棄して画面を切り替えますか？')) return false;
    setTab(value); setNotice(''); return true;
  }
  // WAI-ARIA tabs: arrow keys / Home / End move between tabs (roving tabindex).
  function tabKeys(event: KeyboardEvent) {
    const index = TABS.indexOf(tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index - 1 + TABS.length) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    if (select(TABS[next]!)) document.getElementById(`tab-${TABS[next]}`)?.focus();
  }
  const firstRun = !!data && !data.libraryEntries.length && !data.workspaces.length;
  async function copy(channel: 'positive' | 'negative') {
    try { await navigator.clipboard.writeText(compiled[channel]); setNotice(`${channel}をコピーしました。`); }
    catch { workbench.setError('コピーできませんでした。出力欄を選択して手動でコピーしてください。'); }
  }
  return <main className={tab === 'Experiment Lab' ? 'lab-wide' : ''} onKeyDown={keyboard}>
    <header><small className="eyebrow">LOCAL PROMPT LIBRARY</small><h1>NovelAI Prompt Workbench</h1><p className="hint">原文を残して、構成を切り替える。<a href={location.pathname} target="_blank" rel="noreferrer">広いタブで開く</a></p></header>
    <div className={`status ${workbench.storageError ? 'error' : ''}`} role="status">{workbench.storageError ? '保存エラー・作業データは未保存です' : !data ? 'ローカルデータを読込中…' : workbench.saving ? '保存中…' : '保存済み · この端末のみ'}</div>
    {workbench.storageError && <section className="panel stack" role="alert"><p>{workbench.storageError}</p><p>元の保存データは自動削除しません。画面上の作業データをJSONで退避するか、DBの復旧用ファイルを保存してください。</p><div className="actions">
      {data && <button type="button" onClick={workbench.retry}>保存を再試行</button>}
      <button type="button" onClick={() => { if (confirm('未保存の画面上の編集を破棄して、保存データを再読込しますか？')) location.reload(); }}>再読込</button>
      <button type="button" disabled={!workbench.repository.current && !workbench.migrationRecovery} onClick={() => {
        if (workbench.migrationRecovery) downloadText(recoveryJson(workbench.migrationRecovery), 'nai-migration-recovery.json');
        else void workbench.repository.current?.recoveryDump().then(dump => downloadText(recoveryJson(dump), 'nai-storage-recovery.json')).catch(error => workbench.setError(message(error)));
      }}>DB復旧用ファイルを保存</button>
    </div></section>}
    {workbench.externalChange && !workbench.storageError && <section className="panel stack" role="status" aria-label="他の画面での変更">
      <p>別の画面（サイドパネル・広いタブ）でデータが保存されました。この画面のまま編集すると保存時に競合します。</p>
      <div className="actions"><button type="button" disabled={workbench.saving} onClick={() => void workbench.reloadFromStorage().then(() => setNotice('他の画面で保存された最新の内容を読み込みました（元に戻す履歴はリセットされました）。')).catch(error => workbench.setError(message(error)))}>他の画面の変更を読み込む</button></div>
    </section>}
    {workbench.error && <div className="error" role="alert">{workbench.error}<button type="button" onClick={() => workbench.setError('')}>閉じる</button></div>}
    {!data && workbench.storageError && <Recovery workbench={workbench} />}
    {data && <>
      <nav aria-label="メイン"><div className="tabs" role="tablist" aria-label="機能" onKeyDown={tabKeys}>{TABS.map(value => <button type="button" role="tab" id={`tab-${value}`} aria-controls="main-panel" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} key={value} onClick={() => select(value)}>{value}</button>)}</div></nav>
      {firstRun && tab === 'ライブラリ' && <section className="panel stack" aria-label="はじめに">
        <h2>はじめに</h2>
        <ol className="comparison-steps"><li>「ワークスペース」で構成（グループ）を作る</li><li>「ライブラリ」に部品（タグの原文）を登録し「構成に追加」</li><li>下の「出力プレビュー」をコピーしてNovelAIに貼り付け、NovelAI上で生成する</li></ol>
        <p className="hint">サンプルは「設定」→「デモを追加」で入ります。データはこの端末だけに保存されます。定期的に「設定」→「完全バックアップ」を保存してください。</p>
      </section>}
      <div className="actions history"><button type="button" disabled={!workbench.canUndo || comparisonDraft} onClick={workbench.undo}>元に戻す</button><button type="button" disabled={!workbench.canRedo || comparisonDraft} onClick={workbench.redo}>やり直す</button><small>Ctrl/Cmd+Z・Y（入力欄の外）</small></div>
      <PresetStatus workbench={workbench} />
      {notice && <p role="status">{notice}</p>}
      <div role="tabpanel" id="main-panel" aria-labelledby={`tab-${tab}`}>
        {tab === 'ライブラリ' && <Library workbench={workbench} addToGroup={addToGroup} />}
        {tab === 'ワークスペース' && <Workspace workbench={workbench} />}
        {tab === '設定' && <Settings workbench={workbench} />}
        {tab === 'プリセット' && <Presets workbench={workbench} onEdit={() => setTab('ワークスペース')} />}
        {tab === '比較' && <Comparisons workbench={workbench} onDraftChange={setComparisonDraft} />}
        {tab === 'Experiment Lab' && <Lab workbench={workbench} siteClient={siteClient} onDraftChange={setComparisonDraft} />}
        {tab === 'シャッフル' && <Shuffle workbench={workbench} siteClient={siteClient} />}
      </div>
      {tab !== 'Experiment Lab' && <section className="panel stack preview" aria-label="ライブプレビュー"><div className="group-head"><h2>出力プレビュー</h2><small>{workspace?.title ?? '構成なし'}</small></div>
        {(['positive', 'negative'] as const).map(channel => <div className="stack" key={channel}><label>{channel === 'positive' ? '出力 Positive' : '出力 Negative'}<textarea readOnly rows={3} value={compiled[channel]} /></label><button type="button" onClick={() => void copy(channel)}>{channel === 'positive' ? 'Positiveをコピー' : 'Negativeをコピー'}</button></div>)}
        {compiled.warnings.map((warning, index) => <p role="alert" key={index}>{warning}</p>)}
        <SiteConnection client={siteClient} compiled={compiled} onImport={(channel, raw) => {
          if (!workspace) { workbench.setError('先にワークスペースを作成してください'); return; }
          workbench.commit(previous => ({ ...previous, workspaces: previous.workspaces.map(item => {
            if (item.id !== workspace.id) return item;
            if (channel === 'positive') { const { freeformPositiveSpans: _spans, ...rest } = item; return { ...rest, freeformPositive: raw, updatedAt: now() }; }
            const { freeformNegativeSpans: _spans, ...rest } = item; return { ...rest, freeformNegative: raw, updatedAt: now() };
          }) }));
        }} />
      </section>}
    </>}
    <footer>非公式・ローカル保存。画像生成はNovelAI上で手動で行います。</footer>
  </main>;
}
