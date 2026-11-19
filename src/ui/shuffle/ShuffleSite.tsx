import { useEffect, useRef, useState } from 'react';
import type { ComposeResult } from '../../core/shuffle/compose';
import { fieldLabel, planFieldWrites, type FieldKey } from '../../core/shuffle/fields';
import { recordManual, resetAfterShuffle, startCounter, type AutoCounter } from '../../core/shuffle/generation';
import { detectModel, MODEL_PROFILES } from '../../core/shuffle/models';
import {
  afterApplyAttempt, afterRestore, editedFields, emptySessions, getSession, hasRestoreText, markUncertain, NO_WRITE_CODES,
  observeExpected, otherRestoreSessions, restoreWrites, sameDocument, updateSession, withBaseline,
  type SiteSession, type SiteSessions,
} from '../../core/shuffle/site-session';
import type { ShuffleProfile, ShuffleTrigger } from '../../core/shuffle/types';
import type { SiteClient } from '../../platform/novelai/client';
import type { FieldsInspection, FieldsPreview, SiteInspection, Target } from '../../platform/novelai/protocol';
import { newId } from '../shared';
import { AutoShuffleRun } from './auto-run';
import { Hint } from '../InfoTip';

const INTERVALS = [1, 3, 5, 10] as const;

export interface AutoCheck { fingerprint: string; step: number; blocked: string | null }
export interface ShuffleSiteProps {
  client?: SiteClient;
  profile: ShuffleProfile;
  composed: ComposeResult;
  onShuffle: (trigger: ShuffleTrigger) => { composed: ComposeResult; step: number } | null;
  onAutoEveryChange: (value: number | null) => void;
  /** Synchronous view of the latest committed configuration of a profile (not the last render). */
  autoCheck: (profileId: string) => AutoCheck;
  profileName: (profileId: string) => string;
  onAutoChange?: (running: boolean) => void;
}
interface Preview { kind: 'apply' | 'restore'; data: FieldsPreview; profileId: string }

/**
 * Site-facing shuffle controls. Nothing here writes to NovelAI unless the user
 * confirms a preview (Apply/Restore) or explicitly starts auto shuffle, and every
 * write goes through the adapter's ticketed compare-and-swap path.
 *
 * Restore text, the extension's last writes and uncertain fields are kept per
 * (tab, document, profile) session, so they can never be applied to another tab,
 * a reloaded document or another profile.
 */
