import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wranglerConfig} from '../lib/scaffold.mjs';
import {staticHeaders,staticWorkerRoutes} from '../lib/static-assets.mjs';
import {explainCloudflare} from '../lib/cloudflare.mjs';
import worker from '../worker/index.mjs';
import {requestFixture} from './request-budget.test.mjs';
test('an idle studio needs no cron; scheduled studios retain their ticks',()=>{
 assert.deepEqual(JSON.parse(wranglerConfig({worker:'idle',name:'Idle',d1:'idle'}).replace(/^\s*\/\/.*$/gm,'')).triggers.crons,[]);
 assert.deepEqual(JSON.parse(wranglerConfig({triggers:{crons:['* * * * *']}}).replace(/^\s*\/\/.*$/gm,'')).triggers.crons,['* * * * *']);
 assert.match(explainCloudflare('maximum number of cron triggers exceeded').why,/unused.*triggers|remove.*triggers/i);
});
test('concept static pages traverse the banner and static headers forbid indexing',()=>{
 assert.equal(staticWorkerRoutes({studio:{concept:true}}),true);
 assert.match(staticHeaders('',{concept:true}),/X-Robots-Tag: noindex, nofollow/);
});
test('retired sources cannot leak even when an old asset exists; rooms accept HEAD',async t=>{
 const {env}=requestFixture(t);
 assert.equal((await worker.fetch(new Request('https://speed.example/games/race/source.json'),env)).status,410);
 const head=await worker.fetch(new Request('https://speed.example/api/rooms',{method:'HEAD'}),env);
 assert.equal(head.status,200);assert.equal(await head.text(),'');
});
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {enableReadReplication} from '../lib/read-replication.mjs';
test('replication PATCH refusal and network failure leave the primary available',async t=>{
 const root=mkdtempSync(join(tmpdir(),'hm-rbp-replica-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(join(root,'studio.json'),JSON.stringify({name:'Test',cloudflare:{accountId:'account'}}));
 const token=process.env.CLOUDFLARE_API_TOKEN;process.env.CLOUDFLARE_API_TOKEN='test';t.after(()=>{if(token===undefined)delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=token;});
 const old=process.env.HOMIE_STUDIO_WARM;delete process.env.HOMIE_STUDIO_WARM;t.after(()=>{if(old===undefined)delete process.env.HOMIE_STUDIO_WARM;else process.env.HOMIE_STUDIO_WARM=old;});
 for(const fetchFn of [async()=>Response.json({success:false},{status:403}),async()=>{throw new Error('offline');}]) {
  const result=await enableReadReplication(root,()=>({code:0,stdout:JSON.stringify({token:'test'})}),{databaseId:'db',fetchFn});
  assert.equal(result.enabled,false);assert.match(result.reason,/primary/i);
 }
});
test('rooms HEAD succeeds without a response body',async t=>{
 const {env}=requestFixture(t);const r=await worker.fetch(new Request('https://speed.example/api/rooms',{method:'HEAD'}),env);
 assert.equal(r.status,200);assert.equal(await r.text(),'');
});
test('cron exhaustion explains how to free account capacity',()=>assert.match(explainCloudflare('maximum number of cron triggers exceeded')?.why??'',/unused.*triggers|remove.*triggers/i));
