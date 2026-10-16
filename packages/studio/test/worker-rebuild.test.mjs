import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {devConfig} from '../lib/dev.mjs';
import {readConfig} from '../lib/routes.mjs';
import {buildWorker,workerEntry} from '../lib/worker-build.mjs';
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
  const old=readFileSync(entry,'utf8'),oldMain=workerEntry(root),committed=readConfig(root).main;
  assert.equal(readFileSync(join(src,'worker.mjs'),'utf8'), `export default {async fetch(){return new Response((await import('./lazy.mjs')).value)}}`, 'the studio source is untouched');
  const generated=readFileSync(oldMain,'utf8');
  assert.match(generated, /as Gate/);
  assert.match(generated, /as Concentrator/);
  assert.match(oldMain,/runtime\/[a-f0-9]{24}\/worker\.js$/);
  const local=devConfig(root,true);
  assert.equal(JSON.parse(readFileSync(local.copy,'utf8')).main,oldMain);
  const options=(text=readFileSync(entry,'utf8'))=> {
    const runtime=join(src,'runtime'),modules={};
    for(const path of readdirSync(runtime,{recursive:true}).filter(p=>p.endsWith('.js'))) modules[path]={type:'esm',contents:path==='worker.js'?text:readFileSync(join(runtime,path),'utf8')};
    return {telemetry:{enabled:false},workers:[{config:{name:'rebuild',compatibilityDate:'2026-09-01',manifest:{mainModule:'worker.js',modules}}}]};
  };
  const mf=new Miniflare(options());t.after(()=>mf.dispose());
  assert.equal(await (await mf.dispatchFetch('http://localhost/')).text(),'before');
  writeFileSync(join(src,'lazy.mjs'),`export const value='after'`);
  await buildWorker(root,esbuild);
  assert.equal(readConfig(root).main,committed);
  assert.notEqual(workerEntry(root),oldMain,'new config selects a complete immutable graph');
  assert.equal(JSON.parse(readFileSync(local.copy,'utf8')).main,workerEntry(root),'copied dev config also selects the new complete graph');
  assert.ok(readFileSync(oldMain,'utf8'),'old config still resolves');
  // Simulate the watcher's interleaving: it read the old entry before publication,
  // but resolves that entry's imports after the complete new build is in place.
  await mf.setOptions(options(old));
  assert.equal(await (await mf.dispatchFetch('http://localhost/')).text(),'before');
  await mf.setOptions(options());
  assert.equal(await (await mf.dispatchFetch('http://localhost/')).text(),'after');
  const config=readConfig(root);config.main='site/src/custom-worker.mjs';
  writeFileSync(join(root,'wrangler.jsonc'),JSON.stringify(config));
  assert.equal(workerEntry(root),null,'an explicit custom entry is never overridden by a generated generation');
  assert.equal(JSON.parse(readFileSync(devConfig(root,true).copy,'utf8')).main,join(root,config.main));
});

test('dev loads root local secrets beside its generated config and removes stale copies', t=>{
 const root=mkdtempSync(join(tmpdir(),'homie-dev-vars-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(join(root,'wrangler.jsonc'),JSON.stringify({name:'local',main:'worker.js'}));
 writeFileSync(join(root,'.dev.vars'),'LOCAL_VALUE="local # value"\n');
 const config=devConfig(root,false);
 assert.equal(readFileSync(join(root,'.wrangler/.dev.vars'),'utf8'),'LOCAL_VALUE="local # value"\n');
 rmSync(join(root,'.dev.vars'));devConfig(root,false);
 assert.equal(readdirSync(join(root,'.wrangler')).includes('.dev.vars'),false);
});

for (const name of ['codex-studio-by-homie', 'shop-trial', 'homie-arcade', 'homie-official']) {
 test(`${name}: generated entry preserves fetch and provides queue/scheduled handlers`, async t=>{
  const root=mkdtempSync(join(tmpdir(),'homie-consumer-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const src=join(root,'site/src');mkdirSync(src,{recursive:true});
  writeFileSync(join(root,'studio.json'),JSON.stringify({name,slug:name,cloudflare:{worker:name,d1:name+'-db'}}));
  // Copperwind wraps only fetch; the other studio shapes re-export the toolkit.
  const custom=name==='codex-studio-by-homie';
  if(name==='shop-trial')writeFileSync(join(root,'shop.json'),'{}');
  mkdirSync(join(root,'node_modules/@homie-rocks'),{recursive:true});
  symlinkSync(new URL('..',import.meta.url).pathname,join(root,'node_modules/@homie-rocks/studio'));
  const source=custom ? `export default {fetch(){return Response.json({custom:true,queue:typeof this.queue,scheduled:typeof this.scheduled})}}` : `export {default,Table,Lobby} from '@homie-rocks/studio/worker'`;
  writeFileSync(join(src,'worker.mjs'),source);
  // Stub event implementations, not the generated entry: exercise bundling and
  // the exported Worker's event contract without databases or network services.
  const builder={build:opts=>esbuild.build({...opts,plugins:[{name:'event-fixture',setup(b){b.onLoad({filter:/\/worker\/(?:selling\/)?index\.mjs$/},()=>({contents:`export class Table {}; export class Lobby {}; export default {queue(){},scheduled(){},fetch(){return Response.json({queue:typeof this.queue,scheduled:typeof this.scheduled})}}`,loader:'js'}));}},...opts.plugins]})};
  await buildWorker(root,builder);
  const config=readConfig(root);
  assert.equal(config.name,name);
  assert.equal(config.durable_objects.bindings[0].name,'TABLE');
  assert.equal(config.queues.consumers[0].queue,name+'-background');
  assert.equal(config.queues.consumers[0].dead_letter_queue,name+'-background-dlq');
  const main=workerEntry(root),dir=join(main,'..'),modules={};
  for(const file of readdirSync(dir).filter(f=>f.endsWith('.js')))modules[file]={type:'esm',contents:readFileSync(join(dir,file),'utf8')};
  const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name,compatibilityDate:'2026-09-01',manifest:{mainModule:'worker.js',modules}}}]});
  t.after(()=>mf.dispose());
  assert.deepEqual(await (await mf.dispatchFetch('http://localhost/')).json(),{...(custom?{custom:true}:{}),queue:'function',scheduled:'function'});
  assert.equal(readFileSync(join(src,'worker.mjs'),'utf8'),source);
 });
}

test('generated entry keeps explicitly customized event handlers',async t=>{
 const root=mkdtempSync(join(tmpdir(),'homie-custom-events-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'site/src'),{recursive:true});
 writeFileSync(join(root,'studio.json'),JSON.stringify({name:'custom',slug:'custom',cloudflare:{worker:'custom',d1:'custom-db'}}));
 writeFileSync(join(root,'site/src/worker.mjs'),`export default {queue(){return 'custom queue'},scheduled(){return 'custom scheduled'},fetch(){return Response.json([this.queue(),this.scheduled()])}}`);
 await buildWorker(root,esbuild);
 const dir=join(workerEntry(root),'..'),modules={};
 for(const file of readdirSync(dir).filter(f=>f.endsWith('.js')))modules[file]={type:'esm',contents:readFileSync(join(dir,file),'utf8')};
 const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'custom',compatibilityDate:'2026-09-01',manifest:{mainModule:'worker.js',modules}}}]});t.after(()=>mf.dispose());
 assert.deepEqual(await (await mf.dispatchFetch('http://localhost/')).json(),['custom queue','custom scheduled']);
});
