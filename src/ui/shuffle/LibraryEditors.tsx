import { useState } from 'react';
import { moveById } from '../../core/commands';
import { CATEGORY_LABELS, templateWarnings } from '../../core/shuffle/compose';
import {
  addDefaultLibrary, createCameraPreset, createCharacter, createOption, createPool, createTemplate, removeById, removeCharacter, upsert,
} from '../../core/shuffle/state';
import {
  CAMERA_CATEGORIES, CHARACTER_CATEGORIES, SHUFFLE_CATEGORIES,
  type CameraPreset, type CharacterCategory, type CharacterDefinition, type Constrained, type OptionPool, type PromptOption,
  type RoleDefinition, type SceneTemplate, type ShuffleCategory, type ShuffleData, type ShuffleProfile, type TemplateKind,
} from '../../core/shuffle/types';
import { exportShuffle, importShuffle, parseShuffleExport } from '../../data/shuffle';
import { downloadText, Empty, newId, now, Reorder } from '../shared';
import { message } from '../useWorkbench';
import { CharacterLimit, ListCommit, NumberCommit, TextCommit } from './inputs';
import { Hint } from '../InfoTip';

type Change = (update: (shuffle: ShuffleData) => ShuffleData) => boolean;
const SIDE_LABEL = { '': '指定なし', left: '左', right: '右' } as const;
const OPTION_PAGE = 100;

function Constraints<T extends Constrained>({ label, item, onChange }: { label: string; item: T; onChange: (item: T) => void }) {
  return <details><summary>{label}の制約タグ</summary><div className="stack">
    <Hint label={`${label}の制約タグ`} summary="制約タグはNovelAIに出力しない内部ラベルです">タグは内部ラベルで、NovelAIには出力しません。「必須」はすでに選ばれた候補のタグを要求し、「除外」は一致するタグがあると候補から外します。</Hint>
    <ListCommit label={`${label}のタグ`} values={item.tags} onCommit={tags => onChange({ ...item, tags })} />
    <ListCommit label={`${label}の必須タグ`} values={item.requires} onCommit={requires => onChange({ ...item, requires })} />
    <ListCommit label={`${label}の除外タグ`} values={item.excludes} onCommit={excludes => onChange({ ...item, excludes })} />
  </div></details>;
}

