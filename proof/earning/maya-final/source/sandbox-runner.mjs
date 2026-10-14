import {startStripeSandbox} from './node_modules/@homie-rocks/studio/lib/dev-stripe-sandbox.mjs';
import {writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
writeFileSync('../evidence/sandbox-pid.json',JSON.stringify({pid:process.pid}));
let sandbox;
try{sandbox=await startStripeSandbox({origin:'http://127.0.0.1:8787',profile:'Homie sandbox'});}catch(e){console.log(e.message);process.exit(1);}
mkdirSync('.wrangler',{recursive:true});
const vars=Object.entries(sandbox.bindings).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n');
for(const p of ['.dev.vars','.wrangler/.dev.vars'])writeFileSync(p,vars,{mode:0o600});
console.log('Real sandbox adapter ready; bindings private.');
const child=spawn(process.execPath,['node_modules/@homie-rocks/studio/bin/homie-studio.mjs','dev','--port','8787'],{stdio:['ignore','pipe','pipe']});
writeFileSync('../evidence/sandbox-pid.json',JSON.stringify({pid:process.pid,dev:child.pid}));
const redact=b=>{let s=b.toString();for(const v of Object.values(sandbox.bindings))s=s.replaceAll(v,'[private]');return s.replace(/(?:whsec_|rk_test_|sk_test_)[A-Za-z0-9]+/g,'[private]');};
child.stdout.on('data',b=>process.stdout.write(redact(b)));child.stderr.on('data',b=>process.stderr.write(redact(b)));
let closing=false;async function close(){if(closing)return;closing=true;child.kill('SIGTERM');await sandbox.close();for(const p of ['.dev.vars','.wrangler/.dev.vars'])rmSync(p,{force:true});process.exit();}process.on('SIGTERM',close);process.on('SIGINT',close);
