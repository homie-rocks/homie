import {createHash} from 'node:crypto';
import {bindingManifest} from './policy.mjs';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function cloudflare(account,credential){
 return async(path,method='GET',body,override)=>{
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{method,headers:{authorization:'Bearer '+(override??credential),...(!(body instanceof FormData)?{'content-type':'application/json'}:{})},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
  if(r.status===404)return null;
  const j=await r.json();if(!r.ok||!j.success)throw new Error(`Provider ${method} ${path}: ${r.status} ${JSON.stringify(j.errors)}`);return j.result;
 };
}
const mime=path=>({html:'text/html',js:'application/javascript',mjs:'application/javascript',json:'application/json',css:'text/css',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',webp:'image/webp',mp3:'audio/mpeg',mp4:'video/mp4',woff2:'font/woff2'}[path.split('.').at(-1)]??'application/octet-stream');
export function migrationManifest(artifact){return Object.entries(artifact.files).filter(([p])=>p.startsWith('migrations/')&&p.endsWith('.sql')).sort(([a],[b])=>a.localeCompare(b)).map(([name,b])=>({name,digest:digest(Buffer.from(b,'base64'))}));}
export async function migrateFresh(api,tenant,environment,artifact){
 const db=bindingManifest(tenant,environment).bindings.find(b=>b.name==='DB').id;
 for(const m of migrationManifest(artifact)){
  const sql=Buffer.from(artifact.files[m.name],'base64').toString();
  await api(`d1/database/${db}/query`,'POST',{sql});
 }
}
export async function upload(api,tenant,environment,artifact){
 const manifest=bindingManifest(tenant,environment);
 const path=`workers/dispatch/namespaces/${manifest.namespace}/scripts/${manifest.script}`;
 const assets={},byHash={};
 for(const [p,b] of Object.entries(artifact.files).filter(([p])=>p.startsWith('assets/'))){const bytes=Buffer.from(b,'base64'),hash=digest(bytes).slice(0,32);assets['/'+p.slice(7)]={hash,size:bytes.length};byHash[hash]={b,path:p};}
 const session=await api(path+'/assets-upload-session','POST',{manifest:assets});let completion=session.jwt;
 for(const bucket of session.buckets){const form=new FormData();for(const hash of bucket){const f=byHash[hash];if(!f)throw new Error('Unexpected upload hash');form.set(hash,new Blob([f.b],{type:mime(f.path)}),hash);}const result=await api('workers/assets/upload?base64=true','POST',form,session.jwt);if(result.jwt)completion=result.jwt;}
 const {script,namespace,...metadata}=manifest;
 const form=new FormData();form.set('metadata',new Blob([JSON.stringify({...metadata,main_module:'worker.js',assets:{jwt:completion,config:{run_worker_first:true}},observability:{enabled:true},tags:['hm-s2',tenant.id,environment]})],{type:'application/json'}));
 for(const [p,b] of Object.entries(artifact.files).filter(([p])=>p.startsWith('modules/'))){if(!/\.(js|mjs)$/.test(p))throw new Error('Unexpected Worker module');const name=p.slice(8);form.set(name,new Blob([Buffer.from(b,'base64')],{type:'application/javascript+module'}),name);}
 const uploaded=await api(path,'PUT',form);
 const bindings=await api(path+'/bindings');
 return {uploaded,bindings,manifest,migrations:migrationManifest(artifact)};
}
