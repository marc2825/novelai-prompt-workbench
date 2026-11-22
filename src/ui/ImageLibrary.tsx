import { useMemo, useRef, useState } from 'react';
import { IMAGE_REVIEWS, IMAGE_SORTS, imageLabel, imageTags, imageUsage, pageOf, parseImageTags, removeImage, searchImages, updateImageInfo, type ImageSort, type ReviewFilter } from '../core/images';
import type { ImageRecord, ImageReview } from '../core/types';
import { prepareImage, type PreparedImage } from '../data/images';
import { Thumbnail } from './ImageComparison';
import { InfoTip } from './InfoTip';
import { downloadBlob, newId, now } from './shared';
import { message, type Workbench } from './useWorkbench';

const PAGE_SIZE = 24;
const MAX_BATCH_FILES = 100;
const MAX_BATCH_BYTES = 1024 * 1024 * 1024;
const size = (bytes: number) => bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KiB` : `${(bytes / 1048576).toFixed(1)} MiB`;

function ImageInfoEditor({ workbench, image, label, onClose }: { workbench: Workbench; image: ImageRecord; label: string; onClose: () => void }) {
  const [tags, setTags] = useState((image.tags ?? []).join(', ')); const [note, setNote] = useState(image.note ?? ''); const [issue, setIssue] = useState('');
  return <form className="stack" onSubmit={event => {
    event.preventDefault();
    try { const parsed = parseImageTags(tags); if (workbench.commit(previous => updateImageInfo(previous, image.id, { tags: parsed, note: note.trim() }))) onClose(); }
    catch (error) { setIssue(message(error)); }
  }}>
    <label>{label}のタグ<input value={tags} maxLength={1200} placeholder="例: 候補, 夜景（カンマ区切り）" onChange={event => setTags(event.target.value)} /></label>
    <label>{label}のメモ<textarea value={note} maxLength={2000} rows={2} onChange={event => setNote(event.target.value)} /></label>
    {issue && <p role="alert">{issue}</p>}
    <div className="actions"><button type="submit" className="small primary">{label}のタグ・メモを保存</button><button type="button" className="small" onClick={onClose}>{label}の編集をやめる</button></div>
  </form>;
}

/** Every imported image (issues #21, #28): bulk import, review, tags, search, sort and paging. */
export function ImageLibrary({ workbench, busy, onNotice }: { workbench: Workbench; busy: boolean; onNotice: (text: string) => void }) {
  const data = workbench.data!;
  const [query, setQuery] = useState(''); const [sort, setSort] = useState<ImageSort>('newest'); const [page, setPage] = useState(0);
  const [review, setReview] = useState<ReviewFilter>('all'); const [tag, setTag] = useState('');
  const [capacity, setCapacity] = useState('容量情報は未取得です');
  const [editing, setEditing] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<{ name: string; reason: string }[]>([]);
  const cancel = useRef(false);
  const usage = useMemo(() => imageUsage(data), [data]);
  const tags = useMemo(() => imageTags(data.images), [data.images]);
  const results = useMemo(() => searchImages(data.images, query, usage, sort, { review, tag }), [data.images, query, usage, sort, review, tag]);
  const view = pageOf(results, page, PAGE_SIZE);

  const importMany = async (files: File[]) => {
    setFailures([]);
    if (files.length > MAX_BATCH_FILES) { workbench.setError(`一度に取り込めるのは${MAX_BATCH_FILES}枚までです。分けて取り込んでください`); return; }
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_BATCH_BYTES) { workbench.setError('合計1GiBを超えています。分けて取り込んでください'); return; }
    try { const estimate = await navigator.storage?.estimate(); if (estimate?.quota !== undefined && estimate.usage !== undefined && estimate.quota - estimate.usage < total * 1.2 && !confirm('端末の保存容量が不足する可能性があります。続けますか？（不足した場合は保存エラーになり、データは変更されません）')) return; } catch { /* Estimate is optional. */ }
    cancel.current = false; setBatch({ done: 0, total: files.length });
    const prepared: PreparedImage[] = []; const failed: { name: string; reason: string }[] = [];
    try {
      for (const [index, file] of files.entries()) {
        if (cancel.current) { onNotice('一括取込を中止しました。何も取り込んでいません。'); return; }
        setBatch({ done: index, total: files.length });
        try { prepared.push(await prepareImage(file, newId(), now())); } catch (error) { failed.push({ name: file.name, reason: message(error) }); }
      }
      setFailures(failed);
      if (!prepared.length) { onNotice(`取り込めるPNGがありませんでした（失敗${failed.length}件）。`); return; }
      const result = workbench.addImages(prepared);
      onNotice(`${result.added}件を取り込みました。${result.duplicates.length ? `既にある同じ画像${result.duplicates.length}件は追加していません。` : ''}${failed.length ? `取り込めなかったPNG: ${failed.length}件（下に一覧）。` : ''}「元に戻す」1回で取込前に戻せます。`);
      setPage(0);
    } catch (error) { workbench.setError(`一括取込に失敗しました: ${message(error)}。データは変更していません`); }
    finally { setBatch(null); }
  };

  return <details className="panel"><summary><h3>画像ライブラリ ({data.images.length})</h3></summary><div className="stack">
    <InfoTip label="画像ライブラリ">取り込んだPNGの原本とサムネイルをこの端末に保存します。JSONバックアップには画像を含まないため、画像も残すには「設定」の完全バックアップを使用してください。削除した画像のデータは「元に戻す」のために残り、「参照されない画像バイナリを解放」で整理できます。検索は名前・SHA-256の先頭・プロンプトの注記・タグ・メモ・使用先が対象です。評価（採用・保留・不採用）とタグは結果の整理用で、プロンプトには影響しません。</InfoTip>
    <p className="hint">登録画像の原本合計 {(data.images.reduce((sum, image) => sum + image.byteLength, 0) / 1048576).toFixed(2)} MiB / {capacity}</p>
    <div className="actions">
      <label>PNGをまとめて取り込む<input type="file" multiple accept=".png,image/png" disabled={busy || !!batch} onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ''; if (files.length) void importMany(files); }} /></label>
      <button type="button" className="small" onClick={() => { if (!navigator.storage?.estimate) { setCapacity('この環境は容量取得に非対応です'); return; } void navigator.storage.estimate().then(value => setCapacity(`ブラウザ使用 ${(Number(value.usage ?? 0) / 1048576).toFixed(1)} MiB / 割当 ${value.quota === undefined ? '不明' : (value.quota / 1048576).toFixed(1) + ' MiB'}（概算）`)).catch(cause => workbench.setError(message(cause))); }}>ストレージ容量を確認</button>
    </div>
    {batch && <div className="actions" role="status" aria-label="一括取込の進行状況"><span>PNGを検証中… {batch.done}/{batch.total}</span><button type="button" className="small" onClick={() => { cancel.current = true; }}>一括取込を中止</button></div>}
    {!!failures.length && <div className="notice" aria-label="取り込めなかったPNG"><strong>取り込めなかったPNG（{failures.length}件）</strong><ul>{failures.slice(0, 50).map((item, index) => <li key={index}>{item.name}: {item.reason}</li>)}</ul>{failures.length > 50 && <p className="hint">先頭50件を表示しています。</p>}<button type="button" className="small" onClick={() => setFailures([])}>失敗の一覧を閉じる</button></div>}
    {data.images.length > 0 && <div className="columns">
      <label>画像を検索<input type="search" value={query} placeholder="名前・ハッシュ・タグ・メモ・使用先" onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <label>画像の並び順<select value={sort} onChange={event => { setSort(event.target.value as ImageSort); setPage(0); }}>{(Object.keys(IMAGE_SORTS) as ImageSort[]).map(key => <option key={key} value={key}>{IMAGE_SORTS[key]}</option>)}</select></label>
      <label>評価で絞る<select value={review} onChange={event => { setReview(event.target.value as ReviewFilter); setPage(0); }}><option value="all">すべて</option><option value="none">未評価</option>{(Object.keys(IMAGE_REVIEWS) as ImageReview[]).map(key => <option key={key} value={key}>{IMAGE_REVIEWS[key]}</option>)}</select></label>
      <label>画像のタグで絞る<select value={tag} onChange={event => { setTag(event.target.value); setPage(0); }}><option value="">すべて</option>{tags.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>}
    {data.images.length > 0 && <p className="hint" role="status" aria-label="画像の件数">{results.length}件 / 全{data.images.length}件</p>}
    {view.items.map(image => {
      const label = imageLabel(image, data.images); const used = usage.get(image.id) ?? [];
      return <article key={image.id} className="member image-item" aria-label={label}>
        <Thumbnail workbench={workbench} image={image} />
        <div className="image-item-body"><p>{image.name}</p><p className="hint">{image.width}×{image.height} · {size(image.byteLength)} · {used.length ? `使用: ${used.slice(0, 3).join('、')}${used.length > 3 ? ` ほか${used.length - 3}件` : ''}` : '未使用'}</p>
          {(image.tags?.length || image.note) && <p className="hint">{image.tags?.length ? `タグ: ${image.tags.join('、')}` : ''}{image.tags?.length && image.note ? ' · ' : ''}{image.note ? `メモ: ${image.note.slice(0, 80)}${image.note.length > 80 ? '…' : ''}` : ''}</p>}
          <div className="toolbar">
            <select className="small" aria-label={`${label}の評価`} value={image.review ?? ''} onChange={event => { const value = event.target.value as ImageReview | ''; workbench.commit(previous => updateImageInfo(previous, image.id, { review: value || null })); }}><option value="">未評価</option>{(Object.keys(IMAGE_REVIEWS) as ImageReview[]).map(key => <option key={key} value={key}>{IMAGE_REVIEWS[key]}</option>)}</select>
            <button type="button" className="small" aria-label={`${label}のタグ・メモを編集`} aria-expanded={editing === image.id} onClick={() => setEditing(editing === image.id ? null : image.id)}>タグ・メモ</button>
            <button type="button" className="small" aria-label={`${label}の原本を保存`} onClick={() => { void workbench.imageBlob(image.id).then(blob => { if (!blob) throw new Error('画像原本が欠落しています'); downloadBlob(blob, image.name); }).catch(cause => workbench.setError(message(cause))); }}>原本を保存</button>
            <button type="button" className="small danger" aria-label={`${label}を削除`} onClick={() => { if (confirm(`画像「${image.name}」と、比較・Experiment Labでの関連付けを削除しますか？「元に戻す」で戻せます（原本は残します）。`)) workbench.commit(previous => removeImage(previous, image.id)); }}>削除</button>
          </div>
          {editing === image.id && <ImageInfoEditor workbench={workbench} image={image} label={label} onClose={() => setEditing(null)} />}
        </div>
      </article>;
    })}
    {view.pages > 1 && <div className="actions pager"><button type="button" className="small" disabled={view.page === 0} onClick={() => setPage(view.page - 1)} aria-label="前の画像ページ">← 前</button><span>{view.page + 1} / {view.pages} ページ</span><button type="button" className="small" disabled={view.page >= view.pages - 1} onClick={() => setPage(view.page + 1)} aria-label="次の画像ページ">次 →</button></div>}
    {data.images.length > 0 && !results.length && <p className="empty">一致する画像はありません。</p>}
    <button type="button" disabled={workbench.saving || busy || !!batch} onClick={() => { void workbench.purgeImages().then(removed => onNotice(`現在の資産・元に戻す履歴・取込前バックアップから参照されない画像${removed}件を解放しました。`)).catch(cause => workbench.setError(message(cause))); }}>参照されない画像バイナリを解放</button>
  </div></details>;
}
