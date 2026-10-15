import {readFileSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {wrangler,api,account} from './cloud.mjs';
import {graphql} from './graphql.mjs';
import {tenantMetrics} from '../analytics.mjs';
const [dir,out]=process.argv.slice(2),base='https://hm-test-dispatch.ryan-d2f.workers.dev';
const evidence={started:new Date().toISOString(),probes:[],traces:[]};
const tail=spawn(process.execPath,[wrangler,'tail','hm-test-outbound','--format','json'],{stdio:['ignore','pipe','pipe']});
let raw='';tail.stdout.on('data',b=>raw+=b);tail.stderr.on('data',()=>{});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await sleep(4000);
 for(const kind of ['worker-fetch','owner/fetch'])for(const path of ['/__operator/routes','/__operator/alerts','/__operator/route','/__operator/kill']){
  const target=base+path;const at=Date.now();const r=await fetch(base+'/probe/'+kind+'?target='+encodeURIComponent(target));
  evidence.probes.push({kind,target:path,status:r.status,body:await r.text(),ms:Date.now()-at,ray:r.headers.get('cf-ray')});
 }
 for(const kind of ['worker-fetch','owner/fetch']){
  const r=await fetch(base+'/probe/'+kind+'?target='+encodeURIComponent(base+'/other/probe/echo'));
  evidence.probes.push({kind,target:'other-tenant-echo',status:r.status,body:await r.text()});
 }
 await sleep(5000);
 // Tail consumer logs deliberately contain only provider attribution and counts.
 const blocks=raw.split(/\n(?=\{)/);for(const block of blocks){try{const event=JSON.parse(block);for(const log of event.logs??[])for(const line of log.message??[]){try{const value=JSON.parse(line);if(value.event==='tenant-trace')evidence.traces.push(value)}catch{}}}catch{}}
 const settings=await api('workers/dispatch/namespaces/homie-managed-test/scripts/hm-test-inlet/settings');
 const ids=settings.bindings.filter(b=>b.type==='durable_object_namespace').map(b=>b.namespace_id);
 evidence.identity={script:'hm-test-inlet',namespaceIds:ids,limits:settings.limits,observability:settings.observability,tailConsumers:settings.tail_consumers};
 const query=tenantMetrics({accountId:account,script:'hm-test-inlet',namespaceIds:ids,start:evidence.started,end:new Date().toISOString()});
 evidence.analyticsQuery=query;evidence.analytics=await graphql(query.query,query.variables);
}finally{tail.kill('SIGTERM');writeFileSync(out,JSON.stringify(evidence,null,2)+'\n');}
console.log({probes:evidence.probes,traces:evidence.traces.length,analytics:evidence.analytics});
