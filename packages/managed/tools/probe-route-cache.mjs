import {readFileSync,writeFileSync} from 'node:fs';
import {Agent,fetch as edgeFetch} from 'undici';
const [dir,out]=process.argv.slice(2),base='https://hm-test-dispatch.ryan-d2f.workers.dev',secret=readFileSync(dir+'/operator-token','utf8');
const pinned=new Agent({connect:{lookup:(h,o,cb)=>cb(null,o.all?[{address:'104.21.34.86',family:4}]:'104.21.34.86',4)}});
const clients={dns:fetch,pinned:(u,o)=>edgeFetch(u,{...o,dispatcher:pinned})},e={samples:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function op(action,body){const at=Date.now();const r=await fetch(base+'/__operator/'+action,{method:action==='route'?'PUT':'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Operator '+r.status);return {at,done:Date.now()};}
async function sample(client){const at=Date.now(),r=await clients[client](base+'/other/probe/echo');await r.text();const v={client,at,done:Date.now(),status:r.status,version:r.headers.get('x-hm-route-version'),routeMs:r.headers.get('x-hm-route-ms'),ray:r.headers.get('cf-ray')};e.samples.push(v);return v;}
try{
 await Promise.all(Object.keys(clients).map(sample));
 e.changed=await op('route',{tenant:'hm-test-other',routes:[{hostname:new URL(base).hostname,prefix:'/other'}],limits:{cpuMs:90,subRequests:20}});
 for(let i=0;i<12;i++){await Promise.all(Object.keys(clients).map(sample));await sleep(150);}
 e.kill=await op('kill',{tenant:'hm-test-other'});
 for(let i=0;i<12;i++){await Promise.all(Object.keys(clients).map(sample));await sleep(150);}
}finally{e.restored=await op('route',{tenant:'hm-test-other',routes:[{hostname:new URL(base).hostname,prefix:'/other'}]});await pinned.close();writeFileSync(out,JSON.stringify(e,null,2)+'\n');}
console.log({changed:e.changed,kill:e.kill,samples:e.samples.length});
