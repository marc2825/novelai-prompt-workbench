import { useMemo, useState } from 'react';
import { compileWorkspace } from '../core/compose';
import { composeShuffle, describeSelection, diffComposed, type ComposeResult } from '../core/shuffle/compose';
import { MODEL_IDS, MODEL_PROFILES } from '../core/shuffle/models';
import {
  activeProfile, addProfile, advanceShuffle, clearCurrent, createProfile, getShuffle, peekNext, reapplyHistory, removeProfile,
  resetCursor, shuffleConfigFingerprint, updateProfile, updateSettings, withShuffle,
} from '../core/shuffle/state';
import { MAX_AVOID_RECENT, SHUFFLE_TARGETS, type ShuffleData, type ShuffleProfile, type ShuffleSettings, type ShuffleTarget, type ShuffleTrigger } from '../core/shuffle/types';
import type { WorkbenchData } from '../core/types';
import { recoveryJson } from '../data/recovery';
import type { SiteClient } from '../platform/novelai/client';
import { downloadText, Empty, newId, now, Rename } from './shared';
import { CameraList, CharacterList, PoolList, ShuffleTransfer, TemplateList } from './shuffle/LibraryEditors';
import { NumberCommit, TextCommit } from './shuffle/inputs';
import { ShuffleSite, type AutoCheck } from './shuffle/ShuffleSite';
import type { Workbench } from './useWorkbench';

const TARGET_LABELS: Record<ShuffleTarget, string> = { role: '役割', pose: 'ポーズ', expression: '表情', camera: 'カメラ・視線', position: '位置・順序' };
const MODE_LABELS = { random: 'Pure Random（完全ランダム）', bag: 'Shuffle Bag（使い切るまで重複なし）', weighted: 'Weighted Random（重み付き）' } as const;
const TRIGGER_LABELS: Record<ShuffleTrigger, string> = { manual: '手動', auto: '自動', 'manual-count': '手動記録' };
const newSeed = () => newId().slice(0, 8);

function baseOf(data: WorkbenchData) {
  const workspace = data.workspaces.find(item => item.id === data.settings.activeWorkspaceId);
  const compiled = workspace ? compileWorkspace(workspace) : null;
  return { positive: compiled?.positive ?? '', negative: compiled?.negative ?? '', warnings: compiled?.warnings ?? [], title: workspace?.title ?? null };
}

function Outputs({ result, label, onCopy }: { result: ComposeResult; label: string; onCopy: (text: string, what: string) => void }) {
  return <div className="stack" aria-label={label}>
    {result.pipe !== null && <div className="stack"><label>{label}: |区切り（コピー専用）<textarea readOnly rows={3} value={result.pipe} /></label><button type="button" onClick={() => onCopy(result.pipe!, '|区切りプロンプト')}>|区切りをコピー</button></div>}
    <label>{label}: ベース Prompt<textarea readOnly rows={2} value={result.base.positive} /></label>
    <button type="button" onClick={() => onCopy(result.base.positive, 'ベース Prompt')}>ベース Promptをコピー</button>
    {result.characters.map((item, index) => <div className="stack" key={item.characterId}>
      <label>{label}: キャラクター{index + 1}（{item.name}{item.side ? ` / ${item.side === 'left' ? '左' : '右'}` : ''}）<textarea readOnly rows={2} value={item.positive} /></label>
      <div className="actions"><button type="button" onClick={() => onCopy(item.positive, `${item.name}のPrompt`)}>{item.name}のPromptをコピー</button>
        {item.negative !== null && <button type="button" onClick={() => onCopy(item.negative!, `${item.name}のUndesired Content`)}>{item.name}のUCをコピー</button>}</div>
    </div>)}
  </div>;
}

