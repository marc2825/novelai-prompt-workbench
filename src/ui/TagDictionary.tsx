import { useMemo, useState, type FormEvent } from 'react';
import { normalizeTag, reviewLibraryTags, TAG_DICTIONARY_SCHEMA_VERSION, TAG_LIMITS } from '../core/tags';
import type { TagDictionaryEntry, WorkbenchData } from '../core/types';
import type { Workbench } from './useWorkbench';
import { Empty, newId, now } from './shared';
import { Hint, InfoTip } from './InfoTip';

const PAGE_SIZE = 50;
const NO_ENTRIES: readonly TagDictionaryEntry[] = [];
/** Aliases are typed comma separated (ASCII, Japanese and full-width commas) or one per line. */
const splitAliases = (text: string) => [...new Set(text.split(/[,、，\n]/).map(alias => alias.trim()).filter(Boolean))];

function withEntries(data: WorkbenchData, change: (entries: readonly TagDictionaryEntry[]) => TagDictionaryEntry[]): WorkbenchData {
  return { ...data, tagDictionary: { ...data.tagDictionary, schemaVersion: TAG_DICTIONARY_SCHEMA_VERSION, entries: change(data.tagDictionary?.entries ?? NO_ENTRIES) } };
}

function EntryForm({ entry, workbench, onDone }: { entry: TagDictionaryEntry | null; workbench: Workbench; onDone: () => void }) {
  const [tag, setTag] = useState(entry?.tag ?? '');
  const [aliases, setAliases] = useState(entry?.aliases.join(', ') ?? '');
  const [note, setNote] = useState(entry?.note ?? '');
  function submit(event: FormEvent) {
    event.preventDefault();
    const timestamp = now();
    const next: TagDictionaryEntry = { ...entry, id: entry?.id ?? newId(), tag: tag.trim(), aliases: splitAliases(aliases), note, createdAt: entry?.createdAt ?? timestamp, updatedAt: timestamp };
    // Validation (duplicates, 表記ゆれ of another tag, syntax characters) reports through the normal error bar.
    if (workbench.commit(previous => withEntries(previous, entries => entry ? entries.map(item => item.id === entry.id ? next : item) : [...entries, next]))) {
      if (entry) onDone(); else { setTag(''); setAliases(''); setNote(''); }
    }
  }
  return <form className="stack" aria-label={entry ? 'タグ辞書の項目を編集' : 'タグ辞書に追加'} onSubmit={submit}>
    <div className="columns">
      <label>辞書のタグ<input required maxLength={TAG_LIMITS.tag} value={tag} placeholder="silver hair" onChange={event => setTag(event.target.value)} /></label>
      <label>別名（カンマ区切り）<input value={aliases} placeholder="銀髪, gin" onChange={event => setAliases(event.target.value)} /></label>
    </div>
    <label>辞書のメモ<input maxLength={TAG_LIMITS.note} value={note} onChange={event => setNote(event.target.value)} /></label>
    <div className="actions">
      <button type="submit" className="small primary">{entry ? '辞書の変更を保存' : '辞書に追加'}</button>
      {entry && <button type="button" className="small" onClick={onDone}>辞書の編集をやめる</button>}
    </div>
  </form>;
}

/** Read-only candidates from the library. Nothing is rewritten; the user edits entries in the library if wanted. */
function Review({ data }: { data: WorkbenchData }) {
  const review = useMemo(() => reviewLibraryTags(data.libraryEntries, data.tagDictionary?.entries ?? NO_ENTRIES), [data.libraryEntries, data.tagDictionary]);
  const titles = useMemo(() => new Map(data.libraryEntries.map(entry => [entry.id, entry.title])), [data.libraryEntries]);
  const names = (ids: readonly string[]) => ids.slice(0, 3).map(id => titles.get(id) ?? '').join('・') + (ids.length > 3 ? ` ほか${ids.length - 3}件` : '');
  if (!review.variants.length && !review.duplicates.length) return <Empty>表記ゆれ・重複の候補はありません。</Empty>;
  return <div className="stack">
    {review.variants.length > 0 && <ul className="review-list" aria-label="表記ゆれの候補">
      {review.variants.map(variant => <li key={variant.key}>
        {variant.spellings.map((spelling, index) => <span key={spelling.text}>{index > 0 && ' / '}<span className="mono">{spelling.text}</span> ×{spelling.count}<small>（{names(spelling.entryIds)}）</small></span>)}
        {variant.preferred.length > 0 && <> → 辞書: <span className="mono">{variant.preferred.join(' / ')}</span></>}
      </li>)}
    </ul>}
    {review.duplicates.length > 0 && <ul className="review-list" aria-label="重複の候補">
      {review.duplicates.map(duplicate => <li key={`${duplicate.entryId}:${duplicate.tag}`}>「{titles.get(duplicate.entryId)}」: <span className="mono">{duplicate.tag}</span> ×{duplicate.count}</li>)}
    </ul>}
    {review.truncated && <p className="hint">多いため先頭の200件ずつを表示しています。</p>}
  </div>;
}

