import {authorized} from './auth.mjs';
import {WorkflowEntrypoint,DurableObject} from 'cloudflare:workers';
import {gunzipSync} from 'node:zlib';
import {cloudflare,digest,upload,health,migrationManifest,migrateFresh} from './provider.mjs';
import {canonical,resolvePush,assertArtifact,assertPromotion,assertRollback} from './policy.mjs';
import {synthetic} from './synthetic.mjs';
const decode=archive=>JSON.parse(gunzipSync(Buffer.from(archive,'base64'),{maxOutputLength:60*1024*1024}));
function provider(env){return cloudflare(env.REGISTRY.account,env.DEPLOY_TOKEN);}
async function remote(env,tenant,commit,mode){
 const api=provider(env),base=`artifacts/namespaces/${tenant.namespace}`;
 const repo=await api(base+'/repos/'+tenant.repo);
 const t=await api(base+'/tokens','POST',{repo:tenant.repo,scope:'read',ttl:900});
 let primary;
 try{
  const job={remote:repo.remote,readToken:t.plaintext,commit,toolkit:tenant.toolkit,node:tenant.node,lockDigest:tenant.lockDigest,...(mode==='check'?{mode,previewURL:tenant.preview.url}:{})};
  const r=await env.BUILDER.fetch('https://builder/build',{method:'POST',headers:{authorization:'Bearer '+env.BUILD_KEY,'content-type':'application/json'},body:JSON.stringify(job)});
  const result=await r.json();if(!r.ok)throw new Error(result.error??'Remote build failed');
  const artifact=decode(result.archive);
  if(mode!=='check')assertArtifact(artifact,job);
  else if(!artifact.studio||artifact.commit!==commit)throw new Error('Studio checks failed');
  return {artifact,archive:result.archive};
 }catch(error){primary=error;throw error;}finally{try{await api(base+'/tokens/'+t.id,'DELETE');}catch(error){throw new Error((primary?primary.message+'; ':'')+'Read-token revocation failed (TTL 900s): '+error.message);}}
}
export class Pipeline extends WorkflowEntrypoint {
 async run(event,step){
  const {tenant,commit}=resolvePush(event.payload,this.env.REGISTRY);
  const ledger=this.env.RELEASES.getByName(tenant.id);
  await step.do('claim tenant preview',{retries:{limit:60,delay:'30 seconds',backoff:'constant'},timeout:'1 minute'},()=>ledger.begin(commit));
  try{
   const sealed=await step.do('immutable remote build',{retries:{limit:0,delay:'1 second'},timeout:'12 minutes'},async()=>{
    const {artifact,archive}=await remote(this.env,tenant,commit,'build');
    const hash=digest(Buffer.from(archive,'base64'));
    const migrations=migrationManifest(artifact);
    if(canonical(migrations)!==canonical(tenant.migrations))throw new Error('Migration changes require registry review');
    await this.env.ARTIFACTS.put(hash,Buffer.from(archive,'base64'));
    return {hash,migrations,credentialProbe:artifact.credentialProbe??null};
   });
   const preview=await step.do('deploy isolated preview',{retries:{limit:0,delay:'1 second'},timeout:'5 minutes'},async()=>{
    const object=await this.env.ARTIFACTS.get(sealed.hash);if(!object)throw new Error('Missing sealed artifact');
    const bytes=Buffer.from(await object.arrayBuffer());if(digest(bytes)!==sealed.hash)throw new Error('Artifact digest mismatch');
    const artifact=decode(bytes.toString('base64'));
    return upload(provider(this.env),tenant,'preview',artifact);
   });
   const studio=await step.do('studio checks in fresh remote VM',{retries:{limit:0,delay:'1 second'},timeout:'12 minutes'},async()=>{
    const {artifact}=await remote(this.env,tenant,commit,'check');
    await this.env.ARTIFACTS.put(sealed.hash+'.checks',JSON.stringify(artifact));return {studio:artifact.studio};
   });
   const flow=await step.do('synthetic booking and MCP',{retries:{limit:0,delay:'1 second'}},async()=>{
    const slot='hm-s2-'+commit.slice(0,16);
    await provider(this.env)(`d1/database/${tenant.preview.databaseId}/query`,'POST',{sql:'INSERT OR IGNORE INTO app_records(app,collection,id,value,version,updated_at) VALUES(?1,?2,?3,?4,1,0)',params:['gathering','shifts',slot,JSON.stringify({label:'Managed synthetic booking',capacity:10})]});
    return synthetic(tenant.preview.url,slot);
   });
   const release={tenant:tenant.id,commit,toolkit:tenant.toolkit,node:tenant.node,lockDigest:tenant.lockDigest,compatibilityDate:tenant.compatibilityDate,artifactDigest:sealed.hash,migrations:sealed.migrations,stage:'verified',checks:{studio:studio.studio,synthetic:flow.synthetic,mcp:flow.mcp,credentialProbe:sealed.credentialProbe??null},previewDeploymentId:preview.uploaded.deployment_id,previewBindings:preview.bindings,schemaEpoch:tenant.schemaEpoch};
   await step.do('record verified release',()=>ledger.verified(release));return release;
  }catch(error){await step.do('record failure',()=>ledger.failed(commit,error.message));throw error;}
 }
}
export class Releases extends DurableObject {
 async begin(commit){await this.ctx.storage.transaction(async s=>{const active=await s.get('active');if(active&&active!==commit)throw new Error('Tenant preview is busy');await s.put('active',commit);await s.put('run:'+commit,{stage:'building',commit,at:Date.now()});});}
 async failed(commit,error){await this.ctx.storage.put('run:'+commit,{stage:'failed',commit,error,at:Date.now()});if(await this.ctx.storage.get('active')===commit)await this.ctx.storage.delete('active');}
 async verified(release){if(await this.ctx.storage.get('active')!==release.commit)throw new Error('Preview lease changed');await this.ctx.storage.put('run:'+release.commit,release);await this.ctx.storage.delete('active');}
 async status(){return Object.fromEntries(await this.ctx.storage.list());}
 async promote(commit,expected,actor){
  const tenant=this.env.REGISTRY.tenants.find(t=>t.id===this.env.TENANT_ID);if(!tenant)throw new Error('Tenant registry missing');
  const current=await this.ctx.storage.get('production'),release=await this.ctx.storage.get('run:'+commit);
  if(!release)throw new Error('Release not found');release.approvedBy=actor;assertPromotion(release,current,expected);
  await this.lock(expected);
  try{
   const artifact=await this.artifact(release.artifactDigest);
   const api=provider(this.env);
   // Bootstrap is limited to this experiment's empty, dedicated database. Later
   // releases must have the exact operator-approved migration manifest.
   if(!current&&!await this.ctx.storage.get('productionMigrated')){await migrateFresh(api,tenant,'production',artifact);await this.ctx.storage.put('productionMigrated',true);}
   const receipt=await upload(api,tenant,'production',artifact);
   let healthResult;
   try{healthResult=await health(tenant.production.url,commit);}catch(error){
    if(current){const restored=await upload(api,tenant,'production',await this.artifact(current.artifactDigest));await health(tenant.production.url,current.commit);await this.ctx.storage.put('production',{...current,providerDeploymentId:restored.uploaded.deployment_id,recoveredFrom:commit});await this.ctx.storage.delete('mutation');}
    throw error;
   }
   const manifest={...release,stage:'live',health:healthResult,bindings:receipt.bindings,bindingManifest:receipt.manifest,workerVersionId:null,providerDeploymentId:receipt.uploaded.deployment_id,at:Date.now(),previous:current?.commit??null};
   await this.ctx.storage.put('release:'+commit,manifest);await this.ctx.storage.put('production',manifest);await this.ctx.storage.delete('mutation');return manifest;
  }catch(error){await this.ctx.storage.put('incident',{action:'promotion',error:error.message,at:Date.now()});throw error;}
 }
 async rollback(targetCommit,expected){
  const current=await this.ctx.storage.get('production'),target=await this.ctx.storage.get('release:'+targetCommit);
  if(current?.commit!==expected)throw new Error('Production changed');const policy=assertRollback(target,current);await this.lock(expected);
  const tenant=this.env.REGISTRY.tenants.find(t=>t.id===target.tenant);
  try{
   const receipt=await upload(provider(this.env),tenant,'production',await this.artifact(target.artifactDigest));
   if(canonical(receipt.bindings)!==canonical(target.bindings))throw new Error('Rollback identity changed');
   await health(tenant.production.url,targetCommit);
   const result={...target,workerVersionId:null,providerDeploymentId:receipt.uploaded.deployment_id,rollbackOf:current.commit,restoredFromDeploymentId:target.providerDeploymentId,rollbackMode:'reupload-sealed-bundle',...policy,at:Date.now()};
   await this.ctx.storage.put('production',result);await this.ctx.storage.put('rollback:'+Date.now(),result);await this.ctx.storage.delete('mutation');return result;
  }catch(error){await this.ctx.storage.put('incident',{action:'rollback',error:error.message,at:Date.now()});throw error;}
 }
 async artifact(hash){const o=await this.env.ARTIFACTS.get(hash);if(!o)throw new Error('Missing artifact');const b=Buffer.from(await o.arrayBuffer());if(digest(b)!==hash)throw new Error('Digest mismatch');return decode(b.toString('base64'));}
 async lock(expected){await this.ctx.storage.transaction(async s=>{if((await s.get('production'))?.commit!==expected)throw new Error('Production changed since review');if(await s.get('mutation'))throw new Error('Unresolved deployment: reconcile before retry');await s.put('mutation',{at:Date.now()});});}
}
export default {
 async queue(batch,env){for(const message of batch.messages){try{const {tenant,commit}=resolvePush(message.body,env.REGISTRY);const id=tenant.id+'-'+commit;try{await env.PIPELINE.create({id,params:message.body});}catch(error){try{await env.PIPELINE.get(id).status();}catch{throw error;}}message.ack();}catch(error){console.error('Push rejected or workflow create failed',error.message);message.retry({delaySeconds:60});}}},
 async fetch(request,env){
  if(!authorized(request.headers.get('authorization'),env.OPERATOR_KEY))return new Response('Not found',{status:404});
  const ledger=env.RELEASES.getByName(env.TENANT_ID),path=new URL(request.url).pathname;
  try{
   if(path==='/status'&&request.method==='GET')return Response.json(await ledger.status());
   if(path==='/evidence'&&request.method==='GET'){
    const checks={};let cursor;
    do {const page=await env.ARTIFACTS.list({cursor});for(const item of page.objects)if(item.key.endsWith('.checks')){const o=await env.ARTIFACTS.get(item.key);if(o.size>256*1024)throw new Error('Oversized check receipt');const check=await o.json();checks[check.commit]=check;}cursor=page.truncated?page.cursor:undefined;}while(cursor);
    return Response.json(checks);
   }
   if(request.method!=='POST')return new Response('Not found',{status:404});
   if(path==='/cleanup-artifacts'){
    if(env.REGISTRY.tenants.some(t=>!t.id.startsWith('hm-s2-')))throw new Error('Test registry required');
    let cursor,deleted=0;
    do {const page=await env.ARTIFACTS.list({cursor});if(page.objects.length){await env.ARTIFACTS.delete(page.objects.map(o=>o.key));deleted+=page.objects.length;}cursor=page.truncated?page.cursor:undefined;}while(cursor);
    const after=await env.ARTIFACTS.list();if(after.objects.length)throw new Error('Artifacts remain');return Response.json({deleted,empty:true});
   }
   const body=await request.json();
   if(path==='/promote')return Response.json(await ledger.promote(body.commit,body.expected,'Ryan Campbell'));
   if(path==='/rollback')return Response.json(await ledger.rollback(body.commit,body.expected));
   return new Response('Not found',{status:404});
  }catch(error){return Response.json({error:error.message},{status:409});}
 }
};
