import {generateKeyPairSync,randomUUID} from 'node:crypto';
/** Key material travels only in memory and Wrangler stdin. Never return it or include command output in errors. */
export async function ensureStudioSigningKey(studio,w){
 if(!studio.mcp?.studios)return;
 const result=await w(['secret','list']);
 if(result.code!==0)throw new Error('Cannot inspect studio signing key bindings');
 let names;try{names=JSON.parse(result.stdout??result.out);}catch{throw new Error('Cannot inspect studio signing key bindings');}
 if(names.some(entry=>entry.name==='STUDIO_SIGNING_KEY'))return;
 const {privateKey}=generateKeyPairSync('ed25519');
 const key={...privateKey.export({format:'jwk'}),kid:randomUUID()};
 const saved=await w(['secret','bulk'],{input:JSON.stringify({STUDIO_SIGNING_KEY:JSON.stringify(key)})});
 if(saved.code!==0)throw new Error('Cannot provision studio signing key');
}
