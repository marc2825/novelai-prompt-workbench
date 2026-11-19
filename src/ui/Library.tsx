import { useMemo, useState, type FormEvent } from 'react';
import { searchLibrary } from '../core/search';
import type { Channel, LibraryEntry } from '../core/types';
import type { Workbench } from './useWorkbench';
import { Empty, newId, now, Rename } from './shared';
import { InfoTip } from './InfoTip';

const PAGE_SIZE = 50;

function EntryForm({ entry, workbench, onClose }: { entry: LibraryEntry | null; workbench: Workbench; onClose: () => void }) {
  const data = workbench.data!;
  const [title, setTitle] = useState(entry?.title ?? '');
  const [raw, setRaw] = useState(entry?.raw ?? '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [tags, setTags] = useState(entry?.tags.join('\n') ?? '');
  const [categoryId, setCategoryId] = useState(entry?.categoryId ?? '');
  const [channel, setChannel] = useState<Channel>(entry?.defaultChannel ?? 'positive');
  function submit(event: FormEvent) {
    event.preventDefault();
    const timestamp = now();
    const updated: LibraryEntry = { ...entry, id: entry?.id ?? newId(), title, raw, description, tags: tags.split('\n').map(tag => tag.trim()).filter(Boolean), categoryId: categoryId || null, defaultChannel: channel, previewImageIds: entry?.previewImageIds ?? [], createdAt: entry?.createdAt ?? timestamp, updatedAt: timestamp };
    if (workbench.commit(previous => ({ ...previous, libraryEntries: entry ? previous.libraryEntries.map(item => item.id === entry.id ? updated : item) : [...previous.libraryEntries, updated] }))) onClose();
  }
  return <form className="panel stack" onSubmit={submit} aria-label="ライブラリ編集">
    <h2>{entry ? 'ライブラリを編集' : 'ライブラリを追加'}</h2>
    <label>名前<input autoFocus required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label>プロンプト原文<textarea required rows={4} maxLength={1_000_000} value={raw} onChange={event => setRaw(event.target.value)} /></label>
    <label>説明<textarea rows={2} maxLength={10_000} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <label>カテゴリ<select value={categoryId} onChange={event => setCategoryId(event.target.value)}><option value="">未分類</option>{data.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
    <label>タグ（1行に1つ）<textarea rows={2} value={tags} onChange={event => setTags(event.target.value)} /></label>
    <label>既定チャンネル<select value={channel} onChange={event => setChannel(event.target.value as Channel)}><option value="positive">Positive</option><option value="negative">Negative</option></select></label>
    <div className="actions"><button type="submit">保存</button><button type="button" onClick={onClose}>キャンセル</button></div>
  </form>;
}

export function Library({ workbench, addToGroup }: { workbench: Workbench; addToGroup: (entry: LibraryEntry, groupId: string) => void }) {
  const data = workbench.data!;
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<LibraryEntry | null | undefined>(undefined);
  const [categoryName, setCategoryName] = useState('');
  const workspace = data.workspaces.find(item => item.id === data.settings.activeWorkspaceId);
  const [targetGroup, setTargetGroup] = useState('');
  const groupId = workspace?.groups.some(group => group.id === targetGroup) ? targetGroup : workspace?.groups[0]?.id ?? '';
  const results = useMemo(() => searchLibrary(data.libraryEntries, data.categories, { query, categoryId, tag, sort: data.settings.librarySort }), [data, query, categoryId, tag]);
  const actualPage = Math.min(page, Math.max(0, Math.ceil(results.length / PAGE_SIZE) - 1));
  const tags = [...new Set(data.libraryEntries.flatMap(entry => entry.tags))].sort();

  return <div className="stack">
    {editing !== undefined ? <EntryForm key={editing?.id ?? 'new'} entry={editing} workbench={workbench} onClose={() => setEditing(undefined)} /> : <button type="button" className="primary" onClick={() => setEditing(null)}>＋ ライブラリを追加</button>}
    <section className="panel stack" aria-label="検索と絞り込み">
      <label>検索<input type="search" value={query} placeholder="日本語名・原文・説明・タグ・カテゴリ" onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <div className="columns three"><label>カテゴリで絞る<select value={categoryId} onChange={event => { setCategoryId(event.target.value); setPage(0); }}><option value="">すべて</option>{data.categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
      <label>タグで絞る<select value={tag} onChange={event => { setTag(event.target.value); setPage(0); }}><option value="">すべて</option>{tags.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>並び順<select value={data.settings.librarySort} onChange={event => workbench.commit(previous => ({ ...previous, settings: { ...previous.settings, librarySort: event.target.value as 'title' | 'updatedAt' } }))}><option value="title">名前順</option><option value="updatedAt">更新が新しい順</option></select></label></div>
    </section>
    <details className="panel"><summary>カテゴリ管理</summary><div className="stack">
      <form className="actions" onSubmit={event => { event.preventDefault(); if (workbench.commit(previous => ({ ...previous, categories: [...previous.categories, { id: newId(), name: categoryName }] }))) setCategoryName(''); }}><label>新しいカテゴリ<input required maxLength={200} value={categoryName} onChange={event => setCategoryName(event.target.value)} /></label><button type="submit">カテゴリ追加</button></form>
      {data.categories.map(category => <div key={category.id} className="actions"><Rename label="カテゴリ名" value={category.name} onSave={name => workbench.commit(previous => ({ ...previous, categories: previous.categories.map(item => item.id === category.id ? { ...item, name } : item) }))} /><button type="button" onClick={() => {
        if (confirm(`カテゴリ「${category.name}」を削除し、登録項目を未分類にしますか？`)) { workbench.commit(previous => ({ ...previous, categories: previous.categories.filter(item => item.id !== category.id), libraryEntries: previous.libraryEntries.map(entry => entry.categoryId === category.id ? { ...entry, categoryId: null } : entry) })); setCategoryId(''); }
      }}>カテゴリ削除</button></div>)}
    </div></details>
    <section className="panel stack" aria-label="部品の追加先">
      <div className="field-head"><span>追加先: {workspace?.title ?? 'ワークスペース未作成'}</span><InfoTip label="構成への追加">「構成に追加」を押すと、現在のワークスペースの選んだグループに原文をスナップショット（その時点のコピー）として追加します。あとでライブラリを編集しても構成側は変わりません。</InfoTip></div>
      <label>追加先グループ<select value={groupId} onChange={event => setTargetGroup(event.target.value)}><option value="" disabled>ワークスペースでグループを作成</option>{workspace?.groups.map(group => <option key={group.id} value={group.id}>{group.name} ({group.channel})</option>)}</select></label>
    </section>
    <p role="status">{results.length}件 / 全{data.libraryEntries.length}件</p>
    {!results.length && <Empty>{data.libraryEntries.length ? '条件に一致する項目がありません。' : '最初のプロンプトを追加してください。デモは設定から明示的に追加できます。'}</Empty>}
    {results.slice(actualPage * PAGE_SIZE, (actualPage + 1) * PAGE_SIZE).map(entry => <article className="panel stack" key={entry.id} aria-label={entry.title}>
      <div className="group-head"><h2>{entry.title}</h2><span className={`badge ${entry.defaultChannel}`}>{entry.defaultChannel}</span></div>
      <pre>{entry.raw}</pre>
      <p className="entry-meta">{data.categories.find(category => category.id === entry.categoryId)?.name ?? '未分類'}{entry.tags.length ? ` · ${entry.tags.join(' / ')}` : ''}{entry.description ? ` — ${entry.description}` : ''}</p>
      <div className="actions"><button type="button" className="small primary" disabled={!groupId} onClick={() => addToGroup(entry, groupId)}>構成に追加</button><button type="button" className="small" onClick={() => setEditing(entry)}>編集</button><button type="button" className="small" onClick={() => { const timestamp = now(); workbench.commit(previous => ({ ...previous, libraryEntries: [...previous.libraryEntries, { ...structuredClone(entry), id: newId(), title: `${entry.title.slice(0, 195)} のコピー`, createdAt: timestamp, updatedAt: timestamp }] })); }}>複製</button><button type="button" className="small danger" onClick={() => {
        if (confirm(`「${entry.title}」を削除しますか？構成のスナップショットは残ります。`)) workbench.commit(previous => ({ ...previous, libraryEntries: previous.libraryEntries.filter(item => item.id !== entry.id) }));
      }}>削除</button></div>
    </article>)}
    {results.length > PAGE_SIZE && <div className="actions"><button type="button" disabled={actualPage === 0} onClick={() => setPage(actualPage - 1)}>前の50件</button><span>{actualPage + 1} / {Math.ceil(results.length / PAGE_SIZE)}</span><button type="button" disabled={(actualPage + 1) * PAGE_SIZE >= results.length} onClick={() => setPage(actualPage + 1)}>次の50件</button></div>}
  </div>;
}