export function ShuffleSite({ client, profile, composed, onShuffle, onAutoEveryChange, autoCheck, profileName, onAutoChange }: ShuffleSiteProps) {
  const [sites, setSites] = useState<SiteInspection[]>([]);
  const [selected, setSelected] = useState('');
  const [inspection, setInspection] = useState<FieldsInspection | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const [notice, setNotice] = useState('');
  const [custom, setCustom] = useState(String(profile.settings.autoEvery ?? 2));
  const [manual, setManual] = useState<AutoCounter | null>(null);
  const [auto, setAuto] = useState<{ armed: boolean; count: number; every: number; generating: boolean }>({ armed: false, count: 0, every: 0, generating: false });
  // Sessions are read synchronously by the auto-shuffle run; the state counter only re-renders.
  const sessions = useRef<SiteSessions>(emptySessions());
  const [, setSessionVersion] = useState(0);
  const run = useRef<AutoShuffleRun | null>(null);
  const latest = useRef({ onShuffle, autoCheck, onAutoChange });
  latest.current = { onShuffle, autoCheck, onAutoChange };
  const site = sites.find(item => String(item.tabId) === selected);
  const target: Target | null = site ? { tabId: site.tabId, documentId: site.documentId, url: site.url } : null;
  const every = profile.settings.autoEvery;
  const fieldsMode = profile.settings.outputMode === 'fields';
  const writable = !!inspection && !!target && sameDocument(inspection, target) && inspection.base.positive.canWrite && (composed.characters.length === 0 || inspection.characters.canWrite);
  const session = target ? getSession(sessions.current, target, profile.id) : null;
  const others = otherRestoreSessions(sessions.current, session?.key ?? null);

  const setSessions = (change: (store: SiteSessions) => SiteSessions) => { sessions.current = change(sessions.current); setSessionVersion(version => version + 1); };
  const stopAuto = (reason: string, isError = true) => run.current?.stop(reason, isError);
  // Leaving the tab releases the lease without touching UI state.
  useEffect(() => () => { const current = run.current; run.current = null; current?.stop('パネルを閉じたため自動シャッフルを停止しました'); latest.current.onAutoChange?.(false); }, []);
  // Switching profile/target or changing the interval/output always stops auto mode and drops previews.
  useEffect(() => { stopAuto('設定・対象が変わったため自動シャッフルを停止しました'); setPreview(null); setManual(null); }, [profile.id, profile.settings.enabled, every, selected, profile.settings.outputMode]);
  useEffect(() => { setPreview(null); }, [composed]);
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(() => { setPreview(null); setIssue('プレビューの有効期限が切れました。作成し直してください'); }, Math.max(0, preview.data.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [preview]);
  useEffect(() => {
    if (!auto.armed) return;
    const timer = setInterval(() => void run.current?.tick(), 1000);
    return () => clearInterval(timer);
  }, [auto.armed]);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setIssue(''); setNotice('');
    try { await action(); } catch { setIssue('サイトとの通信に失敗しました。コピーを使用してください'); } finally { setBusy(false); }
  };

  if (!client) return <section className="panel stack" aria-label="シャッフルのサイト反映">
    <h2>NovelAIへの反映</h2>
    <p className="hint">サイト連携はChrome拡張から利用できます。ここでは各欄のコピーを使用してください。</p>
    <ManualCount every={every} armed={false} manual={manual} setManual={setManual} onShuffle={onShuffle} setNotice={setNotice} custom={custom} setCustom={setCustom} onAutoEveryChange={onAutoEveryChange} />
    {notice && <p role="status">{notice}</p>}
  </section>;

  // A preview is checked against the session it was created for, never the one currently selected.
  const previewSession = preview ? getSession(sessions.current, preview.data, preview.profileId) : null;
  const edited = preview && previewSession ? editedFields(previewSession, preview.data.writes) : [];
  const detected = inspection ? detectModel(inspection.model.label) : 'unknown';
  const startAuto = async () => {
    if (!target || !every) return;
    const fields = planFieldWrites(composed).map(write => write.field);
    if (!confirm(`自動シャッフルを開始しますか？\nタブ${target.tabId}で成功した生成ジョブを${every}回数えるごとに次の構図を計算し、${fields.length}欄を書き換えます。\n・生成ボタンは押しません\n・生成中は書き換えません\n・拡張の書込み後にサイト側で編集された場合は上書きせず停止します\n・実行中にシャッフル設定やベースプロンプトを変更すると停止します`)) return;
    const read = await client.readFields(target, fields);
    if (!read.ok) { setIssue(read.reason); return; }
    if (read.type !== 'readFields') return;
    const observed = read.values.map(value => ({ field: value.field, before: value.raw }));
    const changed = editedFields(getSession(sessions.current, target, profile.id), observed);
    if (changed.length) { setIssue(`最後の反映後にサイト側で編集された欄（${changed.map(value => fieldLabel(value.field)).join('、')}）があります。Applyで確認してから開始してください`); return; }
    const check = latest.current.autoCheck(profile.id);
    if (check.blocked) { setIssue(`自動シャッフルを開始できません: ${check.blocked}`); return; }
    setSessions(store => updateSession(store, target, profile.id, current => observeExpected(withBaseline(current, observed), read.values)));
    const profileId = profile.id;
    let created: AutoShuffleRun | null = null;
    const owns = () => created !== null && run.current === created;
    created = new AutoShuffleRun({
      client, target, profileId, every, session: newId(), fingerprint: check.fingerprint, step: check.step,
      current: () => latest.current.autoCheck(profileId),
      shuffle: () => latest.current.onShuffle('auto'),
      getSession: () => getSession(sessions.current, target, profileId),
      setSession: change => setSessions(store => updateSession(store, target, profileId, change)),
      onProgress: progress => { if (owns()) setAuto(current => ({ ...current, ...progress })); },
      onWritten: count => { if (owns()) setNotice(`自動シャッフル: ${count}欄に次のプロンプトを反映しました。生成操作は行っていません。`); },
      onStop: (reason, isError) => {
        if (!owns()) return;
        run.current = null;
        setAuto(current => ({ ...current, armed: false, generating: false }));
        latest.current.onAutoChange?.(false);
        if (isError) setIssue(reason); else setNotice(reason);
      },
    });
    run.current = created;
    setAuto({ armed: true, count: 0, every, generating: false });
    latest.current.onAutoChange?.(true);
    setNotice(`自動シャッフルを開始しました（${every}ジョブごと）。いつでも停止できます。`);
    void created.tick();
  };
  const confirmPreview = async (accepted: Preview) => {
    if (!confirm(`タブ${accepted.data.tabId}の${accepted.data.writes.length}欄を、表示した内容に変更しますか？生成操作は行いません。`)) return;
    setPreview(null);
    const result = await client.applyFields(accepted.data);
    const ok = result.ok && result.type === 'applyFields';
    setSessions(store => updateSession(store, accepted.data, accepted.profileId, current => {
      if (accepted.kind === 'apply') return afterApplyAttempt(current, accepted.data.writes, ok ? { ok: true, values: result.values } : { ok: false, code: result.ok ? 'INVALID_MESSAGE' : result.code });
      if (ok) return afterRestore(current, result.values);
      return !result.ok && NO_WRITE_CODES.includes(result.code) ? current : markUncertain(current, accepted.data.writes.map(change => change.field));
    }));
    if (!result.ok) { setIssue(result.reason); return; }
    if (result.type !== 'applyFields') { setIssue('反映結果を確認できません。サイトの現在値を確認してください'); return; }
    setNotice(accepted.kind === 'apply'
      ? `${result.values.length}欄に反映し、再読取りで一致を確認しました。生成操作は行っていません。`
      : `${result.values.length}欄を反映前の原文に戻し、再読取りで一致を確認しました。`);
  };

  return <section className="panel stack" aria-label="シャッフルのサイト反映">
    <h2>NovelAIへの反映</h2>
    <Hint label="シャッフルのサイト反映" summary="Applyで変更前後を確認してから反映します">Shuffle Nowだけではサイトを変更しません。Applyで変更前後を確認してから反映します。キャラクター欄の追加・削除、座標、生成ボタンは操作しません。</Hint>
    <button type="button" className="small" disabled={busy || auto.armed} onClick={() => void perform(async () => {
      setPreview(null); setInspection(null);
      const result = await client.discover();
      if (!result.ok) { setSites([]); setIssue(result.reason); return; }
      setSites(result.sites); setSelected('');
      setNotice(result.sites.length ? `${result.sites.length}個の画像ページを検出しました。対象を選択してください。` : 'NovelAI画像ページに接続できません。コピーは利用できます。');
    })}>シャッフル用にNovelAIを接続</button>
    <label>シャッフルの対象タブ<select value={selected} disabled={busy || auto.armed} onChange={event => {
      const value = event.target.value; setSelected(value); setInspection(null); setIssue('');
      const chosen = sites.find(item => String(item.tabId) === value);
      if (!chosen) return;
      void perform(async () => {
        const result = await client.inspectFields(chosen);
        if (!result.ok) { setIssue(result.reason); return; }
        if (result.type === 'inspectFields') setInspection(result.inspection);
      });
    }}><option value="">対象を選択</option>{sites.map(item => <option key={item.tabId} value={item.tabId}>タブ {item.tabId}: {item.title}</option>)}</select></label>
    {inspection && <ul className="hint" aria-label="シャッフルの対象サイトの対応状況">
      <li>ベース Prompt: {inspection.base.positive.canWrite ? '書込み可' : inspection.base.positive.canRead ? '読取りのみ' : '不可'} — {inspection.base.positive.reason}</li>
      <li>キャラクター欄: {inspection.characters.slots}個（{inspection.characters.canWrite ? '書込み可' : '書込み不可'}） — {inspection.characters.reason}</li>
      <li>モデル表示: {inspection.model.label ?? '不明'}{detected !== 'unknown' && detected !== profile.settings.model ? `（${MODEL_PROFILES[detected].label}を検出。設定は${MODEL_PROFILES[profile.settings.model].label}です）` : ''}</li>
      <li>キャラクター位置: 変更しません — {inspection.positions.reason}</li>
      <li>生成検知: {inspection.generation.supported ? '対応' : '非対応'} — {inspection.generation.reason}</li>
    </ul>}
    {fieldsMode && inspection && composed.characters.length !== inspection.characters.slots && <p className="hint">⚠ 構成は{composed.characters.length}人、サイトのキャラクター欄は{inspection.characters.slots}個です。一致しない場合は反映できません。</p>}
    {!fieldsMode && <p className="hint">|区切り形式はコピー専用です。サイトへは反映しません。</p>}
    <div className="actions">
      <button type="button" disabled={busy || auto.armed || !target || !writable || !fieldsMode || !!composed.errors.length} onClick={() => void perform(async () => {
        if (!target) return;
        const profileId = profile.id;
        const result = await client.prepareFields(target, composed.characters.length, planFieldWrites(composed));
        if (!result.ok) { setIssue(result.reason); return; }
        if (result.type === 'prepareFields') { setPreview({ kind: 'apply', data: result.preview, profileId }); setOverwrite(false); }
      })}>Apply（反映プレビュー）</button>
      <button type="button" disabled={busy || auto.armed || !target || !writable || !session || !hasRestoreText(session)} onClick={() => void perform(async () => {
        if (!target) return;
        const profileId = profile.id;
        const writes = restoreWrites(getSession(sessions.current, target, profileId));
        if (!writes.length) return;
        const inspected = await client.inspectFields(target);
        if (!inspected.ok) { setIssue(inspected.reason); return; }
        if (inspected.type !== 'inspectFields') return;
        const result = await client.prepareFields(target, inspected.inspection.characters.slots, writes);
        if (!result.ok) { setIssue(result.reason); return; }
        if (result.type === 'prepareFields') { setPreview({ kind: 'restore', data: result.preview, profileId }); setOverwrite(false); }
      })}>Restore（復元プレビュー）</button>
    </div>
    {composed.errors.length > 0 && <p className="hint">エラーがあるため反映できません。</p>}
    {preview && <div className="panel stack" aria-label={preview.kind === 'apply' ? 'シャッフルの反映前の確認' : 'シャッフルの復元前の確認'}>
      <p>タブ{preview.data.tabId} / {preview.data.writes.length}欄を{preview.kind === 'apply' ? '置換' : '反映前の原文へ復元'}します（有効期限60秒）。</p>
      {preview.data.writes.map(change => <div className="columns" key={change.field}>
        <label>{fieldLabel(change.field)}（現在）<textarea readOnly rows={2} value={change.before} /></label>
        <label>{fieldLabel(change.field)}（{preview.kind === 'apply' ? '反映後' : '復元後'}）<textarea readOnly rows={2} value={change.after} /></label>
      </div>)}
      {edited.length > 0 && <div role="alert" className="stack"><p>拡張が最後に書き込んだ後、NovelAI側で編集された（または前回の反映が完了しなかった）欄があります: {edited.map(change => fieldLabel(change.field)).join('、')}</p>
        <label className="inline"><input type="checkbox" checked={overwrite} onChange={event => setOverwrite(event.target.checked)} />サイト側の編集を上書きすることを確認しました</label></div>}
      <div className="actions"><button type="button" className="primary" disabled={busy || (edited.length > 0 && !overwrite)} onClick={() => void perform(() => confirmPreview(preview))}>{preview.kind === 'apply' ? '確認してApply' : '確認してRestore'}</button><button type="button" disabled={busy} onClick={() => setPreview(null)}>プレビューを破棄</button></div>
    </div>}
    {session && hasRestoreText(session) && <RestoreText session={session} label="反映前の原文" summary={`反映前の原文（Restore用、タブ${session.target.tabId}、${Object.keys(session.baseline).length}欄）`} />}
    {others.length > 0 && <details><summary>他の対象・再読込前のページの反映前原文（コピー専用、{others.length}件）</summary><div className="stack">
      <Hint label="他の対象の反映前原文" summary="取り違えを防ぐため、ここからは反映しません（コピー専用）">別のタブ・再読込前のドキュメント・別プロファイルで記録した原文です。取り違えを防ぐため、この画面からは反映しません。必要なら選択してコピーしてください。</Hint>
      {others.map(item => <div className="stack" key={item.key}>
        <RestoreText session={item} label={`タブ${item.target.tabId}・${profileName(item.profileId)}・ページ${item.target.documentId.slice(0, 8)}`} open />
        <button type="button" onClick={() => { if (confirm('この反映前原文の記録を破棄しますか？パネル上の記録だけを消し、サイトは変更しません。')) setSessions(store => ({ ...store, sessions: store.sessions.filter(entry => entry.key !== item.key) })); }}>タブ{item.target.tabId}・ページ{item.target.documentId.slice(0, 8)}の記録を破棄</button>
      </div>)}
    </div></details>}

    <h3>生成回数に応じた自動シャッフル</h3>
    <ManualCount every={every} armed={auto.armed} manual={manual} setManual={setManual} onShuffle={onShuffle} setNotice={setNotice} custom={custom} setCustom={setCustom} onAutoEveryChange={onAutoEveryChange} />
    <Hint label="生成回数の数え方" summary="成功した生成ジョブの回数で切り替えます">回数は成功した生成ジョブ数です。1回の生成で複数枚を出力しても1回と数えます。自動シャッフルは生成ボタンを押しません。開始時点で生成中・表示中のジョブは数えません。実行中にシャッフル設定やベースプロンプトを変えると安全のため停止します。</Hint>
    <div className="actions">
      <button type="button" disabled={busy || auto.armed || !every || !target || !inspection?.generation.supported || !writable || !fieldsMode || !!composed.errors.length || !profile.settings.enabled} onClick={() => void perform(startAuto)}>自動シャッフルを開始</button>
      <button type="button" disabled={!auto.armed} onClick={() => stopAuto('自動シャッフルを停止しました。', false)}>自動シャッフルを停止</button>
    </div>
    <p role="status" aria-label="自動シャッフルの状態">{auto.armed ? `自動シャッフル: 動作中（${auto.count}/${auto.every}ジョブ${auto.generating ? '・生成中のため待機' : ''}）` : `自動シャッフル: 停止中${inspection && !inspection.generation.supported ? '（このページでは生成を検知できません。手動記録を使用してください）' : ''}`}</p>
    {issue && <p role="alert">{issue}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}

function RestoreText({ session, label, summary, open }: { session: SiteSession; label: string; summary?: string; open?: boolean }) {
  const fields = Object.entries(session.baseline) as [FieldKey, string][];
  const body = <div className="stack">
    {fields.map(([field, text]) => <label key={field}>{label}: {fieldLabel(field)}（反映前）<textarea readOnly rows={2} value={text} /></label>)}
    {!open && <Hint label="反映前の原文の保持" summary="パネルを閉じるまで保持します">パネルを閉じるまで保持します（DBには保存しません）。この対象タブ・ページ・プロファイル専用です。Undoはサイトを戻しません。</Hint>}
  </div>;
  return open ? body : <details><summary>{summary}</summary>{body}</details>;
}

function ManualCount({ every, armed, manual, setManual, onShuffle, setNotice, custom, setCustom, onAutoEveryChange }: {
  every: number | null; armed: boolean; manual: AutoCounter | null; setManual: (counter: AutoCounter | null) => void; onShuffle: ShuffleSiteProps['onShuffle'];
  setNotice: (text: string) => void; custom: string; setCustom: (value: string) => void; onAutoEveryChange: (value: number | null) => void;
}) {
  const choice = every === null ? '' : (INTERVALS as readonly number[]).includes(every) ? String(every) : 'custom';
  return <div className="stack">
    <div className="actions">
      <label>自動シャッフルの間隔<select value={choice} disabled={armed} onChange={event => {
        const value = event.target.value;
        onAutoEveryChange(value === '' ? null : value === 'custom' ? Math.min(1000, Math.max(1, Number(custom) || 2)) : Number(value));
      }}><option value="">無効</option><option value="1">毎回</option><option value="3">3回ごと</option><option value="5">5回ごと</option><option value="10">10回ごと</option><option value="custom">任意の回数</option></select></label>
      {choice === 'custom' && <label>任意の回数<input type="number" min={1} max={1000} value={custom} disabled={armed} onChange={event => setCustom(event.target.value)} onBlur={() => {
        const value = Math.min(1000, Math.max(1, Math.round(Number(custom)) || 1)); setCustom(String(value)); if (value !== every) onAutoEveryChange(value);
      }} /></label>}
    </div>
    {every !== null && <div className="actions"><button type="button" disabled={armed} onClick={() => {
      const update = recordManual(manual && manual.every === every ? manual : startCounter(every));
      if (!update.due) { setManual(update.counter); setNotice(`生成完了を記録しました（${update.counter.count}/${every}）。`); return; }
      const next = onShuffle('manual-count');
      setManual(resetAfterShuffle(update.counter));
      setNotice(next ? `${every}回に達したため次のプロンプトに切り替えました。サイトは変更していません。Applyまたはコピーしてください。` : 'シャッフルできませんでした。設定を確認してください。');
    }}>生成完了を手動で記録（+1）</button><small>手動記録: {manual && manual.every === every ? manual.count : 0}/{every}</small></div>}
  </div>;
}
