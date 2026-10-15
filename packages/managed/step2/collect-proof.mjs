/** Copy only explicit, non-secret receipts. Never copy .local wholesale. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {local,here,state,api} from './operator.mjs';
const proof=here+'proof/';mkdirSync(proof,{recursive:true});
for(const name of ['container-probe.json','share-proof.json','expiry-proof.json','synthetic.json','preview-upload.json','continuity-before.json','continuity-after.json','sentinel-proof.json','failed-production-proof.json'])if(existsSync(local+name))writeFileSync(proof+name,readFileSync(local+name));
const workflows=[];
for(const push of state.pushes??[]){const result=await api('workflows/hm-s2-release/instances/'+state.tenant.id+'-'+push.commit);if(result)workflows.push({variant:push.variant,commit:push.commit,...result});}
if(workflows.length)writeFileSync(proof+'workflows.json',JSON.stringify(workflows,null,2)+'\n');
if(!state.finalAbsence){
 const key=readFileSync(local+'operator-key','utf8');
 for(const path of ['status','evidence']){const r=await fetch('https://hm-s2-pipeline.ryan-d2f.workers.dev/'+path,{headers:{authorization:'Bearer '+key}});if(r.ok)writeFileSync(proof+path+'.json',JSON.stringify(await r.json(),null,2)+'\n');}
}
writeFileSync(proof+'resources.json',JSON.stringify(state,null,2)+'\n');
// Fail rather than accidentally commit a capability-bearing receipt.
for(const name of (await import('node:fs')).readdirSync(proof))if(/art_v1_[a-f0-9]{40}|Bearer [A-Za-z0-9_-]{25,}|"(?:DEPLOY_TOKEN|OPERATOR_KEY|BUILD_KEY|RUN_KEY)"\s*:/.test(readFileSync(proof+name,'utf8')))throw new Error('Credential-looking proof: '+name);
console.log('Saved explicit receipts to packages/managed/step2/proof');
