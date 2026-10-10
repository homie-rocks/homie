import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {devConfig} from '../lib/dev.mjs';
import {readConfig} from '../lib/routes.mjs';
import {buildWorker} from '../lib/worker-build.mjs';
import * as esbuild from 'esbuild';
import {Miniflare} from 'miniflare';

test('a reload holding an old entry retains its complete module graph across a build', async t=>{
  const root=mkdtempSync(join(tmpdir(),'homie-worker-rebuild-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const src=join(root,'site/src'),entry=join(src,'runtime/worker.js');
  mkdirSync(src,{recursive:true});
  writeFileSync(join(root,'studio.json'),JSON.stringify({name:'Rebuild',slug:'rebuild',cloudflare:{worker:'rebuild',d1:'rebuild-db'}}));
  writeFileSync(join(src,'worker.mjs'),`export default {async fetch(){return new Response((await import('./lazy.mjs')).value)}}`);
  writeFileSync(join(src,'lazy.mjs'),`export const value='before'`);
  await buildWorker(root,esbuild);
  const old=readFileSync(entry,'utf8'),oldMain=readConfig(root).main;
  assert.match(oldMain,/runtime\/[a-f0-9]{24}\/worker\.js$/);
  const local=devConfig(root,true);
  assert.equal(JSON.parse(readFileSync(local.copy,'utf8')).main,entry,'a copied local config follows the atomic entry');
  const options=(text=readFileSync(entry,'utf8'))=> {
    const runtime=join(src,'runtime'),modules={};
    for(const path of readdirSync(runtime,{recursive:true}).filter(p=>p.endsWith('.js'))) modules[path]={type:'esm',contents:path==='worker.js'?text:readFileSync(join(runtime,path),'utf8')};
    return {telemetry:{enabled:false},workers:[{config:{name:'rebuild',compatibilityDate:'2026-09-01',manifest:{mainModule:'worker.js',modules}}}]};
  };
  const mf=new Miniflare(options());t.after(()=>mf.dispose());
  assert.equal(await (await mf.dispatchFetch('http://localhost/')).text(),'before');
  writeFileSync(join(src,'lazy.mjs'),`export const value='after'`);
  await buildWorker(root,esbuild);
  assert.notEqual(readConfig(root).main,oldMain,'new config selects a complete immutable graph');
  assert.ok(readFileSync(join(root,oldMain),'utf8'),'old config still resolves');
  // Simulate the watcher's interleaving: it read the old entry before publication,
  // but resolves that entry's imports after the complete new build is in place.
  await mf.setOptions(options(old));
  assert.equal(await (await mf.dispatchFetch('http://localhost/')).text(),'before');
  await mf.setOptions(options());
  assert.equal(await (await mf.dispatchFetch('http://localhost/')).text(),'after');
});
