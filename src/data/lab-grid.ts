import { axisValues, axisValueLabel } from '../core/lab/engine';
import type { LabExperiment } from '../core/lab/types';
export async function gridPng(e: LabExperiment, z: number, seedIndex: number, repeat: number, image: (id:string)=>Promise<Blob|undefined>): Promise<Blob> {
  const xs = axisValues(e.definition.axes[0]); const ys = axisValues(e.definition.axes[1]);
  const canvas = document.createElement('canvas'); canvas.width=(xs.length+1)*100; canvas.height=(ys.length+1)*120;
  if (canvas.width*canvas.height>16_777_216 || canvas.width>8192 || canvas.height>8192) throw new Error('Grid exceeds 16Mpx / 8192px');
  const ctx=canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable');
  ctx.fillStyle='#161a23';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.font='11px sans-serif';ctx.fillStyle='#fff';
  ctx.fillText(`Z:${z+1} S:${seedIndex+1} R:${repeat+1}`,4,20);
  xs.forEach((v,i)=>ctx.fillText(axisValueLabel(e.definition.axes[0],v).slice(0,15),(i+1)*100+4,40)); ys.forEach((v,i)=>ctx.fillText(axisValueLabel(e.definition.axes[1],v).slice(0,15),4,(i+1)*120+20));
  for (const c of e.conditions.filter(c=>c.coordinate[2]===z && c.seedIndex===seedIndex && c.repeat===repeat)) {
    const x=(c.coordinate[0]+1)*100;const y=(c.coordinate[1]+1)*120;
    const blob=c.imageId ? await image(c.imageId) : undefined;
    if (blob) { const bitmap=await createImageBitmap(blob); try { const scale=Math.min(96/bitmap.width,92/bitmap.height);ctx.drawImage(bitmap,x+2+(96-bitmap.width*scale)/2,y+2,bitmap.width*scale,bitmap.height*scale); } finally { bitmap.close(); } }
    ctx.fillStyle='#fff';ctx.fillText(blob ? `Seed ${c.seed}` : c.imageId ? 'Missing PNG' : c.status,x+3,y+110,94);
  }
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b ? resolve(b):reject(new Error('PNG export failed')),'image/png'));
}
