import { describe, expect, it } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { vi } from 'vitest';
import { createLab, expandDefinition, applyTemplate, PRESETS } from '../../src/core/lab/engine';
import { defaultDefinition, emptyAxis, type Axis } from '../../src/core/lab/types';
import { csvValues, numericValues, consecutiveSeeds, seedList, textValues } from '../../src/core/lab/values';
import { promptItems, transformPrompt } from '../../src/core/lab/prompt';
import { exportBackup, prepareImport } from '../../src/data/backup';
import { parseBackup, validateData } from '../../src/data/validation';
import { duplicateLab } from '../../src/data/lab';
import { exportLabJson, importLabJson, exportLabCsv, makeZip } from '../../src/data/lab-export';
import { WorkbenchRepository } from '../../src/data/repository';
import { fixture, timestamp } from './helpers';
const id='aaaaaaaa-aaaa-4aaa-8aaa-000000000001'; const id2='aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const data=()=>({...fixture(),lab:{schemaVersion:1 as const,experiments:[createLab(id,defaultDefinition(),timestamp)]}});
const axis=(kind:Axis['kind'],target='blush'):Axis=>({...emptyAxis(),kind,target});

describe('Lab expansion and parsers',()=>{
  it.each([['0.5-2 (+0.25)',['0.5','0.75','1','1.25','1.5','1.75','2']],['0.5-2 [7]',['0.5','0.75','1','1.25','1.5','1.75','2']],['2-0 (-0.5)',['2','1.5','1','0.5','0']],['-3--1 (+1)',['-3','-2','-1']],['0, 1.5,2',['0','1.5','2']]])('expands %s',(s,values)=>expect(numericValues(s as string)).toEqual(values));
  it.each(['1-2 (+0)','1-2 (-1)','1-2 [1]','1-100000','1,1.0','1,,2','NaN','Infinity','1-2 [0]'])('rejects numeric input %s',s=>expect(()=>numericValues(s)).toThrow());
  it('parses quoted CSV commas, escaped quotes, CRLF and quoted newlines',()=>{
    expect(csvValues('"red, blue","say ""hi"""\r\n"line\ntext"')).toEqual(['red, blue','say "hi"','line\ntext']);
    expect(textValues('red, blue\ncat, hat','lines')).toEqual(['red, blue','cat, hat']);
    expect(()=>csvValues('"unclosed')).toThrow();expect(()=>textValues('a\n\nb','lines')).toThrow();expect(()=>csvValues('"a"oops')).toThrow();
  });
  it('preserves exact seeds with BigInt arithmetic and detects duplicate canonical seeds',()=>{
    expect(consecutiveSeeds('9007199254740993000',3)).toEqual(['9007199254740993000','9007199254740993001','9007199254740993002']);
    expect(()=>seedList('01,1')).toThrow();expect(()=>seedList('-1')).toThrow();
    const d=defaultDefinition();d.seeds=['1,2'];expect(()=>expandDefinition(d)).toThrow();
  });
  it('creates 5,25,75 immutable conditions with unique stable IDs and exact XYZ seeds',()=>{
    const d=defaultDefinition();expect(expandDefinition(d)).toHaveLength(5);
    d.axes[1]={...d.axes[0],target:'smile'};expect(expandDefinition(d)).toHaveLength(25);
    d.axes[2]={...emptyAxis(),kind:'seed',input:'1001,1002,1003'};
    const e=createLab(id,d,timestamp);expect(e.conditions).toHaveLength(75);expect(new Set(e.conditions.map(c=>c.id)).size).toBe(75);
    expect(e.conditions[25]).toMatchObject({coordinate:[0,0,1],seed:'1002'});
    expect(e.conditions[0]!.positive).toBe('1girl, solo, 0.5::blush::, 0.5::smile::');
    expect(createLab(id,d,timestamp)).toEqual(e);expect(d.positive).toBe('1girl, solo, blush, smile');
  });
  it('crosses common seed groups and repeats without accumulation and rejects explosions',()=>{
    const d=defaultDefinition();d.seeds=['1','2'];d.repeats=3;
    expect(expandDefinition(d)).toHaveLength(30);
    d.axes[1]={...d.axes[0],target:'smile',input:'1-64'};expect(()=>expandDefinition(d)).toThrow('limit');
  });
  it('records all Matrix presences as analysis factors',()=>{const rows=expandDefinition(applyTemplate(defaultDefinition(),'Prompt Matrix'));expect(rows).toHaveLength(8);expect(rows[0]!.factors[0]!.members!.every(m=>!m.present)).toBe(true);expect(rows[7]!.factors[0]!.members!.every(m=>m.present)).toBe(true);});
  it.each(PRESETS)('builds template %s',name=>expect(expandDefinition(applyTemplate(defaultDefinition(),name)).length).toBeGreaterThan(1));
  it('validates Medium capabilities per condition, including model axes',()=>{
    const d=defaultDefinition();d.settings={...d.settings,effort:'medium',steps:14,rescale:null};expect(expandDefinition(d)).toHaveLength(5);
    d.axes[1]={...emptyAxis(),kind:'steps',input:'14'};expect(()=>expandDefinition(d)).toThrow('Medium');d.axes[1]=emptyAxis();d.negative='hat';expect(()=>expandDefinition(d)).toThrow('Medium');
    d.negative='';d.axes[1]={...emptyAxis(),kind:'model',input:'V5 Curated'};expect(()=>expandDefinition(d)).toThrow('Medium');
  });
  it.each([['steps','1,30'],['guidance','3,7'],['rescale','0,1'],['sampler','Euler\nEuler Ancestral'],['model','V5 Full\nV5 Curated'],['resolution','1024x1024\n768x1024'],['uc','watermark\ntext'],['quality','Off\nOn']])('supports %s axes',(kind,input)=>{
    const d=defaultDefinition();d.axes=[{...emptyAxis(),kind:kind as Axis['kind'],input},emptyAxis(),emptyAxis()];expect(expandDefinition(d)).toHaveLength(2);
  });
  it('rejects axis collisions and full prompt / S/R combinations that could erase another factor',()=>{
    const d=defaultDefinition();d.axes[1]={...d.axes[0]};expect(()=>expandDefinition(d)).toThrow('conflict');
    d.axes[1]={...emptyAxis(),kind:'prompt',input:'cat'};expect(()=>expandDefinition(d)).toThrow('conflict');
    d.axes[1]={...emptyAxis(),kind:'searchReplace',target:'blush',input:'cat'};expect(()=>expandDefinition(d)).toThrow();
  });
});
describe('Lab safe prompt transformations',()=>{
  it.each(['blush','{blush}','{{blush}}','[blush]','1.5::blush::','-3::blush::'])('replaces complete emphasis %s',raw=>expect(transformPrompt(`cat, ${raw}, hat`,axis('weight'),'-3')).toBe('cat, -3::blush::, hat'));
  it('retains zero explicitly while On/Off removes or appends the tag',()=>{
    expect(transformPrompt('cat, blush, hat',axis('weight'),'0')).toBe('cat, 0::blush::, hat');
    expect(transformPrompt('cat, blush, hat',axis('onOff'),'Off')).toBe('cat, hat');
    expect(transformPrompt('cat',axis('onOff'),'On')).toBe('cat, blush');
    expect(transformPrompt('blush, cat',axis('onOff'),'Off')).toBe('cat');
    expect(transformPrompt('cat, blush',axis('onOff'),'Off')).toBe('cat');
  });
  it('targets an explicit occurrence and preserves unrelated syntax verbatim',()=>{
    expect(transformPrompt(' {{cat}}, blush,  blush,  [hat] ',{...axis('weight'),occurrence:2},'2')).toBe(' {{cat}}, blush,  2::blush::,  [hat] ');
    expect(()=>transformPrompt('cat, {blush, hat}',axis('weight'),'2')).toThrow();
    expect(()=>promptItems('{blush')).toThrow();expect(()=>promptItems('||cat|hat||')).toThrow();
  });
  it('implements replace, position, group, literal S/R and full variants',()=>{
    expect(transformPrompt('cat, blush',axis('replace'),'smile')).toBe('cat, smile');
    expect(transformPrompt('cat, blush',axis('position'),'first')).toBe('blush, cat');
    expect(transformPrompt('cat',axis('group'),'rain, night')).toBe('cat, rain, night');
    expect(transformPrompt('cat cat',{...axis('searchReplace','cat'),occurrence:0},'dog')).toBe('dog dog');
    expect(transformPrompt('cat cat',{...axis('searchReplace','cat'),occurrence:2},'dog')).toBe('cat dog');
    expect(transformPrompt('cat',axis('prompt'),'||rain|night||')).toBe('||rain|night||');
  });
});
describe('Lab persistence, exports and recovery',()=>{
  it('retains corrupt Lab records for recovery rather than resetting the database',async()=>{
    const factory=new IDBFactory();const repo=await WorkbenchRepository.open('lab-corrupt',factory);await repo.save(data(),0);
    const request=factory.open('lab-corrupt');const db=await new Promise<IDBDatabase>(resolve=>{request.onsuccess=()=>resolve(request.result);});
    const corrupt=data().lab;corrupt.experiments[0]!.conditions[0]!.positive='corrupt preserved prompt';
    const tx=db.transaction('metadata','readwrite');tx.objectStore('metadata').put({lab:corrupt},'extra');await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
    await expect(repo.load()).rejects.toThrow('snapshot');expect(JSON.stringify(await repo.recoveryDump())).toContain('corrupt preserved prompt');repo.close();
  });

  it('round-trips JSON with unknown safe fields, preserves existing libraries and rejects invalid snapshots',()=>{
    const d=data();(d.lab as unknown as Record<string,unknown>).future={keep:true};
    expect(parseBackup(exportBackup(d,timestamp)).payload).toEqual(d);
    const bad=data();bad.lab.experiments[0]!.conditions[0]!.positive='corrupt';expect(()=>validateData(bad)).toThrow('snapshot');
    const unsupported=data();(unsupported.lab as {schemaVersion:number}).schemaVersion=2;expect(()=>validateData(unsupported)).toThrow('version');
    const missing=data();missing.lab.experiments[0]!.conditions[0]!.imageId=id2;expect(()=>validateData(missing)).toThrow('image');
    expect(()=>prepareImport(d,d,'merge')).toThrow();
  });
  it('exports/imports standalone experiments, CSV is formula-safe, and duplicate runs start pending',()=>{
    const d=data();const e=d.lab.experiments[0]!;const incoming=importLabJson(fixture(),exportLabJson(d,e,timestamp));expect(incoming.libraryEntries).toEqual(d.libraryEntries);expect(incoming.lab).toEqual(d.lab);
    e.conditions[0]!.note='=HYPERLINK("evil")';expect(exportLabCsv(e)).toContain("'=HYPERLINK");
    e.conditions[0]!.note='\t=HYPERLINK("evil")';expect(exportLabCsv(e)).toContain("'\t=HYPERLINK");
    const copy=duplicateLab(e,id2,timestamp);expect(copy.conditions[0]!.id).toBe(`${id2}:0`);expect(copy.conditions[0]!.note).toBe('');
    expect(()=>importLabJson(d,exportLabJson(d,e,timestamp))).toThrow('duplicate');
  });
  it('ZIP has consistent local/central directory offsets and original bytes',async()=>{
    const zip=makeZip([{name:'experiment.json',bytes:new TextEncoder().encode('{"test":true}')}]);const bytes=new Uint8Array(await zip.arrayBuffer());const view=new DataView(bytes.buffer);
    expect(view.getUint32(0,true)).toBe(0x04034b50);const end=bytes.length-22;expect(view.getUint32(end,true)).toBe(0x06054b50);expect(view.getUint32(view.getUint32(end+16,true),true)).toBe(0x02014b50);
    expect(()=>makeZip([{name:'../bad',bytes:new Uint8Array()}])).toThrow();
  });
  it('persists through restart and rolls back quota failures without altering saved data',async()=>{
    const factory=new IDBFactory();let repo=await WorkbenchRepository.open('lab',factory);await repo.save(data(),0);repo.close();repo=await WorkbenchRepository.open('lab',factory);expect((await repo.load()).data).toEqual(data());
    const put=IDBObjectStore.prototype.put;const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value,key){if(this.name==='metadata'&&key==='extra')throw new DOMException('quota','QuotaExceededError');return put.call(this,value,key);});
    try{await expect(repo.save(fixture(),1)).rejects.toThrow('quota');}finally{spy.mockRestore();}
    expect((await repo.load()).data).toEqual(data());repo.close();
  });
});
