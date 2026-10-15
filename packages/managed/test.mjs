import test from 'node:test';
import assert from 'node:assert/strict';
import dispatch from './dispatch.mjs';
const routes=[{hostname:'studio.test',prefix:'/',script:'hm-test-studio'}];
test('unknown hosts and public tick never acquire dispatch capabilities',async()=>{
  const env={ROUTES:routes,STUDIOS:{get(){throw new Error('must not dispatch')}}};
  for(const url of ['https://unknown.test/','https://studio.test/__managed/tick'])
    assert.equal((await dispatch.fetch(new Request(url),env)).status,404);
});
test('registry selects Worker; spoofed managed header has no authority; limits applied',async()=>{
  let calls=0;
  const env={ROUTES:routes,STUDIOS:{get(script,props,options){
    calls++;assert.equal(script,'hm-test-studio');assert.deepEqual(props,{});
    assert.equal(options.limits.cpuMs,100);
    return {fetch(req){assert.equal(req.headers.get('x-homie-managed-tick'),'true');return new Response('ok')}};
  }}};
  assert.equal(await (await dispatch.fetch(new Request('https://studio.test/?tenant=other',{headers:{'x-homie-managed-tick':'true'}}),env)).text(),'ok');
  assert.equal(calls,1);
});
test('queue retries failing tenants independently; killed tenants never dispatch',async()=>{
  const messages=[];let calls=[];
  const env={ROUTES:[...routes,{hostname:'bad.test',prefix:'/',script:'hm-test-bad'}],TICKS:{async sendBatch(batch){messages.push(...batch)}},STUDIOS:{get(script,options,limits){
    calls.push(script);assert.equal(options.props.managedTick,true);assert.equal(limits.outbound.tenant,script);
    return {async fetch(){return new Response(null,{status:script==='hm-test-bad'?500:204})}};
  }}};
  await dispatch.scheduled({scheduledTime:123,cron:'* * * * *'},env);
  assert.equal(messages.length,2);
  const outcomes=[];
  await dispatch.queue({messages:messages.map(m=>({...m,ack(){outcomes.push('ack')},retry(){outcomes.push('retry')}}))},env);
  assert.deepEqual(outcomes,['ack','retry']);
  env.ROUTES=[];calls=[];
  await dispatch.queue({messages:[{body:messages[0].body,ack(){},retry(){throw Error('no retry')}}]},env);
  assert.deepEqual(calls,[]);
  assert.equal((await dispatch.fetch(new Request('https://studio.test/'),env)).status,404);
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
  writeFileSync(join(studio,'wrangler.jsonc'),JSON.stringify({compatibility_date:'2026-06-01',compatibility_flags:['nodejs_compat','global_fetch_strictly_public'],routes:['production.example/*'],services:[{binding:'ADMIN',service:'production'}],vars:{SECRET:'must-not-copy'},d1_databases:[{database_id:'production'}]}));
  const output=join(dir,'managed');
  const config=prepare({studio,output,name:'hm-test-unit',databaseId:'11111111-1111-1111-1111-111111111111',accountId:'a'.repeat(32),hostname:'test.example'});
  assert.deepEqual(config.compatibility_flags,['nodejs_compat']);
  assert.equal(config.routes,undefined);assert.equal(config.services,undefined);assert.equal(config.vars.SECRET,undefined);
  assert.equal(config.durable_objects.bindings.length,4);
  assert.ok((await import('node:fs')).existsSync(join(config.d1_databases[0].migrations_dir,'0033_tool_namespace_revisions.sql')));
  const sourcePath=join(studio,'wrangler.jsonc');
  const source=JSON.parse((await import('node:fs')).readFileSync(sourcePath));
  source.durable_objects={bindings:[{name:'CUSTOM',class_name:'OwnerRoom'},{name:'CONTROL',class_name:'Admin',script_name:'production'}]};
  writeFileSync(sourcePath,JSON.stringify(source));
  const next=prepare({studio,output,name:'hm-test-unit',databaseId:'11111111-1111-1111-1111-111111111111',accountId:'a'.repeat(32),hostname:'test.example'});
  assert.deepEqual(next.migrations[1],{tag:'v2',new_sqlite_classes:['OwnerRoom']});
  assert.ok(next.durable_objects.bindings.some(b=>b.class_name==='OwnerRoom'));
  assert.ok(!next.durable_objects.bindings.some(b=>b.name==='CONTROL'));
  assert.equal(config.d1_databases[0].database_id,'11111111-1111-1111-1111-111111111111');
  assert.equal(JSON.parse((await import('node:fs')).readFileSync(join(config.assets.directory,'games.json'),'utf8')).studio.canonical,'https://test.example');
  const worker=(await import(pathToFileURL(config.main))).default;
  const env={ticks:[]};
  const req=()=>new Request('https://test.example/__managed/tick',{method:'POST',headers:{'x-homie-managed-tick':'true'},body:'{"scheduledTime":123,"cron":"* * * * *"}'});
  assert.equal((await worker.fetch(req(),env,{})).status,404);assert.equal(env.ticks.length,0);
  assert.equal((await worker.fetch(req(),env,{props:{managedTick:true}})).status,204);assert.equal(env.ticks[0].scheduledTime,123);
 } finally {rmSync(dir,{recursive:true,force:true})}
});
import {waitForDatabase,removeResource} from './lifecycle.mjs';
import {blocked} from './outbound.mjs';
test('D1 readiness retries provisioning only and terminates',async()=>{
 let calls=0,waits=0;
 await waitForDatabase(async()=>{if(++calls<3)throw Error('7403');return true;},{sleep:async()=>waits++});
 assert.equal(calls,3);assert.equal(waits,2);
 await assert.rejects(waitForDatabase(async()=>{throw Error('bad SQL')},{sleep:async()=>assert.fail()}),/bad SQL/);
 await assert.rejects(waitForDatabase(async()=>{throw Error('7403')},{attempts:2,sleep:async()=>{}}),/7403/);
});
test('cleanup distinguishes cascade absence from deletion',async()=>{
 let exists=true;const api=async(p,method)=>{if(method==='DELETE')exists=false;return exists?{id:1}:null};
 assert.equal((await removeResource(api,'test')).result,'deleted');
 assert.equal((await removeResource(api,'test')).result,'already absent');
});
test('outbound blocks control plane and internal literals, permits public destinations',()=>{
 for(const host of ['127.0.0.1','10.1.2.3','169.254.169.254','[::1]','[::ffff:7f00:1]','localhost','a.internal','control.example','a.control.example'])assert.ok(blocked(host,['control.example']),host);
 for(const host of ['example.com','8.8.8.8','[2606:4700:4700::1111]'])assert.equal(blocked(host),false,host);
});
import {read} from './prepare.mjs';
test('JSONC inline/block comments, trailing commas and malformed input',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hm-test-jsonc-'));const file=join(dir,'config.jsonc');
 try {writeFileSync(file,'{/* comment */"url":"https://example.com", // inline\n}');assert.equal(read(file).url,'https://example.com');writeFileSync(file,'{"bad":}');assert.throws(()=>read(file),/Invalid JSONC/);}finally{rmSync(dir,{recursive:true,force:true})}
});
test('routing adds exactly one dispatch call and no serial startup work',async()=>{
 let calls=0;const env={ROUTES:routes,STUDIOS:{get(){calls++;return {fetch:async()=>new Response('ok')}}}};
 const start=performance.now();
 for(let i=0;i<50;i++)await dispatch.fetch(new Request('https://studio.test/asset.js'),env);
 assert.equal(calls,50);assert.ok(performance.now()-start<1000,'50 local dispatches exceed 1s budget');
});
import {buildInSandbox} from './build.mjs';
test('owner builds have no local execution fallback',async()=>{
 await assert.rejects(buildInSandbox({}),/Sandbox runner required/);
 await assert.rejects(buildInSandbox({sourceDigest:'s',toolkitDigest:'t'},{kind:'local',build(){assert.fail()}}),/Sandbox runner required/);
});
import {instrument} from './probe.mjs';
test('test instrumentation counts D1 calls and reports first isolate invocation',async()=>{
 const worker=instrument({async fetch(req,env){await env.DB.prepare('select 1').first();return new Response('ok')}});
 const env={DB:{prepare(){return {first:async()=>1}}},ASSETS:{}};
 for(const first of ['true','false']){const r=await worker.fetch(new Request('https://x.test'),env,{});assert.equal(r.headers.get('x-hm-first'),first);assert.equal(JSON.parse(r.headers.get('x-hm-calls')).d1,1);}
});
import outbound from './outbound.mjs';
test('outbound overwrites spoofed identity and never follows redirects unchecked',async()=>{
 const original=globalThis.fetch;
 try {
  globalThis.fetch=async req=>{assert.equal(req.headers.get('x-homie-tenant'),'hm-test-studio');assert.equal(req.redirect,'manual');return new Response(null,{status:302,headers:{location:'http://127.0.0.1/'}})};
  assert.equal((await outbound.fetch(new Request('https://example.com/',{headers:{'x-homie-tenant':'victim'}}),{tenant:'hm-test-studio'})).status,302);
  assert.equal((await outbound.fetch(new Request('https://example.com/'),{})).status,403);
 }finally{globalThis.fetch=original;}
});
