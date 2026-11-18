import { useId, useState } from 'react';
import { MAX_TAG_WEIGHT, MIN_TAG_WEIGHT, previewTagWeight, TAG_WEIGHT_STEP, type TagWeightTarget } from '../core/weights';
import { message } from './useWorkbench';

export function TagWeightControl({ label, target, onApply, onCancel }: {
  label: string; target: TagWeightTarget; onApply: (weight: number) => void; onCancel: () => void;
}) {
  const [weight, setWeight] = useState(target.weight);
  const [number, setNumber] = useState(String(target.weight));
  const id = useId();
  const valid = number.trim() !== '' && Number.isFinite(Number(number)) && Number(number) >= MIN_TAG_WEIGHT && Number(number) <= MAX_TAG_WEIGHT;
  let preview = ''; let issue = '';
  try { preview = previewTagWeight(target, weight); } catch (cause) { issue = message(cause); }
  const change = (value: number) => { setWeight(value); setNumber(String(value)); };
  return <section className="weight-control stack" aria-label={`${label}のタグ重み`}>
    <div className="group-head"><strong>タグの重み</strong><output htmlFor={id}>{Number(weight.toFixed(2)) === weight ? weight.toFixed(2) : String(weight)}</output></div>
    <p className="weight-target">{target.text}</p>
    <label>重みスライダー<input id={id} type="range" min={MIN_TAG_WEIGHT} max={MAX_TAG_WEIGHT} step={TAG_WEIGHT_STEP} value={weight} onChange={event => change(Number(event.target.value))} /></label>
    <div className="weight-scale" aria-hidden="true"><span>0</span><span>1 · 標準</span><span>2</span></div>
    <div className="actions"><label>重みの数値<input type="number" min={MIN_TAG_WEIGHT} max={MAX_TAG_WEIGHT} step="0.01" value={number} aria-invalid={!valid || !!issue} onChange={event => {
      const raw = event.target.value; setNumber(raw); const next = Number(raw);
      if (raw.trim() && Number.isFinite(next) && next >= MIN_TAG_WEIGHT && next <= MAX_TAG_WEIGHT) setWeight(next);
    }} /></label><button type="button" onClick={() => change(1)}>標準の重みに戻す</button></div>
    <p className="hint">未反映のプレビューです。「重みを反映」でこの編集欄に確定します。0でもタグの文字列は残ります。</p>
    <label>重み変更後のプレビュー<textarea readOnly rows={3} value={preview} /></label>
    {(!valid || issue) && <p role="alert">{issue || '重みは0〜2の数値で指定してください'}</p>}
    <div className="actions"><button type="button" disabled={!valid || !!issue} onClick={() => onApply(weight)}>重みを反映</button><button type="button" onClick={onCancel}>重みの調整を閉じる</button></div>
  </section>;
}
