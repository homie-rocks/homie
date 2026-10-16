import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureBackgroundQueues} from '../lib/background-queue.mjs';
function root(t){const p=mkdtempSync(join(tmpdir(),'hm-rbp-queues-'));t.after(()=>rmSync(p,{recursive:true,force:true}));writeFileSync(join(p,'studio.json'),JSON.stringify({name:'Test',cloudflare:{worker:'test',accountId:'account'}}));return p;}
test('partial queue creation recovers from structured unbound queue records',async t=>{
 const p=root(t),calls=[];
 await ensureBackgroundQueues(p,args=>{calls.push(args);return {code:1,out:'localized output'};},{headers:{authorization:'Bearer test'},fetchFn:async url=>{
  const name=new URL(url).searchParams.get('name');return Response.json({success:true,result:[{queue_name:name,producers:[],consumers:[],producers_total_count:0,consumers_total_count:0}]});
 }});
 assert.ok(calls.every(a=>a[1]==='create'),'no human-readable queue info');
});
test('missing CI queue permission has an actionable diagnostic',async t=>{
 await assert.rejects(async()=>ensureBackgroundQueues(root(t),()=>({code:1,out:'localized'}),{headers:{authorization:'Bearer test'},fetchFn:async()=>Response.json({success:false},{status:403})}),/Queues.*Edit.*CI|CI.*Queues.*Edit/);
});
test('another Worker queue cannot be adopted',async t=>{
 await assert.rejects(async()=>ensureBackgroundQueues(root(t),()=>({code:1,out:'localized'}),{headers:{authorization:'Bearer test'},fetchFn:async url=>Response.json({success:true,result:[{queue_name:new URL(url).searchParams.get('name'),producers:[{type:'worker',script:'other'}],consumers:[]}]})}),/another|exclusively/);
});
import {explainCloudflare} from '../lib/cloudflare.mjs';
test('deploy diagnostics explain a revoked queue permission on an existing CI token',()=>{
 assert.match(explainCloudflare('Queue binding: authentication error (10000)')?.why??'',/Queues.*Edit/);
});
