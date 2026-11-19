import { useCallback, useEffect, useState } from 'react';
import { captureVariant, compareSettings, createExperiment, duplicateExperiment, experimentDifferences, SETTING_LABELS, textDifference } from '../core/experiments';
import { toggleMember, updateGroup } from '../core/commands';
import { compileWorkspace } from '../core/compose';
import { record, redo, startHistory, undo } from '../core/history';
import type { Experiment, ExperimentVariant, GenerationSettings, ImageMetadata, PromptWorkspace } from '../core/types';
import { prepareImage } from '../data/images';
import { validateGenerationSettings } from '../data/validation';
import { ImageComparison, Thumbnail } from './ImageComparison';
import { PromptEditor } from './PromptEditor';
import { downloadBlob, newId, now, Rename } from './shared';
import { message, type Workbench } from './useWorkbench';
import { InfoTip } from './InfoTip';

function SettingsEditor({ value, onSave }: { value: GenerationSettings; onSave: (value: GenerationSettings) => void }) {
  const [draft, setDraft] = useState(value); const [extra, setExtra] = useState(JSON.stringify(value.extra, null, 2)); const [error, setError] = useState('');
  const savedValue = JSON.stringify(value);
  useEffect(() => { setDraft(value); setExtra(JSON.stringify(value.extra, null, 2)); }, [savedValue]);
  return <details><summary>生成設定の確認・手入力</summary><form className="stack" onSubmit={event => {
    event.preventDefault(); try { const next = { ...draft, extra: JSON.parse(extra) as GenerationSettings['extra'], evidence: 'manual' as const }; validateGenerationSettings(next); onSave(next); setError(''); } catch (cause) { setError(message(cause)); }
  }}><p>空欄は不明です。Seedは数字の文字列として保存します。Image2Image・参照画像を使わない場合も「不使用」と記録してください。</p>
    {Object.entries(SETTING_LABELS).map(([field, label]) => { const key = field as keyof typeof SETTING_LABELS; const numeric = ['width', 'height', 'steps', 'guidance', 'cfgRescale', 'imageCount'].includes(key); return <label key={key}>{label}<input maxLength={10_000} type={numeric ? 'number' : 'text'} step={['guidance', 'cfgRescale'].includes(key) ? 'any' : '1'} min="0" value={draft[key] ?? ''} onChange={event => setDraft({ ...draft, [key]: event.target.value === '' ? null : numeric ? Number(event.target.value) : event.target.value })} /></label>; })}
    <label>モデル固有の追加設定（JSONオブジェクト）<textarea maxLength={100_000} value={extra} onChange={event => setExtra(event.target.value)} /></label>
    <label className="inline"><input type="checkbox" checked={draft.extrasConfirmed} onChange={event => setDraft({ ...draft, extrasConfirmed: event.target.checked })} />追加条件をすべて確認した</label>
    <p>未保存の入力は「設定を保存」で確定します。</p>{error && <p role="alert">{error}</p>}<button type="submit">設定を保存</button>
  </form></details>;
}
function VariantDraft({ variant, onSave, onCancel }: { variant: ExperimentVariant; onSave: (workspace: PromptWorkspace) => void; onCancel: () => void }) {
  const [history, setHistory] = useState(() => startHistory(structuredClone(variant.workspaceSnapshot))); const draft = history.present;
  const [pendingWeights, setPendingWeights] = useState<Set<string>>(() => new Set());
  const weightDraftChanged = useCallback((label: string, pending: boolean) => setPendingWeights(previous => {
    if (previous.has(label) === pending) return previous;
    const next = new Set(previous); if (pending) next.add(label); else next.delete(label); return next;
  }), []);
  const update = (next: PromptWorkspace) => setHistory(previous => record(previous, next));
  const compiled = compileWorkspace(draft);
  return <section className="panel stack" aria-label="Bスナップショット編集"><h3>Bの変更案（未保存）</h3><p>現在のワークスペースとAは変更しません。確定時にBのプロンプトを再固定し、旧画像の関連付けを外します。</p>
    <p className="hint">重みを比べるには、下の原文からタグを選択して「重みを調整」を押します。候補の原文は「この候補のタグを編集」で開けます。</p>
    {(['positive', 'negative'] as const).map(channel => <PromptEditor key={channel} onWeightDraftChange={weightDraftChanged} label={`B変更案 ${channel}`} value={channel === 'positive' ? draft.freeformPositive : draft.freeformNegative} spans={channel === 'positive' ? draft.freeformPositiveSpans : draft.freeformNegativeSpans} undo={() => setHistory(previous => undo(previous))} redo={() => setHistory(previous => redo(previous))} onChange={(raw, spans) => {
      const key = channel === 'positive' ? 'freeformPositive' : 'freeformNegative'; const spanKey = channel === 'positive' ? 'freeformPositiveSpans' : 'freeformNegativeSpans';
      const next = { ...draft, [key]: raw }; delete next[spanKey]; if (spans) next[spanKey] = spans; update(next);
    }} />)}
    {draft.groups.map(group => <fieldset key={group.id}><legend>{group.name} / {group.channel}</legend><label className="inline"><input type="checkbox" checked={group.enabled} onChange={event => update(updateGroup(draft, group.id, value => ({ ...value, enabled: event.target.checked })))} />グループ有効</label>
      {group.members.map((member, index) => <div key={member.id}><label className="inline"><input type={group.mode === 'exclusive' ? 'radio' : 'checkbox'} name={`b-${group.id}`} disabled={!group.enabled} checked={group.mode === 'exclusive' ? group.selectedMemberId === member.id : member.enabled} onChange={() => update(updateGroup(draft, group.id, value => toggleMember(value, member.id)))} />{member.overrideRaw ?? member.rawSnapshot}</label><details><summary>この候補のタグを編集</summary><PromptEditor onWeightDraftChange={weightDraftChanged} label={`B ${group.name} 候補${index + 1}`} value={member.overrideRaw ?? member.rawSnapshot} spans={member.overrideSpans} undo={() => setHistory(previous => undo(previous))} redo={() => setHistory(previous => redo(previous))} onChange={(raw, spans) => update(updateGroup(draft, group.id, value => ({ ...value, members: value.members.map(item => {
        if (item.id !== member.id) return item; const { overrideSpans: _old, ...rest } = item; return { ...rest, overrideRaw: raw, ...(spans ? { overrideSpans: spans } : {}) };
      }) })))} /></details></div>)}
      {group.mode === 'exclusive' && <button type="button" onClick={() => update(updateGroup(draft, group.id, value => ({ ...value, selectedMemberId: null })))}>選択解除</button>}
    </fieldset>)}
    <label>B確定前 Positive<textarea readOnly value={compiled.positive} /></label><label>B確定前 Negative<textarea readOnly value={compiled.negative} /></label>
    {!!pendingWeights.size && <p role="status">調整中の重みを「重みを反映」で確定するか、調整を閉じてからBを確定してください。</p>}
    <div className="actions"><button type="button" disabled={!history.past.length} onClick={() => setHistory(previous => undo(previous))}>変更案をUndo</button><button type="button" disabled={!history.future.length} onClick={() => setHistory(previous => redo(previous))}>変更案をRedo</button><button type="button" disabled={!!pendingWeights.size} onClick={() => onSave(draft)}>Bの変更を確定</button><button type="button" onClick={() => { if (confirm('Bの未保存変更案を破棄しますか？')) onCancel(); }}>変更案を破棄</button></div>
  </section>;
}
function PromptDiff({ a, b, label }: { a: string; b: string; label: string }) { const diff = textDifference(a, b); return <div><h4>{label} の文字差分</h4><pre className="diff-text">{diff.prefix}<del>{diff.removed}</del><ins>{diff.added}</ins>{diff.suffix}</pre>{a === b && <p>変更なし</p>}</div>; }

