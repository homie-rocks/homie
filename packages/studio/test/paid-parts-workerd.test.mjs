/** Published discovery and real D1/R2 in workerd; only payment-provider boundaries are doubles. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Mppx, stripe } from 'mppx/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpClient } from 'mppx/mcp/client';
import { world, LIVE_KEY, configureMachine, addPart } from './paid-parts-review4-harness.mjs';
import { signPayload } from '../worker/stripe.mjs';
const origin = 'https://seller.example';
const secret = () => randomBytes(32).toString('hex');
async function runtime(w,{keyless=false,quantity=1,handlers=new Map()}={}) {
  const bundled=await build({bundle:true,write:false,format:'esm',platform:'node',stdin:{resolveDir:new URL('../worker/',import.meta.url).pathname,contents:`import worker from './selling/index.mjs';
    export default {async fetch(request,env,ctx){env.ASSETS={fetch:async(request)=>{const object=await env.STATIC.get(new URL(request.url).pathname);return object?new Response(object.body):new Response('',{status:404});}};return worker.fetch(request,env,ctx);}};`}});
  const bindings={DB:{type:'d1',id:'purchases'},PURCHASE_MEDIA:{type:'r2',name:'paid'},STATIC:{type:'r2',name:'static'},PURCHASE_RATE_LIMITER:{type:'rate-limit',namespace:'purchases',simple:{limit:1000,period:60}}};
  for(const [key,value] of Object.entries(w.env))if(typeof value==='string' && (!keyless || !['STRIPE_KEY','TURNSTILE_SECRET','TURNSTILE_SITE_KEY'].includes(key))) bindings[key]={type:'json',value};
  if(keyless){bindings.STRIPE_SHOP_LINKS={type:'json',value:JSON.stringify({v:1,mode:'live',items:[]})};const p=JSON.parse(readFileSync(join(w.dist,'parts/index.json'))).parts[0];bindings.PURCHASE_LINKS={type:'json',value:JSON.stringify({v:1,mode:'live',offers:[{quantity,kind:'part',resource:p.id,version:p.version,offer:(await import('../worker/referrals.mjs')).canonicalJson(p.sale),id:'plink_test',url:'https://buy.stripe.com/test',revision:'release1'}]})};}
  const hosts=[];
  const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'seller',compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public','disallow_eval_during_startup'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:bindings},dev:{outboundService:{type:'fetcher',handler:async(req)=>{const url=new URL(req.url);hosts.push(url.hostname);if(handlers.has(url.hostname)) return handlers.get(url.hostname)(req);assert.equal(url.host,new URL(w.st.base).host,'only the seller provider may be contacted');return fetch(req.url,{method:req.method,headers:Object.fromEntries(req.headers),...(req.body?{body:await req.arrayBuffer()}:{} )});}}}}]});
  const db=await mf.getD1Database('DB');
  for(const file of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync(new URL(`../../../template/site/migrations/${file}`,import.meta.url),'utf8').replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[]) if(sql.trim())await db.prepare(sql).run();
  const media=await mf.getR2Bucket('PURCHASE_MEDIA');for(const [key,bytes]of w.objects)await media.put(key,bytes);
  const assets=await mf.getR2Bucket('STATIC');for(const path of readdirSync(w.dist,{recursive:true}).filter(p=>!p.endsWith('/')))try{await assets.put('/'+path,readFileSync(join(w.dist,path)));}catch(e){if(e.code!=='EISDIR')throw e;}
  await assets.put('/games.json',JSON.stringify(w.cat));
  const fetcher=async(input,init)=>{const req=input instanceof Request?new Request(input,init):new Request(input,init);assert.equal(new URL(req.url).origin,origin);const response=await mf.dispatchFetch(req.url,{redirect:'manual',method:req.method,headers:Object.fromEntries(req.headers),...(req.body?{body:await req.arrayBuffer()}:{} )});return new Response(await response.arrayBuffer(),{status:response.status,headers:Object.fromEntries(response.headers)});};
  const post=(path,body,claim)=>fetcher(origin+path,{method:'POST',headers:{'content-type':'application/json',...(claim?{authorization:`Bearer ${claim}`}:{})},body:JSON.stringify(body)});
  const event=async(type,object)=>{const body=JSON.stringify({id:'evt_'+secret(),type,created:Math.floor(Date.now()/1000),livemode:true,data:{object}}),t=Math.floor(Date.now()/1000);return fetcher(origin+'/api/shop/hook',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${await signPayload(body,w.env.STRIPE_WEBHOOK_SECRET,t)}`},body});};
  return{mf,db,fetcher,post,event,hosts};
}

test('workerd: a stranger discovers MPP and MCP, pays twice, installs, rejects forged claims and refunds',{timeout:60000},async()=>{
 const w=await world('workerd-agent',{key:LIVE_KEY,saleOpts:{refundWindowDays:14}});await configureMachine(w,{profile:'profile_test'});const r=await runtime(w);
 try{
  const catalog=await(await r.fetcher(origin+'/.well-known/api-catalog')).json();const description=catalog.linkset[0]['service-desc'][0].href;const doc=await(await r.fetcher(description)).json();
  const [path,operation]=Object.entries(doc.paths).find(([p])=>p.startsWith('/api/purchases/resource/'));const properties=operation.post.requestBody.content['application/json'].schema.properties;
  const base=Object.fromEntries(Object.entries(properties).filter(([,v])=>v.const!==undefined).map(([k,v])=>[k,v.const]));const buyer=secret();
  let token=0;const methods=[stripe.charge({paymentMethod:'pm_card',createToken:async()=>{const id='spt_workerd_'+ ++token;w.st.spts.set(id,{max:1000,currency:'usd'});return id;}})];const wallet=Mppx.create({polyfill:false,fetch:r.fetcher,methods});
  for(let i=0;i<2;i++){const claim=secret();const response=await wallet.fetch(origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...base,buyer,claim})});assert.equal(response.status,200,await response.clone().text());const received=await response.json();assert.ok(received.proof);assert.ok(received.files.length);assert.equal((await r.post('/api/purchases/grant',{},secret())).status,401);
   if(i===0){const retry=await wallet.fetch(origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...base,buyer,claim})});assert.equal(retry.status,200);assert.equal((await retry.json()).order,received.order,'lost delivery is recovered with the same claim');assert.equal(token,1,'retry does not charge again');assert.equal((await r.post('/api/purchases/refund',{},claim)).status,200);assert.equal((await r.post('/api/purchases/grant',{},claim)).status,402);}
  }
  const quote=await addPart(w.buyer,'seller.example/camera',{fetch:r.fetcher,npm:()=>({status:0})}); const installed=await addPart(w.buyer,'seller.example/camera',{fetch:r.fetcher,npm:()=>({status:0}),approve:quote.purchase.quote,wallet:'link-cli',walletPay:async(url,body)=>({data:await(await wallet.fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json()})});assert.equal(installed.ok,true,JSON.stringify(installed));
  const client=new Client({name:'stranger',version:'1'});const mcp=catalog.linkset[0].item.find(i=>i.title==='Purchases over MCP').href;await client.connect(new StreamableHTTPClientTransport(new URL(mcp),{fetch:r.fetcher}));McpClient.wrap(client,{methods});const paid=await client.callTool({name:'purchase',arguments:{...base,buyer,claim:secret()}});assert.ok(paid.receipt);assert.ok(paid.content.length>1);
  const mcpBuyer=join(w.root,'mcp-buyer');mkdirSync(mcpBuyer);writeFileSync(join(mcpBuyer,'studio.json'),JSON.stringify({name:'MCP buyer'}));
  const mcpQuote=await addPart(mcpBuyer,'seller.example/camera',{fetch:r.fetcher,npm:()=>({status:0})});
  const mcpInstall=await addPart(mcpBuyer,'seller.example/camera',{fetch:r.fetcher,npm:()=>({status:0}),approve:mcpQuote.purchase.quote,wallet:'link-cli',walletPay:async(url,body)=>{const result=await client.callTool({name:'purchase',arguments:{...body,offerVersion:base.offerVersion}});return{data:{...JSON.parse(result.content.find(c=>c.type==='text').text),files:result.content.filter(c=>c.type==='resource').map(c=>({path:new URL(c.resource.uri).searchParams.get('path'),data:c.resource.blob}))}};}});assert.equal(mcpInstall.ok,true,JSON.stringify(mcpInstall));await client.close();
  assert.equal((await r.db.prepare('SELECT COUNT(*) n FROM purchase_orders WHERE paid_at IS NOT NULL').first()).n,5);
 }finally{await r.mf.dispose();await w.close();}
});

test('workerd: keyless Payment Link, signed delivery, repeat purchase and reordered refund',{timeout:60000},async()=>{
 const w=await world('workerd-keyless',{key:LIVE_KEY});const r=await runtime(w,{keyless:true,quantity:2});
 try{const p=JSON.parse(readFileSync(join(w.dist,'parts/index.json'))).parts[0];const buyer=secret();
 for(let i=0;i<2;i++){const claim=secret();const {digest}=await import('../worker/purchase-crypto.mjs');const intent=await(await r.post('/api/purchases/intent',{quantity:2,kind:'part',resource:p.id,version:p.version,buyer,claimHash:await digest(claim),offerVersion:p.releases[0].offerVersion})).json();assert.ok(intent.url,JSON.stringify(intent));const opened=await r.fetcher(intent.url,{method:'POST',headers:{origin},body:''});assert.equal(opened.status,303,await opened.text());const checkout=new URL(opened.headers.get('location'));assert.equal(checkout.hostname,'buy.stripe.com');
 const session={id:'cs_keyless_'+i,payment_link:'plink_test',client_reference_id:intent.order,metadata:{homie:'purchase-links-v1',revision:'release1'},currency:'usd',amount_subtotal:2000,amount_total:2000,livemode:true,payment_status:'paid',payment_intent:'pi_keyless_'+i};
 if(i===1)assert.equal((await r.event('refund.created',{id:'re_keyless',payment_intent:session.payment_intent,amount:2000,currency:'usd',status:'succeeded'})).status,200);
 assert.equal((await r.event('checkout.session.completed',session)).status,200);assert.equal((await r.event('checkout.session.completed',session)).status,200);
 const grant=await r.post('/api/purchases/grant',{},claim);assert.equal(grant.status,i?402:200,await grant.clone().text());
 if(!i){assert.equal((await r.event('refund.created',{id:'re_first',payment_intent:session.payment_intent,amount:2000,currency:'usd',status:'succeeded'})).status,200);assert.equal((await r.post('/api/purchases/grant',{},claim)).status,402);}
 }
 assert.equal(r.hosts.length,0,'keyless purchases make no provider API requests');
 }finally{await r.mf.dispose();await w.close();}
});


test('workerd: x402 Base through the official client, repeated credential grants once',{timeout:60000},async()=>{
 const {chain}=await import('./paid-parts-review5-kit.mjs');
 const {generatePrivateKey,privateKeyToAccount}=await import('viem/accounts');
 const {x402Client,x402HTTPClient}=await import('@x402/core/client');const {ExactEvmScheme}=await import('@x402/evm/exact/client');
 const {generateKeyPairSync}=await import('node:crypto');const pair=generateKeyPairSync('ed25519');
 const w=await world('workerd-base',{key:LIVE_KEY});const recipient=privateKeyToAccount(generatePrivateKey()).address;await configureMachine(w,{profile:'profile_base',base:recipient});
 w.env.CDP_API_KEY_SECRET=Buffer.concat([pair.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32),pair.publicKey.export({format:'der',type:'spki'}).subarray(-32)]).toString('base64');
 const handlers=new Map();const c=chain({handle:(host,fn)=>handlers.set(host,fn)});const r=await runtime(w,{handlers});
 try{const doc=await(await r.fetcher(origin+'/openapi.json')).json();const [path,op]=Object.entries(doc.paths).find(([p])=>p.startsWith('/api/purchases/resource/'));const props=op.post.requestBody.content['application/json'].schema.properties;const body={...Object.fromEntries(Object.entries(props).filter(([,v])=>v.const!==undefined).map(([k,v])=>[k,v.const])),buyer:secret(),claim:secret()};
 const core=x402Client.fromConfig({schemes:[{network:'eip155:8453',client:new ExactEvmScheme(privateKeyToAccount(generatePrivateKey()))}],spendControls:{maxAmountPerPayment:'10'}});const http=new x402HTTPClient(core);
 const post=(headers={})=>r.fetcher(origin+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});const unpaid=await post();assert.equal(unpaid.status,402,await unpaid.clone().text());const required=http.getPaymentRequiredResponse(n=>unpaid.headers.get(n));const headers=http.encodePaymentSignatureHeader(await http.createPaymentPayload(required));
 for(let i=0;i<2;i++){const paid=await post(headers);assert.equal(paid.status,200,await paid.clone().text());assert.ok(paid.headers.get('payment-response'));assert.ok((await paid.json()).proof);}assert.equal(c.transfers.length,1);
 const quote=await addPart(w.buyer,'seller.example/camera',{fetch:r.fetcher,npm:()=>({status:0})});
 const installed=await addPart(w.buyer,'seller.example/camera',{fetch:r.fetcher,npm:()=>({status:0}),approve:quote.purchase.quote,wallet:'link-cli',walletPay:async(url,body)=>{const send=(headers={})=>r.fetcher(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});const challenge=await send();assert.equal(challenge.status,402);const required=http.getPaymentRequiredResponse(n=>challenge.headers.get(n));return{data:await(await send(http.encodePaymentSignatureHeader(await http.createPaymentPayload(required)))).json()};}});assert.equal(installed.ok,true,JSON.stringify(installed));assert.equal(c.transfers.length,2);
 }finally{await r.mf.dispose();await w.close();}
});

test('real Chrome: keyless hosted fallback accepts the licence, pays at a Stripe stand-in, then delivers',{timeout:60000,skip:!process.env.CHROME_PATH},async()=>{
 const {default:puppeteer}=await import('puppeteer-core');const w=await world('workerd-browser',{key:LIVE_KEY});const r=await runtime(w,{keyless:true});const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH,headless:true});
 try{const p=JSON.parse(readFileSync(join(w.dist,'parts/index.json'))).parts[0];const claim=secret();const {digest}=await import('../worker/purchase-crypto.mjs');const intent=await(await r.post('/api/purchases/intent',{kind:'part',resource:p.id,version:p.version,buyer:secret(),claimHash:await digest(claim),offerVersion:p.releases[0].offerVersion})).json();const page=await browser.newPage();await page.setViewport({width:390,height:844});await page.setRequestInterception(true);
 page.on('request',async request=>{try{const u=new URL(request.url());if(u.hostname==='buy.stripe.com')return request.respond({status:200,contentType:'text/html',body:'<h1>Stripe test stand-in</h1><form method="post" action="https://seller.example/test-paid"><button>Pay test payment</button></form>'});if(u.hostname!=='seller.example')return request.abort();if(u.pathname==='/test-paid'){const response=await r.event('checkout.session.completed',{id:'cs_browser',payment_link:'plink_test',client_reference_id:intent.order,metadata:{homie:'purchase-links-v1',revision:'release1'},currency:'usd',amount_subtotal:1000,amount_total:1000,livemode:true,payment_status:'paid',payment_intent:'pi_browser'});assert.equal(response.status,200);return request.respond({status:200,contentType:'text/html',body:'<h1>Test payment complete</h1>'});}const response=await r.fetcher(request.url(),{method:request.method(),headers:request.headers(),...(request.postData()?{body:request.postData()}:{} )});await request.respond({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}catch(error){await request.abort();throw error;}});
 await page.goto(intent.url);assert.match(await page.$eval('h1',e=>e.textContent),/Camera/);await Promise.all([page.waitForNavigation(),page.click('button')]);assert.equal(new URL(page.url()).hostname,'buy.stripe.com',await page.content());await Promise.all([page.waitForNavigation(),page.click('button')]);assert.match(await page.$eval('h1',e=>e.textContent),/complete/);assert.equal((await r.post('/api/purchases/grant',{},claim)).status,200);
 }finally{await browser.close();await r.mf.dispose();await w.close();}
});

test('workerd: keyless renewals correlate invoice payments, failed refunds restore access and concurrent sessions each get one order',{timeout:60000},async()=>{
 const w=await world('workerd-keyless-renewal',{key:LIVE_KEY,saleOpts:{billing:'month'}});const r=await runtime(w,{keyless:true});
 try{
  const p=JSON.parse(readFileSync(join(w.dist,'parts/index.json'))).parts[0],claim=secret();const {digest}=await import('../worker/purchase-crypto.mjs');
  const intent=await(await r.post('/api/purchases/intent',{kind:'part',resource:p.id,version:p.version,buyer:secret(),claimHash:await digest(claim),offerVersion:p.releases[0].offerVersion})).json();assert.ok(intent.url,JSON.stringify(intent));assert.equal((await r.fetcher(intent.url,{method:'POST',headers:{origin},body:''})).status,303);
  const end=Math.floor(Date.now()/1000)+86400;
  const invoice={id:'in_month',subscription:'sub_month',status:'paid',currency:'usd',livemode:true,amount_remaining:0,total:1000,lines:{data:[{period:{end}}]}};
  const invoicePayment={id:'inpay_month',invoice:invoice.id,status:'paid',currency:'usd',livemode:true,payment:{type:'payment_intent',payment_intent:'pi_month'}};
  assert.equal((await r.event('invoice_payment.paid',invoicePayment)).status,200);assert.equal((await r.event('invoice.paid',invoice)).status,200);
  const session={id:'cs_month',subscription:'sub_month',payment_link:'plink_test',client_reference_id:intent.order,metadata:{homie:'purchase-links-v1',revision:'release1'},currency:'usd',amount_subtotal:1000,amount_total:1000,livemode:true,payment_status:'paid'};
  assert.equal((await r.event('checkout.session.completed',session)).status,200);assert.equal((await r.post('/api/purchases/grant',{},claim)).status,200);
  const refund={id:'re_month',payment_intent:'pi_month',currency:'usd',amount:500,status:'succeeded'};
  assert.equal((await r.event('refund.created',refund)).status,200);assert.equal((await r.post('/api/purchases/grant',{},claim)).status,200);
  assert.equal((await r.event('refund.created',{...refund,id:'re_month_second'})).status,200);assert.equal((await r.post('/api/purchases/grant',{},claim)).status,402);
  assert.equal((await r.event('refund.failed',{...refund,id:'re_month_second',status:'failed'})).status,200);assert.equal((await r.post('/api/purchases/grant',{},claim)).status,200);
  const results=await Promise.all(Array.from({length:4},()=>r.event('checkout.session.completed',{...session,id:'cs_month_two',subscription:'sub_month_two'})));assert.ok(results.every(r=>r.status===200),await Promise.all(results.map(r=>r.text())));
  assert.equal((await r.db.prepare('SELECT COUNT(*) n FROM purchase_orders').first()).n,2);
  assert.equal(r.hosts.length,0);
 }finally{await r.mf.dispose();await w.close();}
});
