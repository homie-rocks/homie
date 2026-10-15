import {readFileSync,writeFileSync} from 'node:fs';
const [dir,out]=process.argv.slice(2),base='https://hm-test-dispatch.ryan-d2f.workers.dev';
const token=readFileSync(dir+'/operator-token','utf8'),tenant='hm-test-other';
const evidence={};
async function route(limits){const r=await fetch(base+'/__operator/route',{method:'PUT',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({tenant,routes:[{hostname:new URL(base).hostname,prefix:'/other'}],limits})});if(!r.ok)throw Error('Operator '+r.status);await new Promise(r=>setTimeout(r,2200));}
async function get(path){const r=await fetch(base+path);const body=await r.text();return {status:r.status,body:r.status>=500?'Upstream error (body omitted)':body,ray:r.headers.get('cf-ray')};}
try{
 await route({cpuMs:100,subRequests:1});evidence.lowLimit={cpuMs:100,subRequests:1};
 evidence.low=await get('/other/probe/burst?target='+encodeURIComponent(base+'/other/probe/echo'));
 evidence.neighbor=await get('/probe/echo');
}finally{await route({cpuMs:100,subRequests:32});evidence.restored=await get('/other/probe/burst?target='+encodeURIComponent(base+'/other/probe/echo'));writeFileSync(out,JSON.stringify(evidence,null,2)+'\n');}
console.log(evidence);
