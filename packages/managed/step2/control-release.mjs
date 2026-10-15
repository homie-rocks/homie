/** Authenticated operator action. The server rechecks stage and expected production. */
import {readFileSync,writeFileSync} from 'node:fs';import {local,state,save,intent} from './operator.mjs';
const [action,commit,expected]=process.argv.slice(2);if(!['promote','rollback'].includes(action)||!/^[a-f0-9]{40}$/.test(commit??''))throw new Error('promote|rollback COMMIT [EXPECTED]');
if(action==='promote'&&!state.resources.some(r=>r.path==='workers/dispatch/namespaces/homie-managed-s2/scripts/'+state.tenant.production.script)){const name=state.tenant.production.script,path='workers/dispatch/namespaces/homie-managed-s2/scripts/'+name;intent(name,path,path+'/settings');}
const r=await fetch('https://hm-s2-pipeline.ryan-d2f.workers.dev/'+action,{method:'POST',headers:{authorization:'Bearer '+readFileSync(local+'operator-key','utf8'),'content-type':'application/json'},body:JSON.stringify({commit,expected}),signal:AbortSignal.timeout(300000)});
const value=await r.json();writeFileSync(local+action+'-'+commit+'.json',JSON.stringify({status:r.status,...value},null,2));if(!r.ok)throw new Error(JSON.stringify(value));
state.resources.find(r=>r.path==='workers/dispatch/namespaces/homie-managed-s2/scripts/'+state.tenant.production.script).status='created';save();console.log({action,commit,workerVersionId:value.workerVersionId,providerDeploymentId:value.providerDeploymentId});
