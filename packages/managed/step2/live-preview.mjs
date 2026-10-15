import {readFileSync,writeFileSync} from 'node:fs';
import {api,token,state,save,intent,local,account} from './operator.mjs';
import {assertArtifact} from './policy.mjs';import {cloudflare,migrateFresh,upload,digest} from './provider.mjs';
const artifact=JSON.parse(readFileSync(local+'artifact.json'));
const job={commit:state.sourceCommit,toolkit:'0.51.8',node:'v24.20.0',lockDigest:digest(readFileSync(local+'source/package-lock.json'))};assertArtifact(artifact,job);
state.tenant.lockDigest=job.lockDigest;save();
const environment='preview',name=state.tenant[environment].script,path='workers/dispatch/namespaces/homie-managed-s2/scripts/'+name;
if(!state.resources.some(r=>r.name===name))intent(name,path,path+'/settings');
const provider=cloudflare(account,token());
if(!state.previewMigrated){await migrateFresh(provider,state.tenant,environment,artifact);state.previewMigrated=true;save();}
const receipt=await upload(provider,state.tenant,environment,artifact);writeFileSync(local+'preview-upload.json',JSON.stringify(receipt,null,2));state.resources.find(r=>r.name===name).status='created';save();console.log({uploaded:receipt.uploaded,bindings:receipt.bindings});
