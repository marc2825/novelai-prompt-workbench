import { useEffect, useId, useRef, useState } from 'react';
import { commentRange, toggleCommentSpan } from '../core/comments';
import type { PromptSpan } from '../core/types';
import { applyTagWeight, selectTagWeight, type TagWeightTarget } from '../core/weights';
import { newId } from './shared';
import { message } from './useWorkbench';
import { TagWeightControl } from './TagWeightControl';
import { InfoTip } from './InfoTip';

export function PromptEditor({ label, value, spans, rows = 3, onChange, undo, redo, onWeightDraftChange }: {
  label: string; value: string; spans?: PromptSpan[]; rows?: number;
  onChange: (raw: string, spans?: PromptSpan[]) => void; undo: () => void; redo: () => void;
  onWeightDraftChange?: (editorId: string, pending: boolean) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const editorId = useId();
  const inputId = `${editorId}-input`;
  const [issue, setIssue] = useState('');
  const [target, setTarget] = useState<TagWeightTarget | null>(null);
  const activeTarget = target?.source === value && !spans ? target : null;
  useEffect(() => { setTarget(null); }, [value, spans]);
  useEffect(() => {
    onWeightDraftChange?.(editorId, !!activeTarget);
    return () => onWeightDraftChange?.(editorId, false);
  }, [!!activeTarget, editorId, onWeightDraftChange]);
  useEffect(() => setIssue(''), [value, spans]);
  const run = (action: () => void) => { try { action(); setIssue(''); } catch (error) { setIssue(message(error)); } };
  return <div className="stack prompt-editor">
    <div className="field-head"><label htmlFor={inputId}>{label}</label><InfoTip label={`${label}の編集`}>{spans
      ? 'OFFにした範囲の原文も保持しています。下のチェックで範囲ごとにON/OFFでき、構造を解除するまで本文は読取り専用です。'
      : 'テキストの一部を選んで「選択範囲をOFF」にすると、原文を残したまま出力から外せます。タグを1つ選んで「重みを調整」で0〜2の重みを付けます（既存の数値重みは「1.2::tag::」全体を選択）。'}</InfoTip></div>
    <textarea id={inputId} ref={input} rows={rows} maxLength={1_000_000} readOnly={!!spans} value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => {
      if (!spans || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'z' || key === 'y') { event.preventDefault(); event.stopPropagation(); if (key === 'y' || event.shiftKey) redo(); else undo(); }
    }} />
    <div className="actions"><button type="button" className="small" onMouseDown={event => event.preventDefault()} onClick={() => run(() => {
      if (!input.current) return;
      const next = commentRange(value, spans, input.current.selectionStart, input.current.selectionEnd, [newId(), newId(), newId()]);
      onChange(value, next);
    })} aria-label={`${label}の選択範囲をOFF`} title="選んだ範囲を、原文を残したまま出力から外します">範囲をOFF</button>
      <button type="button" className="small" disabled={!!spans} onMouseDown={event => event.preventDefault()} onClick={() => run(() => {
        setTarget(null);
        if (input.current) setTarget(selectTagWeight(value, input.current.selectionStart, input.current.selectionEnd));
      })} aria-label={`${label}の重みを調整`} title="選んだタグの重みを0〜2で調整します">重みを調整</button>
      {spans && <button type="button" className="small" onClick={() => {
        if (confirm('全範囲を有効な原文に戻して編集しますか？元に戻す操作でコメント状態を復元できます。')) onChange(value);
      }} aria-label={`${label}のコメント構造を解除して編集`}>OFF範囲を解除して編集</button>}
    </div>
    {activeTarget && <TagWeightControl key={`${activeTarget.start}:${activeTarget.end}:${activeTarget.source}`} label={label} target={activeTarget} onApply={weight => run(() => {
      const next = applyTagWeight(value, activeTarget, weight);
      if (next !== value) onChange(next);
      setTarget(null);
    })} onCancel={() => setTarget(null)} />}
    {spans && <div className="stack" aria-label={`${label}のコメント範囲`}>
      {spans.map((span, index) => <div key={span.id} className={span.enabled ? '' : 'inactive'}><label className="inline"><input type="checkbox" checked={span.enabled} onChange={() => run(() => onChange(value, toggleCommentSpan(value, spans, span.id)))} />範囲{index + 1} 有効</label><pre className="member-raw">{span.text}</pre></div>)}
    </div>}
    {issue && <p role="alert">{issue}</p>}
  </div>;
}
