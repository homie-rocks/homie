/** Test-only sanitized tail capture; never records request headers or body. */
import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';import {wrangler} from './cloud.mjs';
const [path,out]=process.argv.slice(2);if(!path?.startsWith('/probe/'))throw Error('Probe path required');
const p=spawn(process.execPath,[wrangler,'tail','hm-test-outbound','--format','json'],{stdio:['ignore','pipe','pipe']});let raw='';p.stdout.on('data',b=>raw+=b);p.stderr.on('data',()=>{});
try{await new Promise(r=>setTimeout(r,4000));const r=await fetch('https://hm-test-dispatch.ryan-d2f.workers.dev'+path);console.log(r.status);await r.text();await new Promise(r=>setTimeout(r,3000));}finally{p.kill('SIGTERM');}
const events=[];for(const block of raw.split(/\n(?=\{)/)){try{const e=JSON.parse(block);for(const l of e.logs??[])for(const m of l.message??[]){try{const v=JSON.parse(m);if(v.event==='tenant-trace')events.push(v);}catch{}}}catch{}}
writeFileSync(out,JSON.stringify(events,null,2));console.log(events);
