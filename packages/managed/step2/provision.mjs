import {writeFileSync} from 'node:fs';
import {api,intent,state,save,run,local,account,here} from './operator.mjs';
const ns='homie-managed-s2';
if(!state.resources.some(r=>r.name===ns)){if(await api('workers/dispatch/namespaces/'+ns)!==null)throw new Error('Namespace already exists');intent(ns,'workers/dispatch/namespaces/'+ns);await api('workers/dispatch/namespaces','POST',{name:ns,trusted_workers:false});state.resources.at(-1).status='created';save();}
state.tenant??={id:'hm-s2-little-inlet',namespace:'hm-s2-source',repo:'hm-s2-little-inlet',compatibilityDate:'2026-10-01',toolkit:'0.51.8',node:'v24.20.0'};
for(const environment of ['preview','production']){
 if(state.tenant[environment])continue;
 const name='hm-s2-inlet-'+environment;
 const existing=await api('d1/database?name='+name);if(existing?.length)throw new Error('Database already exists');
 intent(name,'pending-d1-'+name);const db=await api('d1/database','POST',{name});const entry=state.resources.at(-1);entry.path=entry.readPath='d1/database/'+db.uuid;entry.status='created';
 state.tenant[environment]={script:name,databaseId:db.uuid};save();
}
for(const environment of ['preview','production']){
const name=environment==='preview'?'hm-s2-dispatch':'hm-s2-live';
const config={name,main:here+'dispatch.mjs',compatibility_date:'2026-10-15',workers_dev:true,observability:{enabled:true},dispatch_namespaces:[{binding:'STUDIOS',namespace:ns}],vars:{SCRIPT:state.tenant[environment].script,HOST:name+'.ryan-d2f.workers.dev'}};
writeFileSync(local+name+'.json',JSON.stringify(config,null,2));
if(!state.resources.some(r=>r.name===config.name))intent(config.name,'workers/scripts/'+config.name,'workers/scripts/'+config.name+'/settings');
console.log(run(['deploy','--config',local+name+'.json']));
state.resources.find(r=>r.name===config.name).status='created';state.tenant[environment].url='https://'+config.vars.HOST;save();
}
