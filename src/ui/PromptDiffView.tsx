import { useMemo } from 'react';
import { textDifference } from '../core/experiments';
import { diffTags } from '../core/prompt-diff';

const LIMIT = 30;
const list = (items: string[]) => `${items.slice(0, LIMIT).join('、')}${items.length > LIMIT ? ` ほか${items.length - LIMIT}件` : ''}`;

/**
 * Tag-level summary of a prompt change (issue #30) with the raw character
 * difference underneath. When the prompt cannot be split safely (macros,
 * unbalanced brackets) only the raw difference is shown.
 */
export function PromptDiffView({ before, after, label }: { before: string; after: string; label: string }) {
  const tags = useMemo(() => diffTags(before, after), [before, after]);
  const raw = useMemo(() => textDifference(before, after), [before, after]);
  const same = before === after;
  return <div className="stack prompt-diff" role="group" aria-label={`${label}の差分`}>
    <h4>{label}</h4>
    {same ? <p className="hint">変更なし</p> : tags ? <ul className="tag-diff">
      {!!tags.added.length && <li className="added">追加 {tags.added.length}: {list(tags.added.map(tag => tag.raw))}</li>}
      {!!tags.removed.length && <li className="removed">削除 {tags.removed.length}: {list(tags.removed.map(tag => tag.raw))}</li>}
      {!!tags.reweighted.length && <li>重み・括弧の変更 {tags.reweighted.length}: {list(tags.reweighted.map(item => `${item.before} → ${item.after}`))}</li>}
      {!!tags.moved.length && <li>並び順の変更 {tags.moved.length}: {list(tags.moved)}</li>}
      {!tags.added.length && !tags.removed.length && !tags.reweighted.length && !tags.moved.length && <li>タグの変更なし（区切りや空白のみの違い）</li>}
    </ul> : <p className="hint">特殊な構文を含むため、タグ単位では比べず原文の差分だけを表示します。</p>}
    {!same && <pre className="diff-text">{raw.prefix}<del>{raw.removed}</del><ins>{raw.added}</ins>{raw.suffix}</pre>}
  </div>;
}
