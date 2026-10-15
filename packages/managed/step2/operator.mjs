import {acquireStateLock,atomicState} from './state-lock.mjs';
/** Trusted test-resource operator. Never imports or executes studio code. */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const here=fileURLToPath(new URL('.',import.meta.url));
export const local=here+'.local/';
export const account='d2f6f976cecad2fe130976fe36916cdb';
export const wrangler=here+'node_modules/.bin/wrangler';
mkdirSync(local,{recursive:true});
// Serialize stateful harness commands. Read-only status/proof collection can run
// while a remote build is pending; mutations may not overwrite another snapshot.
const readOnly=/\/(status|collect-proof|scenario)\.mjs$/.test(process.argv[1]??'')||process.argv[1]==='-';
if(!readOnly)process.once('exit',acquireStateLock(local));

export const state=existsSync(local+'resources.json')?JSON.parse(readFileSync(local+'resources.json')):{account,resources:[],receipts:[]};
export const save=()=>{if(readOnly)throw new Error('Read-only operator command');atomicState(local+'resources.json',state);};
let credential,credentialAt=0;
export function token(){if(!credential||Date.now()-credentialAt>300000){execFileSync(wrangler,['whoami'],{stdio:'ignore'});credential=JSON.parse(execFileSync(wrangler,['auth','token','--json'],{encoding:'utf8'})).token;credentialAt=Date.now();}return credential;}
export async function api(path,method='GET',body){
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{method,headers:{authorization:'Bearer '+token(),...(!(body instanceof FormData)?{'content-type':'application/json'}:{})},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
 if(r.status===404)return null;
 const j=await r.json();if(!r.ok||!j.success)throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j.errors)}`);return j.result;
}
export function intent(name,path,readPath=path){
 if(!/^hm-s2-[a-z0-9-]+$/.test(name)&&name!=='homie-managed-s2')throw new Error('Step 2 resource required');
 if(state.resources.some(r=>r.path===path))throw new Error('Resource already recorded');
 state.resources.push({name,path,readPath,status:'intent'});save();
}
export async function create(name,path,method,body,readPath=path){
 if(await api(readPath)!==null)throw new Error('Refusing to adopt existing resource: '+name);
 intent(name,path,readPath);const result=await api(path,method,body);state.resources.at(-1).status='created';save();return result;
}
export function run(args,input){return execFileSync(wrangler,args,{cwd:here,encoding:'utf8',input,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:account,WRANGLER_SEND_METRICS:'false',CI:'true'}});}
