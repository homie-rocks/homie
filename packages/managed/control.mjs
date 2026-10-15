/** Operator-only step-1 harness. Run from a trusted shell, never in a studio Worker. */
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {prepare} from './prepare.mjs';
import {waitForDatabase,removeResource} from './lifecycle.mjs';
import {functionDeploymentSQL} from '../studio/lib/functions-build.mjs';
const [command,folder,studio,name,hostname]=process.argv.slice(2);
if (!folder) throw new Error('Usage: control.mjs init|deploy|cleanup STATE [STUDIO NAME HOSTNAME]');
const stateDir=resolve(folder);mkdirSync(stateDir,{recursive:true});
const lock=join(stateDir,'.control.lock');
const lockFd=openSync(lock,'wx');
process.on('exit',()=>{closeSync(lockFd);unlinkSync(lock);});
const stateFile=join(stateDir,'resources.json');
const state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile)): {namespace:'homie-managed-test',databases:[],workers:[],deleted:[]};
if(state.namespace!=='homie-managed-test')throw new Error('Only the test dispatch namespace is permitted');
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
async function operator(path,body) {
  if(!/^hm-test-dispatch\.[a-z0-9-]+\.workers\.dev$/.test(state.dispatchHost??''))throw Error('Test dispatch host required');
  const secretPath=join(stateDir,'operator-token');
  const response=await fetch('https://'+state.dispatchHost+'/__operator/'+path,{method:path==='route'?'PUT':'POST',headers:{authorization:'Bearer '+readFileSync(secretPath,'utf8'),'content-type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw Error('Registry write failed: '+response.status);
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
  await api(`workers/dispatch/namespaces/${state.namespace}`,'PUT',{name:state.namespace,trusted_workers:false});
  state.queues=[];
  for(const name of ['hm-test-ticks-dlq','hm-test-ticks']) {
    state.queues.push(name);save();run(['queues','create',name]);
  }
} else if(command==='deploy'||command==='deploy-plain') {
  if(!state.namespaceCreated)throw new Error('Initialize a fresh test namespace first');
  // Provider GET may omit the flag; explicitly set the namespace policy before every upload.
  await api(`workers/dispatch/namespaces/${state.namespace}`,'PUT',{name:state.namespace,trusted_workers:false});
  if(!/^hm-test-[a-z0-9-]+$/.test(name??''))throw new Error('hm-test- name required');
  let db=state.databases.find(d=>d.name===name+'-db');
  if(!db) {
    const out=run(['d1','create',name+'-db']);
    const id=out.match(/"database_id":\s*"([0-9a-f-]+)"/)?.[1];
    if(!id)throw new Error('D1 created but ID could not be parsed: recover it from the output before retrying');
    db={name:name+'-db',id};state.databases.push(db);save();
  }
  db.readiness=await waitForDatabase(()=>api(`d1/database/${db.id}/query`,'POST',{sql:'SELECT 1 AS ready'}));
  db.info=await api(`d1/database/${db.id}`);save();
  const output=join(stateDir,name);
  const deployed=await api(command==='deploy-plain'?`workers/scripts/${name}/settings`:`workers/dispatch/namespaces/${state.namespace}/scripts/${name}/settings`);
  prepare({studio,output,name,databaseId:db.id,accountId:state.accountId,hostname,deployed});
  run(['d1','migrations','apply','DB','--remote','--config',join(output,'user.json')]);
  // Same deploy-time reconciliation as self-hosted, including removed/changed declarations.
  await api(`d1/database/${db.id}/query`,'POST',{sql:functionDeploymentSQL(resolve(studio))});
  if(command==='deploy-plain') {
    const configPath=join(output,'user.json');const config=JSON.parse(readFileSync(configPath));
    delete config.tail_consumers;config.workers_dev=true;writeFileSync(configPath,JSON.stringify(config,null,2));
    if(!state.workers.includes(name))state.workers.push(name);save();
    run(['deploy','--config',configPath]);
    const settings=await api(`workers/scripts/${name}/settings`);
    state.durableObjects??=[];
    for(const b of settings.bindings.filter(b=>b.type==='durable_object_namespace'))if(!state.durableObjects.some(d=>d.id===b.namespace_id))state.durableObjects.push({name:name+'_'+b.class_name,id:b.namespace_id});
    save();process.exit(0);
  }
  if(!state.workers.includes('hm-test-outbound')){
    state.workers.push('hm-test-outbound');save();
    run(['deploy','--config',join(output,'outbound.json')]);
  }
  state.users??=[];if(!state.users.includes(name))state.users.push(name);save();
  run(['deploy','--config',join(output,'user.json'),'--dispatch-namespace',state.namespace]);
  await inventoryUsers();
  await api(`workers/dispatch/namespaces/${state.namespace}/scripts/${name}/tags`,'PUT',['hm-test','step-1',name]);
  if(!state.workers.includes('hm-test-dispatch')) {
    state.workers.push('hm-test-dispatch');save();
    const secretPath=join(stateDir,'operator-token');
    const secret=randomBytes(32).toString('hex');
    writeFileSync(secretPath,secret,{mode:0o600});
    run(['deploy','--config',join(output,'dispatch.json')]);
    await api('workers/scripts/hm-test-dispatch/secrets','PUT',{name:'OPERATOR_TOKEN',type:'secret_text',text:secret});
    state.dispatchHost=hostname;
    const settings=await api('workers/scripts/hm-test-dispatch/settings');
    state.durableObjects??=[];
    for(const b of settings.bindings.filter(b=>b.type==='durable_object_namespace'))state.durableObjects.push({name:'hm-test-dispatch_'+b.class_name,id:b.namespace_id});
    save();
  }
  const cfg=JSON.parse(readFileSync(join(output,'user.json')));
  const ticks=JSON.parse(cfg.vars.STUDIO_FUNCTION_CRONS).length>0||JSON.parse(cfg.vars.STUDIO_FUNCTION_MANAGED_CRONS).length>0;
  await operator('route',{tenant:name,routes:[{hostname,prefix:'/'}],ticks});
  save();
} else if(command==='kill') {
  if(!/^hm-test-[a-z0-9-]+$/.test(studio??''))throw new Error('kill STATE SCRIPT');
  await operator('kill',{tenant:studio});
  state.killed??=[];state.killed.push(studio);save();
} else if(command==='cleanup') {
  if(state.namespace!=='homie-managed-test')throw new Error('Unexpected namespace');
  await inventoryUsers();
  state.cleanup??=[];
  const remove=async(name,path,readPath=path)=>{
    if(!/^hm-test-/.test(name)&&name!==state.namespace)throw new Error('Unexpected resource');
    const result=await removeResource(api,path,readPath);
    state.cleanup.push({name,...result});state.deleted.push(name);save();
    console.log(`${result.result}: ${name}; absence verified`);
  };
  // Queue consumers must be detached before Cloudflare permits Worker deletion.
  for(const name of state.queues??[]) {
    if(!/^hm-test-/.test(name))throw new Error('Unexpected queue');
    const queue=(await api('queues')).find(q=>q.queue_name===name);
    if(!queue)continue;
    const info=await api(`queues/${queue.queue_id}`);
    for(const consumer of info.consumers??[]) {
      if(!state.workers.includes(consumer.script))throw new Error('Queue has an unrecorded consumer');
      await api(`queues/${queue.queue_id}/consumers/${consumer.consumer_id}`,'DELETE');
      const after=await api(`queues/${queue.queue_id}`);
      if(after.consumers.some(c=>c.consumer_id===consumer.consumer_id))throw new Error('Queue consumer still exists');
      state.cleanup.push({name:name+' consumer',id:consumer.consumer_id,existed:true,result:'deleted',absent:true});save();
    }
  }
  // Capture DO existence before script deletion can cascade to DO deletion.
  for(const object of state.durableObjects??[]) {
    object.existedBeforeCleanup??=(await api(`workers/durable_objects/namespaces/${object.id}`))!==null;save();
  }
  for(const worker of [...state.workers].reverse())await remove(worker,`workers/scripts/${worker}?force=true`,`workers/scripts/${worker}/settings`);
  for(const user of state.users??[])await remove(user,`workers/dispatch/namespaces/${state.namespace}/scripts/${user}?force=true`,`workers/dispatch/namespaces/${state.namespace}/scripts/${user}/settings`);
  for(const object of state.durableObjects??[]) {
    if(!/^[0-9a-f]{32}$/.test(object.id))throw new Error('Unexpected DO ID');
    await remove(object.name,`workers/durable_objects/namespaces/${object.id}`);
  }
  if(state.namespaceCreated)await remove(state.namespace,`workers/dispatch/namespaces/${state.namespace}`);
  for(const db of state.databases)await remove(db.name,`d1/database/${db.id}`);
  for(const name of [...(state.queues??[])].reverse()) {
    const queues=await api('queues');const queue=queues.find(q=>q.queue_name===name);
    if(queue)await remove(name,`queues/${queue.queue_id}`);
    else {state.cleanup.push({name,result:'already absent',absent:true});save();}
  }
} else throw new Error('Unknown command');
