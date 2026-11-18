import { useEffect, useId, useRef, useState } from 'react';
import { commentRange, toggleCommentSpan } from '../core/comments';
import type { PromptSpan } from '../core/types';
import { applyTagWeight, selectTagWeight, type TagWeightTarget } from '../core/weights';
import { newId } from './shared';
import { message } from './useWorkbench';
import { TagWeightControl } from './TagWeightControl';

export function PromptEditor({ label, value, spans, rows = 3, onChange, undo, redo, onWeightDraftChange }: {
  label: string; value: string; spans?: PromptSpan[]; rows?: number;
  onChange: (raw: string, spans?: PromptSpan[]) => void; undo: () => void; redo: () => void;
  onWeightDraftChange?: (editorId: string, pending: boolean) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const editorId = useId();
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
    <label>{label}<textarea ref={input} rows={rows} maxLength={1_000_000} readOnly={!!spans} value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => {
      if (!spans || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'z' || key === 'y') { event.preventDefault(); event.stopPropagation(); if (key === 'y' || event.shiftKey) redo(); else undo(); }
    }} /></label>
    <div className="actions"><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => run(() => {
      if (!input.current) return;
      const next = commentRange(value, spans, input.current.selectionStart, input.current.selectionEnd, [newId(), newId(), newId()]);
      onChange(value, next);
    })}>{label}の選択範囲をOFF</button>
      <button type="button" disabled={!!spans} onMouseDown={event => event.preventDefault()} onClick={() => run(() => {
        setTarget(null);
        if (input.current) setTarget(selectTagWeight(value, input.current.selectionStart, input.current.selectionEnd));
      })}>{label}の重みを調整</button>
      {spans && <button type="button" onClick={() => {
        if (confirm('全範囲を有効な原文に戻して編集しますか？元に戻す操作でコメント状態を復元できます。')) onChange(value);
      }}>{label}のコメント構造を解除して編集</button>}
    </div>
    {!spans && <p className="hint">タグを選択して「重みを調整」。既存の数値重みは「1.2::tag::」全体を選択します。</p>}
    {activeTarget && <TagWeightControl key={`${activeTarget.start}:${activeTarget.end}:${activeTarget.source}`} label={label} target={activeTarget} onApply={weight => run(() => {
      const next = applyTagWeight(value, activeTarget, weight);
      if (next !== value) onChange(next);
      setTarget(null);
    })} onCancel={() => setTarget(null)} />}
    {spans && <div className="stack" aria-label={`${label}のコメント範囲`}>
      <p className="hint">原文を保持しています。トグルで解除できます。構造を解除するまで本文は読取り専用です。</p>
      {spans.map((span, index) => <div key={span.id} className={span.enabled ? '' : 'inactive'}><label className="inline"><input type="checkbox" checked={span.enabled} onChange={() => run(() => onChange(value, toggleCommentSpan(value, spans, span.id)))} />範囲{index + 1} 有効</label><pre className="member-raw">{span.text}</pre></div>)}
    </div>}
    {issue && <p role="alert">{issue}</p>}
  </div>;
}
