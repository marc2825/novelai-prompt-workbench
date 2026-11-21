import { readFile } from 'node:fs/promises';
import { expect,test,type Page } from '@playwright/test';
import { png } from '../fixtures/png';
const saved=(p:Page)=>expect(p.getByText('保存済み · この端末のみ',{exact:true})).toBeVisible();
const button=(p:Page,name:string)=>p.getByRole('button',{name,exact:true});
const field=(p:Page,name:string)=>p.getByRole('textbox',{name,exact:true});
const combo=(p:Page,name:string)=>p.getByRole('combobox',{name,exact:true});
async function boot(p:Page,site=false){p.on('dialog',d=>void d.accept());await p.goto(site?'/tests/fixtures/site.html':'/tests/fixtures/index.html');await saved(p);await p.getByRole('tab',{name:'Experiment Lab',exact:true}).click();}
async function create(p:Page){await button(p,'確認して実験を作成').click();await saved(p);await expect(p.getByRole('region',{name:'Execution',exact:true})).toBeVisible();}
async function upload(p:Page,shade:number){await p.getByLabel('この条件にPNGを登録',{exact:true}).setInputFiles({name:`result-${shade}.png`,mimeType:'image/png',buffer:png(4,4,{},shade)});await expect(p.getByRole('img',{name:'選択条件の画像',exact:true})).toBeVisible();await saved(p);}
async function download(p:Page,name:string){const event=p.waitForEvent('download');await button(p,name).click();return await (await event).path();}

test('Phase 1: weight, interaction, seed XYZ, Medium validation, bilingual UI and draft navigation',async({page})=>{
 await boot(page);await expect(page.getByText(/予定生成枚数: 5 \/ 512/)).toBeVisible();
 await combo(page,'実験テンプレート').selectOption('Tag Interaction');await expect(page.getByText(/予定生成枚数: 25 \/ 512/)).toBeVisible();
 await combo(page,'Z Type').selectOption('seed');await field(page,'Z Values').fill('1001,1002,1003');await expect(page.getByText(/予定生成枚数: 75 \/ 512/)).toBeVisible();
 await create(page);const plot=page.getByRole('region',{name:'X/Y/Z Plot',exact:true});await expect(plot.locator('.lab-cell')).toHaveCount(25);
 await expect(combo(page,'共通Seed')).toBeDisabled();await combo(page,'Z').selectOption('1');await expect(plot.locator('.lab-cell').first()).toContainText('1002');await expect(page.getByRole('button',{name:'Controlled Batch',exact:true})).toBeDisabled();
 await page.screenshot({path:test.info().outputPath('nai-lab-xyz.png'),fullPage:true});
 await button(page,'新しい実験').click();await combo(page,'Effort').selectOption('medium');await expect(page.getByRole('spinbutton',{name:'steps',exact:true})).toHaveValue('14');await expect(field(page,'Undesired Content')).toBeDisabled();
 await combo(page,'Language').selectOption('en');await expect(page.getByRole('textbox',{name:'Experiment name',exact:true})).toBeVisible();
 page.removeAllListeners('dialog');page.on('dialog',d=>void d.dismiss());await page.getByRole('tab',{name:'ライブラリ',exact:true}).click();await expect(page.getByRole('tab',{name:'Experiment Lab',exact:true})).toHaveAttribute('aria-selected','true');
});

