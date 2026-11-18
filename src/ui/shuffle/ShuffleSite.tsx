import { useEffect, useRef, useState } from 'react';
import type { ComposeResult } from '../../core/shuffle/compose';
import { fieldLabel, planFieldWrites, type FieldKey } from '../../core/shuffle/fields';
import { observeStatus, recordManual, resetAfterShuffle, startCounter, type AutoCounter } from '../../core/shuffle/generation';
import { detectModel, MODEL_PROFILES } from '../../core/shuffle/models';
import type { ShuffleProfile, ShuffleTrigger } from '../../core/shuffle/types';
import type { SiteClient } from '../../platform/novelai/client';
import type { FieldsInspection, FieldsPreview, SiteInspection, Target } from '../../platform/novelai/protocol';
import { newId } from '../shared';

type Values = Partial<Record<FieldKey, string>>;
const INTERVALS = [1, 3, 5, 10] as const;

export interface ShuffleSiteProps {
  client?: SiteClient;
  profile: ShuffleProfile;
  composed: ComposeResult;
  onShuffle: (trigger: ShuffleTrigger) => ComposeResult | null;
  onAutoEveryChange: (value: number | null) => void;
}

/**
 * Site-facing shuffle controls. Nothing here writes to NovelAI unless the user
 * confirms a preview (Apply/Restore) or explicitly starts auto shuffle, and every
 * write goes through the adapter's ticketed compare-and-swap path.
 */
