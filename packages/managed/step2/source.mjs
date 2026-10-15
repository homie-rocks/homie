/** Repo management is trusted; Git receives repo-only capabilities via environment. */
import {spawnSync} from 'node:child_process';
import {mkdirSync,cpSync,readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {api,local,state,save,intent,account} from './operator.mjs';
export const namespace='hm-s2-source',repo='hm-s2-little-inlet';
const base=`artifacts/namespaces/${namespace}`;
export function git(args,{cwd,token,allowFailure=false}={}){
 const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_COUNT:token?'2':'1',GIT_CONFIG_KEY_0:'core.hooksPath',GIT_CONFIG_VALUE_0:'/dev/null',...(token?{GIT_CONFIG_KEY_1:'http.extraHeader',GIT_CONFIG_VALUE_1:'Authorization: Bearer '+token}:{})};
 const r=spawnSync('git',args,{cwd,env,encoding:'utf8',maxBuffer:32*1024*1024});
 if(r.status!==0&&!allowFailure)throw new Error('Git operation failed: '+args[0]+' '+r.stderr.replaceAll(token??'UNUSED','[REDACTED]'));
 return {status:r.status,stdout:r.stdout,stderr:r.stderr};
}
export async function share(ttl=3600){
 if(!Number.isInteger(ttl)||ttl<60||ttl>3600)throw new Error('Share expiry must be 60–3600 seconds');
 const t=await api(base+'/tokens','POST',{repo,scope:'read',ttl});
 state.tokens??=[];state.tokens.push({id:t.id,scope:t.scope,expiresAt:t.expires_at});save();return t;
}
export async function revoke(id){if(!state.tokens?.some(t=>t.id===id))throw new Error('Unrecorded token');await api(base+'/tokens/'+id,'DELETE');}
export async function importExample(){
 if(await api(base)!==null)throw new Error('Source namespace already exists');
 intent(namespace,base);await api('artifacts/namespaces','POST',{namespace});state.resources.at(-1).status='created';save();
 intent(repo,base+'/repos/'+repo);const created=await api(base+'/repos','POST',{name:repo,default_branch:'main'});state.resources.at(-1).status='created';state.remote=created.remote;save();
 const source='/Users/ryan/Studios/examples/little-inlet',dest=local+'source';mkdirSync(dest);
 const files=git(['ls-files','-z'],{cwd:source}).stdout.split('\0').filter(Boolean);
 for(const file of files){if(file.startsWith('/')||file.split('/').includes('..')||/(^|\/)\.env|\.dev.vars/.test(file))throw new Error('Unsafe source path');const from=join(source,file);if(!lstatSync(from).isFile())throw new Error('Only ordinary files accepted');mkdirSync(dirname(join(dest,file)),{recursive:true});cpSync(from,join(dest,file),{recursive:false});}
 git(['init','-b','main'],{cwd:dest});git(['add','.'],{cwd:dest});git(['-c','user.name=Ryan Campbell','-c','user.email=ryan@ryancampbell.com','commit','-s','-m','Read-only copy of Little Inlet for managed step 2'],{cwd:dest});
 git(['push',created.remote,'HEAD:main'],{cwd:dest,token:created.token});
 state.sourceCommit=git(['rev-parse','HEAD'],{cwd:dest}).stdout.trim();save();
 const tokens=await api(base+`/repos/${repo}/tokens`);for(const t of tokens)await api(base+'/tokens/'+t.id,'DELETE');
 return {commit:state.sourceCommit,files:files.length};
}
if(process.argv[2]==='import')console.log(await importExample());
if(process.argv[2]==='share-proof'){
 const t=await share(60);const checkout=local+'share';
 const clone=git(['clone',state.remote,checkout],{token:t.plaintext});
 const push=git(['push',state.remote,'HEAD:refs/heads/share-must-fail'],{cwd:checkout,token:t.plaintext,allowFailure:true});
 await revoke(t.id);const after=git(['ls-remote',state.remote],{token:t.plaintext,allowFailure:true});
 const proof={scope:t.scope,expiresAt:t.expires_at,clone:clone.status,push:push.status,revokedRead:after.status};
 if(proof.clone!==0||proof.push===0||proof.revokedRead===0)throw new Error('Share boundary failed');
 writeFileSync(local+'share-proof.json',JSON.stringify(proof,null,2));console.log(proof);
}