function CharacterEditor({ character, change }: { character: CharacterDefinition; change: Change }) {
  const save = (next: CharacterDefinition) => change(shuffle => ({ ...shuffle, characters: upsert(shuffle.characters, next) }));
  const variable = (category: CharacterCategory) => character.variables.filter(part => part.category === category).map(part => part.prompt).join(', ');
  const setVariable = (category: CharacterCategory, prompt: string) => save({ ...character, variables: [...character.variables.filter(part => part.category !== category), ...(prompt.trim() ? [{ category, prompt }] : [])] });
  const label = character.name;
  return <details><summary>「{label}」を編集</summary><div className="stack">
    <TextCommit label="キャラクター名" value={character.name} required maxLength={200} onCommit={name => save({ ...character, name })} />
    <TextCommit label={`${label}の固定プロンプト`} multiline value={character.fixedPrompt} onCommit={fixedPrompt => save({ ...character, fixedPrompt })} placeholder="girl, blonde hair, blue eyes, white dress" />
    <Hint label={`${label}の固定プロンプト`} summary="外見などは固定（シャッフルで変えません）">固定プロンプトは外見・固有設定です。シャッフルで変更・削除しません。</Hint>
    <ListCommit label={`${label}の固定タグ`} values={character.lockedTags} onCommit={lockedTags => save({ ...character, lockedTags })} />
    <Hint label={`${label}の固定タグ`} summary="固定タグは常に出力します">固定タグは常に出力し、そのタグを候補に含むカテゴリ（例: sitting → ポーズ）をシャッフルしません。</Hint>
    {CHARACTER_CATEGORIES.map(category => <TextCommit key={category} label={`${label}の可変プロンプト（${CATEGORY_LABELS[category]}）`} value={variable(category)} onCommit={prompt => setVariable(category, prompt)} />)}
    <Hint label={`${label}の可変プロンプト`} summary="シャッフルが決めたカテゴリだけ置き換え">可変プロンプトはシャッフルがそのカテゴリを決めたときだけ置き換えます。</Hint>
    <fieldset className="actions"><legend>{label}: 変更を許可する項目</legend>{CHARACTER_CATEGORIES.map(category => <label className="inline" key={category}><input type="checkbox" checked={character.allowedCategories.includes(category)} onChange={event => save({ ...character, allowedCategories: event.target.checked ? [...character.allowedCategories, category] : character.allowedCategories.filter(item => item !== category) })} />{label}: {CATEGORY_LABELS[category]}</label>)}</fieldset>
    <label>{label}の立ち位置<select value={character.side ?? ''} onChange={event => save({ ...character, side: (event.target.value || null) as CharacterDefinition['side'] })}>{Object.entries(SIDE_LABEL).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
    <label className="inline"><input type="checkbox" checked={character.negativePrompt !== null} onChange={event => save({ ...character, negativePrompt: event.target.checked ? '' : null })} />{label}のUndesired Contentを管理する</label>
    {character.negativePrompt !== null && <TextCommit label={`${label}のUndesired Content`} multiline value={character.negativePrompt} onCommit={negativePrompt => save({ ...character, negativePrompt })} />}
    <button type="button" onClick={() => { if (confirm(`キャラクター「${label}」を削除しますか？プロファイル・役割・候補プールの参照も外します。Undoで戻せます。`)) change(shuffle => removeCharacter(shuffle, character.id)); }}>キャラクター「{label}」を削除</button>
  </div></details>;
}

export function CharacterList({ shuffle, profile, change }: { shuffle: ShuffleData; profile?: ShuffleProfile; change: Change }) {
  const [name, setName] = useState('');
  const setParticipants = (characterIds: string[]) => profile && change(current => ({ ...current, profiles: current.profiles.map(item => item.id === profile.id ? { ...item, characterIds } : item) }));
  const participants = profile?.characterIds ?? [];
  return <details open className="panel"><summary>キャラクター ({shuffle.characters.length})</summary><div className="stack">
    <form className="actions" aria-label="キャラクター作成" onSubmit={event => {
      event.preventDefault();
      if (!name.trim()) return;
      const created = createCharacter(newId(), name.trim());
      if (change(current => ({ ...current, characters: [...current.characters, created], profiles: current.profiles.map(item => item.id === current.activeProfileId ? { ...item, characterIds: [...item.characterIds, created.id] } : item) }))) setName('');
    }}><label>新しいキャラクター名<input required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label><button type="submit">キャラクターを追加</button></form>
    {!shuffle.characters.length && <Empty>キャラクターを追加し、外見などの固定プロンプトを入力してください。</Empty>}
    {shuffle.characters.map(character => <article key={character.id} className="member" aria-label={`キャラクター ${character.name}`}>
      <div className="group-head"><strong>{character.name}</strong>{profile && <label className="inline"><input type="checkbox" checked={participants.includes(character.id)} onChange={event => setParticipants(event.target.checked ? [...participants, character.id] : participants.filter(id => id !== character.id))} />対象: {character.name}</label>}</div>
      <pre className="member-raw">{character.fixedPrompt || '（固定プロンプト未入力）'}</pre>
      <CharacterEditor character={character} change={change} />
    </article>)}
    {profile && participants.length > 1 && <div className="stack" aria-label="対象キャラクターの順序"><h3>出力順（位置シャッフルOFF時）</h3>{participants.map((id, index) => {
      const item = shuffle.characters.find(character => character.id === id);
      return <div className="actions" key={id}><span>{index + 1}. {item?.name ?? id}</span><Reorder name={item?.name ?? id} first={index === 0} last={index === participants.length - 1} onMove={direction => setParticipants(moveById(participants.map(value => ({ id: value })), id, direction).map(value => value.id))} /></div>;
    })}</div>}
  </div></details>;
}

function RoleEditor({ template, role, characters, save }: { template: SceneTemplate; role: RoleDefinition; characters: CharacterDefinition[]; save: (template: SceneTemplate) => void }) {
  const update = (next: RoleDefinition) => save({ ...template, roles: template.roles.map(item => item.id === role.id ? next : item) });
  const label = `${template.name} / ${role.name}`;
  return <div className="member stack" aria-label={`役割 ${label}`}>
    <TextCommit label={`役割名（${template.name}）`} value={role.name} required maxLength={200} onCommit={name => update({ ...role, name })} />
    <TextCommit label={`${label}のプロンプト`} multiline value={role.prompt} onCommit={prompt => update({ ...role, prompt })} />
    <div className="columns">
      <label>{label}の相互作用<select value={role.interaction ?? ''} onChange={event => update({ ...role, interaction: (event.target.value || null) as RoleDefinition['interaction'] })}><option value="">なし</option><option value="source">source#（行動する側）</option><option value="target">target#（行動される側）</option><option value="mutual">mutual#（相互）</option></select></label>
      <label>{label}の立ち位置<select value={role.side ?? ''} onChange={event => update({ ...role, side: (event.target.value || null) as RoleDefinition['side'] })}>{Object.entries(SIDE_LABEL).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
    </div>
    <fieldset className="actions"><legend>{label}が決めるカテゴリ</legend>{CHARACTER_CATEGORIES.map(category => <label className="inline" key={category}><input type="checkbox" checked={role.categories.includes(category)} onChange={event => update({ ...role, categories: event.target.checked ? [...role.categories, category] : role.categories.filter(item => item !== category) })} />{label}: {CATEGORY_LABELS[category]}</label>)}</fieldset>
    <CharacterLimit label={`${label}を担当できるキャラクター`} characters={characters} value={role.allowedCharacterIds} onChange={allowedCharacterIds => update({ ...role, allowedCharacterIds })} />
    <button type="button" disabled={template.roles.length <= 1} onClick={() => save({ ...template, roles: template.roles.filter(item => item.id !== role.id) })}>役割「{role.name}」を削除</button>
  </div>;
}

function TemplateEditor({ template, characters, change }: { template: SceneTemplate; characters: CharacterDefinition[]; change: Change }) {
  const save = (next: SceneTemplate) => change(shuffle => ({ ...shuffle, templates: upsert(shuffle.templates, next) }));
  const warnings = templateWarnings(template);
  return <article className="member" aria-label={`テンプレート ${template.name}`}>
    <div className="group-head"><label className="inline"><input type="checkbox" checked={template.enabled} onChange={event => save({ ...template, enabled: event.target.checked })} />有効: {template.name}</label><span className="badge">{template.kind === 'role' ? '役割' : 'ポーズセット'} · {template.roles.length}人</span></div>
    <small>{template.roles.map(role => `${role.name}: ${[role.prompt, template.action && role.interaction ? `${role.interaction}#${template.action}` : ''].filter(Boolean).join(', ') || '（なし）'}`).join(' ／ ')}</small>
    {warnings.map((warning, index) => <p className="hint" key={index}>⚠ {warning}</p>)}
    <details><summary>「{template.name}」を編集</summary><div className="stack">
      <TextCommit label="テンプレート名" value={template.name} required maxLength={200} onCommit={name => save({ ...template, name })} />
      <label>{template.name}の種類<select value={template.kind} onChange={event => save({ ...template, kind: event.target.value as TemplateKind })}><option value="role">役割テンプレート</option><option value="pose">ポーズセット</option></select></label>
      <TextCommit label={`${template.name}の行動タグ`} value={template.action} maxLength={200} placeholder="hug" onCommit={action => save({ ...template, action: action.trim() })} />
      <Hint label={`${template.name}の行動タグ`} summary="source# / target# / mutual# を自動で付けます">行動タグを入れると、相互作用を設定した役割に source#行動 / target#行動 / mutual#行動 を付けます（公式記法。常に信頼できるとは限りません）。</Hint>
      <TextCommit label={`${template.name}のベースプロンプト追加`} value={template.basePrompt} onCommit={basePrompt => save({ ...template, basePrompt })} />
      <NumberCommit label={`${template.name}の重み`} value={template.weight} min={0} max={1000} step={0.1} onCommit={weight => save({ ...template, weight })} />
      <Constraints label={template.name} item={template} onChange={save} />
      {template.roles.map(role => <RoleEditor key={role.id} template={template} role={role} characters={characters} save={save} />)}
      <button type="button" disabled={template.roles.length >= 22} onClick={() => save({ ...template, roles: [...template.roles, { id: newId(), name: `役割${template.roles.length + 1}`, prompt: '', categories: template.kind === 'pose' ? ['pose'] : ['action'], interaction: null, side: null, allowedCharacterIds: null }] })}>「{template.name}」に役割を追加</button>
      <button type="button" onClick={() => { if (confirm(`テンプレート「${template.name}」を削除しますか？Undoで戻せます。`)) change(shuffle => ({ ...shuffle, templates: removeById(shuffle.templates, template.id) })); }}>テンプレート「{template.name}」を削除</button>
    </div></details>
  </article>;
}

export function TemplateList({ shuffle, change }: { shuffle: ShuffleData; change: Change }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TemplateKind>('role');
  return <details className="panel"><summary>役割テンプレート・ポーズセット ({shuffle.templates.length})</summary><div className="stack">
    <Hint label="役割テンプレート・ポーズセット" summary="役割の担当キャラクターだけを入れ替えます">役割テンプレートとポーズセットは同じ構造です。役割IDとキャラクターIDは別で、シャッフルごとに役割の担当者だけを入れ替えます。</Hint>
    <form className="actions" aria-label="テンプレート作成" onSubmit={event => {
      event.preventDefault();
      if (name.trim() && change(current => ({ ...current, templates: [...current.templates, createTemplate(kind, newId(), name.trim(), [newId(), newId()])] }))) setName('');
    }}><label>新しいテンプレート名<input required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label><label>新しいテンプレートの種類<select value={kind} onChange={event => setKind(event.target.value as TemplateKind)}><option value="role">役割</option><option value="pose">ポーズセット</option></select></label><button type="submit">テンプレートを追加</button></form>
    {!shuffle.templates.length && <Empty>テンプレートがありません。下の「標準テンプレート・候補を追加」も利用できます。</Empty>}
    {shuffle.templates.map(template => <TemplateEditor key={template.id} template={template} characters={shuffle.characters} change={change} />)}
  </div></details>;
}

function OptionRow({ pool, option, savePool }: { pool: OptionPool; option: PromptOption; savePool: (pool: OptionPool) => void }) {
  const update = (next: PromptOption) => savePool({ ...pool, options: pool.options.map(item => item.id === option.id ? next : item) });
  return <div className="member stack" aria-label={`候補 ${option.prompt}`}>
    <div className="actions"><label className="inline"><input type="checkbox" checked={option.enabled} onChange={event => update({ ...option, enabled: event.target.checked })} />有効: {option.prompt}</label>
      <button type="button" onClick={() => savePool({ ...pool, options: pool.options.filter(item => item.id !== option.id) })}>候補「{option.prompt}」を削除</button></div>
    <details><summary>候補「{option.prompt}」の詳細</summary><div className="stack">
      <TextCommit label={`候補「${option.prompt}」のプロンプト`} value={option.prompt} onCommit={prompt => update({ ...option, prompt })} />
      <NumberCommit label={`候補「${option.prompt}」の重み`} value={option.weight} min={0} max={1000} step={0.1} onCommit={weight => update({ ...option, weight })} />
      <Constraints label={`候補「${option.prompt}」`} item={option} onChange={update} />
    </div></details>
  </div>;
}

function PoolEditor({ pool, characters, change }: { pool: OptionPool; characters: CharacterDefinition[]; change: Change }) {
  const [bulk, setBulk] = useState('');
  const [limit, setLimit] = useState(OPTION_PAGE);
  const save = (next: OptionPool) => change(shuffle => ({ ...shuffle, pools: upsert(shuffle.pools, next) }));
  const camera = (CAMERA_CATEGORIES as readonly string[]).includes(pool.category);
  return <article className="member" aria-label={`候補プール ${pool.name}`}>
    <div className="group-head"><strong>{pool.name}</strong><span className="badge">{CATEGORY_LABELS[pool.category]} · {pool.options.length}件</span></div>
    <details><summary>「{pool.name}」を編集</summary><div className="stack">
      <TextCommit label="プール名" value={pool.name} required maxLength={200} onCommit={name => save({ ...pool, name })} />
      <label>{pool.name}のカテゴリ<select value={pool.category} onChange={event => save({ ...pool, category: event.target.value as ShuffleCategory })}>{SHUFFLE_CATEGORIES.map(category => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select></label>
      {camera ? <p className="hint">カメラ系カテゴリはベースプロンプトに1つだけ出力します。</p> : <CharacterLimit label={`${pool.name}の対象キャラクター`} characters={characters} value={pool.characterIds} onChange={characterIds => save({ ...pool, characterIds })} />}
      <label>{pool.name}に候補を一括追加（1行に1つ）<textarea rows={3} value={bulk} onChange={event => setBulk(event.target.value)} /></label>
      <button type="button" disabled={!bulk.trim()} onClick={() => {
        const lines = bulk.split('\n').map(line => line.trim()).filter(Boolean);
        if (save({ ...pool, options: [...pool.options, ...lines.map(line => createOption(newId(), line))] })) setBulk('');
      }}>「{pool.name}」に候補を追加</button>
      {pool.options.slice(0, limit).map(option => <OptionRow key={option.id} pool={pool} option={option} savePool={save} />)}
      {pool.options.length > limit && <button type="button" onClick={() => setLimit(limit + OPTION_PAGE)}>さらに表示（残り{pool.options.length - limit}件）</button>}
      <button type="button" onClick={() => { if (confirm(`候補プール「${pool.name}」を削除しますか？Undoで戻せます。`)) change(shuffle => ({ ...shuffle, pools: removeById(shuffle.pools, pool.id) })); }}>候補プール「{pool.name}」を削除</button>
    </div></details>
  </article>;
}

export function PoolList({ shuffle, change }: { shuffle: ShuffleData; change: Change }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ShuffleCategory>('pose');
  return <details className="panel"><summary>候補プール（ポーズ・表情・カメラ） ({shuffle.pools.length})</summary><div className="stack">
    <Hint label="候補プール" summary="キャラクターごとに1つずつ選びます">キャラクター系プールは、テンプレートがそのカテゴリを決めなかったキャラクターごとに1つ選びます。同じカテゴリはキャラクターごとに1つだけ適用されます。</Hint>
    <form className="actions" aria-label="候補プール作成" onSubmit={event => {
      event.preventDefault();
      if (name.trim() && change(current => ({ ...current, pools: [...current.pools, createPool(newId(), name.trim(), category)] }))) setName('');
    }}><label>新しいプール名<input required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label><label>新しいプールのカテゴリ<select value={category} onChange={event => setCategory(event.target.value as ShuffleCategory)}>{SHUFFLE_CATEGORIES.map(item => <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>)}</select></label><button type="submit">プールを追加</button></form>
    {shuffle.pools.map(pool => <PoolEditor key={pool.id} pool={pool} characters={shuffle.characters} change={change} />)}
  </div></details>;
}

function CameraEditor({ preset, change }: { preset: CameraPreset; change: Change }) {
  const save = (next: CameraPreset) => change(shuffle => ({ ...shuffle, cameraPresets: upsert(shuffle.cameraPresets, next) }));
  const part = (category: ShuffleCategory) => preset.parts.find(item => item.category === category)?.prompt ?? '';
  const setPart = (category: ShuffleCategory, prompt: string) => save({ ...preset, parts: [...preset.parts.filter(item => item.category !== category), ...(prompt.trim() ? [{ category, prompt }] : [])] });
  return <article className="member" aria-label={`カメラプリセット ${preset.name}`}>
    <div className="group-head"><label className="inline"><input type="checkbox" checked={preset.enabled} onChange={event => save({ ...preset, enabled: event.target.checked })} />有効: {preset.name}</label></div>
    <small>{preset.parts.map(item => `${CATEGORY_LABELS[item.category]}: ${item.prompt}`).join(' ／ ') || '（未設定）'}</small>
    <details><summary>「{preset.name}」を編集</summary><div className="stack">
      <TextCommit label="カメラプリセット名" value={preset.name} required maxLength={200} onCommit={name => save({ ...preset, name })} />
      {[...CAMERA_CATEGORIES, 'gaze' as const].map(category => <TextCommit key={category} label={`${preset.name}の${CATEGORY_LABELS[category]}`} value={part(category)} onCommit={prompt => setPart(category, prompt)} />)}
      <Hint label={`${preset.name}の出力先`} summary="アングル等はベース、視線は各キャラクターへ">アングル・フレーミング・視点はベースプロンプト、視線は各キャラクターに出力します。空欄のカテゴリは個別プールから選びます。</Hint>
      <NumberCommit label={`${preset.name}の重み`} value={preset.weight} min={0} max={1000} step={0.1} onCommit={weight => save({ ...preset, weight })} />
      <Constraints label={preset.name} item={preset} onChange={save} />
      <button type="button" onClick={() => { if (confirm(`カメラプリセット「${preset.name}」を削除しますか？`)) change(shuffle => ({ ...shuffle, cameraPresets: removeById(shuffle.cameraPresets, preset.id) })); }}>カメラプリセット「{preset.name}」を削除</button>
    </div></details>
  </article>;
}

export function CameraList({ shuffle, change }: { shuffle: ShuffleData; change: Change }) {
  const [name, setName] = useState('');
  return <details className="panel"><summary>カメラプリセット ({shuffle.cameraPresets.length})</summary><div className="stack">
    <Hint label="カメラプリセット" summary="カメラ関連をまとめて切り替える組合せです">アングル・距離・視線などを連動して切り替える組合せです。カテゴリ単位で置き換え、同じカテゴリを二重に出力しません。</Hint>
    <form className="actions" aria-label="カメラプリセット作成" onSubmit={event => {
      event.preventDefault();
      if (name.trim() && change(current => ({ ...current, cameraPresets: [...current.cameraPresets, createCameraPreset(newId(), name.trim())] }))) setName('');
    }}><label>新しいカメラプリセット名<input required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label><button type="submit">カメラプリセットを追加</button></form>
    {shuffle.cameraPresets.map(preset => <CameraEditor key={preset.id} preset={preset} change={change} />)}
  </div></details>;
}

export function ShuffleTransfer({ shuffle, change, onError }: { shuffle: ShuffleData; change: Change; onError: (message: string) => void }) {
  const [incoming, setIncoming] = useState<ShuffleData | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [notice, setNotice] = useState('');
  let problem = '';
  if (incoming) { try { importShuffle(shuffle, incoming, mode); } catch (error) { problem = message(error); } }
  return <details className="panel"><summary>標準テンプレート・シャッフル設定の取込/書出し</summary><div className="stack">
    <button type="button" onClick={() => { if (change(current => addDefaultLibrary(current, newId))) setNotice('標準のテンプレート・候補プール・カメラプリセットを追加しました。'); }}>標準テンプレート・候補を追加</button>
    <Hint label="標準テンプレート" summary="汎用の例です（効果は未検証・キャラクターは含みません）">標準テンプレートは公式記法の例（source#hug など）に沿った汎用例です。モデルでの効果は未検証です。キャラクターは含みません。</Hint>
    <button type="button" onClick={() => { try { downloadText(exportShuffle(shuffle, now()), 'nai-shuffle-settings.json'); } catch (error) { onError(message(error)); } }}>シャッフル設定をエクスポート</button>
    <label>シャッフル設定をインポート<input type="file" accept=".json,application/json" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; setIncoming(null); setNotice('');
      if (!file) return;
      void file.text().then(text => setIncoming(parseShuffleExport(text))).catch(error => onError(`${message(error)}。現在の設定は変更していません`));
    }} /></label>
    {incoming && <div className="stack" aria-label="シャッフル設定の取込プレビュー">
      <p>取込候補: キャラクター{incoming.characters.length}件、テンプレート{incoming.templates.length}件、候補プール{incoming.pools.length}件、カメラ{incoming.cameraPresets.length}件、プロファイル{incoming.profiles.length}件</p>
      <label>シャッフル設定の取込方法<select value={mode} onChange={event => setMode(event.target.value as 'merge' | 'replace')}><option value="merge">追加（ID衝突はエラー）</option><option value="replace">シャッフル設定を全置換（履歴も置換）</option></select></label>
      {problem && <p role="alert">{problem}</p>}
      <div className="actions"><button type="button" disabled={!!problem} onClick={() => {
        if (!confirm(mode === 'replace' ? 'シャッフル設定を全置換しますか？Undoで戻せます。' : 'シャッフル設定を追加しますか？')) return;
        if (change(current => importShuffle(current, incoming, mode))) { setIncoming(null); setNotice('シャッフル設定を取り込みました。'); }
      }}>確認してシャッフル設定を取込</button><button type="button" onClick={() => setIncoming(null)}>シャッフル設定の取込をキャンセル</button></div>
    </div>}
    {notice && <p role="status">{notice}</p>}
  </div></details>;
}