export function ShuffleSite({ client, profile, composed, onShuffle, onAutoEveryChange }: ShuffleSiteProps) {
  const [sites, setSites] = useState<SiteInspection[]>([]);
  const [selected, setSelected] = useState('');
  const [inspection, setInspection] = useState<FieldsInspection | null>(null);
  const [preview, setPreview] = useState<{ kind: 'apply' | 'restore'; data: FieldsPreview } | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const [notice, setNotice] = useState('');
  const [custom, setCustom] = useState(String(profile.settings.autoEvery ?? 2));
  const [baseline, setBaseline] = useState<Values>({});
  const [manual, setManual] = useState<AutoCounter | null>(null);
  const [auto, setAuto] = useState<{ armed: boolean; count: number; every: number; generating: boolean }>({ armed: false, count: 0, every: 0, generating: false });
  // Refs are read by the polling loop, which must never act on a stale closure.
  const lastWritten = useRef<Values>({});
  // Fields whose state is unknown after a failed/unverified write. They always need explicit overwrite consent.
  const uncertain = useRef(new Set<FieldKey>());
  const baselineRef = useRef<Values>({});
  const armed = useRef(false);
  const counter = useRef<AutoCounter | null>(null);
  const pending = useRef<ComposeResult | null>(null);
  const session = useRef('');
  const ticking = useRef(false);
  const targetRef = useRef<Target | null>(null);
  const shuffleRef = useRef(onShuffle);
  shuffleRef.current = onShuffle;
  const site = sites.find(item => String(item.tabId) === selected);
  const target: Target | null = site ? { tabId: site.tabId, documentId: site.documentId, url: site.url } : null;
  const every = profile.settings.autoEvery;
  const fieldsMode = profile.settings.outputMode === 'fields';
  const writable = !!inspection && inspection.base.positive.canWrite && (composed.characters.length === 0 || inspection.characters.canWrite);

  const updateBaseline = (next: Values) => { baselineRef.current = next; setBaseline(next); };
  const stopAuto = (reason: string, isError = true) => {
    if (armed.current && targetRef.current && client) void client.releaseGeneration(targetRef.current, session.current).catch(() => undefined);
    armed.current = false; pending.current = null; counter.current = null;
    setAuto(current => ({ ...current, armed: false, generating: false }));
    if (isError) setIssue(reason); else setNotice(reason);
  };
  // Leaving the tab, switching profile/target or changing the interval always stops auto mode.
  useEffect(() => () => { if (armed.current && targetRef.current && client) void client.releaseGeneration(targetRef.current, session.current).catch(() => undefined); armed.current = false; }, [client]);
  useEffect(() => { if (armed.current) stopAuto('設定・対象が変わったため自動シャッフルを停止しました'); setPreview(null); setManual(null); }, [profile.id, profile.settings.enabled, every, selected, profile.settings.outputMode]);
  useEffect(() => { setPreview(null); }, [composed]);
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(() => { setPreview(null); setIssue('プレビューの有効期限が切れました。作成し直してください'); }, Math.max(0, preview.data.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [preview]);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setIssue(''); setNotice('');
    try { await action(); } catch { setIssue('サイトとの通信に失敗しました。コピーを使用してください'); } finally { setBusy(false); }
  };
  const record = (values: { field: FieldKey; raw: string }[]) => {
    lastWritten.current = { ...lastWritten.current, ...Object.fromEntries(values.map(value => [value.field, value.raw])) };
    for (const value of values) uncertain.current.delete(value.field);
  };
  const keepBaseline = (preview: FieldsPreview) => {
    const next = { ...baselineRef.current };
    for (const change of preview.writes) if (next[change.field] === undefined) next[change.field] = change.before;
    updateBaseline(next);
  };
  const isEdited = (change: { field: FieldKey; before: string }) => uncertain.current.has(change.field) || (lastWritten.current[change.field] !== undefined && lastWritten.current[change.field] !== change.before);

  const autoApply = async (site: Target, next: ComposeResult) => {
    if (!client) return;
    const prepared = await client.prepareFields(site, next.characters.length, planFieldWrites(next));
    if (!armed.current) return;
    if (!prepared.ok) { if (prepared.code !== 'BUSY') stopAuto(`自動シャッフルを停止しました: ${prepared.reason}`); return; }
    if (prepared.type !== 'prepareFields') { stopAuto('自動シャッフルを停止しました: 予期しない応答です'); return; }
    const edited = prepared.preview.writes.filter(change => uncertain.current.has(change.field) || lastWritten.current[change.field] !== change.before);
    if (edited.length) { stopAuto(`拡張の最後の書込み後にNovelAI側で編集された欄（${edited.map(change => fieldLabel(change.field)).join('、')}）があるため、上書きせず自動シャッフルを停止しました。Applyで差分を確認してください`); return; }
    const applied = await client.applyFields(prepared.preview);
    if (!applied.ok && applied.code !== 'BUSY') for (const change of prepared.preview.writes) uncertain.current.add(change.field);
    if (!armed.current) return;
    if (!applied.ok) { if (applied.code !== 'BUSY') stopAuto(`自動シャッフルを停止しました: ${applied.reason}`); return; }
    if (applied.type !== 'applyFields') { stopAuto('自動シャッフルを停止しました: 予期しない応答です'); return; }
    record(applied.values);
    pending.current = null;
    if (counter.current) counter.current = resetAfterShuffle(counter.current);
    setAuto(current => ({ ...current, count: 0 }));
    setNotice(`自動シャッフル: ${applied.values.length}欄に次のプロンプトを反映しました。生成操作は行っていません。`);
  };
  const tick = async () => {
    if (!armed.current || ticking.current || !client || !targetRef.current) return;
    ticking.current = true;
    try {
      const site = targetRef.current;
      const result = await client.generationStatus(site, session.current);
      if (!armed.current) return;
      if (!result.ok || result.type !== 'generationStatus') { stopAuto(`自動シャッフルを停止しました: ${result.ok ? '予期しない応答です' : result.reason}`); return; }
      if (!result.status.supported) { stopAuto(`自動シャッフルを停止しました: ${result.status.reason}`); return; }
      const update = observeStatus(counter.current!, result.status);
      counter.current = update.counter;
      setAuto(current => ({ ...current, count: update.counter.count, generating: result.status.generating }));
      if ((!update.due && !pending.current) || result.status.generating) return; // Never write while generating.
      if (!pending.current) {
        const next = shuffleRef.current('auto');
        if (!next) { stopAuto('シャッフルできないため自動シャッフルを停止しました'); return; }
        if (next.errors.length) { stopAuto(`自動シャッフルを停止しました: ${next.errors[0]}`); return; }
        pending.current = next;
      }
      await autoApply(site, pending.current);
    } catch {
      if (armed.current) stopAuto('サイトとの通信に失敗したため自動シャッフルを停止しました');
    } finally { ticking.current = false; }
  };
  useEffect(() => {
    if (!auto.armed) return;
    const timer = setInterval(() => void tick(), 1000);
    return () => clearInterval(timer);
  }, [auto.armed]);

  if (!client) return <section className="panel stack" aria-label="シャッフルのサイト反映">
    <h2>NovelAIへの反映</h2>
    <p className="hint">サイト連携はChrome拡張から利用できます。ここでは各欄のコピーを使用してください。</p>
    <ManualCount every={every} armed={false} manual={manual} setManual={setManual} onShuffle={onShuffle} setNotice={setNotice} custom={custom} setCustom={setCustom} onAutoEveryChange={onAutoEveryChange} />
    {notice && <p role="status">{notice}</p>}
  </section>;

  const edited = preview ? preview.data.writes.filter(isEdited) : [];
  const detected = inspection ? detectModel(inspection.model.label) : 'unknown';
  return <section className="panel stack" aria-label="シャッフルのサイト反映">
    <h2>NovelAIへの反映</h2>
    <p className="hint">Shuffle Nowだけではサイトを変更しません。Applyで変更前後を確認してから反映します。キャラクター欄の追加・削除、座標、生成ボタンは操作しません。</p>
    <button type="button" disabled={busy || auto.armed} onClick={() => void perform(async () => {
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
        const result = await client.prepareFields(target, composed.characters.length, planFieldWrites(composed));
        if (!result.ok) { setIssue(result.reason); return; }
        if (result.type === 'prepareFields') { setPreview({ kind: 'apply', data: result.preview }); setOverwrite(false); }
      })}>Apply（反映プレビュー）</button>
      <button type="button" disabled={busy || auto.armed || !target || !writable || !Object.keys(baseline).length} onClick={() => void perform(async () => {
        if (!target) return;
        const inspected = await client.inspectFields(target);
        if (!inspected.ok) { setIssue(inspected.reason); return; }
        if (inspected.type !== 'inspectFields') return;
        const writes = (Object.entries(baselineRef.current) as [FieldKey, string][]).map(([field, text]) => ({ field, text }));
        const result = await client.prepareFields(target, inspected.inspection.characters.slots, writes);
        if (!result.ok) { setIssue(result.reason); return; }
        if (result.type === 'prepareFields') { setPreview({ kind: 'restore', data: result.preview }); setOverwrite(false); }
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
      <div className="actions"><button type="button" disabled={busy || (edited.length > 0 && !overwrite)} onClick={() => void perform(async () => {
        if (!confirm(`タブ${preview.data.tabId}の${preview.data.writes.length}欄を、表示した内容に変更しますか？生成操作は行いません。`)) return;
        const accepted = preview; setPreview(null);
        // Keep the pre-apply text for Restore even if the write fails part-way.
        if (accepted.kind === 'apply') keepBaseline(accepted.data);
        const result = await client.applyFields(accepted.data);
        if (!result.ok) {
          if (!['EXPIRED', 'CONFLICT', 'BUSY'].includes(result.code)) for (const change of accepted.data.writes) uncertain.current.add(change.field);
          setIssue(result.reason); return;
        }
        if (result.type !== 'applyFields') return;
        if (accepted.kind === 'apply') {
          record(result.values);
          setNotice(`${result.values.length}欄に反映し、再読取りで一致を確認しました。生成操作は行っていません。`);
        } else {
          lastWritten.current = Object.fromEntries(result.values.map(value => [value.field, value.raw]));
          uncertain.current.clear();
          updateBaseline({});
          setNotice(`${result.values.length}欄を反映前の原文に戻し、再読取りで一致を確認しました。`);
        }
      })}>{preview.kind === 'apply' ? '確認してApply' : '確認してRestore'}</button><button type="button" disabled={busy} onClick={() => setPreview(null)}>プレビューを破棄</button></div>
    </div>}
    {Object.keys(baseline).length > 0 && <details><summary>反映前の原文（Restore用、{Object.keys(baseline).length}欄）</summary><div className="stack">
      {(Object.entries(baseline) as [FieldKey, string][]).map(([field, text]) => <label key={field}>{fieldLabel(field)}（反映前）<textarea readOnly rows={2} value={text} /></label>)}
      <p className="hint">パネルを閉じるまで保持します（DBには保存しません）。Undoはサイトを戻しません。</p>
    </div></details>}

    <h3>生成回数に応じた自動シャッフル</h3>
    <ManualCount every={every} armed={auto.armed} manual={manual} setManual={setManual} onShuffle={onShuffle} setNotice={setNotice} custom={custom} setCustom={setCustom} onAutoEveryChange={onAutoEveryChange} />
    <p className="hint">回数は成功した生成ジョブ数です。1回の生成で複数枚を出力しても1回と数えます。自動シャッフルは生成ボタンを押しません。</p>
    <div className="actions">
      <button type="button" disabled={busy || auto.armed || !every || !target || !inspection?.generation.supported || !writable || !fieldsMode || !!composed.errors.length || !profile.settings.enabled} onClick={() => void perform(async () => {
        if (!target || !every) return;
        const fields = planFieldWrites(composed).map(write => write.field);
        if (!confirm(`自動シャッフルを開始しますか？\nタブ${target.tabId}で成功した生成ジョブを${every}回数えるごとに次の構図を計算し、${fields.length}欄を書き換えます。\n・生成ボタンは押しません\n・生成中は書き換えません\n・拡張の書込み後にサイト側で編集された場合は上書きせず停止します`)) return;
        const read = await client.readFields(target, fields);
        if (!read.ok) { setIssue(read.reason); return; }
        if (read.type !== 'readFields') return;
        const changed = read.values.filter(value => isEdited({ field: value.field, before: value.raw }));
        if (changed.length) { setIssue(`最後の反映後にサイト側で編集された欄（${changed.map(value => fieldLabel(value.field)).join('、')}）があります。Applyで確認してから開始してください`); return; }
        const next = { ...baselineRef.current };
        for (const value of read.values) { if (lastWritten.current[value.field] === undefined) lastWritten.current[value.field] = value.raw; if (next[value.field] === undefined) next[value.field] = value.raw; }
        updateBaseline(next);
        session.current = newId(); counter.current = startCounter(every); pending.current = null; targetRef.current = target; armed.current = true;
        setAuto({ armed: true, count: 0, every, generating: false });
        setNotice(`自動シャッフルを開始しました（${every}ジョブごと）。いつでも停止できます。`);
        void tick();
      })}>自動シャッフルを開始</button>
      <button type="button" disabled={!auto.armed} onClick={() => stopAuto('自動シャッフルを停止しました。', false)}>自動シャッフルを停止</button>
    </div>
    <p role="status" aria-label="自動シャッフルの状態">{auto.armed ? `自動シャッフル: 動作中（${auto.count}/${auto.every}ジョブ${auto.generating ? '・生成中のため待機' : ''}）` : `自動シャッフル: 停止中${inspection && !inspection.generation.supported ? '（このページでは生成を検知できません。手動記録を使用してください）' : ''}`}</p>
    {issue && <p role="alert">{issue}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
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
