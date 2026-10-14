import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importMedia } from '../lib/media-import.mjs';
import { officialConnections } from '../lib/official-media.mjs';
import { upgradePlan, upgradeApply } from '../lib/upgrade.mjs';
import { RETIRED_MEDIA_GUIDANCE, OFFICIAL_MEDIA_GUIDANCE } from '../lib/upgrade-media.mjs';
const fixture = new URL('./fixtures/official-media/', import.meta.url);
const fal = JSON.parse(readFileSync(new URL('fal-result.json', fixture)));
const receipt = { provider:'fal',tool:'run_model',model:fal.endpoint_id,requestId:fal.request_id,prompt:fal.recipe.input.prompt,styleRevision:'forest-proof-1',rights:{source:'https://fal.ai/terms',checkedAt:'2026-10-14',commercial:false,note:'Proof only; not licensed for a shipping product by this test'},cost:{status:'estimate',amount:0.003,unit:'usd'} };
test('completed MCP result places the image and sound with provenance; repeat is idempotent', () => {
 const root=mkdtempSync(join(tmpdir(),'homie-official-proof-'));
 try {
  writeFileSync(join(root,'studio.json'),JSON.stringify({name:'Forest',slug:'forest'}));
  mkdirSync(join(root,'games/forest'),{recursive:true});
  writeFileSync(join(root,'games/forest/index.html'),'<img src="assets/forest.png"><audio controls src="assets/lantern.wav"></audio>');
  const image = importMedia(root,{file:new URL('forest.png',fixture),receipt,out:'games/forest/assets/forest.png',usedBy:'games/forest/index.html'});
  const soundReceipt={...receipt,provider:'elevenlabs',tool:'fixture-only',model:'synthetic-audio-fixture',requestId:'fixture-sound-1',fixture:true,cost:{status:'unknown'}};
  importMedia(root,{file:new URL('lantern.wav',fixture),receipt:soundReceipt,out:'games/forest/assets/lantern.wav',usedBy:'games/forest/index.html'});
  assert.deepEqual(readFileSync(join(root,image.artifact)),readFileSync(new URL('forest.png',fixture)));
  assert.equal(importMedia(root,{file:new URL('forest.png',fixture),receipt,out:image.artifact,usedBy:'games/forest/index.html'}).already,true);
  const records=JSON.parse(readFileSync(join(root,'media/provenance.json')));
  writeFileSync(join(root,'receipt.json'),JSON.stringify(receipt));
  const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../bin/homie-studio.mjs',import.meta.url)),'media','import','--file',fileURLToPath(new URL('forest.png',fixture)),'--receipt',join(root,'receipt.json'),'--out',image.artifact,'--used-by','games/forest/index.html','--json'],{cwd:root,encoding:'utf8'});
  assert.equal(cli.status,0,cli.stdout+cli.stderr);assert.equal(JSON.parse(cli.stdout).already,true);
  assert.equal(records.length,2);assert.equal(records[0].requestId,fal.request_id);assert.equal(records[0].sha256,image.sha256);assert.equal(records[1].fixture,true);assert.equal(records[1].cost.status,'unknown');
  assert.throws(()=>importMedia(root,{file:new URL('forest.png',fixture),receipt,out:'../escape.png',usedBy:'games/forest/index.html'}),/inside/);
  symlinkSync(tmpdir(),join(root,'outside'));
  assert.throws(()=>importMedia(root,{file:new URL('forest.png',fixture),receipt,out:'outside/escape.png',usedBy:'games/forest/index.html'}),/symlink/);
  assert.throws(()=>importMedia(root,{file:new URL('forest.png',fixture),receipt:{...receipt,cost:{status:'actual'}},out:image.artifact,usedBy:'games/forest/index.html'}),/cost/);
  writeFileSync(join(root,'games/forest/index.html'),'unused');
  assert.throws(()=>importMedia(root,{file:new URL('forest.png',fixture),receipt,out:image.artifact,usedBy:'games/forest/index.html'}),/reference/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('connection evidence is explicit, with no credential or host configuration access',()=>{
 const unknown=officialConnections();assert.deepEqual(unknown.map(x=>x.connection),['unknown','unknown','unknown']);
 assert.deepEqual(officialConnections({fal:'connected',elevenlabs:'unavailable'}).map(x=>x.connection),['connected','unavailable','unknown']);
});
test('upgrade replaces retired guidance without changing studio-authored notes',()=>{
 const root=mkdtempSync(join(tmpdir(),'homie-media-upgrade-'));
 try {
  writeFileSync(join(root,'studio.json'),JSON.stringify({name:'Forest',slug:'forest'}));
  const before='# Studio\n\nKeep my palette.\n\n'+RETIRED_MEDIA_GUIDANCE;
  writeFileSync(join(root,'README.md'),before);
  const plan=upgradePlan(root);assert.equal(plan.ok,true);
  upgradeApply(root,plan);
  assert.equal(readFileSync(join(root,'README.md'),'utf8'),'# Studio\n\nKeep my palette.\n\n'+OFFICIAL_MEDIA_GUIDANCE);
 } finally {rmSync(root,{recursive:true,force:true});}
});

import { MEDIA_WORKFLOWS, validateMediaTools } from '../lib/media-workflows.mjs';
test('skill workflow tool references resolve against official provider contracts',()=>{
 const contracts=JSON.parse(readFileSync(new URL('tools.json',fixture)));
 for(const workflow of Object.values(MEDIA_WORKFLOWS)) {
  assert.deepEqual(validateMediaTools(workflow,contracts[workflow.provider].tools),{ready:true,missing:[]});
  assert.equal(validateMediaTools(workflow,[]).ready,false);
 }
});

import { setupStatus } from '../lib/doctor.mjs';
import { availability } from '../lib/mcp-tools.mjs';
test('setup and local media availability never access provider credentials',async(t)=>{
 const accesses=[];const read=fs.readFileSync;const exists=fs.existsSync;
 const credentialPath=p=>['fal-key','elevenlabs-key'].some(name=>String(p).endsWith('/'+name));
 t.mock.method(fs,'readFileSync',function(p,...args){if(credentialPath(p)){accesses.push(String(p));throw new Error('provider credential file access');}return read.call(this,p,...args);});
 t.mock.method(fs,'existsSync',function(p){return credentialPath(p)||exists.call(this,p);});
 syncBuiltinESMExports();
 t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const env={};
 for(const key of ['FAL_KEY','ELEVENLABS_API_KEY','ELEVENLABS_CLI']) Object.defineProperty(env,key,{get(){accesses.push(key);throw new Error(`forbidden credential access: ${key}`);}});
 const root=mkdtempSync(join(tmpdir(),'homie-media-no-keys-'));
 try {
  const calls=[];
  const status=await setupStatus({cwd:root,env,exec:async(cmd,args)=>{calls.push([cmd,args]);return {code:1,stdout:'',stderr:''};},fetchFn:async()=>new Response('',{status:405}),chrome:()=>null});
  assert.equal(status.rows.find(x=>x.id==='fal').connection,'unknown');
  assert.equal(status.rows.find(x=>x.id==='elevenlabs').connection,'unknown');
  assert.ok(calls.every(([cmd])=>cmd!=='elevenlabs'&&cmd!=='fal'));
  assert.equal(availability(env).node,true);
  assert.deepEqual(accesses,[], 'even caught credential-read attempts are forbidden');
 } finally {rmSync(root,{recursive:true,force:true});}
});