export function Shuffle({ workbench, siteClient }: { workbench: Workbench; siteClient?: SiteClient }) {
  const data = workbench.data!;
  const shuffle = getShuffle(data);
  const profile = activeProfile(shuffle);
  const [profileName, setProfileName] = useState('');
  const [notice, setNotice] = useState('');
  // While auto shuffle runs, controls that move the cursor are locked; any other change stops the run.
  const [autoRunning, setAutoRunning] = useState(false);
  const base = useMemo(() => baseOf(data), [data]);
  const change = (update: (shuffle: ShuffleData) => ShuffleData) => workbench.commit(previous => withShuffle(previous, update));
  const changeProfile = (update: (profile: ShuffleProfile) => ShuffleProfile) => !!profile && change(current => updateProfile(current, profile.id, update));
  const setSettings = (patch: Partial<ShuffleSettings>) => changeProfile(current => updateSettings(current, patch));
  const composed = useMemo(() => profile ? composeShuffle({ library: shuffle, profile, selection: profile.current, base }) : null, [shuffle, profile, base]);
  const next = useMemo(() => {
    if (!profile || !profile.settings.enabled) return null;
    const outcome = peekNext(shuffle, profile);
    return { outcome, composed: composeShuffle({ library: shuffle, profile, selection: outcome.selection, base }) };
  }, [shuffle, profile, base]);
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setNotice(`${what}をコピーしました。`); }
    catch { workbench.setError('コピーできませんでした。出力欄を選択して手動でコピーしてください。'); }
  };
  const shuffleNow = (trigger: ShuffleTrigger): { composed: ComposeResult; step: number } | null => {
    if (!profile || workbench.storageFailed()) return null;
    const profileId = profile.id;
    let result: { composed: ComposeResult; step: number } | null = null;
    // Consecutive shuffles share one undo entry; Undo returns to before the run.
    const ok = workbench.commit(previous => {
      const advanced = advanceShuffle(previous, { profileId, historyId: newId(), now: now(), trigger, base: baseOf(previous) });
      result = { composed: advanced.composed, step: advanced.outcome.cursor.step };
      return advanced.data;
    }, false, { coalesce: true });
    return ok ? result : null;
  };
  /** Reads the latest committed data (not this render), so a running auto shuffle never acts on stale props. */
  const autoCheck = (profileId: string): AutoCheck => {
    const latest = workbench.latest();
    if (!latest) return { fingerprint: '', step: -1, blocked: 'データを読み込めません' };
    const current = getShuffle(latest);
    const target = current.profiles.find(item => item.id === profileId);
    const fingerprint = shuffleConfigFingerprint(current, profileId, baseOf(latest));
    if (!target || fingerprint === null) return { fingerprint: '', step: -1, blocked: 'シャッフルプロファイルが削除されました' };
    const blocked = workbench.storageFailed() ? '保存エラーのため履歴を保存できません' : current.activeProfileId !== profileId ? '別のプロファイルに切り替わりました' : !target.settings.enabled ? 'シャッフルが無効です' : null;
    return { fingerprint, step: target.cursor.step, blocked };
  };
  const recoveries = data.shuffleRecovery ?? [];
  const history = shuffle.history.filter(entry => entry.profileId === profile?.id);

  return <div className="stack">
    {(recoveries.length > 0 || workbench.loadNotice) && <section className="panel stack" role="alert" aria-label="シャッフル設定の復旧">
      {workbench.loadNotice && <p>{workbench.loadNotice}</p>}
      {recoveries.length > 0 && <><p>読み込めなかったシャッフル設定、または移行前のバックアップを{recoveries.length}件保持しています。ライブラリ等は影響を受けていません。</p>
        <div className="actions"><button type="button" onClick={() => downloadText(recoveryJson(recoveries), 'nai-shuffle-recovery.json')}>シャッフル復旧データを保存</button>
          <button type="button" onClick={() => { if (confirm('保持している復旧データを破棄しますか？先に保存することをおすすめします。Undoで戻せます。')) { workbench.commit(previous => { const { shuffleRecovery: _removed, ...rest } = previous; return rest as WorkbenchData; }); workbench.setLoadNotice(''); } }}>復旧データを破棄</button></div></>}
    </section>}

    <section className="panel stack" aria-label="シャッフル設定">
      <h2>シャッフル</h2>
      {autoRunning && <p role="status" aria-label="自動シャッフル実行中の注意" className="hint">⚠ 自動シャッフル実行中です。シャッフル設定・キャラクター・テンプレート・候補・ベースプロンプトを変更すると、安全のため自動で停止します。</p>}
      <p className="hint">キャラクターの外見は固定したまま、役割・ポーズ・カメラ・順序だけを入れ替えます。プレビューとApplyまでNovelAIの入力欄は変更しません。</p>
      <div className="actions">
        <label>シャッフルプロファイル<select value={profile?.id ?? ''} disabled={autoRunning} onChange={event => change(current => ({ ...current, activeProfileId: event.target.value || null }))}><option value="" disabled>プロファイルを選択</option>{shuffle.profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <form className="actions" aria-label="シャッフルプロファイル作成" onSubmit={event => {
          event.preventDefault();
          const created = createProfile(newId(), profileName.trim() || `プロファイル${shuffle.profiles.length + 1}`, newSeed());
          if (change(current => addProfile(current, { ...created, characterIds: current.characters.map(item => item.id).slice(0, 6) }))) setProfileName('');
        }}><label>新しいプロファイル名<input maxLength={200} value={profileName} onChange={event => setProfileName(event.target.value)} /></label><button type="submit">＋ プロファイル</button></form>
      </div>
      {!profile ? <Empty>プロファイルを作成すると、シャッフル方式・Seed・対象キャラクターを設定できます。</Empty> : <>
        <Rename label="プロファイル名" value={profile.name} onSave={name => changeProfile(current => ({ ...current, name }))} />
        <label className="inline"><input type="checkbox" checked={profile.settings.enabled} onChange={event => setSettings({ enabled: event.target.checked })} />シャッフル有効</label>
        <fieldset className="actions"><legend>対象カテゴリ</legend>{SHUFFLE_TARGETS.map(target => <label className="inline" key={target}><input type="checkbox" checked={profile.settings.targets[target]} onChange={event => setSettings({ targets: { ...profile.settings.targets, [target]: event.target.checked } })} />{TARGET_LABELS[target]}</label>)}</fieldset>
        <div className="columns">
          <label>シャッフル方式<select value={profile.settings.mode} onChange={event => setSettings({ mode: event.target.value as ShuffleSettings['mode'] })}>{Object.entries(MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <NumberCommit label="直近N件と同じ構図を避ける" value={profile.settings.avoidRecent} min={0} max={MAX_AVOID_RECENT} onCommit={avoidRecent => setSettings({ avoidRecent })} />
        </div>
        <label className="inline"><input type="checkbox" checked={profile.settings.avoidRepeat} onChange={event => setSettings({ avoidRepeat: event.target.checked })} />直前と同じ候補を避ける</label>
        <div className="actions">
          <TextCommit label="シャッフルSeed" value={profile.settings.seed} maxLength={128} required onCommit={seed => setSettings({ seed: seed.trim() })} />
          <button type="button" onClick={() => setSettings({ seed: newSeed() })}>Seedを再生成</button>
          <button type="button" disabled={!profile.cursor.step || autoRunning} onClick={() => changeProfile(resetCursor)}>ステップ0に戻す</button>
        </div>
        <small>ステップ {profile.cursor.step}。同じ設定・Seed・ステップ数で同じ結果を再現します。NovelAIの画像生成Seedとは別で、生成Seedは読み書きしません。</small>
        <div className="columns">
          <label>モデル<select value={profile.settings.model} onChange={event => setSettings({ model: event.target.value as ShuffleSettings['model'] })}>{MODEL_IDS.map(id => <option key={id} value={id}>{MODEL_PROFILES[id].label}</option>)}</select></label>
          <label>出力形式<select value={profile.settings.outputMode} onChange={event => setSettings({ outputMode: event.target.value as ShuffleSettings['outputMode'] })}><option value="fields">キャラクター欄（推奨）</option><option value="pipe">|区切り（コピー専用）</option></select></label>
        </div>
        {profile.settings.targets.position && <div className="columns">
          <TextCommit label="左側キャラクターの補助テキスト" value={profile.settings.positionHints.left} maxLength={1000} onCommit={left => setSettings({ positionHints: { ...profile.settings.positionHints, left } })} />
          <TextCommit label="右側キャラクターの補助テキスト" value={profile.settings.positionHints.right} maxLength={1000} onCommit={right => setSettings({ positionHints: { ...profile.settings.positionHints, right } })} />
        </div>}
        <button type="button" onClick={() => { if (confirm(`プロファイル「${profile.name}」と、その履歴を削除しますか？キャラクター・テンプレートは残ります。Undoで戻せます。`)) change(current => removeProfile(current, profile.id)); }}>プロファイルを削除</button>
      </>}
    </section>

    <CharacterList shuffle={shuffle} profile={profile} change={change} />
    <TemplateList shuffle={shuffle} change={change} />
    <PoolList shuffle={shuffle} change={change} />
    <CameraList shuffle={shuffle} change={change} />
    <ShuffleTransfer shuffle={shuffle} change={change} onError={workbench.setError} />

    {profile && composed && <section className="panel stack preview" aria-label="シャッフル結果">
      <div className="group-head"><h2>シャッフル結果</h2><small>ベース: {base.title ?? 'ワークスペースなし'}</small></div>
      {base.warnings.length > 0 && <p className="hint">⚠ ワークスペースにコンパイル警告があります。ベースプロンプトを確認してください。</p>}
      <ul aria-label="現在のシャッフル内容">{describeSelection(shuffle, profile.current).map((line, index) => <li key={index}>{line}</li>)}</ul>
      <div className="actions">
        <button type="button" disabled={!profile.settings.enabled || !!workbench.storageError || autoRunning} onClick={() => { if (shuffleNow('manual')) setNotice('シャッフルしました。NovelAIの入力欄はまだ変更していません。'); }}>Shuffle Now</button>
        <button type="button" disabled={!profile.current || autoRunning} onClick={() => change(current => clearCurrent(current, profile.id))}>シャッフルを解除（元の構成）</button>
      </div>
      {!profile.settings.enabled && <p className="hint">シャッフルは無効です。</p>}
      {next && <details><summary>次のシャッフル結果のプレビュー（ステップ{next.outcome.selection.step}）</summary><div className="stack" aria-label="次のシャッフル結果">
        <ul>{describeSelection(shuffle, next.outcome.selection).map((line, index) => <li key={index}>{line}</li>)}</ul>
        {(() => { const differences = diffComposed(composed, next.composed); return differences.length ? <div className="table-scroll"><table><thead><tr><th>項目</th><th>現在</th><th>次</th></tr></thead><tbody>{differences.map((item, index) => <tr key={index}><td>{item.label}</td><td>{item.before}</td><td>{item.after}</td></tr>)}</tbody></table></div> : <p className="hint">現在と同じ構成です。</p>; })()}
        {next.outcome.warnings.map((warning, index) => <p className="hint" key={index}>⚠ {warning}</p>)}
      </div></details>}
      <Outputs result={composed} label="現在の出力" onCopy={(text, what) => void copy(text, what)} />
      {composed.errors.map((error, index) => <p role="alert" key={index}>{error}</p>)}
      {composed.warnings.length > 0 && <ul aria-label="シャッフルの警告">{composed.warnings.map((warning, index) => <li key={index} className="hint">⚠ {warning}</li>)}</ul>}
      {composed.notes.length > 0 && <details><summary>モデル・記法の注意 ({composed.notes.length})</summary><ul>{composed.notes.map((note, index) => <li key={index} className="hint">{note}</li>)}</ul></details>}
      {notice && <p role="status">{notice}</p>}
    </section>}

    {profile && composed && <ShuffleSite client={siteClient} profile={profile} composed={composed} onShuffle={shuffleNow} onAutoEveryChange={autoEvery => setSettings({ autoEvery })}
      autoCheck={autoCheck} profileName={id => shuffle.profiles.find(item => item.id === id)?.name ?? '削除済みプロファイル'} onAutoChange={setAutoRunning} />}

    {profile && <details className="panel"><summary>シャッフル履歴 ({history.length})</summary><div className="stack" aria-label="シャッフル履歴">
      {!history.length && <Empty>Shuffle Nowの結果がここに残ります（最大50件）。</Empty>}
      {history.map(entry => <article className="member" key={entry.id} aria-label={`履歴 ステップ${entry.selection.step}`}>
        <div className="group-head"><strong>ステップ{entry.selection.step} · Seed {entry.selection.seed}</strong><span className="badge">{TRIGGER_LABELS[entry.trigger]}</span><small>{new Date(entry.createdAt).toLocaleString()}</small></div>
        <ul>{describeSelection(shuffle, entry.selection).map((line, index) => <li key={index}>{line}</li>)}</ul>
        <details><summary>当時の出力</summary><pre>{[entry.composed.base.positive, ...entry.composed.characters.map((item, index) => `[${index + 1}] ${item.name}: ${item.positive}`)].join('\n')}</pre></details>
        <button type="button" disabled={autoRunning} onClick={() => { if (change(current => reapplyHistory(current, entry.id))) setNotice(`ステップ${entry.selection.step}の選択を現在の結果にしました（現在のキャラクター定義で再合成）。`); }}>ステップ{entry.selection.step}を再適用</button>
      </article>)}
    </div></details>}
  </div>;
}
