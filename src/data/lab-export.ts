import { emptyData } from '../core/commands';
import { crc32 } from '../core/png';
import type { LabExperiment } from '../core/lab/types';
import type { WorkbenchData } from '../core/types';
import { exportBackup } from './backup';
import { parseBackup, validateData } from './validation';
export function exportLabJson(data: WorkbenchData, experiment: LabExperiment, time: string): string {
  const ids = new Set(experiment.conditions.map(c => c.imageId));
  return exportBackup({ ...emptyData(), lab: { schemaVersion: 1, experiments: [experiment] }, images: data.images.filter(i => ids.has(i.id)) },time);
}
export function importLabJson(current: WorkbenchData, text: string): WorkbenchData {
  const incoming = parseBackup(text).payload;
  if (!incoming.lab?.experiments.length || incoming.libraryEntries.length || incoming.workspaces.length || incoming.presets.length || incoming.experiments.length) throw new Error('Use an Experiment Lab JSON export');
  const mapping = new Map(incoming.images.map(i => [i.id,current.images.find(old => old.hash === i.hash)?.id ?? i.id]));
  return validateData({ ...current, images: [...current.images,...incoming.images.filter(i => !current.images.some(old => old.hash === i.hash))], lab: { ...incoming.lab, ...current.lab, schemaVersion: 1, experiments: [...(current.lab?.experiments ?? []), ...incoming.lab.experiments.map(e => ({ ...e, conditions:e.conditions.map(c => ({ ...c,imageId:c.imageId ? mapping.get(c.imageId)! : null })) }))] } });
}
const cell = (s: unknown) => '"' + String(s).replace(/^(?:\s*[=+@-]|[\t\r\n])/, "'$&").replace(/"/g,'""') + '"';
export function exportLabCsv(e: LabExperiment): string {
  const headers = ['experiment_id','condition_id','x','y','z','seed_index','repeat','seed','positive','negative','settings_json','factors_json','image_id','status','favorite','rating','note'];
  return '\ufeff' + [headers.map(cell).join(','), ...e.conditions.map(c => [e.id,c.id,...c.coordinate,c.seedIndex,c.repeat,c.seed,c.positive,c.negative,JSON.stringify(c.settings),JSON.stringify(c.factors),c.imageId ?? '',c.status,c.favorite,c.rating,c.note].map(cell).join(','))].join('\r\n');
}
/** Bounded ZIP32 store-only writer. Filenames are generated internally; no extraction. */
export function makeZip(files: { name: string; bytes: Uint8Array }[]): Blob {
  const encoder = new TextEncoder(); const parts: Uint8Array<ArrayBuffer>[] = []; const directory: Uint8Array<ArrayBuffer>[] = []; let offset = 0;
  if (files.length > 1024 || files.reduce((n,f) => n+f.bytes.length,0) > 128*1024*1024) throw new Error('ZIP limit: 128 MiB / 1024 files');
  for (const f of files) {
    if (!/^[a-zA-Z0-9_.\/-]+$/.test(f.name) || f.name.includes('..') || f.name.startsWith('/')) throw new Error('Invalid ZIP path');
    const name = encoder.encode(f.name); const bytes = new Uint8Array(f.bytes); const crc = crc32(bytes);
    const local = new Uint8Array(30+name.length); const v = new DataView(local.buffer);
    v.setUint32(0,0x04034b50,true); v.setUint16(4,20,true); v.setUint32(14,crc,true); v.setUint32(18,bytes.length,true); v.setUint32(22,bytes.length,true); v.setUint16(26,name.length,true); local.set(name,30);
    const central = new Uint8Array(46+name.length); const c = new DataView(central.buffer);
    c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint32(16,crc,true); c.setUint32(20,bytes.length,true); c.setUint32(24,bytes.length,true); c.setUint16(28,name.length,true); c.setUint32(42,offset,true); central.set(name,46);
    parts.push(local,bytes); directory.push(central); offset += local.length+bytes.length;
  }
  const end = new Uint8Array(22); const v = new DataView(end.buffer); v.setUint32(0,0x06054b50,true); v.setUint16(8,files.length,true); v.setUint16(10,files.length,true); v.setUint32(12,directory.reduce((n,b)=>n+b.length,0),true); v.setUint32(16,offset,true);
  return new Blob([...parts,...directory,end],{type:'application/zip'});
}
export async function exportLabZip(data: WorkbenchData, e: LabExperiment, time: string, image: (id:string)=>Promise<Blob|undefined>): Promise<Blob> {
  const enc = new TextEncoder(); const files = [{name:'experiment.json',bytes:enc.encode(exportLabJson(data,e,time))},{name:'conditions.csv',bytes:enc.encode(exportLabCsv(e))}];
  let size = files.reduce((n,f)=>n+f.bytes.length,0);
  for (const id of new Set(e.conditions.flatMap(c=>c.imageId ? [c.imageId] : []))) {
    const blob = await image(id); if (!blob) throw new Error(`Missing original PNG: ${id}`);
    size += blob.size; if (size>128*1024*1024) throw new Error('ZIP limit: 128 MiB');
    files.push({name:`images/${id}.png`,bytes:new Uint8Array(await blob.arrayBuffer())});
  }
  return makeZip(files);
}