test('Phases 2/3: manual progress, pinned PNG association, ratings, viewer, exports, restart and duplication',async({page})=>{
 await boot(page);await create(page);const ids=await combo(page,'Condition ID').locator('option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value));
 await expect(button(page,'この条件を生成待ちにする')).toBeDisabled();await page.getByRole('checkbox',{name:'この条件のSeed・モデル・全設定をNovelAIで確認した',exact:true}).check();await button(page,'この条件を生成待ちにする').click();await expect(page.getByRole('region',{name:'Execution',exact:true})).toContainText('awaiting: 1');
 await upload(page,20);await page.getByRole('checkbox',{name:'お気に入り',exact:true}).check();await combo(page,'主観評価').selectOption('5');await field(page,'メモ').fill('strong blush');await saved(page);
 await button(page,'次の未実行条件を選択').click();await expect(combo(page,'Condition ID')).toHaveValue(ids[1]!);await upload(page,200);
 await combo(page,'比較条件 A').selectOption(ids[0]!);await combo(page,'比較条件 B').selectOption(ids[1]!);await combo(page,'表示モード').selectOption('wipe');await page.getByRole('slider',{name:'重ね合わせ位置',exact:true}).fill('35');await expect(page.getByRole('img',{name:'比較画像B',exact:true})).toBeVisible();await combo(page,'表示モード').selectOption('diff');await expect(page.getByRole('img',{name:'A/Bピクセル差分',exact:true})).toBeVisible();
 const json=JSON.parse(await readFile((await download(page,'JSON'))!,'utf8'));expect(json.payload.lab.experiments[0].conditions[0].rating).toBe(5);expect(json.payload.images).toHaveLength(2);
 const csv=await readFile((await download(page,'CSV'))!,'utf8');expect(csv).toContain('strong blush');expect(csv).toContain('factors_json');
 const zipEvent=page.waitForEvent('download');await button(page,'ZIP (PNG + JSON + CSV)').click();await (await zipEvent).saveAs(test.info().outputPath('nai-lab-export.zip'));
 const grid=await readFile((await download(page,'このZ・Seed・反復のグリッドPNGを保存'))!);expect([...grid.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
 await button(page,'一時停止').click();await expect(button(page,'次の未実行条件を選択')).toBeDisabled();await saved(page);await page.reload();await saved(page);await page.getByRole('tab',{name:'Experiment Lab',exact:true}).click();await expect(page.getByRole('region',{name:'Execution',exact:true})).toContainText('paused');await expect(page.getByRole('img',{name:'選択条件の画像',exact:true})).toBeVisible();await button(page,'再開').click();await button(page,'実験を複製').click();await saved(page);await expect(page.getByRole('region',{name:'Execution',exact:true})).toContainText('completed: 0');await button(page,'実験を削除').click();await saved(page);await button(page,'元に戻す').click();await saved(page);await expect(combo(page,'保存済み実験').locator('option')).toHaveCount(3);
});

test('Lab JSON restores to a fresh profile, reports missing PNG, repairs by hash and rejects corrupt conditions',async({page,browser})=>{
 await boot(page);await create(page);await upload(page,100);const raw=await readFile((await download(page,'JSON'))!,'utf8');
 const context=await browser.newContext();const p=await context.newPage();await boot(p);await p.getByLabel('実験JSONをインポート',{exact:true}).setInputFiles({name:'lab.json',mimeType:'application/json',buffer:Buffer.from(raw)});await saved(p);await expect(p.getByRole('alert')).toContainText('原本PNGが欠落');await upload(p,100);await expect(p.getByRole('img',{name:'選択条件の画像',exact:true})).toBeVisible();
 const bad=JSON.parse(raw);bad.payload.lab.experiments[0].conditions[0].seed='999';await p.getByLabel('実験JSONをインポート',{exact:true}).setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});await expect(p.getByRole('alert')).toContainText('snapshot mismatch');await expect(p.getByRole('img',{name:'選択条件の画像',exact:true})).toBeVisible();await context.close();
});

test('Lab uses existing confirmed adapter, detects CAS conflicts and never generates',async({page})=>{
 await boot(page,true);await create(page);await button(page,'NovelAIの接続を確認').click();await combo(page,'対象タブ').selectOption('101');await combo(page,'反映方法').selectOption('replace');await button(page,'反映プレビューを作成').click();const expected=await field(page,'反映後').inputValue();await field(page,'Mock Positive 101').fill('user edited');await button(page,'確認してサイトに反映').click();await expect(field(page,'Mock Positive 101')).toHaveValue('user edited');await expect(page.getByRole('region',{name:'NovelAIサイト連携',exact:true})).toContainText('変更');
 await button(page,'反映プレビューを作成').click();await button(page,'確認してサイトに反映').click();await expect(field(page,'Mock Positive 101')).toHaveValue(expected);await expect(field(page,'Mock Negative 101')).toHaveValue('site 101 negative');await expect(button(page,'Generate 101 (0)')).toBeVisible();await expect(button(page,'Generate 202 (0)')).toBeVisible();
 await button(page,'次の未実行条件を選択').click();await expect(button(page,'確認してサイトに反映')).toHaveCount(0);
 await page.getByText('Tab 101 / positive',{exact:true}).click();await button(page,'復元プレビュー').click();await button(page,'確認して原文へ復元').click();await expect(field(page,'Mock Positive 101')).toHaveValue('user edited');
});
