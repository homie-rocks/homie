import {api,deploy} from './cloud.mjs';import {readFileSync,writeFileSync} from 'node:fs';
const dir=process.argv[2],out=process.argv[3],base='https://hm-test-dispatch.ryan-d2f.workers.dev';const secret=readFileSync(dir+'/operator-token','utf8');const evidence={};
async function op(path,body){const r=await fetch(base+'/__operator/'+path,{method:body?(path==='route'?'PUT':'POST'):'GET',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error(path+': '+r.status);return r.status===204?null:r.json();}
const save=()=>writeFileSync(out,JSON.stringify(evidence,null,2)+'\n');
evidence.routes=await op('routes');evidence.otherHasNoDO=(await api('workers/dispatch/namespaces/homie-managed-test/scripts/hm-test-other/bindings')).filter(b=>b.type==='durable_object_namespace');
evidence.http=[];for(const path of ['/probe/echo','/other/probe/echo','/otherness/probe/echo']){const r=await fetch(base+path);evidence.http.push({path,status:r.status,ray:r.headers.get('cf-ray')});}save();
// Infrastructure update exposes the persisted DLQ alert view; studio deploys do not redeploy this script.
deploy(dir+'/hm-test-inlet/dispatch.json');
await op('route',{tenant:'hm-test-missing',routes:[{hostname:new URL(base).hostname,prefix:'/missing'}],ticks:true});
const q=(await api('queues')).find(q=>q.queue_name==='hm-test-ticks');const body={script:'hm-test-missing',scheduledTime:Date.now(),cron:'* * * * *'};
evidence.injected={...body,at:new Date().toISOString()};await api(`queues/${q.queue_id}/messages`,'POST',{body,content_type:'json'});save();
for(let n=0;n<50;n++){await new Promise(r=>setTimeout(r,1000));const alerts=await op('alerts');if(alerts.some(x=>x.script==='hm-test-missing')){evidence.alerts=alerts;break}}
evidence.queue=await api(`queues/${q.queue_id}`);const dlq=(await api('queues')).find(q=>q.queue_name==='hm-test-ticks-dlq');evidence.dlq=await api(`queues/${dlq.queue_id}`);await op('kill',{tenant:'hm-test-missing'});save();console.log({alerts:evidence.alerts?.length,routes:evidence.routes,otherHasNoDO:evidence.otherHasNoDO});
