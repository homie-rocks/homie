import {DatabaseSync} from 'node:sqlite';
/** Explicit real sandbox proof; not part of offline tests. No deploy, credentials never leave this process. */
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stripeProcess} from '../lib/stripe-connect.mjs';
import {formEncode,redactStripe} from '../worker/stripe.mjs';
import {shopMcpPlan,saveMcpVerification} from '../lib/shop-mcp.mjs';
import {syncPaymentLinks} from '../lib/shop-links.mjs';
import {refreshWorkerConfig} from '../lib/worker-config.mjs';
import {readShop} from '../lib/shop.mjs';
import {readiness} from '../worker/shop.mjs';
import {LINKS_STRIPE_VERSION} from '../worker/shop-links.mjs';
if(!process.argv.includes('--run'))throw Error('Explicit --run required; only Homie sandbox is authorized');
const root=mkdtempSync(join(tmpdir(),'selling-sandbox-')),slug='selling-proof-'+Date.now(),site=`https://${slug}.example`;
const sql=new DatabaseSync(':memory:');
for(const f of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort())sql.exec(readFileSync(new URL('../../../template/site/migrations/'+f,import.meta.url),'utf8'));
const DB={prepare:q=>({first:async()=>sql.prepare(q).get()??null})};
let calls=0,bytes=0,endpoint,links=[],privateBindings;
const api=async(method,path,params={},idempotency)=>{
 const args=['--project-name','Homie sandbox',method.toLowerCase(),path,'--stripe-version',LINKS_STRIPE_VERSION,...(idempotency?['--idempotency',idempotency]:[]),...(method==='DELETE'?['--confirm']:[])];
 for(const [k,v] of formEncode(params))args.push('-d',`${k}=${v}`);
 const response=await stripeProcess(args);let body;try{body=JSON.parse(response.stdout);}catch{}
 if(response.code!==0||!body||body.error)throw Error(redactStripe(body?.error?.message??'Stripe request failed'));
 if(body.livemode===true||body.data?.some(x=>x.livemode===true))throw Error('Live response refused');
 if(!path.includes('webhook')){calls++;bytes+=Buffer.byteLength(JSON.stringify({method,path,params,...(idempotency?{idempotency}:{})}))+Buffer.byteLength(JSON.stringify(body));}
 return body;
};
try {
 writeFileSync(join(root,'studio.json'),JSON.stringify({name:'Selling proof',slug,cloudflare:{domain:new URL(site).hostname,worker:slug,d1:slug}}));
 writeFileSync(join(root,'shop.json'),JSON.stringify({till:'stripe',currency:'usd',automaticTax:false,items:Array.from({length:8},(_,i)=>({id:'item'+i,name:'Proof item '+i,price:300+i}))}));
 const account=await api('GET','/v1/account');calls=0;bytes=0;
 const observations=[];let plan,rounds=0;
 for(;rounds<20;rounds++) {
  plan=await shopMcpPlan(root,{observations,account:account.id});
  if(plan.verified)break;
  const results=await Promise.all(plan.operations.map(async op=>({...op,body:await api(op.method,op.path,op.params,op.idempotency)})));
  observations.push(...results);
 }
 assert.equal(plan.verified,true);links=[...plan.config.items,...plan.config.menus];
 const measured={stripeCalls:calls,stripeBytes:bytes,plannerCalls:rounds+1};
 assert.equal((await saveMcpVerification(root,{observations,account:account.id})).verified,true);
 refreshWorkerConfig(root);
 const config=JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8').replace(/^\s*\/\/.*$/gm,''));
 const shop=readShop(root).shop;
 assert.deepEqual((await readiness({...config.vars,DB},shop)).missing,['webhook-secret']);
 const installation=await syncPaymentLinks({api,shop,slug,site,mode:'test',catalog:{config:plan.config,retire:[]},saveReceipt:r=>{if(r.endpoint)endpoint=r.endpoint;},w:async(args,options)=>{
   if(args[1]==='list')return {code:0,stdout:'[]'};
   assert.deepEqual(args,['secret','bulk']);privateBindings=JSON.parse(options.input);return {code:0};
 }});
 endpoint=installation.webhook.id;
 assert.equal((await readiness({...config.vars,...privateBindings,DB},shop)).ready,true);
 assert.ok(!JSON.stringify(installation).includes(privateBindings.STRIPE_WEBHOOK_SECRET));
 console.log(JSON.stringify({ok:true,profile:'Homie sandbox',...measured,publicConfigBytes:Buffer.byteLength(readFileSync(join(root,'.studio/stripe-mcp.json'))),links:links.length,withoutWebhook:['webhook-secret'],withWebhook:'ready',webhookCreated:true,secretTransport:'private installer stdin captured in-process; no remote Wrangler mutation or deploy',paymentTested:false},null,2));
} finally {
 if(endpoint)await api('DELETE',`/v1/webhook_endpoints/${endpoint}`);
 for(const link of links)await api('POST',`/v1/payment_links/${link.id}`,{active:false});
 sql.close();
 rmSync(root,{recursive:true,force:true});
}
