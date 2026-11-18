import type { Axis, Definition } from '../../core/lab/types';
import { AXIS_KINDS, emptyAxis } from '../../core/lab/types';
import { applyTemplate, PRESETS, SAMPLERS } from '../../core/lab/engine';
import { consecutiveSeeds, seedList } from '../../core/lab/values';
import { message } from '../useWorkbench';
export type Translate = (ja: string, en: string) => string;
export const axisLabels = ['固定 / Fixed','タグ重み / Tag Weight','有無 / On–Off','タグ置換 / Replace','Prompt S/R','タグ位置 / Position','タググループ / Group','Prompt Variant','Seed','Steps','Prompt Guidance','Guidance Rescale','Sampler','Model','解像度 / Resolution','UC Variant','Quality Tags','Prompt Matrix'];
export function Setup({ value: d, change, t }: { value: Definition; change: (d: Definition) => void; t: Translate }) {
  const set = <K extends keyof Definition>(k: K, value: Definition[K]) => change({ ...d, [k]: value });
  const settings = <K extends keyof Definition['settings']>(k: K, value: Definition['settings'][K]) => set('settings', { ...d.settings, [k]: value });
  const axis = (i: number, a: Axis) => set('axes', d.axes.map((old, j) => i === j ? a : old) as Definition['axes']);
  return <div className="stack">
    <label>{t('実験テンプレート','Experiment template')}<select defaultValue="" onChange={e => { if (e.target.value) change(applyTemplate(d, e.target.value)); e.target.value = ''; }}><option value="">—</option>{PRESETS.map(name => <option key={name}>{name}</option>)}</select></label>
    <label>{t('実験名','Experiment name')}<input maxLength={200} value={d.name} onChange={e => set('name',e.target.value)} /></label>
    <label>{t('説明','Description')}<textarea maxLength={10000} value={d.description} onChange={e => set('description',e.target.value)} /></label>
    <label>Base Prompt<textarea rows={4} maxLength={100000} value={d.positive} onChange={e => set('positive',e.target.value)} /></label>
    <label>Undesired Content<textarea maxLength={100000} disabled={d.settings.effort === 'medium'} value={d.negative} onChange={e => set('negative',e.target.value)} /></label>
    <div className="columns"><label>Model<select value={d.settings.model} onChange={e => settings('model',e.target.value as Definition['settings']['model'])}><option>V5 Full</option><option>V5 Curated</option></select></label>
    <label>Effort<select value={d.settings.effort} onChange={e => { const effort = e.target.value as 'high' | 'medium'; if (effort === 'high') settings('effort',effort); else if (confirm(t('Medium用に14 Steps・Euler Ancestralへ変更し、UCとRescaleを解除しますか？','Set 14 Steps / Euler Ancestral and clear UC / Rescale for Medium?'))) change({ ...d, negative: '', settings: { ...d.settings, model: 'V5 Full', effort, steps: 14, sampler: 'Euler Ancestral', rescale: null } }); }}><option value="high">High</option><option value="medium">Medium (Full)</option></select></label></div>
    <div className="columns">{(['steps','guidance','rescale','width','height'] as const).map(k => <label key={k}>{k}<input type="number" step={k === 'guidance' || k === 'rescale' ? '0.01' : '1'} disabled={d.settings.effort === 'medium' && (k === 'steps' || k === 'rescale')} value={d.settings[k] ?? ''} onChange={e => settings(k,Number(e.target.value))} /></label>)}
    <label>Sampler<select disabled={d.settings.effort === 'medium'} value={d.settings.sampler} onChange={e => settings('sampler',e.target.value)}>{SAMPLERS.map(v => <option key={v}>{v}</option>)}</select></label></div>
    <label className="inline"><input type="checkbox" checked={d.settings.quality} onChange={e => settings('quality',e.target.checked)} />Quality Tags</label>
    <label>{t('共通Seed群（数字をカンマ区切り）','Shared seeds (comma separated)')}<input value={d.seeds.join(',')} onChange={e => set('seeds',e.target.value.split(',').map(v => v.trim()))} /></label>
    <div className="actions"><button type="button" onClick={() => { try { const count = prompt(t('連続Seed数 (1–64)','Consecutive seed count (1–64)'),'3'); if (count) set('seeds',consecutiveSeeds(d.seeds[0] ?? '1001',Number(count))); } catch (e) { alert(message(e)); } }}>{t('連続Seed','Consecutive seeds')}</button><button type="button" onClick={() => { const raw = prompt(t('ランダムSeed数 (1–64)','Random seed count (1–64)'),'3'); if (!raw) return; const count = Number(raw); if (!Number.isInteger(count) || count < 1 || count > 64) return; const seeds = new Set<string>(); while (seeds.size < count) seeds.add(String(crypto.getRandomValues(new Uint32Array(1))[0])); set('seeds',seedList([...seeds].join(','))); }}>{t('ランダムSeedを事前生成','Pre-generate random seeds')}</button></div>
    <div className="columns"><label>{t('各Seedでの反復数','Repeats per seed')}<input type="number" min="1" max="16" value={d.repeats} onChange={e => set('repeats',Number(e.target.value))} /></label><label>{t('1枚のAnlas（任意・公式画面で確認）','Anlas per image (optional, check official UI)')}<input type="number" min="0" step="0.01" value={d.costPerImage ?? ''} onChange={e => set('costPerImage',e.target.value === '' ? null : Number(e.target.value))} /></label></div>
    {d.axes.map((a,i) => <fieldset className="stack" key={i}><legend>{['X','Y','Z'][i]} {t('軸','axis')}</legend>
      <label>{['X','Y','Z'][i]} Type<select value={a.kind} onChange={e => axis(i,{ ...emptyAxis(), kind:e.target.value as Axis['kind'] })}>{AXIS_KINDS.map((kind,j) => <option key={kind} value={kind} disabled={d.settings.effort === 'medium' && ['steps','sampler','rescale','uc'].includes(kind)}>{axisLabels[j]}</option>)}</select></label>
      {a.kind !== 'none' && <>
        {['weight','onOff','replace','searchReplace','position'].includes(a.kind) && <div className="columns"><label>{['X','Y','Z'][i]} Target<input maxLength={1000} value={a.target} onChange={e => axis(i,{...a,target:e.target.value})} /></label><label>{t('出現番号（1から、S/Rのみ0=全件）','Occurrence (1-based; S/R only: 0=all)')}<input type="number" min={a.kind === 'searchReplace' ? 0 : 1} value={a.occurrence} onChange={e => axis(i,{...a,occurrence:Number(e.target.value)})} /></label></div>}
        <div className="columns"><label>Channel<select value={a.channel} disabled={a.kind === 'uc'} onChange={e => axis(i,{...a,channel:e.target.value as Axis['channel']})}><option value="positive">Positive</option><option value="negative">Negative</option></select></label><label>{t('候補形式','Value format')}<select value={a.format} onChange={e => axis(i,{...a,format:e.target.value as Axis['format']})}><option value="lines">1 line = 1 candidate</option><option value="csv">CSV ("a, b",c)</option></select></label></div>
        <label>{['X','Y','Z'][i]} Values<textarea maxLength={100000} value={a.input} onChange={e => axis(i,{...a,input:e.target.value})} /></label>
        <p className="hint">{t('数値: 0.5,1,1.5 / 0.5-2 (+0.25) / 0.5-2 [7]。有無: Off/On、位置: first/last、解像度: 1024x1024。テキストは1行1候補。','Numbers: 0.5,1,1.5 / 0.5-2 (+0.25) / 0.5-2 [7]. On/Off: Off/On. Position: first/last. Resolution: 1024x1024. Text: one candidate per line.')}</p>
      </>}
      <div className="actions"><button type="button" onClick={() => { const next = [...d.axes] as Definition['axes']; const j = (i+1)%3; [next[i],next[j]] = [next[j]!,next[i]!]; set('axes',next); }}>{t('次の軸と交換','Swap with next axis')}</button><button type="button" onClick={() => axis((i+1)%3,structuredClone(a))}>{t('次の軸へコピー','Copy to next axis')}</button></div>
    </fieldset>)}
  </div>;
}
