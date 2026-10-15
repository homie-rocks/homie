import {spawnSync} from 'node:child_process';
import {wrangler} from './cloud.mjs';
let token;
export async function graphql(query,variables={}){
 if(!token){const r=spawnSync(process.execPath,[wrangler,'auth','token','--json'],{encoding:'utf8'});if(r.status!==0)throw Error('Auth failed');token=JSON.parse(r.stdout).token;}
 const r=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(30000)});
 return r.json();
}
