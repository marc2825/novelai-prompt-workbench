import { Lab } from './lab/Lab';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
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
import { InfoTip } from './InfoTip';
import { saveFullBackup } from './FullBackup';
import { UnsavedRecovery } from './UnsavedRecovery';
import { TagCompletionContext, useTagCompletionSource } from './TagCompletion';

type Tab = 'ライブラリ' | 'ワークスペース' | 'プリセット' | '比較' | '設定' | 'シャッフル' | 'Experiment Lab';
// Four areas in workflow order (issue #29): collect parts → edit the prompt → make variations →
// compare / experiment. Settings & backup sit apart at the end. Tab names stay stable (one tablist).
const AREAS: { label: string; tabs: Tab[] }[] = [
  { label: 'ライブラリ', tabs: ['ライブラリ'] },
  { label: '編集', tabs: ['ワークスペース', 'プリセット'] },
  { label: 'バリエーション', tabs: ['シャッフル'] },
  { label: '比較・実験', tabs: ['比較', 'Experiment Lab'] },
];
const TABS: Tab[] = [...AREAS.flatMap(area => area.tabs), '設定'];
// Deep links (#workspace …): "open in a wide tab" lands on the same section. The panel's own URL is
// not rewritten on every switch, so reopening or reloading still starts at the library.
const HASH: Record<Tab, string> = { ライブラリ: 'library', ワークスペース: 'workspace', プリセット: 'presets', シャッフル: 'shuffle', 比較: 'compare', 'Experiment Lab': 'lab', 設定: 'settings' };
const tabFromHash = (hash: string): Tab => TABS.find(value => `#${HASH[value]}` === hash) ?? 'ライブラリ';
const WIDE = '(min-width: 1000px)';
function useWide() {
  const [wide, setWide] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(WIDE).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const query = matchMedia(WIDE); const update = () => setWide(query.matches);
    query.addEventListener('change', update); return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}
// The workspace output is the main result on these tabs; elsewhere it starts collapsed.
const PREVIEW_OPEN: Tab[] = ['ライブラリ', 'ワークスペース', 'プリセット'];

