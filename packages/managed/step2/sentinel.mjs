import {api,intent,state,save,local} from './operator.mjs';import {writeFileSync} from 'node:fs';
const name='hm-s2-sentinel',path='workers/dispatch/namespaces/homie-managed-s2/scripts/'+name;
if(process.argv[2]==='create'){
 if(await api(path+'/settings')!==null)throw new Error('Sentinel exists');intent(name,path,path+'/settings');
 const form=new FormData();form.set('metadata',new Blob([JSON.stringify({main_module:'sentinel.mjs',compatibility_date:'2026-10-15',bindings:[]})],{type:'application/json'}));form.set('sentinel.mjs',new Blob(['export default {fetch(){return new Response("unchanged step 2 sentinel")}}'],{type:'application/javascript+module'}),'sentinel.mjs');
 const r=await api(path,'PUT',form);state.sentinel={deploymentId:r.deployment_id,etag:r.etag};state.resources.at(-1).status='created';save();console.log(state.sentinel);
}else{
 const scripts=await api('workers/dispatch/namespaces/homie-managed-s2/scripts');const s=scripts.find(s=>s.id===name);
 const settings=await api(path+'/settings');
 if(!s||s.etag!==state.sentinel.etag||settings.compatibility_date!=='2026-10-15'||settings.bindings.length||settings.compatibility_flags.length)throw new Error('Other tenant changed');
 // The WFP list response leaves deployment_id empty. Compare the actual code
 // ETag and fixed settings; retain the initial upload ID without inventing one.
 writeFileSync(local+'sentinel-proof.json',JSON.stringify({unchanged:true,...state.sentinel,listDeploymentId:s.deployment_id||null,contentEtagMatches:true,settings,modifiedOn:s.modified_on},null,2));console.log({unchanged:true});
}
