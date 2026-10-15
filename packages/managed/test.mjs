import test from 'node:test';
import assert from 'node:assert/strict';
import dispatch from './dispatch.mjs';
const routes=[{hostname:'studio.test',prefix:'/',script:'hm-test-studio'}];
test('unknown hosts and public tick never acquire dispatch capabilities',async()=>{
  const env={ROUTES:routes,STUDIOS:{get(){throw new Error('must not dispatch')}}};
  for(const url of ['https://unknown.test/','https://studio.test/__managed/tick'])
    assert.equal((await dispatch.fetch(new Request(url),env)).status,404);
});
test('registry selects Worker; spoofed managed header is stripped; limits applied',async()=>{
  let calls=0;
  const env={ROUTES:routes,STUDIOS:{get(script,props,options){
    calls++;assert.equal(script,'hm-test-studio');assert.deepEqual(props,{});
    assert.equal(options.limits.cpuMs,100);
    return {fetch(req){assert.equal(req.headers.get('x-homie-managed-tick'),null);return new Response('ok')}};
  }}};
  assert.equal(await (await dispatch.fetch(new Request('https://studio.test/?tenant=other',{headers:{'x-homie-managed-tick':'true'}}),env)).text(),'ok');
  assert.equal(calls,1);
});
test('cron supplies trusted props',async()=>{
  let promise;
  const env={ROUTES:routes,STUDIOS:{get(script,options){
    assert.equal(options.props.managedTick,true);
    return {async fetch(url,init){assert.equal(JSON.parse(init.body).scheduledTime,123);return new Response(null,{status:204})}};
  }}};
  await dispatch.scheduled({scheduledTime:123,cron:'* * * * *'},env,{waitUntil(p){promise=p}});
  await promise;
});
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepare} from './prepare.mjs';
test('adapter excludes production capabilities; tick requires unforgeable dispatch props',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hm-test-unit-'));
 try {
  const studio=join(dir,'studio'),generation=join(studio,'site/src/runtime/generation');
  mkdirSync(generation,{recursive:true});
  mkdirSync(join(studio,'site/dist'),{recursive:true});
  writeFileSync(join(studio,'site/dist/games.json'),JSON.stringify({studio:{canonical:'https://production.example'}}));
  writeFileSync(join(studio,'package.json'),'{"type":"module"}');
  writeFileSync(join(generation,'worker.js'),`export default {fetch(){return new Response('studio')},scheduled(event,env){env.ticks.push(event)}};`);
  writeFileSync(join(studio,'site/src/runtime/current.json'),JSON.stringify({main:join(generation,'worker.js')}));
  writeFileSync(join(studio,'wrangler.jsonc'),JSON.stringify({compatibility_date:'2026-06-01',compatibility_flags:['nodejs_compat'],routes:['production.example/*'],services:[{binding:'ADMIN',service:'production'}],vars:{SECRET:'must-not-copy'},d1_databases:[{database_id:'production'}]}));
  const output=join(dir,'managed');
  const config=prepare({studio,output,name:'hm-test-unit',databaseId:'11111111-1111-1111-1111-111111111111',accountId:'a'.repeat(32),hostname:'test.example'});
  assert.equal(config.routes,undefined);assert.equal(config.services,undefined);assert.equal(config.vars.SECRET,undefined);
  assert.equal(config.durable_objects.bindings.length,4);
  assert.equal(config.d1_databases[0].database_id,'11111111-1111-1111-1111-111111111111');
  assert.equal(JSON.parse((await import('node:fs')).readFileSync(join(config.assets.directory,'games.json'),'utf8')).studio.canonical,'https://test.example');
  const worker=(await import(pathToFileURL(config.main))).default;
  const env={ticks:[]};
  const req=()=>new Request('https://test.example/__managed/tick',{method:'POST',headers:{'x-homie-managed-tick':'true'},body:'{"scheduledTime":123,"cron":"* * * * *"}'});
  assert.equal((await worker.fetch(req(),env,{})).status,404);assert.equal(env.ticks.length,0);
  assert.equal((await worker.fetch(req(),env,{props:{managedTick:true}})).status,204);assert.equal(env.ticks[0].scheduledTime,123);
 } finally {rmSync(dir,{recursive:true,force:true})}
});
