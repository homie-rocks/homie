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
  let mf;try {
  const bundled=await build({bundle:true,write:false,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],stdin:{resolveDir:new URL('../worker/',import.meta.url).pathname,contents:`import worker, { useTools, useFunctions } from './selling/index.mjs';
    useTools(async()=>[{name:'translate',description:'Translate a word',audience:'public',price:{amount:250,currency:'usd'},inputSchema:{type:'object',properties:{word:{type:'string'}},required:['word'],additionalProperties:false},handler:async({word},ctx)=>{if(word==='fail')throw Error('private failure');await ctx.database.put('last',ctx.purchase.id);return {word:word.toUpperCase()};}}]);
    useFunctions(async()=>[{name:'paid-order',event:'order.paid',handler:async(event,ctx)=>ctx.database.put(event.id,event.data)}]);
    export default {async fetch(request,env,ctx){env.ASSETS={fetch:async(request)=>{const object=await env.STATIC.get(new URL(request.url).pathname);return object?new Response(object.body):new Response('',{status:404});}};if(new URL(request.url).pathname==='/__functions'){await (await import('./functions.mjs')).runFunctions(env,{games:[]},'https://seller.example');return Response.json({ok:true});}return worker.fetch(request,env,ctx);}};`}});
  const bindings={DB:{type:'d1',id:'purchases'},PURCHASE_MEDIA:{type:'r2',name:'paid'},STATIC:{type:'r2',name:'static'},PURCHASE_RATE_LIMITER:{type:'rate-limit',namespace:'purchases',simple:{limit:1000,period:60}}};
  for(const [key,value] of Object.entries(w.env))if(typeof value==='string' && (!keyless || !['STRIPE_KEY','TURNSTILE_SECRET','TURNSTILE_SITE_KEY'].includes(key))) bindings[key]={type:'json',value};
  if(keyless){bindings.STRIPE_SHOP_LINKS={type:'json',value:JSON.stringify({v:1,mode:'live',items:[]})};const p=JSON.parse(readFileSync(join(w.dist,'parts/index.json'))).parts[0];bindings.PURCHASE_LINKS={type:'json',value:JSON.stringify({v:1,mode:'live',offers:[{quantity,kind:'part',resource:p.id,version:p.version,offer:(await import('../worker/referrals.mjs')).canonicalJson(p.sale),id:'plink_test',url:'https://buy.stripe.com/test',revision:'release1'}]})};}
  const hosts=[];
  mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'seller',compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public','disallow_eval_during_startup'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:bindings},dev:{outboundService:{type:'fetcher',handler:async(req)=>{const url=new URL(req.url);hosts.push(url.hostname);if(handlers.has(url.hostname)) return handlers.get(url.hostname)(req);assert.equal(url.host,new URL(w.st.base).host,'only the seller provider may be contacted');return fetch(req.url,{method:req.method,headers:Object.fromEntries(req.headers),...(req.body?{body:await req.arrayBuffer()}:{} )});}}}}]});
  const db=await mf.getD1Database('DB');
  for(const file of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync(new URL(`../../../template/site/migrations/${file}`,import.meta.url),'utf8').replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[]) if(sql.trim())await db.prepare(sql).run();
  const media=await mf.getR2Bucket('PURCHASE_MEDIA');for(const [key,bytes]of w.objects)await media.put(key,bytes);
  const assets=await mf.getR2Bucket('STATIC');for(const path of readdirSync(w.dist,{recursive:true}).filter(p=>!p.endsWith('/')))try{await assets.put('/'+path,readFileSync(join(w.dist,path)));}catch(e){if(e.code!=='EISDIR')throw e;}
  await assets.put('/games.json',JSON.stringify(w.cat));
  const fetcher=async(input,init)=>{const req=input instanceof Request?new Request(input,init):new Request(input,init);assert.equal(new URL(req.url).origin,origin);const response=await mf.dispatchFetch(req.url,{redirect:'manual',method:req.method,headers:Object.fromEntries(req.headers),...(req.body?{body:await req.arrayBuffer()}:{} )});return new Response(await response.arrayBuffer(),{status:response.status,headers:Object.fromEntries(response.headers)});};
  const post=(path,body,claim)=>fetcher(origin+path,{method:'POST',headers:{'content-type':'application/json',...(claim?{authorization:`Bearer ${claim}`}:{})},body:JSON.stringify(body)});
  const event=async(type,object)=>{const body=JSON.stringify({id:'evt_'+secret(),type,created:Math.floor(Date.now()/1000),livemode:true,data:{object}}),t=Math.floor(Date.now()/1000);return fetcher(origin+'/api/shop/hook',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${await signPayload(body,w.env.STRIPE_WEBHOOK_SECRET,t)}`},body});};
  return{mf,db,fetcher,post,event,hosts};
  }catch(error){await mf?.dispose();await w.close();throw error;}
}

test('outside customer uses /mcp for catalogue, cart, standard payment, priced tool, replay and order function',{timeout:120000},async()=>{
 const w=await world('customer-mcp',{key:LIVE_KEY,shop:{v:1,till:'stripe',currency:'usd',refundDays:14,items:[{id:'coffee',name:'Coffee',kind:'supporter',price:400,gives:['coffee']}]}});
 await configureMachine(w,{profile:'profile_test'});const r=await runtime(w);
 const client=new Client({name:'outside-customer',version:'1'});
 try {
  await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{fetch:r.fetcher}));
  const names=(await client.listTools()).tools.map(t=>t.name);assert.ok(names.includes('studio_catalogue'));assert.ok(!names.includes('studio_office'));
  const browse=await client.callTool({name:'studio_catalogue',arguments:{}});assert.equal(browse.isError,undefined,JSON.stringify(browse));assert.match(JSON.stringify(browse),/Coffee/);
  const raw=await client.callTool({name:'translate',arguments:{word:'hello'}});assert.equal(raw.isError,undefined,JSON.stringify(raw));const {quote}=JSON.parse(raw.content[0].text);
  const args={word:'hello',_payment:{buyer:'a'.repeat(64),claim:'b'.repeat(64),offerVersion:quote.offerVersion}};
  const substitution=await client.callTool({name:'translate',arguments:{...args,_payment:{...args._payment,kind:'part',resource:'cheap',quote:'different-approved-quote'}}});
  assert.equal(substitution.isError,true,'buyer cannot replace the server-selected service with another purchase');
  assert.equal(w.st.pis.size,0);
  await assert.rejects(client.callTool({name:'translate',arguments:args}),e=>e.code===-32042);
  let charges=0;McpClient.wrap(client,{methods:[stripe.charge({paymentMethod:'pm_card',createToken:async()=>{const token='spt_customer_'+ ++charges;w.st.spts.set(token,{max:10000,currency:'usd'});return token;}})]});
  const paid=await client.callTool({name:'translate',arguments:args});assert.equal(paid.isError,undefined,JSON.stringify(paid));const result=JSON.parse(paid.content[0].text);assert.deepEqual(result.data,{word:'HELLO'});assert.ok(paid.receipt);
  const again=await client.callTool({name:'translate',arguments:args});assert.equal(JSON.parse(again.content[0].text).order,result.order);assert.equal(charges,1);
  await r.fetcher(origin+'/__functions');
  const fired=await r.db.prepare("SELECT value FROM tool_data WHERE namespace='function:paid-order' AND key=?1").bind('purchase_orders:'+result.order+':paid').first();assert.equal(JSON.parse(fired.value).order,result.order);
  const cart=await client.callTool({name:'studio_cart',arguments:{lines:[{item:'coffee',quantity:2}]}});assert.equal(cart.isError,undefined,JSON.stringify(cart));const offer=JSON.parse(cart.content[0].text).data;
  const bought=await client.callTool({name:'studio_purchase',arguments:{kind:offer.kind,resource:offer.resource,version:offer.version,offerVersion:offer.offerVersion,buyer:'c'.repeat(64),claim:'d'.repeat(64)}});assert.equal(bought.isError,undefined,JSON.stringify(bought));
  const cookie=offer.account.cookies[0].split(';')[0];
  const mine=await r.fetcher(origin+'/api/shop/mine',{headers:{cookie}});assert.equal(mine.status,200);assert.match(await mine.text(),/coffee/);
  const order=JSON.parse(bought.content[0].text).order;assert.ok(order);assert.equal((await r.db.prepare('SELECT status FROM shop_orders WHERE id=?1').bind(order).first()).status,'paid');
  assert.equal((await r.db.prepare('SELECT quantity FROM shop_entitlement_lines WHERE order_id=?1').bind(order).first()).quantity,2);
  assert.equal(charges,2);
  const payment=(await r.db.prepare('SELECT payment FROM purchase_orders WHERE id=?1').bind(order).first()).payment;
  const refund=w.st.refund(payment);const webhook=await r.event('charge.refunded',refund);assert.equal(webhook.status,200,await webhook.clone().text());
  assert.equal((await r.db.prepare('SELECT status FROM shop_orders WHERE id=?1').bind(order).first()).status,'refunded');
  assert.equal((await r.db.prepare('SELECT state FROM shop_entitlement_lines WHERE order_id=?1').bind(order).first()).state,'revoked');
  assert.equal(await r.db.prepare("SELECT id FROM studio_events WHERE type='order.refunded' AND json_extract(data,'$.order')=?1").bind(order).first(),null,'undeclared event types are not retained');
  assert.ok(r.hosts.every(h=>h===new URL(w.st.base).hostname),'No Homie payment dependency');
 }finally{await client.close();await r.mf.dispose();await w.close();}
});

test('a person approves a priced service on the studio Stripe checkout and the AI resumes the same order',{timeout:120000},async()=>{
 const w=await world('customer-hosted',{key:LIVE_KEY});delete w.env.TURNSTILE_SECRET;const r=await runtime(w);const client=new Client({name:'personal-ai',version:'1'});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{fetch:r.fetcher}));
  const quote=JSON.parse((await client.callTool({name:'translate',arguments:{word:'approved'}})).content[0].text).quote;
  const args={word:'approved',_payment:{buyer:'1'.repeat(64),claim:'2'.repeat(64),offerVersion:quote.offerVersion,checkout:true}};
  const approval=await client.callTool({name:'translate',arguments:args});assert.equal(approval.isError,undefined,JSON.stringify(approval));const intent=JSON.parse(approval.content[0].text);assert.equal(new URL(intent.url).origin,origin);
  const opened=await r.fetcher(intent.url,{method:'POST',headers:{origin},body:''});assert.equal(opened.status,303,await opened.clone().text());assert.equal(new URL(opened.headers.get('location')).hostname,'checkout.stripe.com');
  const session=[...w.st.sessions.values()].at(-1);assert.ok(session);await r.event('checkout.session.completed',w.st.complete(session.id));
  args._payment.checkout=false;const executed=await client.callTool({name:'translate',arguments:args});assert.equal(executed.isError,undefined,JSON.stringify(executed));const result=JSON.parse(executed.content[0].text);assert.deepEqual(result.data,{word:'APPROVED'});assert.equal(result.order,intent.order);
  assert.equal(w.st.pis.size,1);assert.equal((await r.db.prepare('SELECT COUNT(*) n FROM purchase_orders').first()).n,1);
 }finally{await client.close();await r.mf.dispose();await w.close();}
});

test('claim and web refunds share tip and used-item policy; guest quotes return usable sessions before charging',{timeout:120000},async()=>{
 const w=await world('customer-refund-policy',{key:LIVE_KEY,shop:{v:1,till:'stripe',currency:'usd',refundDays:14,guestBuyersPerAddressPerHour:3,policy:{refundUsedItems:false},items:[{id:'coins',name:'Coins',kind:'supporter',price:400,gives:['coins']},{id:'tip',name:'Tip',kind:'tip',price:100}]}});
 await configureMachine(w,{profile:'profile_test'});const r=await runtime(w),client=new Client({name:'refund-test',version:'1'});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{fetch:r.fetcher}));let charges=0;
  McpClient.wrap(client,{methods:[stripe.charge({paymentMethod:'pm_card',createToken:async()=>{const token='spt_refund_'+ ++charges;w.st.spts.set(token,{max:10000,currency:'usd'});return token;}})]});
  for(const [i,item] of ['tip','coins','coins'].entries()){
    const quoted=await client.callTool({name:'studio_cart',arguments:{lines:[{item}]}});assert.equal(quoted.isError,undefined,JSON.stringify(quoted));const offer=JSON.parse(quoted.content[0].text).data;
    assert.ok(offer.account.cookies.length);assert.ok(await r.db.prepare('SELECT id FROM players WHERE id=?1').bind(offer.account.player.id).first());
    const claim=String(i+1).repeat(64),buyer=String(i+4).repeat(64);
    const result=await client.callTool({name:'studio_purchase',arguments:{kind:offer.kind,resource:offer.resource,version:offer.version,offerVersion:offer.offerVersion,claim,buyer}});assert.equal(result.isError,undefined,JSON.stringify(result));const order=JSON.parse(result.content[0].text).order;
    const cookie=offer.account.cookies[0].split(';')[0];const mine=await r.fetcher(origin+'/api/shop/mine',{headers:{cookie}});assert.equal(mine.status,200);assert.match(await mine.text(),new RegExp(order));
    if(i===1)await r.db.prepare('UPDATE entitlements SET used_at=?2 WHERE order_id=?1').bind(order,Date.now()).run();
    if(i<2){const web=await r.fetcher(origin+'/api/shop/refund',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({order})});assert.equal(web.status,403,await web.clone().text());const claimRefund=await r.post('/api/purchases/refund',{},claim);assert.equal(claimRefund.status,403,await claimRefund.clone().text());if(i===1){w.cat.shop.policy={...w.cat.shop.policy,refundUsedItems:true};await (await r.mf.getR2Bucket('STATIC')).put('/games.json',JSON.stringify(w.cat));const allowed=await r.post('/api/purchases/refund',{},claim);assert.equal(allowed.status,200,await allowed.clone().text());assert.equal((await allowed.json()).ok,true,'studio explicitly allows used-item refunds');}}
    else {const refund=await r.post('/api/purchases/refund',{},claim);assert.equal(refund.status,200,await refund.clone().text());assert.equal((await refund.json()).ok,true);}
  }
  const blocked=await client.callTool({name:'studio_cart',arguments:{lines:[{item:'coins'}]}});assert.equal(blocked.isError,true);assert.equal(charges,3,'opted-in guest refusal happens before any payment');
 }finally{await client.close();await r.mf.dispose();await w.close();}
});

test('paid MCP handler failure refunds at Stripe and claim retry reports the same refund',{timeout:120000},async()=>{
 const w=await world('customer-service-refund',{key:LIVE_KEY});await configureMachine(w,{profile:'profile_test'});const r=await runtime(w),client=new Client({name:'service-failure',version:'1'});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{fetch:r.fetcher}));let charges=0;
  const quote=JSON.parse((await client.callTool({name:'translate',arguments:{word:'fail'}})).content[0].text).quote;
  McpClient.wrap(client,{methods:[stripe.charge({paymentMethod:'pm_card',createToken:async()=>{const token='spt_failure_'+ ++charges;w.st.spts.set(token,{max:10000,currency:'usd'});return token;}})]});
  const args={word:'fail',_payment:{buyer:'f'.repeat(64),claim:'e'.repeat(64),offerVersion:quote.offerVersion}};
  const failed=await client.callTool({name:'translate',arguments:args});assert.equal(failed.isError,true);const data=JSON.parse(failed.content[0].text);assert.equal(data.state,'refunded',JSON.stringify(data));assert.match(data.message,/automatically refunded/);
  const again=await client.callTool({name:'translate',arguments:args});assert.deepEqual(JSON.parse(again.content[0].text),data);assert.equal(charges,1);assert.equal(w.st.refunds.length,1);
 }finally{await client.close();await r.mf.dispose();await w.close();}
});

test('hosted cart checkout binds the account from the quote and returns grants to that session',{timeout:120000},async()=>{
 const w=await world('customer-hosted-cart',{key:LIVE_KEY,shop:{v:1,till:'stripe',currency:'usd',items:[{id:'coffee',name:'Coffee',kind:'supporter',price:400,gives:['coffee']}]}});delete w.env.TURNSTILE_SECRET;
 const r=await runtime(w),client=new Client({name:'hosted-cart',version:'1'});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{fetch:r.fetcher}));
  const quoted=await client.callTool({name:'studio_cart',arguments:{lines:[{item:'coffee'}]}});assert.equal(quoted.isError,undefined,JSON.stringify(quoted));const offer=JSON.parse(quoted.content[0].text).data;
  const checkout=await client.callTool({name:'studio_purchase',arguments:{kind:offer.kind,resource:offer.resource,version:offer.version,offerVersion:offer.offerVersion,buyer:'a'.repeat(64),claim:'b'.repeat(64),checkout:true}});assert.equal(checkout.isError,undefined,JSON.stringify(checkout));
  const row=await r.db.prepare('SELECT player FROM shop_orders').first();assert.equal(row.player,offer.account.player.id);assert.equal((await r.db.prepare('SELECT COUNT(*) n FROM players').first()).n,1);
  const session=[...w.st.sessions.values()].at(-1);const hook=await r.event('checkout.session.completed',w.st.complete(session.id));assert.equal(hook.status,200,await hook.clone().text());
  const mine=await r.fetcher(origin+'/api/shop/mine',{headers:{cookie:offer.account.cookies[0].split(';')[0]}});assert.match(await mine.text(),/coffee/);
 }finally{await client.close();await r.mf.dispose();await w.close();}
});