export function TagDictionaryPanel({ workbench }: { workbench: Workbench }) {
  const data = workbench.data!;
  const entries = data.tagDictionary?.entries ?? NO_ENTRIES;
  const [editing, setEditing] = useState<TagDictionaryEntry | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const current = editing && entries.find(entry => entry.id === editing.id) || null;
  const filtered = useMemo(() => {
    const key = normalizeTag(query);
    return key ? entries.filter(entry => [entry.tag, ...entry.aliases, entry.note].some(text => normalizeTag(text).includes(key))) : entries;
  }, [entries, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const actualPage = Math.min(page, pages - 1);
  return <details className="panel"><summary>タグ辞書<small> {entries.length}件</small></summary><div className="stack">
    <Hint label="タグ辞書" summary="入力補完で優先される自分用のタグです。">プロンプトの入力欄でタグを途中まで入力すると、ここに登録したタグを最優先に、ライブラリの原文に出てくるタグも候補に出します。別名（日本語名・略称など）でも探せ、確定すると登録したタグの表記が入ります。大文字小文字・_と空白・全角半角の違いは同じタグとして照合します。外部のタグデータは同梱・送信していません。変更は「元に戻す」で戻せます。</Hint>
    <EntryForm key={current?.id ?? 'new'} entry={current} workbench={workbench} onDone={() => setEditing(null)} />
    {entries.length > 0 && <>
      <label>辞書を検索<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <ul className="dictionary-list" aria-label="タグ辞書の項目">
        {filtered.slice(actualPage * PAGE_SIZE, (actualPage + 1) * PAGE_SIZE).map(entry => <li key={entry.id}>
          <div><strong className="mono">{entry.tag}</strong>{entry.aliases.length > 0 && <small> ← {entry.aliases.join(', ')}</small>}{entry.note && <small> — {entry.note}</small>}</div>
          <span className="toolbar">
            <button type="button" className="icon" aria-label={`辞書「${entry.tag}」を編集`} title="編集" onClick={() => setEditing(entry)}>✎</button>
            <button type="button" className="icon danger" aria-label={`辞書「${entry.tag}」を削除`} title="削除" onClick={() => {
              if (confirm(`タグ辞書から「${entry.tag}」を削除しますか？`) && workbench.commit(previous => withEntries(previous, items => items.filter(item => item.id !== entry.id))) && editing?.id === entry.id) setEditing(null);
            }}>✕</button>
          </span>
        </li>)}
      </ul>
      {!filtered.length && <Empty>一致する辞書の項目がありません。</Empty>}
      {pages > 1 && <div className="actions"><button type="button" className="small" disabled={actualPage === 0} onClick={() => setPage(actualPage - 1)}>辞書の前の50件</button><span>{actualPage + 1} / {pages}</span><button type="button" className="small" disabled={actualPage + 1 >= pages} onClick={() => setPage(actualPage + 1)}>辞書の次の50件</button></div>}
    </>}
    <details onToggle={event => setReviewOpen(event.currentTarget.open)}><summary>表記ゆれ・重複の候補</summary>
      <div className="stack">
        <InfoTip label="表記ゆれ・重複の候補">ライブラリの原文に出てくるタグのうち、大文字小文字・_と空白・全角半角だけが違うもの、辞書の表記と違うもの・辞書の別名で書かれたもの、同じ部品の中で重複しているものを表示します。原文は自動では書き換えません（必要ならライブラリで編集してください）。</InfoTip>
        {reviewOpen && <Review data={data} />}
      </div>
    </details>
  </div></details>;
}
