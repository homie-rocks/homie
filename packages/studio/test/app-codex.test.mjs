import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newCodex, renderCodex, parseCodex, codexGaps } from '../lib/codex.mjs';
import { initDecisions, contextOf } from '../lib/decisions.mjs';
import { newApp } from '../lib/studio.mjs';
import { readAppNeeds, proveAppNeeds, saveAppNeeds } from '../lib/app-needs.mjs';

test('an app is planned before plumbing, keeps its Codex, and renders needs status in the shared page', async t => {
  const root = mkdtempSync(join(tmpdir(), 'homie-app-codex-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'studio.json'), JSON.stringify({name:'Coldsmoke',slug:'coldsmoke'}));
  writeFileSync(join(root, 'package.json'), JSON.stringify({dependencies:{}}));
  const result = newCodex(root, 'workshop', {kind:'app', name:'Coldsmoke'});
  assert.equal(result.ok, true);
  assert.equal(result.file, 'apps/workshop/CODEX.md');
  const file = join(root, result.file), original = readFileSync(file,'utf8');
  assert.ok(codexGaps(parseCodex(original)).missing.includes('Scene'));
  assert.equal(existsSync(join(root,'games/workshop')),false);
  await newApp(root,'workshop');
  assert.equal(readFileSync(file,'utf8'),original);
  const need = {id:'gear',statement:'I can follow my gear',assertions:[{surface:'wall',selector:'#gear'},{surface:'phone',selector:'#mine'}]};
  writeFileSync(file, original.replace('[]',JSON.stringify([need])));
  const context = contextOf(root, 'workshop');
  assert.equal(context.kind, 'app');
  const style = initDecisions(root, 'workshop', {prompt:'Cold alpine workshop with icy blue light'});
  assert.equal(style.kind,'app');
  assert.equal(style.file,'apps/workshop/codex/decisions.json');
  assert.ok(style.picked.every(id=>id.startsWith('style.')), 'app styling does not invent a game cast or rigs');
  const plan = readAppNeeds(root,'workshop');
  saveAppNeeds(root,'workshop',plan,[{...need,status:'not',why:'No tracking link yet',captures:[]}]);
  const page = renderCodex(root,'workshop');
  assert.ok(page.html.includes('No tracking link yet'));
  assert.ok(page.html.includes('apps/workshop/CODEX.md'));
  assert.equal(newCodex(root,'workshop').ok,false,'never overwrite the owner’s words');
});

test('Codex needs run real flow operations, retain failures, capture both surfaces and leave older apps opted out',async t=>{
  const root=mkdtempSync(join(tmpdir(),'homie-needs-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  assert.equal(readAppNeeds(root,'old-app'),null);
  mkdirSync(join(root,'apps/old-app'),{recursive:true});
  writeFileSync(join(root,'apps/old-app/CODEX.md'),'# Our existing plan\nNo executable acceptance contract.');
  assert.equal(readAppNeeds(root,'old-app'),null,'an older prose Codex does not opt an app in');
  const events=[];
  const surfaces=['wall','phone'].map(name=>({name,frame:{waitForSelector:async selector=>{if(selector==='#missing')throw new Error('not visible');events.push([name,'visible',selector]);},click:async selector=>events.push([name,'click',selector])},page:{screenshot:async options=>events.push([name,'capture',options.path])}}));
  const plan={needs:[{id:'book',statement:'Book from my phone',steps:[{surface:'phone',selector:'#book',click:true}],assertions:[{surface:'phone',selector:'#receipt'},{surface:'wall',selector:'#gear'}]},{id:'track',statement:'Follow my own gear',assertions:[{surface:'phone',selector:'#missing'},{surface:'wall',selector:'#gear'}]}]};
  const result=await proveAppNeeds({plan,surfaces,shots:root});
  assert.deepEqual(result.map(n=>n.status),['met','not']);
  assert.deepEqual(events[0],['phone','visible','#book']);
  assert.deepEqual(events[1],['phone','click','#book']);
  assert.equal(result[0].captures.length,2);assert.equal(result[1].captures.length,2);
  assert.equal(result[1].statement,'Follow my own gear');
});

test('a need customer role applies to its phone while the wall retains its own role; passing needs save shots',async t=>{
 const root=mkdtempSync(join(tmpdir(),'needs-roles-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const captures=[];
 const surfaces=[['phone','customer'],['wall','display']].map(([name,role])=>({name,role,frame:{waitForSelector:async()=>{}},page:{screenshot:async({path})=>{writeFileSync(path,'capture');captures.push(path);}}}));
 const results=await proveAppNeeds({plan:{needs:[{id:'visible',statement:'Both views work',role:'customer',assertions:[{surface:'phone',selector:'#ready'},{surface:'wall',selector:'#ready'}]}]},surfaces,shots:root});
 assert.equal(results[0].status,'met',results[0].why);assert.equal(captures.length,2);assert.ok(captures.every(existsSync));
});

test('readiness recognizes a private frame served through its signed asset path',async()=>{
 const {appReady}=await import('../lib/app-ready.mjs');let rendered=false;
 const frame={url:()=> 'https://place.test/app/__assets/signed/index.html',evaluate:async()=>{rendered=true;}};
 const surface={name:'phone',page:{waitForFunction:async()=>{},frames:()=>[frame]}};
 await appReady(surface,{timeout:10});assert.equal(surface.frame,frame);assert.equal(rendered,true);
});

test('an explicit UI step role selects its own context on the same surface',async()=>{
 const clicked=[];const surfaces=['customer','staff'].map(role=>({name:'phone',role,frame:{waitForSelector:async()=>{},click:async()=>clicked.push(role)},page:{}}));
 const [need]=await proveAppNeeds({plan:{needs:[{id:'staff-step',statement:'Use the named role',role:'customer',steps:[{surface:'phone',role:'staff',selector:'#act',click:true}],assertions:[{surface:'phone',role:'staff',selector:'#ready'}]}]},surfaces});
 assert.equal(need.status,'met',need.why);assert.deepEqual(clicked,['staff']);
});

test('wall-first assertions keep the wall role while the need role belongs to the phone',async()=>{
 const surfaces=[['wall','display'],['phone','customer']].map(([name,role])=>({name,role,frame:{waitForSelector:async()=>{}},page:{}}));
 const [need]=await proveAppNeeds({plan:{needs:[{id:'wall-first',statement:'Both surfaces show the change',role:'customer',assertions:[{surface:'wall',selector:'#ready'},{surface:'phone',selector:'#ready'}]}]},surfaces});
 assert.equal(need.status,'met',need.why);
});
