/** Operator-only step-1 harness. Run from a trusted shell, never in a studio Worker. */
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {prepare} from './prepare.mjs';
const [command,folder,studio,name,hostname]=process.argv.slice(2);
if (!folder) throw new Error('Usage: control.mjs init|deploy|cleanup STATE [STUDIO NAME HOSTNAME]');
const stateDir=resolve(folder);mkdirSync(stateDir,{recursive:true});
const stateFile=join(stateDir,'resources.json');
const state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile)): {namespace:'homie-managed-test',databases:[],workers:[],deleted:[]};
const save=()=>writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n');
const wrangler=process.env.WRANGLER ?? 'wrangler';
function run(args) {
  const r=spawnSync(wrangler,args,{encoding:'utf8',env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',...(state.accountId?{CLOUDFLARE_ACCOUNT_ID:state.accountId}:{})}});
  process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');
  if(r.status!==0)throw new Error(`Wrangler failed: ${args[0]}`);
  return r.stdout;
}
let token;
async function api(path, method='GET', body) {
  if (!/^[0-9a-f]{32}$/.test(state.accountId??'')) throw new Error('Invalid recorded account');
  if (!token) {
    // Capture credentials in memory only; never print auth command output.
    const auth=spawnSync(wrangler,['auth','token','--json'],{encoding:'utf8'});
    if(auth.status!==0)throw new Error('Wrangler authentication failed');
    const value=JSON.parse(auth.stdout);
    if(!['oauth','api_token'].includes(value.type)||!value.token)throw new Error('Bearer-token Wrangler authentication required');
    token=value.token;
  }
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${state.accountId}/${path}`,{
    method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  const value=await response.json();
  if(response.status===404)return null;
  if(!response.ok||!value.success)throw new Error(`Cloudflare ${method} failed (${response.status}): ${JSON.stringify(value.errors)}`);
  return value.result;
}
async function inventoryUsers() {
  for(const user of state.users??[]) {
    if(!/^hm-test-[a-z0-9-]+$/.test(user))throw new Error('Unexpected user Worker');
    const bindings=await api(`workers/dispatch/namespaces/${state.namespace}/scripts/${user}/bindings`);
    if(!bindings)continue;
    for(const b of bindings.filter(b=>b.type==='durable_object_namespace')) {
      state.durableObjects??=[];
      if(!state.durableObjects.some(d=>d.id===b.namespace_id))state.durableObjects.push({name:user+'_'+b.class_name,id:b.namespace_id});
    }
    save();
  }
}
if(command==='init') {
  if(existsSync(stateFile))throw new Error('State already exists; refusing to adopt existing resources');
  state.accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
  if(!/^[0-9a-f]{32}$/.test(state.accountId??''))throw new Error('CLOUDFLARE_ACCOUNT_ID required');
  // Persist intent first, so interrupted provisioning is visible to the operator.
  save();run(['dispatch-namespace','create',state.namespace]);state.namespaceCreated=true;save();
} else if(command==='deploy') {
  if(!state.namespaceCreated)throw new Error('Initialize a fresh test namespace first');
  if(!/^hm-test-[a-z0-9-]+$/.test(name??''))throw new Error('hm-test- name required');
  let db=state.databases.find(d=>d.name===name+'-db');
  if(!db) {
    const out=run(['d1','create',name+'-db']);
    const id=out.match(/"database_id":\s*"([0-9a-f-]+)"/)?.[1];
    if(!id)throw new Error('D1 created but ID could not be parsed: recover it from the output before retrying');
    db={name:name+'-db',id};state.databases.push(db);save();
  }
  const output=join(stateDir,name);
  prepare({studio,output,name,databaseId:db.id,accountId:state.accountId,hostname});
  run(['d1','migrations','apply','DB','--remote','--config',join(output,'user.json')]);
  state.users??=[];if(!state.users.includes(name))state.users.push(name);save();
  run(['deploy','--config',join(output,'user.json'),'--dispatch-namespace',state.namespace]);
  await inventoryUsers();
  await api(`workers/dispatch/namespaces/${state.namespace}/scripts/${name}/tags`,'PUT',['hm-test','step-1',name]);
  for(const kind of ['outbound','dispatch']) {
    const worker='hm-test-'+kind;
    if(!state.workers.includes(worker)){state.workers.push(worker);save();}
    run(['deploy','--config',join(output,kind+'.json')]);
  }
  save();
} else if(command==='cleanup') {
  // Refuse broad/account-level deletion. Only the fixed disposable namespace and recorded test names.
  if(state.namespace!=='homie-managed-test')throw new Error('Unexpected namespace');
  if(!state.deleted.includes(state.namespace))await inventoryUsers();
  for(const worker of [...state.workers].reverse()) {
    if(!/^hm-test-/.test(worker))throw new Error('Unexpected Worker');
    if(state.deleted.includes(worker))continue;
    run(['delete',worker]);state.deleted.push(worker);save();
  }
  for(const user of state.users??[]) {
    if(!/^hm-test-[a-z0-9-]+$/.test(user))throw new Error('Unexpected user Worker');
    if(state.deleted.includes(user))continue;
    await api(`workers/dispatch/namespaces/${state.namespace}/scripts/${user}?force=true`,'DELETE');
    state.deleted.push(user);save();
  }
  for(const object of state.durableObjects??[]) {
    if(!/^hm-test-/.test(object.name)||! /^[0-9a-f]{32}$/.test(object.id))throw new Error('Unexpected DO namespace');
    if(state.deleted.includes(object.name))continue;
    await api(`workers/durable_objects/namespaces/${object.id}`,'DELETE');
    if(await api(`workers/durable_objects/namespaces/${object.id}`)!==null)throw new Error('DO namespace still exists');
    state.deleted.push(object.name);save();console.log('Deleted DO namespace '+object.name+' '+object.id);
  }
  if(state.namespaceCreated&&!state.deleted.includes(state.namespace)) {
    run(['dispatch-namespace','delete',state.namespace]);state.deleted.push(state.namespace);save();
  }
  for(const db of state.databases) {
    if(!/^hm-test-/.test(db.name))throw new Error('Unexpected database');
    if(state.deleted.includes(db.name))continue;
    run(['d1','delete',db.id,'--skip-confirmation']);state.deleted.push(db.name);save();
  }
} else throw new Error('Unknown command');
