import {readFileSync} from 'node:fs';
const [dir,tenant,prefix]=process.argv.slice(2),state=JSON.parse(readFileSync(dir+'/resources.json'));
if(!/^hm-test-/.test(tenant)||!state.users.includes(tenant)||!prefix?.startsWith('/')||!/^hm-test-dispatch\.[a-z0-9-]+\.workers\.dev$/.test(state.dispatchHost))throw Error('Owned test tenant and route required');
const token=readFileSync(dir+'/operator-token','utf8');
async function op(path,body){const r=await fetch('https://'+state.dispatchHost+'/__operator/'+path,{method:path==='route'?'PUT':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Operator '+r.status);}
await op('kill',{tenant});await new Promise(r=>setTimeout(r,4000));await op('route',{tenant,routes:[{hostname:state.dispatchHost,prefix}]});await new Promise(r=>setTimeout(r,2200));console.log('Reset completed:',tenant);
