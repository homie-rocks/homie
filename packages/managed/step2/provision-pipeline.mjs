import {writeFileSync,readFileSync,existsSync} from 'node:fs';import {randomBytes} from 'node:crypto';
import {api,intent,state,save,run,local,account,here,token} from './operator.mjs';
import {migrationManifest} from './provider.mjs';
const bucket='hm-s2-releases',queue='hm-s2-pushes',worker='hm-s2-pipeline',workflow='hm-s2-release';
if(!state.resources.some(r=>r.name===bucket)){if(await api('r2/buckets/'+bucket)!==null)throw new Error('Bucket exists');intent(bucket,'r2/buckets/'+bucket);await api('r2/buckets','POST',{name:bucket});state.resources.at(-1).status='created';save();}
if(!state.queueId){if((await api('queues')).some(q=>q.queue_name===queue))throw new Error('Queue exists');intent(queue,'pending-queue');const q=await api('queues','POST',{queue_name:queue});state.queueId=q.queue_id;state.resources.at(-1).path=state.resources.at(-1).readPath='queues/'+q.queue_id;state.resources.at(-1).status='created';save();}
const dlq='hm-s2-pushes-dlq';
if(!state.resources.some(r=>r.name===dlq)){
 if((await api('queues')).some(q=>q.queue_name===dlq))throw new Error('DLQ exists');
 intent(dlq,'pending-dlq');const q=await api('queues','POST',{queue_name:dlq});const r=state.resources.at(-1);r.path=r.readPath='queues/'+q.queue_id;r.status='created';save();
}
if(!state.tenant.preview.url||!state.tenant.production.url)throw new Error('Registry origins missing; finish dispatch provisioning');
state.tenant.migrations=migrationManifest(JSON.parse(readFileSync(local+'artifact.json')));state.tenant.schemaEpoch=1;save();
const config={name:worker,main:here+'pipeline.mjs',account_id:account,compatibility_date:'2026-10-15',compatibility_flags:['nodejs_compat'],workers_dev:true,observability:{enabled:true},limits:{cpu_ms:300000},
 services:[{binding:'BUILDER',service:'hm-s2-builder'}],r2_buckets:[{binding:'ARTIFACTS',bucket_name:bucket}],
 durable_objects:{bindings:[{name:'RELEASES',class_name:'Releases'}]},exports:{Releases:{type:'durable-object',storage:'sqlite'}},
 workflows:[{name:workflow,binding:'PIPELINE',class_name:'Pipeline'}],queues:{consumers:[{queue,max_batch_size:1,max_concurrency:1,max_retries:3,dead_letter_queue:dlq}]},
 vars:{TENANT_ID:state.tenant.id,REGISTRY:{account,subscriptionId:state.subscription,tenants:[state.tenant]}}};
writeFileSync(local+'pipeline.json',JSON.stringify(config,null,2));
if(!state.resources.some(r=>r.name===worker))intent(worker,'workers/scripts/'+worker,'workers/scripts/'+worker+'/settings');
if(!state.resources.some(r=>r.name===workflow))intent(workflow,'workflows/'+workflow);
console.log(run(['deploy','--config',local+'pipeline.json']));
for(const r of state.resources.filter(r=>[worker,workflow].includes(r.name)))r.status='created';save();
const key=existsSync(local+'operator-key')?readFileSync(local+'operator-key','utf8'):randomBytes(32).toString('hex');writeFileSync(local+'operator-key',key,{mode:0o600});
console.log(run(['secret','bulk','--config',local+'pipeline.json'],JSON.stringify({OPERATOR_KEY:key,BUILD_KEY:readFileSync(local+'run-key','utf8'),DEPLOY_TOKEN:token()})));
if(!state.subscription){
 intent('hm-s2-source-push','pending-subscription');const s=await api('event_subscriptions/subscriptions','POST',{name:'hm-s2-source-push',enabled:true,source:{type:'artifacts.repo',namespace:'hm-s2-source',repo_name:'hm-s2-little-inlet'},events:['pushed'],destination:{type:'queues.queue',queue_id:state.queueId}});
 state.subscription=s.id;state.resources.at(-1).path=state.resources.at(-1).readPath='event_subscriptions/subscriptions/'+s.id;state.resources.at(-1).status='created';save();console.log({subscription:s});config.vars.REGISTRY.subscriptionId=s.id;writeFileSync(local+'pipeline.json',JSON.stringify(config,null,2));console.log(run(['deploy','--config',local+'pipeline.json']));
}
