/** CLI-only proof, no Worker key. Raw CLI output and listener secret remain in memory. */
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {stripeProcess} from '../lib/stripe-connect.mjs';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const profile='homie-636e9d423df0184d0af88019';
let listener,server,secret,mf,verified=0;
try {
 const account=await stripeProcess(['get','/v1/account','--project-name',profile]);
 if(account.code!==0||!JSON.parse(account.stdout).id.endsWith('Dz5BcOk2Yt'))throw new Error();
 server=createServer(async(req,res)=>{let body='';for await(const c of req){body+=c;if(body.length>1048576){res.writeHead(413);res.end();return;}}
  if(!mf){res.writeHead(503);res.end();return;}
  const response=await mf.dispatchFetch('https://sandbox.local/hook',{method:'POST',headers:{'stripe-signature':req.headers['stripe-signature']},body});
  const result=await response.json();if(result.ok)verified++;
  res.writeHead(response.status);res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('STRIPE_')));
 listener=spawn('stripe',['listen','--project-name',profile,'--events','payment_intent.succeeded','--forward-to',`http://127.0.0.1:${server.address().port}`],{env,stdio:['ignore','pipe','pipe']});
 const capture=b=>{const match=b.toString().match(/whsec_[A-Za-z0-9]+/);if(match)secret=match[0];};
 listener.stdout.on('data',capture);listener.stderr.on('data',capture);listener.on('error',()=>{});
 const wait=async predicate=>{const deadline=Date.now()+45000;while(!predicate()){if(Date.now()>deadline)throw new Error();await new Promise(r=>setTimeout(r,250));}};
 await wait(()=>secret);
 const bundle=await build({bundle:true,write:false,format:'esm',platform:'browser',stdin:{resolveDir:fileURLToPath(new URL('../worker/',import.meta.url)),contents:`import {verifyWebhook} from './stripe.mjs';
 export default {async fetch(request,env) {
  const v=await verifyWebhook(await request.text(),request.headers.get('stripe-signature'),env.SIGNING_SECRET);
  const ok=v.ok && v.event.livemode===false && v.event.type==='payment_intent.succeeded';
  return Response.json({ok},{status:ok?200:400});
 }};`}});
 mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'stripe-sandbox-proof',compatibilityDate:'2026-06-01',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{SIGNING_SECRET:{type:'text',value:secret}}}}]});
 await mf.dispatchFetch('https://sandbox.local/hook',{method:'POST',body:'{}'});
 const trigger=await stripeProcess(['trigger','payment_intent.succeeded','--project-name',profile]);
 if(trigger.code!==0)throw new Error();
 await wait(()=>verified>0);
 console.log('PASS named sandbox account, CLI trigger, forwarding into local workerd, signature verification, and test-mode event.');
 console.log('Worker-key checkout acceptance remains owner-run.');
}catch{console.log('FAIL CLI sandbox proof; private provider output discarded.');process.exitCode=1;}
finally{listener?.kill('SIGTERM');if(mf)try{await mf.dispose();}catch{}if(server)await new Promise(r=>{server.close(r);server.closeAllConnections();});}
