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
 // Wrangler's lookup of a consumer's queue, answered by Cloudflare for a token without Queues.
 const out='✘ [ERROR] A request to the Cloudflare API (/accounts/acc1/queues?page=1&name=studio-background) failed.\n\n  Authentication error [code: 10000]\n\nIf you think this is a bug, please open an issue at: https://github.com/cloudflare/workers-sdk/issues/new/choose\n';
 assert.match(explainCloudflare(out)?.why??'',/Queues.*Edit/);
});

import {wranglerError} from '../lib/cloudflare.mjs';
test('deploy reports the real consumer error above a long footer and redacts credentials',()=>{
 const out='Uploaded worker\n\u001b[31mX [ERROR] Queue handler is missing. [code: 11001]\u001b[0m\n'+
  'Authorization: Bearer '+ 'sensitive123'.repeat(5)+'\n'+
  'CLOUDFLARE_API_TOKEN='+ 'secret456'.repeat(5)+'\n'+
  'To learn more about this error, visit: https://developers.cloudflare.com/queues/configuration/javascript-apis/#consumer\n'+
  '\n'.repeat(8)+'Successful trigger changes were not rolled back.\n';
 const result=wranglerError(out);
 assert.match(result,/Queue handler is missing.*11001/);
 assert.match(result,/Successful trigger changes/);
 assert.doesNotMatch(result,/sensitive123|secret456|\u001b/);
 assert.equal(wranglerError('plain failure without an ERROR marker'),'plain failure without an ERROR marker');
});
