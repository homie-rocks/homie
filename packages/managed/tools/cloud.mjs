import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
export const account='d2f6f976cecad2fe130976fe36916cdb';
export const wrangler=resolve('node_modules/wrangler/bin/wrangler.js');
let token;
export async function api(path,method='GET',body){
 if(!token){const a=spawnSync(process.execPath,[wrangler,'auth','token','--json'],{encoding:'utf8'});if(a.status!==0)throw Error('Authentication failed');token=JSON.parse(a.stdout).token;}
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{method,headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 const j=await response.json();if(response.status===404)return null;
 if(!response.ok||!j.success)throw Error(`${method} ${path}: ${response.status} ${JSON.stringify(j.errors)}`);return j.result;
}
export function deploy(config){const r=spawnSync(process.execPath,[wrangler,'deploy','--config',config],{encoding:'utf8',env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'}});if(r.status!==0)throw Error(r.stderr+'\n'+r.stdout);return r.stdout;}
