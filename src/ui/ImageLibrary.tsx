import { useMemo, useState } from 'react';
import { IMAGE_SORTS, imageLabel, imageUsage, pageOf, removeImage, searchImages, type ImageSort } from '../core/images';
import { Thumbnail } from './ImageComparison';
import { InfoTip } from './InfoTip';
import { downloadBlob } from './shared';
import { message, type Workbench } from './useWorkbench';

const PAGE_SIZE = 24;
const size = (bytes: number) => bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KiB` : `${(bytes / 1048576).toFixed(1)} MiB`;

/** Every imported image (issue #21): search, sort and paging instead of the first 50 only. */
export function ImageLibrary({ workbench, busy, onNotice }: { workbench: Workbench; busy: boolean; onNotice: (text: string) => void }) {
  const data = workbench.data!;
  const [query, setQuery] = useState(''); const [sort, setSort] = useState<ImageSort>('newest'); const [page, setPage] = useState(0);
  const [capacity, setCapacity] = useState('容量情報は未取得です');
  const usage = useMemo(() => imageUsage(data), [data]);
  const results = useMemo(() => searchImages(data.images, query, usage, sort), [data.images, query, usage, sort]);
  const view = pageOf(results, page, PAGE_SIZE);
  return <details className="panel"><summary><h3>画像ライブラリ ({data.images.length})</h3></summary><div className="stack">
    <InfoTip label="画像ライブラリ">取り込んだPNGの原本とサムネイルをこの端末に保存します。JSONバックアップには画像を含まないため、画像も残すには「設定」の完全バックアップを使用してください。削除した画像のデータは「元に戻す」のために残り、「参照されない画像バイナリを解放」で整理できます。検索は名前・SHA-256の先頭・プロンプトの注記・使用先が対象です。</InfoTip>
    <p className="hint">登録画像の原本合計 {(data.images.reduce((sum, image) => sum + image.byteLength, 0) / 1048576).toFixed(2)} MiB / {capacity}</p>
    <button type="button" className="small" onClick={() => { if (!navigator.storage?.estimate) { setCapacity('この環境は容量取得に非対応です'); return; } void navigator.storage.estimate().then(value => setCapacity(`ブラウザ使用 ${(Number(value.usage ?? 0) / 1048576).toFixed(1)} MiB / 割当 ${value.quota === undefined ? '不明' : (value.quota / 1048576).toFixed(1) + ' MiB'}（概算）`)).catch(cause => workbench.setError(message(cause))); }}>ストレージ容量を確認</button>
    {data.images.length > 0 && <div className="columns">
      <label>画像を検索<input type="search" value={query} placeholder="名前・ハッシュ・注記・使用先" onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <label>画像の並び順<select value={sort} onChange={event => { setSort(event.target.value as ImageSort); setPage(0); }}>{(Object.keys(IMAGE_SORTS) as ImageSort[]).map(key => <option key={key} value={key}>{IMAGE_SORTS[key]}</option>)}</select></label>
    </div>}
    {data.images.length > 0 && <p className="hint" role="status" aria-label="画像の件数">{results.length}件 / 全{data.images.length}件</p>}
    {view.items.map(image => {
      const label = imageLabel(image, data.images); const used = usage.get(image.id) ?? [];
      return <article key={image.id} className="member image-item" aria-label={label}>
        <Thumbnail workbench={workbench} image={image} />
        <div className="image-item-body"><p>{image.name}</p><p className="hint">{image.width}×{image.height} · {size(image.byteLength)} · {used.length ? `使用: ${used.slice(0, 3).join('、')}${used.length > 3 ? ` ほか${used.length - 3}件` : ''}` : '未使用'}</p>
          <div className="toolbar"><button type="button" className="small" aria-label={`${label}の原本を保存`} onClick={() => { void workbench.imageBlob(image.id).then(blob => { if (!blob) throw new Error('画像原本が欠落しています'); downloadBlob(blob, image.name); }).catch(cause => workbench.setError(message(cause))); }}>原本を保存</button>
            <button type="button" className="small danger" aria-label={`${label}を削除`} onClick={() => { if (confirm(`画像「${image.name}」と、比較・Experiment Labでの関連付けを削除しますか？「元に戻す」で戻せます（原本は残します）。`)) workbench.commit(previous => removeImage(previous, image.id)); }}>削除</button></div></div>
      </article>;
    })}
    {view.pages > 1 && <div className="actions pager"><button type="button" className="small" disabled={view.page === 0} onClick={() => setPage(view.page - 1)} aria-label="前の画像ページ">← 前</button><span>{view.page + 1} / {view.pages} ページ</span><button type="button" className="small" disabled={view.page >= view.pages - 1} onClick={() => setPage(view.page + 1)} aria-label="次の画像ページ">次 →</button></div>}
    {data.images.length > 0 && !results.length && <p className="empty">一致する画像はありません。</p>}
    <button type="button" disabled={workbench.saving || busy} onClick={() => { void workbench.purgeImages().then(removed => onNotice(`現在の資産・元に戻す履歴・取込前バックアップから参照されない画像${removed}件を解放しました。`)).catch(cause => workbench.setError(message(cause))); }}>参照されない画像バイナリを解放</button>
  </div></details>;
}
