import { useState } from 'react';
import { axisValues, axisValueLabel } from '../../core/lab/engine';
import type { Condition, LabExperiment } from '../../core/lab/types';
import { textDifference } from '../../core/experiments';
import { gridPng } from '../../data/lab-grid';
import { ImageComparison, Thumbnail } from '../ImageComparison';
import type { Workbench } from '../useWorkbench';
import { message } from '../useWorkbench';
import { downloadBlob } from '../shared';
import type { Translate } from './Setup';
export function Results({experiment:e,workbench,t,select}:{experiment:LabExperiment;workbench:Workbench;t:Translate;select:(id:string)=>void}) {
  const [z,setZ]=useState(0);const [seed,setSeed]=useState(0);const [repeat,setRepeat]=useState(0);const [size,setSize]=useState(120);
  const [row,setRow]=useState(0);const [col,setCol]=useState(0);const [favorite,setFavorite]=useState(false);const [rating,setRating]=useState(0);const [sorted,setSorted]=useState(false);
  const [listPage,setListPage]=useState(0);
  const [a,setA]=useState('');const [b,setB]=useState('');const [issue,setIssue]=useState('');const [busy,setBusy]=useState(false);
  const xs=axisValues(e.definition.axes[0]);const ys=axisValues(e.definition.axes[1]);const zs=axisValues(e.definition.axes[2]);
  const seedAxis=e.definition.axes.some(a=>a.kind==='seed');
  const seedCount=seedAxis?1:e.definition.seeds.length;
  const page=e.conditions.filter(c=>c.coordinate[2]===z && c.seedIndex===seed && c.repeat===repeat);
  const visible=(c:Condition)=> (!favorite||c.favorite)&&c.rating>=rating;
  const ranked=page.filter(visible).sort((a,b)=>b.rating-a.rating);
  const actualListPage=Math.min(listPage,Math.max(0,Math.ceil(ranked.length/64)-1));
  const aa=e.conditions.find(c=>c.id===a);const bb=e.conditions.find(c=>c.id===b);
  const image=(c:Condition|undefined)=>workbench.data!.images.find(i=>i.id===c?.imageId);
  const tile=(c:Condition)=> <button type="button" className="lab-cell" style={{width:size}} aria-label={`Condition ${c.id}`} onClick={()=>select(c.id)}>{image(c)?<Thumbnail workbench={workbench} image={image(c)!}/>:<span>{c.status}</span>}<small>{c.status}<br/>{c.coordinate.map(n=>n+1).join('/')} · Seed {c.seed}<br/>{c.favorite?'★ ':''}{c.rating?`${c.rating}/5`:''}</small></button>;
  return <section className="panel stack" aria-label="X/Y/Z Plot"><h2>X/Y/Z Plot</h2><p>{e.definition.axes.map((a,i)=>`${['X','Y','Z'][i]}: ${a.kind} ${a.target}`).join(' · ')}</p>
    <div className="columns"><label>Z<select value={z} onChange={event=>setZ(Number(event.target.value))}>{zs.map((v,i)=><option key={i} value={i}>{axisValueLabel(e.definition.axes[2],v)}</option>)}</select></label><label>{t('共通Seed','Shared seed')}<select disabled={seedAxis} value={seed} onChange={event=>setSeed(Number(event.target.value))}>{Array.from({length:seedCount},(_,i)=><option key={i} value={i}>{seedAxis?t('Seed軸で指定','Controlled by Seed axis'):e.definition.seeds[i]}</option>)}</select></label><label>{t('反復','Repeat')}<select value={repeat} onChange={event=>setRepeat(Number(event.target.value))}>{Array.from({length:e.definition.repeats},(_,i)=><option key={i} value={i}>{i+1}</option>)}</select></label><label>{t('サムネイルサイズ','Thumbnail size')}<input type="range" min="80" max="240" step="10" value={size} onChange={event=>setSize(Number(event.target.value))}/></label></div>
    <div className="actions"><label className="inline"><input type="checkbox" checked={favorite} onChange={event=>setFavorite(event.target.checked)}/>{t('お気に入りのみ','Favorites only')}</label><label>{t('最低評価','Minimum rating')}<select value={rating} onChange={event=>setRating(Number(event.target.value))}>{[0,1,2,3,4,5].map(n=><option key={n}>{n}</option>)}</select></label><label className="inline"><input type="checkbox" checked={sorted} onChange={event=>setSorted(event.target.checked)}/>{t('評価順リスト','List by rating')}</label></div>
    <div className="columns"><label>{t('行ページ','Row page')}<select value={row} onChange={event=>setRow(Number(event.target.value))}>{Array.from({length:Math.ceil(ys.length/8)},(_,i)=><option key={i} value={i}>{i+1}</option>)}</select></label><label>{t('列ページ','Column page')}<select value={col} onChange={event=>setCol(Number(event.target.value))}>{Array.from({length:Math.ceil(xs.length/8)},(_,i)=><option key={i} value={i}>{i+1}</option>)}</select></label></div>
    {sorted&&<div className="actions"><button type="button" disabled={!actualListPage} onClick={()=>setListPage(actualListPage-1)}>←</button><span>{actualListPage+1}/{Math.max(1,Math.ceil(ranked.length/64))}</span><button type="button" disabled={(actualListPage+1)*64>=ranked.length} onClick={()=>setListPage(actualListPage+1)}>→</button></div>}
    {sorted ? <div className="lab-list">{ranked.slice(actualListPage*64,(actualListPage+1)*64).map(c=><div key={c.id}>{tile(c)}</div>)}</div> : <div className="table-scroll"><table className="lab-grid"><thead><tr><th>Y ↓ / X →</th>{xs.slice(col*8,col*8+8).map((v,i)=><th key={i}>{e.definition.axes[0].kind}: {axisValueLabel(e.definition.axes[0],v)}</th>)}</tr></thead><tbody>{ys.slice(row*8,row*8+8).map((v,yi)=><tr key={yi}><th>{e.definition.axes[1].kind}: {axisValueLabel(e.definition.axes[1],v)}</th>{xs.slice(col*8,col*8+8).map((_,xi)=>{const c=page.find(c=>c.coordinate[0]===col*8+xi&&c.coordinate[1]===row*8+yi);return <td key={xi}>{c&&visible(c)?tile(c):'—'}</td>;})}</tr>)}</tbody></table></div>}
    <button type="button" disabled={busy} onClick={()=>{setBusy(true);void gridPng(e,z,seed,repeat,id=>workbench.imageBlob(id,true)).then(blob=>downloadBlob(blob,`grid-z${z+1}-s${seed+1}-r${repeat+1}.png`)).catch(error=>setIssue(message(error))).finally(()=>setBusy(false));}}>{t('このZ・Seed・反復のグリッドPNGを保存','Export this Z / seed / repeat grid PNG')}</button>
    <p className="hint">{t('最大8×8セルずつ表示。PNG出力は選択ページの全条件（フィルタ前）。ピクセル差分はタグ効果の定量指標ではありません。','Displays up to 8×8 cells. PNG includes all conditions in this plane before filters. Pixel differences do not measure tag effects.')}</p>
    <div className="columns">{(['A','B'] as const).map(label=><label key={label}>{t('比較条件','Compare condition')} {label}<select value={label==='A'?a:b} onChange={event=>(label==='A'?setA:setB)(event.target.value)}><option value="">—</option>{e.conditions.map(c=><option key={c.id} value={c.id}>{c.coordinate.map(n=>n+1).join('/')} · {c.seed} · R{c.repeat+1}</option>)}</select></label>)}</div>
    {aa&&bb&&<><ImageComparison workbench={workbench} a={image(aa)} b={image(bb)}/>{(['positive','negative'] as const).map(key=>{const diff=textDifference(aa[key],bb[key]);return <div key={key}><label>A {key}<textarea readOnly value={aa[key]}/></label><label>B {key}<textarea readOnly value={bb[key]}/></label><pre className="diff-text">{diff.prefix}<del>{diff.removed}</del><ins>{diff.added}</ins>{diff.suffix}</pre></div>;})}<pre>{JSON.stringify({A:{seed:aa.seed,settings:aa.settings,factors:aa.factors},B:{seed:bb.seed,settings:bb.settings,factors:bb.factors}},null,2)}</pre></>}
    {issue&&<p role="alert">{issue}</p>}
  </section>;
}
