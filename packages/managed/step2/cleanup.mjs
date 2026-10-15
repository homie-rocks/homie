/** Delete only resources recorded by this run; verify every deletion with a read. */
import {api,state,save,run} from './operator.mjs';
function allowed(r){if(!/^hm-s2-[a-z0-9-]+$/.test(r.name)&&r.name!=='homie-managed-s2')throw new Error('Unowned resource');}
async function remove(r){allowed(r);if(r.path.startsWith('pending-'))throw new Error('Unresolved creation intent: '+r.name);const before=await api(r.readPath);if(before!==null)await api(r.path+(r.path.startsWith('workers/scripts/')||r.path.includes('/scripts/')?'?force=true':''),'DELETE');if(await api(r.readPath)!==null)throw new Error('Resource remains: '+r.name);state.receipts.push({name:r.name,path:r.path,existed:before!==null,result:before===null?'already absent':'deleted',absent:true,at:new Date().toISOString()});r.status='absent';save();console.log(r.name+': absence verified');}
// Inventory durable namespaces before deleting scripts can cascade.
state.durableObjects??=[];
for(const r of state.resources.filter(r=>r.path.startsWith('workers/scripts/')||r.path.includes('/scripts/'))){const settings=await api(r.readPath);for(const b of settings?.bindings??[])if(b.type==='durable_object_namespace'&&!state.durableObjects.some(d=>d.id===b.namespace_id)){state.durableObjects.push({id:b.namespace_id,name:r.name+'-'+b.class_name.toLowerCase(),existed:await api('workers/durable_objects/namespaces/'+b.namespace_id)!==null});save();}}
for(const r of state.resources.filter(r=>r.path.startsWith('event_subscriptions/')))await remove(r);
// Terminate only this test Workflow's instances, then detach the Queue consumer.
for(const push of state.pushes??[]){const path='workflows/hm-s2-release/instances/'+state.tenant.id+'-'+push.commit;const instance=await api(path);if(instance&&!['complete','errored','terminated'].includes(instance.status))await api(path+'/status','PATCH',{status:'terminate'});}
if(state.queueId){const q=await api('queues/'+state.queueId);for(const c of q?.consumers??[]){if(c.script!=='hm-s2-pipeline')throw new Error('Unrecorded Queue consumer');await api(`queues/${state.queueId}/consumers/${c.consumer_id}`,'DELETE');}}
// The authenticated trusted service deletes its R2 objects through its binding.
const bucket=state.resources.find(r=>r.name==='hm-s2-releases');
if(bucket&&await api(bucket.readPath)!==null){
 const {readFileSync}=await import('node:fs');const {local}=await import('./operator.mjs');
 const r=await fetch('https://hm-s2-pipeline.ryan-d2f.workers.dev/cleanup-artifacts',{method:'POST',headers:{authorization:'Bearer '+readFileSync(local+'operator-key','utf8')}});if(!r.ok)throw new Error('Artifact cleanup failed: '+r.status);state.artifactCleanup=await r.json();save();
}
for(const r of state.resources.filter(r=>r.path.startsWith('workflows/')))await remove(r);
const containers=JSON.parse(run(['containers','list','--json']));
for(const c of containers.filter(c=>c.name==='hm-s2-build-vm')){if(!state.durableObjects.some(d=>d.id===c.id))throw new Error('Unrecorded container');console.log(run(['containers','delete',c.id]));if(JSON.parse(run(['containers','list','--json'])).some(x=>x.id===c.id))throw new Error('Container remains');state.receipts.push({name:c.name,id:c.id,existed:true,result:'deleted',absent:true});save();}
for(const r of [...state.resources].reverse().filter(r=>r.path.startsWith('workers/scripts/')||r.path.includes('/scripts/')))await remove(r);
for(const d of state.durableObjects){const r={name:d.name,path:'workers/durable_objects/namespaces/'+d.id,readPath:'workers/durable_objects/namespaces/'+d.id};await remove(r);}
for(const prefix of ['workers/dispatch/namespaces/','queues/','d1/database/','r2/buckets/','artifacts/namespaces/'])for(const r of [...state.resources].reverse().filter(r=>r.path.startsWith(prefix)&&r.status!=='absent'))await remove(r);
for(const r of state.resources){if(await api(r.readPath)!==null)throw new Error('Final absence failed: '+r.name);}
state.finalAbsence={verified:true,at:new Date().toISOString(),resources:state.resources.length,durableNamespaces:state.durableObjects.length};save();console.log(state.finalAbsence);
