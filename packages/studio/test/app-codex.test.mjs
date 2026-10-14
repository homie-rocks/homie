import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newCodex, renderCodex, parseCodex, codexGaps } from '../lib/codex.mjs';
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
