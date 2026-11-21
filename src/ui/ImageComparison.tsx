import { useEffect, useRef, useState } from 'react';
import { MAX_DIFF_PIXELS, pixelDifference } from '../core/experiments';
import type { ImageRecord } from '../core/types';
import { message, type Workbench } from './useWorkbench';
import { InfoTip } from './InfoTip';

export function useImage(workbench: Workbench, id: string | null, thumbnail = false) {
  const [result, setResult] = useState<{ url: string; blob?: Blob; missing: boolean }>({ url: '', missing: false });
  useEffect(() => {
    let cancelled = false; let url = '';
    setResult({ url: '', missing: false });
    if (id) void workbench.imageBlob(id, thumbnail).then(blob => {
      if (cancelled) return;
      if (blob) url = URL.createObjectURL(blob);
      setResult({ url, ...(blob ? { blob } : {}), missing: !blob });
    }).catch(() => { if (!cancelled) setResult({ url: '', missing: true }); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [id, thumbnail, workbench.saving, workbench.data]);
  return result;
}
export function Thumbnail({ workbench, image }: { workbench: Workbench; image: ImageRecord }) {
  const value = useImage(workbench, image.id, true);
  return value.url ? <img className="thumbnail" src={value.url} alt={image.name} /> : <p>{value.missing ? 'サムネイル欠落：元PNGを再取込してください' : '読込中…'}</p>;
}
export function ImageComparison({ workbench, a, b }: { workbench: Workbench; a?: ImageRecord; b?: ImageRecord }) {
  const aa = useImage(workbench, a?.id ?? null); const bb = useImage(workbench, b?.id ?? null);
  const [mode, setMode] = useState('side'); const [wipe, setWipe] = useState(50); const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 }); const drag = useRef<{ x: number; y: number } | null>(null);
  const [resize, setResize] = useState(false); const [diff, setDiff] = useState({ url: '', info: '' });
  const frame = useRef<HTMLDivElement>(null); const [frameWidth, setFrameWidth] = useState(300);
  useEffect(() => { const element = frame.current; if (!element) return; const observer = new ResizeObserver(entries => setFrameWidth(entries[0]!.contentRect.width)); observer.observe(element); return () => observer.disconnect(); }, []);
  useEffect(() => { setPan({ x: 0, y: 0 }); setZoom(1); setResize(false); }, [a?.id, b?.id]);
  const mismatch = !!(a && b && (a.width !== b.width || a.height !== b.height));
  useEffect(() => {
    let cancelled = false; let url = '';
    setDiff({ url: '', info: '' });
    if (mode !== 'diff' || !aa.blob || !bb.blob || !a || !b || (mismatch && !resize)) return;
    if (Math.max(a.width * a.height, b.width * b.height) > MAX_DIFF_PIXELS) { setDiff({ url: '', info: 'ピクセル差分は各画像4Mpxまでです。' }); return; }
    const make = async () => {
      const bitmaps: ImageBitmap[] = [];
      try {
        bitmaps.push(await createImageBitmap(aa.blob!)); bitmaps.push(await createImageBitmap(bb.blob!));
        const canvas = document.createElement('canvas'); canvas.width = a.width; canvas.height = a.height;
        const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('差分Canvasを作成できません');
        const pixels = bitmaps.map(bitmap => { context.clearRect(0, 0, canvas.width, canvas.height); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); return context.getImageData(0, 0, canvas.width, canvas.height).data; });
        const result = pixelDifference(pixels[0]!, pixels[1]!); context.putImageData(new ImageData(new Uint8ClampedArray(result.pixels), canvas.width, canvas.height), 0, 0);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('差分画像を作成できません')), 'image/png'));
        if (!cancelled) { url = URL.createObjectURL(blob); setDiff({ url, info: `変更ピクセル ${result.changed} / ${a.width * a.height}、RGBA平均絶対差 ${result.mean.toFixed(3)}（0〜255）` }); }
      } catch (error) { if (!cancelled) setDiff({ url: '', info: message(error) }); }
      finally { bitmaps.forEach(bitmap => bitmap.close()); }
    };
    void make(); return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [mode, aa.blob, bb.blob, a, b, mismatch, resize]);
  const scale = Math.min(frameWidth / Math.max(a?.width ?? 1, b?.width ?? 1), 280 / Math.max(a?.height ?? 1, b?.height ?? 1)) * zoom;
  const picture = (url: string, image: ImageRecord | undefined, alt: string) => image && url ? <img draggable={false} src={url} alt={alt} style={{ width: image.width * scale, height: image.height * scale, transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))` }} /> : null;
  return <section className="panel stack" aria-label="画像比較">
    <div className="section-title"><h3>画像比較</h3><InfoTip label="画像比較の操作">画像をドラッグするとA/Bが同じ位置で動きます（同期パン）。画像枠にフォーカスして矢印キーでも移動できます。ズームはA/B共通です。</InfoTip></div><label>表示モード<select value={mode} onChange={event => setMode(event.target.value)}><option value="side">A/B横並び</option><option value="wipe">重ね合わせスライダー</option><option value="diff">ピクセル差分</option></select></label>
    {(!a || !b) && <p>比較するPNGをA/B両方に関連付けてください。</p>}
    {(aa.missing || bb.missing) && <p role="alert">画像原本が欠落、またはメタデータと不整合です。JSONには画像バイナリを含みません。同一PNGを再取込すると復元できます。</p>}
    {a && b && <p>A: {a.width}×{a.height} / B: {b.width}×{b.height}</p>}
    {mismatch && <p role="alert">画像サイズが異なります。通常表示は同じ倍率で中央に配置します。</p>}
    {mode === 'diff' && <><p>ブラウザでデコードしたsRGB RGBA値の絶対差です。色管理による差を含み、原本は変更しません。</p>{mismatch && <label className="inline"><input type="checkbox" checked={resize} onChange={event => setResize(event.target.checked)} />BをAの幅・高さへ変形して比較（Canvas高品質補間、縦横比変更あり）</label>}{mismatch && !resize && <p>リサイズ条件を明示的に選ぶまで差分は計算しません。</p>}<p role="status">{diff.info}</p></>}
    <label>同期ズーム<input type="range" min="1" max="8" step="0.1" value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label><button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>表示位置をリセット</button>
    {mode === 'wipe' && <label>重ね合わせ位置<input type="range" min="0" max="100" value={wipe} onChange={event => setWipe(Number(event.target.value))} /></label>}
    <div className={mode === 'side' ? 'image-pair' : ''} onPointerDown={event => { drag.current = { x: event.clientX - pan.x, y: event.clientY - pan.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (drag.current) setPan({ x: event.clientX - drag.current.x, y: event.clientY - drag.current.y }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <div ref={frame} className="image-frame" tabIndex={0} aria-label="同期画像枠" onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); setPan(value => ({ x: value.x + (event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0), y: value.y + (event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0) })); } }}>
        {mode === 'diff' ? picture(diff.url, a, 'A/Bピクセル差分') : picture(aa.url, a, '比較画像A')}
        {mode === 'wipe' && <div className="wipe-layer" style={{ clipPath: `inset(0 ${100 - wipe}% 0 0)` }}>{picture(bb.url, b, '比較画像B')}</div>}
        <span className="image-caption">{mode === 'side' ? 'A' : mode === 'wipe' ? '左 B / 右 A' : '絶対差'}</span>
      </div>
      {mode === 'side' && <div className="image-frame">{picture(bb.url, b, '比較画像B')}<span className="image-caption">B</span></div>}
    </div>
  </section>;
}
