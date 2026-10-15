/** Sequential fresh-version pairs; same assets/runtime, test scripts only. */
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {Agent,fetch} from 'undici';import {wrangler} from './cloud.mjs';
const [dir,out]=process.argv.slice(2),rows=[];
const agent=new Agent({connect:{lookup:(h,o,cb)=>cb(null,o.all?[{address:'104.21.34.86',family:4}]:'104.21.34.86',4)}});
try{for(let round=0;round<6;round++)for(const kind of round%2?['plain','managed']:['managed','plain']){
 const name='hm-test-speed-'+kind,config=dir+'/'+name+'/user.json',cfg=JSON.parse(readFileSync(config));if(cfg.name!==name)throw Error('Unexpected test script');
 appendFileSync(cfg.main,'\n// isolate-first probe '+round+'\n');
 const r=spawnSync(process.execPath,[wrangler,'deploy','--config',config,...(kind==='managed'?['--dispatch-namespace','homie-managed-test']:[])],{encoding:'utf8',env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'}});if(r.status!==0)throw Error('Deploy failed '+name);
 const at=performance.now();const response=await fetch('https://'+(kind==='managed'?'hm-test-dispatch.ryan-d2f.workers.dev/speed':'hm-test-speed-plain.ryan-d2f.workers.dev')+'/cafe/open',{dispatcher:agent});await response.arrayBuffer();
 rows.push({round,kind,endpoint:'page',status:response.status,ms:Math.round(performance.now()-at),first:response.headers.get('x-hm-first'),ray:response.headers.get('cf-ray'),colo:response.headers.get('cf-ray')?.split('-').at(-1),routeMs:response.headers.get('x-hm-route-ms')});writeFileSync(out,JSON.stringify(rows,null,2)+'\n');console.log(rows.at(-1));
}}finally{await agent.close();}