export function App({ siteClient }: { siteClient?: SiteClient } = {}) {
  const workbench = useWorkbench();
  const [tab, setTab] = useState<Tab>(() => tabFromHash(location.hash));
  const wide = useWide();
  const [notice, setNotice] = useState('');
  const [comparisonDraft, setComparisonDraft] = useState(false);
  const [rescuing, setRescuing] = useState(false);
  const data = workbench.data;
  const workspace = data?.workspaces.find(item => item.id === data.settings.activeWorkspaceId);
  const compiled = useMemo(() => workspace ? compileWorkspace(workspace) : { positive: '', negative: '', warnings: [] }, [workspace]);
  const completion = useTagCompletionSource(data);
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
  const tabButton = (value: Tab) => <button type="button" role="tab" id={`tab-${value}`} aria-controls="main-panel" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} key={value} onClick={() => select(value)}>{value}</button>;
  const statusPill = <div className={`status ${workbench.storageError ? 'error' : !data ? 'loading' : workbench.saving ? 'saving' : ''}`} role="status">{workbench.storageError ? '保存エラー・作業データは未保存です' : !data ? 'ローカルデータを読込中…' : workbench.saving ? '保存中…' : '保存済み · この端末のみ'}</div>;
  return <TagCompletionContext.Provider value={completion}><main className={tab === 'Experiment Lab' ? 'lab-wide' : 'with-preview'} onKeyDown={keyboard}>
    <header className="app-header">
      <div className="app-title"><img className="app-icon" src="/icon/32.png" width={20} height={20} alt="" /><h1>Spellbinder<span className="app-subtitle"> for NovelAI</span></h1><span className="badge" title="NovelAI（Anlatan Inc.）とは提携していない非公式ツールです。データはこの端末だけに保存され、画像の生成はNovelAI上で行います">非公式</span></div>
      <div className="header-links">{!data && statusPill}<a href={`${location.pathname}#${HASH[tab]}`} target="_blank" rel="noreferrer" aria-label="広いタブで開く" title="広いタブで開く（サイドパネルより広い画面で、同じデータを開きます）">↗ タブ</a></div>
    </header>
    {workbench.storageError && <section className="panel stack" role="alert"><p>{workbench.storageError}</p><p>元の保存データは自動削除しません。画面上の作業データを、画像も含めて完全バックアップで退避できます。</p><div className="actions">
      {data && <button type="button" className="primary" onClick={workbench.retry}>保存を再試行</button>}
      {data && <button type="button" disabled={rescuing} onClick={() => { setRescuing(true); void saveFullBackup(workbench).then(setNotice).catch(error => workbench.setError(message(error))).finally(() => setRescuing(false)); }}>未保存の変更を含めて完全バックアップを保存</button>}
      <button type="button" onClick={() => { if (confirm('未保存の画面上の編集を破棄して、保存データを再読込しますか？')) location.reload(); }}>再読込</button>
      <button type="button" disabled={!workbench.repository.current && !workbench.migrationRecovery} onClick={() => {
        if (workbench.migrationRecovery) downloadText(recoveryJson(workbench.migrationRecovery), 'nai-migration-recovery.json');
        else void workbench.repository.current?.recoveryDump().then(dump => downloadText(recoveryJson(dump), 'nai-storage-recovery.json')).catch(error => workbench.setError(message(error)));
      }}>DB復旧用ファイルを保存</button>
    </div></section>}
    {workbench.externalChange && !workbench.storageError && <section className="panel stack" role="status" aria-label="他の画面での変更">
      <p>別の画面（サイドパネル・広いタブ）でデータが保存されました。この画面のまま編集すると保存時に競合します。</p>
      <div className="actions"><button type="button" className="primary" disabled={workbench.saving} onClick={() => void workbench.reloadFromStorage().then(() => setNotice('他の画面で保存された最新の内容を読み込みました（元に戻す履歴はリセットされました）。')).catch(error => workbench.setError(message(error)))}>他の画面の変更を読み込む</button></div>
    </section>}
    {data && !!workbench.unsaved.length && <UnsavedRecovery workbench={workbench} onDone={setNotice} />}
    {workbench.error && <div className="error" role="alert">{workbench.error}<button type="button" onClick={() => workbench.setError('')}>閉じる</button></div>}
    {!data && workbench.storageError && <Recovery workbench={workbench} />}
    {data && <>
      <nav className="app-nav" aria-label="メイン">
        <div className="tabs" role="tablist" aria-label="機能" onKeyDown={tabKeys}>{AREAS.map(area => <div className="tab-area" role="presentation" key={area.label}>{(area.tabs.length > 1 || area.tabs[0] !== area.label) && <span className="tab-area-label" aria-hidden="true">{area.label}</span>}<div className="tab-area-tabs" role="presentation">{area.tabs.map(tabButton)}</div></div>)}<div className="tab-area settings" role="presentation"><div className="tab-area-tabs" role="presentation">{tabButton('設定')}</div></div></div>
        <div className="toolbar history">
          <button type="button" className="small" disabled={!workbench.canUndo || comparisonDraft} onClick={workbench.undo}><span aria-hidden="true">↶ </span>元に戻す</button>
          <button type="button" className="small" disabled={!workbench.canRedo || comparisonDraft} onClick={workbench.redo}>やり直す<span aria-hidden="true"> ↷</span></button>
          <InfoTip label="元に戻す・やり直す">入力欄の外で Ctrl/Cmd+Z（元に戻す）・Ctrl/Cmd+Y（やり直す）。直近30操作まで戻せます。パネルを閉じると履歴は消え、NovelAIのページへの操作は戻りません。</InfoTip>
          <span className="spacer" />
          {statusPill}
        </div>
        <PresetStatus workbench={workbench} />
      </nav>
      {firstRun && tab === 'ライブラリ' && <section className="panel stack first-run" aria-label="はじめに">
        <h2>はじめに</h2>
        <ol className="comparison-steps"><li>「ワークスペース」で構成（グループ）を作る</li><li>「ライブラリ」に部品（タグの原文）を登録し「構成に追加」</li><li>下の「出力プレビュー」をコピーしてNovelAIに貼り付け、NovelAI上で生成する</li></ol>
        <p className="hint">サンプルは「設定」→「デモを追加」で入ります。定期的に「設定」→「完全バックアップ」を保存してください。</p>
      </section>}
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
      {tab !== 'Experiment Lab' && <details className="panel preview" aria-label="ライブプレビュー" open={wide || PREVIEW_OPEN.includes(tab)}>
        <summary>出力プレビュー<small>{workspace?.title ?? '構成なし'}</small></summary>
        <div className="stack">
        <InfoTip label="出力プレビュー">現在のワークスペースから合成したプロンプトです。コピーしてNovelAIに貼り付け、NovelAI上で生成してください。OFFにした部品・範囲は出力しません。</InfoTip>
        {(['positive', 'negative'] as const).map(channel => <div className="stack" key={channel}>
          <div className="field-head"><label htmlFor={`preview-${channel}`}>{channel === 'positive' ? '出力 Positive' : '出力 Negative'}</label><button type="button" className="small primary" onClick={() => void copy(channel)}>{channel === 'positive' ? 'Positiveをコピー' : 'Negativeをコピー'}</button></div>
          <textarea id={`preview-${channel}`} readOnly rows={2} value={compiled[channel]} />
        </div>)}
        {compiled.warnings.map((warning, index) => <p role="alert" key={index}>{warning}</p>)}
        <SiteConnection client={siteClient} compiled={compiled} onImport={(channel, raw) => {
          if (!workspace) { workbench.setError('先にワークスペースを作成してください'); return; }
          workbench.commit(previous => ({ ...previous, workspaces: previous.workspaces.map(item => {
            if (item.id !== workspace.id) return item;
            if (channel === 'positive') { const { freeformPositiveSpans: _spans, ...rest } = item; return { ...rest, freeformPositive: raw, updatedAt: now() }; }
            const { freeformNegativeSpans: _spans, ...rest } = item; return { ...rest, freeformNegative: raw, updatedAt: now() };
          }) }));
        }} />
        </div>
      </details>}
    </>}
    <footer>非公式ツール・データはこの端末のみ。NovelAIの利用規約を守ってご利用ください（この拡張機能の説明より規約が優先されます）。</footer>
  </main></TagCompletionContext.Provider>;
}
