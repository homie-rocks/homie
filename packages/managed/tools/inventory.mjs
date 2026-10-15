/** Read-only crash recovery inventory. Credentials stay in memory. */
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const account='d2f6f976cecad2fe130976fe36916cdb';
const auth=spawnSync(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'auth','token','--json'],{encoding:'utf8'});
if(auth.status!==0)throw Error('Wrangler authentication failed');
const {token}=JSON.parse(auth.stdout);
if(!token)throw Error('Missing token');
async function list(path){
 const all=[];
 for(let page=1;page<=100;page++){
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}${path.includes('?')?'&':'?'}page=${page}&per_page=100`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  const j=await r.json();if(r.status===404)return [];
  if(!r.ok||!j.success)throw Error(`${path}: ${r.status} ${JSON.stringify(j.errors)}`);
  if(!Array.isArray(j.result))throw Error('Expected list');
  all.push(...j.result);if(j.result.length<100||page>=(j.result_info?.total_pages??Infinity))return all;
 }throw Error('Pagination limit');
}
const namespace='homie-managed-test';
const results=await Promise.all([
 list('workers/dispatch/namespaces'),list('workers/scripts'),list('d1/database'),list('queues'),list('workers/durable_objects/namespaces')
]);
const inventory={at:new Date().toISOString(),account,
 namespaces:results[0].filter(x=>x.namespace_name===namespace||x.name===namespace),
 workers:results[1].filter(x=>(x.id??'').startsWith('hm-test-')).map(x=>({id:x.id})),
 databases:results[2].filter(x=>(x.name??'').startsWith('hm-test-')),
 queues:results[3].filter(x=>(x.queue_name??'').startsWith('hm-test-')),
 durableObjects:results[4].filter(x=>[x.name,x.script].some(n=>n?.startsWith('hm-test-'))),
 scripts:await list(`workers/dispatch/namespaces/${namespace}/scripts`)};
const output=process.argv[2];if(!output)throw Error('Output file required');
writeFileSync(output,JSON.stringify(inventory,null,2)+'\n');
console.log(JSON.stringify(inventory,null,2));