function ImageNotes({ value, onSave }: { value: ImageMetadata; onSave: (value: ImageMetadata) => void }) {
  const [positive, setPositive] = useState(value.positive ?? ''); const [negative, setNegative] = useState(value.negative ?? '');
  useEffect(() => { setPositive(value.positive ?? ''); setNegative(value.negative ?? ''); }, [value]);
  return <details><summary>画像情報を手入力で補完</summary><p>画像資産への注記です。比較の固定プロンプトや生成設定は自動変更しません。空欄は不明として保存します。</p><label>画像 Positive 注記<textarea maxLength={100_000} value={positive} onChange={event => setPositive(event.target.value)} /></label><label>画像 Negative 注記<textarea maxLength={100_000} value={negative} onChange={event => setNegative(event.target.value)} /></label><button type="button" onClick={() => onSave({ ...value, positive: positive || null, negative: negative || null, promptEvidence: 'manual' })}>画像のプロンプト注記を保存</button><SettingsEditor value={value.settings} onSave={settings => onSave({ ...value, settings })} /></details>;
}

export function Comparisons({ workbench, onDraftChange }: { workbench: Workbench; onDraftChange: (dirty: boolean) => void }) {
  const data = workbench.data!; const [selected, setSelected] = useState(''); const [source, setSource] = useState('current'); const [name, setName] = useState('新しい比較');
  const [editing, setEditing] = useState(false); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [capacity, setCapacity] = useState('容量情報は未取得です');
  const experiment = data.experiments.find(item => item.id === selected) ?? data.experiments[0];
  const sourcePreset = data.presets.find(item => item.id === source);
  const sourceWorkspace = source === 'current' ? data.workspaces.find(item => item.id === data.settings.activeWorkspaceId) : sourcePreset?.workspaceSnapshot;
  useEffect(() => { setEditing(false); }, [experiment?.id]);
  useEffect(() => { onDraftChange(editing); return () => onDraftChange(false); }, [editing, onDraftChange]);
  useEffect(() => { if (!editing) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [editing]);
  const change = (fn: (item: Experiment) => Experiment) => { if (!experiment) return false; return workbench.commit(previous => ({ ...previous, experiments: previous.experiments.map(item => item.id === experiment.id ? { ...fn(item), updatedAt: now() } : item) })); };
  const changeVariant = (key: 'variantA' | 'variantB', fn: (item: ExperimentVariant) => ExperimentVariant) => change(item => ({ ...item, [key]: fn(item[key]) }));
  async function importImage(file: File | undefined, key: 'variantA' | 'variantB') {
    if (!file || !experiment || busy) return; const experimentId = experiment.id; setBusy(true); setNotice('');
    try { const prepared = await prepareImage(file, newId(), now()); setNotice(workbench.attachImage(prepared, experimentId, key)); }
    catch (cause) { workbench.setError(`画像取込失敗: ${message(cause)}。保存済み画像とプロンプトは変更していません。`); }
    finally { setBusy(false); }
  }
  const comparison = experiment ? compareSettings(experiment.variantA.settings, experiment.variantB.settings) : null;
  const differences = experiment ? experimentDifferences(experiment) : null;
  return <div className="stack">
    <section className="panel stack"><div className="section-title"><h2>手動A/B比較</h2><InfoTip label="手動A/B比較">現在の構成やプリセットをA/Bのスナップショットとして固定し、Bだけを変えて比べます。プロンプトをコピーしてNovelAIで同じSeed・設定で手動生成し、保存したPNGを取り込んで横並び・重ね合わせ・差分で比較します。元の構成は変更せず、実サイトへの書込みは行いません。</InfoTip></div>
      <ol className="comparison-steps"><li>Aを基準に、Bのタグ・重みを調整</li><li>同じSeed・生成設定でA/Bを手動生成</li><li>PNGを取り込み、横並び・重ね合わせで比較</li></ol>
      <label>比較元<select value={source} onChange={event => setSource(event.target.value)}><option value="current">現在のワークスペース</option>{data.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
      <label>新しい比較名<input maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label>
      <button type="button" disabled={!sourceWorkspace || !name.trim() || editing} onClick={() => {
        if (!sourceWorkspace) return;
        const created = createExperiment(newId(), newId(), newId(), name, sourceWorkspace, sourcePreset?.id ?? (sourceWorkspace.appliedPresetId ?? null), now());
        if (workbench.commit(previous => ({ ...previous, experiments: [...previous.experiments, created] }))) { setSelected(created.id); setNotice('A/Bのプロンプトを固定して保存しました。現在の構成は変更していません。'); }
      }} className="primary">比較セッションを作成</button>
      <label>保存済み比較<select disabled={editing || busy} value={experiment?.id ?? ''} onChange={event => { setSelected(event.target.value); setNotice(''); }}><option value="" disabled>比較を選択</option>{data.experiments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {notice && <p role="status">{notice}</p>}
    </section>
    {experiment && <>
      <section className="panel stack"><Rename label="比較名" value={experiment.name} onSave={name => change(item => ({ ...item, name }))} /><small>比較内容は変更ごとにローカル保存します。上部の保存状態を確認してください。</small>
        <div className="actions"><button type="button" disabled={editing || busy} onClick={() => { const copy = duplicateExperiment(experiment, newId(), newId(), newId(), now()); if (workbench.commit(previous => ({ ...previous, experiments: [...previous.experiments, copy] }))) setSelected(copy.id); }}>比較を複製</button><button type="button" disabled={editing || busy} onClick={() => { if (confirm('この比較セッションを削除しますか？画像資産は保持され、Undoで戻せます。')) workbench.commit(previous => ({ ...previous, experiments: previous.experiments.filter(item => item.id !== experiment.id) })); }}>比較を削除</button></div>
        <button type="button" disabled={editing || busy} onClick={() => setEditing(true)}>Bのグループ・タグを編集</button>
        <button type="button" disabled={!sourceWorkspace || editing || busy} onClick={() => { if (sourceWorkspace && confirm('選択した比較元からBを再固定しますか？Bの旧画像の関連付けを外します。')) changeVariant('variantB', item => ({ ...captureVariant(item.id, 'B', sourceWorkspace, sourcePreset?.id ?? sourceWorkspace.appliedPresetId ?? null), settings: item.settings })); }}>比較元からBを再固定</button>
      </section>
      {editing && <VariantDraft key={experiment.id} variant={experiment.variantB} onCancel={() => setEditing(false)} onSave={workspace => { if (changeVariant('variantB', item => ({ ...captureVariant(item.id, 'B', workspace, null), settings: item.settings }))) setEditing(false); }} />}
      <ImageComparison workbench={workbench} a={data.images.find(item => item.id === experiment.variantA.imageId)} b={data.images.find(item => item.id === experiment.variantB.imageId)} />
      {(['variantA', 'variantB'] as const).map(key => {
        const variant = experiment[key]; const image = data.images.find(item => item.id === variant.imageId);
        return <section className="panel stack" key={`${experiment.id}-${key}`} aria-label={`比較 ${variant.label}`}>
          <h3>{variant.label} 固定スナップショット</h3><p>プリセット: {variant.presetId ? data.presets.find(item => item.id === variant.presetId)?.name ?? '参照先削除済み（スナップショットは保持）' : 'ワークスペース / 個別変更'}</p>
          {(['positive', 'negative'] as const).map(channel => <div className="stack" key={channel}><label>{variant.label} {channel}<textarea readOnly value={variant.compiled[channel]} /></label><button type="button" onClick={() => { void navigator.clipboard.writeText(variant.compiled[channel]).then(() => setNotice(`${variant.label} ${channel}をコピーしました。生成はNovelAIで手動実行してください。`)).catch(() => workbench.setError('コピーできません。固定プロンプト欄から手動コピーしてください。')); }}>{variant.label} {channel}をコピー</button></div>)}
          <SettingsEditor value={variant.settings} onSave={settings => changeVariant(key, item => ({ ...item, settings }))} />
          <div className="drop-zone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (event.dataTransfer.files.length !== 1) workbench.setError('PNGを1枚ずつ取り込んでください'); else void importImage(event.dataTransfer.files[0], key); }}><label>{variant.label}にPNGを取り込む<input disabled={busy || editing} type="file" accept=".png,image/png" onChange={event => { void importImage(event.target.files?.[0], key); event.target.value = ''; }} /></label><p>ここにPNGを1枚ドロップ（20MiB・16Mpxまで）</p></div>
          <label>{variant.label}の登録済み画像<select disabled={busy || editing} value={variant.imageId ?? ''} onChange={event => { const imageId = event.target.value || null; changeVariant(key, item => ({ ...item, imageId })); }}><option value="">画像なし</option>{data.images.map(image => <option key={image.id} value={image.id}>{image.name} / {image.hash.slice(0, 8)}</option>)}</select></label>
          {image && <><Thumbnail workbench={workbench} image={image} /><p>{image.name} / {image.width}×{image.height} / SHA-256 {image.hash}</p>
            {image.metadata.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
            <details><summary>抽出メタデータ（信頼されないテキスト）</summary><pre>{JSON.stringify(image.metadata, null, 2)}</pre></details>
            <p>画像Prompt取得元: {image.metadata.promptEvidence ?? 'unknown'}</p><ImageNotes value={image.metadata} onSave={metadata => { workbench.commit(previous => ({ ...previous, images: previous.images.map(item => item.id === image.id ? { ...item, metadata } : item) })); }} />
            <p>画像Prompt照合: {image.metadata.positive === null || image.metadata.negative === null ? '検証不能' : image.metadata.positive === variant.compiled.positive && image.metadata.negative === variant.compiled.negative ? '固定プロンプトと一致' : '固定プロンプトと不一致'}</p>
            <p>画像設定照合: {compareSettings(variant.settings, image.metadata.settings).status}</p>
            <button type="button" disabled={image.metadata.settings.evidence === 'unknown'} onClick={() => { if (confirm('このスロットの設定を画像メタデータの値に置換しますか？不明項目も引き継ぎます。固定プロンプトは保持します。')) changeVariant(key, item => ({ ...item, settings: structuredClone(image.metadata.settings) })); }}>画像の設定を採用</button>
          </>}
        </section>;
      })}
      <section className="panel stack" aria-label="A/Bテキスト差分"><h3>プロンプト・グループ・設定差分</h3><p>文字差分は原文の差を示します。特殊構文をタグとして分割・再解釈しません。</p><PromptDiff label="Positive" a={experiment.variantA.compiled.positive} b={experiment.variantB.compiled.positive} /><PromptDiff label="Negative" a={experiment.variantA.compiled.negative} b={experiment.variantB.compiled.negative} />
        <h4>グループ / 選択状態の差分 {differences?.total}件</h4><ul>{differences?.differences.map((diff, i) => <li key={i}>{diff.label}: {diff.before} → {diff.after}</li>)}</ul>{(differences?.total ?? 0) > 100 && <p>先頭100件を表示しています。</p>}
        <strong>生成条件: {comparison?.status}{comparison?.status !== '記録した条件は一致' ? '（厳密比較不可）' : ''}</strong>{!!comparison?.unknown.length && <p>不明 / 未確認: {comparison.unknown.join('、')}</p>}
        <div className="table-scroll"><table><thead><tr><th>設定</th><th>A</th><th>B</th></tr></thead><tbody>{comparison?.rows.map(row => <tr key={row.label}><th>{row.label}</th><td>{row.a === null ? '不明' : String(row.a)}</td><td>{row.b === null ? '不明' : String(row.b)} {row.a !== null && row.b !== null && row.a !== row.b ? '（差あり）' : ''}</td></tr>)}</tbody></table></div><p>記録した条件が一致しても、モデルの版や未記録条件を含む厳密な再現性は保証しません。</p>
      </section>
    </>}
    <section className="panel stack"><div className="section-title"><h3>画像ライブラリ ({data.images.length})</h3><InfoTip label="画像ライブラリ">取り込んだPNGの原本とサムネイルをこの端末に保存します。JSONバックアップには画像を含まないため、画像も残すには「設定」の完全バックアップを使用してください。削除した画像のデータは「元に戻す」のために残り、「参照されない画像バイナリを解放」で整理できます。</InfoTip></div><p className="hint">登録画像の原本合計 {(data.images.reduce((sum, image) => sum + image.byteLength, 0) / 1048576).toFixed(2)} MiB / {capacity}</p>
      <button type="button" onClick={() => { if (!navigator.storage?.estimate) { setCapacity('この環境は容量取得に非対応です'); return; } void navigator.storage.estimate().then(value => setCapacity(`ブラウザ使用 ${(Number(value.usage ?? 0) / 1048576).toFixed(1)} MiB / 割当 ${value.quota === undefined ? '不明' : (value.quota / 1048576).toFixed(1) + ' MiB'}（概算）`)).catch(cause => workbench.setError(message(cause))); }}>ストレージ容量を確認</button>
      {data.images.slice(0, 50).map(image => <article key={image.id} className="member"><Thumbnail workbench={workbench} image={image} /><p>{image.name}</p><button type="button" onClick={() => { void workbench.imageBlob(image.id).then(blob => { if (!blob) throw new Error('画像原本が欠落しています'); downloadBlob(blob, image.name); }).catch(cause => workbench.setError(message(cause))); }}>画像原本を保存</button><button type="button" onClick={() => { if (confirm('画像メタデータと全比較の関連付けを削除しますか？Undo用の原本は保持します。')) workbench.commit(previous => ({ ...previous, images: previous.images.filter(item => item.id !== image.id), ...(previous.lab ? { lab: { ...previous.lab, experiments: previous.lab.experiments.map(e => ({ ...e, conditions: e.conditions.map(c => c.imageId === image.id ? { ...c, imageId: null, status: 'pending' as const } : c) })) } } : {}), experiments: previous.experiments.map(item => ({ ...item, variantA: item.variantA.imageId === image.id ? { ...item.variantA, imageId: null } : item.variantA, variantB: item.variantB.imageId === image.id ? { ...item.variantB, imageId: null } : item.variantB })) })); }}>登録画像を削除</button></article>)}
      {data.images.length > 50 && <p>先頭50件を表示。全件はスロットの選択欄から選べます。</p>}
      <button type="button" disabled={workbench.saving || busy} onClick={() => { void workbench.purgeImages().then(() => setNotice('現在の資産・Undo/Redo・取込前バックアップから参照されない画像を解放しました。')).catch(cause => workbench.setError(message(cause))); }}>参照されない画像バイナリを解放</button>
      {busy && <p role="status">画像を検証・取り込み中…</p>}
    </section>
  </div>;
}
