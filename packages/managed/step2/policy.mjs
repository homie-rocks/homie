export function canonical(value){return JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);}
/** Pure policy. No repository-supplied resource identifiers enter deployment metadata. */
export function resolvePush(event,registry){
 if(event?.type!=='cf.artifacts.repo.pushed'||event.metadata?.accountId!==registry.account)throw new Error('Untrusted push envelope');
 const tenant=registry.tenants.find(t=>t.namespace===event.source?.namespace&&t.repo===event.source?.repoName);
 if(!tenant||event.payload?.ref!=='refs/heads/main'||!event.metadata?.eventSubscriptionId||(registry.subscriptionId&&event.metadata.eventSubscriptionId!==registry.subscriptionId))throw new Error('Unregistered push');
 const commit=event.payload.after;if(!/^[a-f0-9]{40}$/.test(commit)||/^0+$/.test(commit))throw new Error('Immutable commit required');
 if(tenant.preview?.url!=='https://hm-s2-dispatch.ryan-d2f.workers.dev'||tenant.production?.url!=='https://hm-s2-live.ryan-d2f.workers.dev')throw new Error('Registered test origins required');
 return {tenant,commit};
}
export function bindingManifest(tenant,environment){
 if(!['preview','production'].includes(environment))throw new Error('Invalid environment');
 const r=tenant[environment],other=tenant[environment==='preview'?'production':'preview'];
 if(!r||!other||r.script===other.script||r.databaseId===other.databaseId)throw new Error('Preview resources must be separate');
 if(!/^hm-s2-[a-z0-9-]+$/.test(r.script)||!/^[-a-f0-9]{36}$/.test(r.databaseId))throw new Error('Test registry resources required');
 return {script:r.script,namespace:'homie-managed-s2',compatibility_date:tenant.compatibilityDate,compatibility_flags:['nodejs_compat'],bindings:[
 {name:'DB',type:'d1',id:r.databaseId},
 {name:'ASSETS',type:'assets'},
 ...['Table','Lobby','Gate','Concentrator'].map(class_name=>({name:class_name.toUpperCase(),type:'durable_object_namespace',class_name})),
 {name:'HOMIE_CONCEPT',type:'plain_text',text:'1'},
 {name:'STUDIO_NAME',type:'plain_text',text:'Little Inlet — managed step 2 test'}],
 exports:Object.fromEntries(['Table','Lobby','Gate','Concentrator'].map(c=>[c,{type:'durable-object',storage:'sqlite'}]))};
}
export function assertArtifact(artifact,job){
 for(const k of ['commit','toolkit','node','lockDigest'])if(artifact[k]!==job[k])throw new Error('Artifact provenance mismatch: '+k);
 if(!artifact.checks?.build||!artifact.files?.['modules/worker.js'])throw new Error('Incomplete build');
 const entries=Object.entries(artifact.files);let bytes=0;
 if(entries.length>5000)throw new Error('Too many files');
 for(const [path,value] of entries){if(!/^(modules|assets|migrations)\/[A-Za-z0-9_./@+ ()-]+$/.test(path)||path.split('/').some(p=>p==='..'||p==='')||typeof value!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('Invalid artifact file');bytes+=value.length;if(bytes>56*1024*1024)throw new Error('Artifact too large');}
}
export function assertPromotion(release,current,expected){
 if(current?.commit!==expected)throw new Error('Production changed since review');
 if(release.stage!=='verified'||!release.checks?.studio||!release.checks?.synthetic)throw new Error('Preview checks required');
 if(!release.approvedBy)throw new Error('Pilot operator review required');
}
export function assertRollback(target,current){
 if(!target||!current||target.tenant!==current.tenant)throw new Error('Known tenant release required');
 if(canonical(target.bindings)!==canonical(current.bindings))throw new Error('Rollback would change resource identities');
 if(target.schemaEpoch!==current.schemaEpoch)throw new Error('Schema compatibility review required');
 return {migrations:'remain-applied',dataRestored:false};
}
