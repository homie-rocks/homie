/** Manual, local-only acceptance trial of a packed toolkit and freshly scaffolded studio. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,symlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Miniflare} from 'miniflare';
import {newStudio} from '../lib/scaffold.mjs';
import {world,TEST_KEY,configureMachine} from './paid-parts-review4-harness.mjs';
import {Client,StreamableHTTPClientTransport} from 'mcp-studio-client';
import {McpClient} from 'mppx/mcp/client';
import {stripe} from 'mppx/client';
const repo=resolve(new URL('../../../',import.meta.url).pathname),scratch=mkdtempSync(join('/tmp','homie-customers-trial-')),root=join(scratch,'studio');
newStudio(root,{name:'Customer trial',install:false});
const packed=JSON.parse(execFileSync('npm',['pack','./packages/studio','--pack-destination',scratch,'--json'],{cwd:repo,encoding:'utf8'}))[0].filename;
mkdirSync(join(root,'node_modules','@homie-rocks'),{recursive:true});
for(const name of readdirSync(join(repo,'node_modules')))if(name!=='@homie-rocks'&&name!=='.bin')symlinkSync(join(repo,'node_modules',name),join(root,'node_modules',name));
for(const name of readdirSync(join(repo,'node_modules','@homie-rocks')))if(name!=='studio')symlinkSync(join(repo,'node_modules','@homie-rocks',name),join(root,'node_modules','@homie-rocks',name));
mkdirSync(join(root,'node_modules','@homie-rocks','studio'));execFileSync('tar',['-xzf',join(scratch,packed),'--strip-components=1','-C',join(root,'node_modules','@homie-rocks','studio')]);
symlinkSync(join(repo,'packages/studio/node_modules'),join(root,'node_modules/@homie-rocks/studio/node_modules'));
const shop={v:1,till:'stripe',currency:'usd',items:[{id:'coffee',name:'Coffee',kind:'supporter',price:400,gives:['coffee']}]};
writeFileSync(join(root,'shop.json'),JSON.stringify(shop));mkdirSync(join(root,'tools'));mkdirSync(join(root,'functions'));
writeFileSync(join(root,'tools','translate.ts'),`import {defineTool} from '@homie-rocks/studio/tools';export default defineTool<{word:string}>({name:'translate',description:'Translate a word',audience:'public',price:{amount:250,currency:'usd'},inputSchema:{type:'object',properties:{word:{type:'string'}},required:['word'],additionalProperties:false},async handler({word},ctx){await ctx.database.put('last',ctx.purchase!.id);return {word:word.toUpperCase()};}});`);
writeFileSync(join(root,'functions','order.ts'),`import {defineFunction} from '@homie-rocks/studio/functions';export default defineFunction({name:'order-ready',event:'order.paid',async handler(event,ctx){await ctx.database.put(event.id,event.data);}});`);
execFileSync(process.execPath,[join(root,'node_modules/@homie-rocks/studio/bin/homie-studio.mjs'),'build'],{cwd:root,stdio:'pipe',encoding:'utf8'});
const before=readFileSync(join(root,'wrangler.jsonc'),'utf8');execFileSync(process.execPath,[join(root,'node_modules/@homie-rocks/studio/bin/homie-studio.mjs'),'build'],{cwd:root,stdio:'pipe',encoding:'utf8'});assert.equal(readFileSync(join(root,'wrangler.jsonc'),'utf8'),before);
const w=await world('scratch-trial',{key:TEST_KEY,shop});await configureMachine(w,{profile:'profile_test'});
const runtime=join(root,'site/src/runtime'),modules=Object.fromEntries(readdirSync(runtime).filter(f=>f.endsWith('.js')).map(f=>[f,{type:'esm',contents:readFileSync(join(runtime,f),'utf8')} ]));
modules['entry.mjs']={type:'esm',contents:`import worker from './worker.js';export * from './worker.js';export default {async fetch(request,env,ctx){env.ASSETS={fetch:async r=>{const o=await env.STATIC.get(new URL(r.url).pathname);return o?new Response(o.body):new Response('',{status:404});}};return worker.fetch(request,env,ctx);}};`};
const bindings={DB:{type:'d1',id:'trial'},STATIC:{type:'r2',name:'static'}};for(const [key,value] of Object.entries(w.env))if(typeof value==='string'&&!key.startsWith('TURNSTILE'))bindings[key]={type:'json',value};
const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'customer-trial',compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'entry.mjs',modules},env:bindings}}]});
let client;
try {
 const db=await mf.getD1Database('DB');for(const file of readdirSync(join(root,'site/migrations')).sort())for(const sql of readFileSync(join(root,'site/migrations',file),'utf8').replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(sql.trim())await db.prepare(sql).run();
 const assets=await mf.getR2Bucket('STATIC'),dist=join(root,'site/dist');for(const file of readdirSync(dist,{recursive:true}))try{await assets.put('/'+file,readFileSync(join(dist,file)));}catch(e){if(e.code!=='EISDIR')throw e;}
 const origin=(await mf.ready).origin;client=new Client({name:'outside-trial-client',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp')));
 const names=(await client.listTools()).tools.map(t=>t.name);assert.ok(!names.includes('studio_office'));assert.ok(names.includes('studio_purchase'));
 const browse=await client.callTool({name:'studio_catalogue',arguments:{}});assert.match(JSON.stringify(browse),/Coffee/);
 let charges=0;McpClient.wrap(client,{methods:[stripe.charge({paymentMethod:'pm_card',createToken:async()=>{const token='spt_trial_'+ ++charges;w.st.spts.set(token,{max:10000,currency:'usd'});return token;}})]});
 const approveTest=async()=>{await db.prepare('INSERT OR IGNORE INTO purchase_test_approvals(order_id,value) SELECT id,claim_hash FROM purchase_orders WHERE mode=\'test\'').run();};
 const quoted=await client.callTool({name:'studio_cart',arguments:{lines:[{item:'coffee',quantity:2}]}});assert.equal(quoted.isError,undefined,JSON.stringify(quoted));const quote=JSON.parse(quoted.content[0].text).data;
 const purchase={name:'studio_purchase',arguments:{...quote,buyer:'a'.repeat(64),claim:'b'.repeat(64)}};
 await client.callTool(purchase);await approveTest();const bought=await client.callTool(purchase);assert.equal(bought.isError,undefined,JSON.stringify(bought));const order=JSON.parse(bought.content[0].text).order;
 const serviceQuote=JSON.parse((await client.callTool({name:'translate',arguments:{word:'hello'}})).content[0].text).quote;
 const call={name:'translate',arguments:{word:'hello',_payment:{buyer:'c'.repeat(64),claim:'d'.repeat(64),offerVersion:serviceQuote.offerVersion}}};await client.callTool(call);await approveTest();const service=await client.callTool(call);assert.equal(service.isError,undefined,JSON.stringify(service));assert.deepEqual(JSON.parse(service.content[0].text).data,{word:'HELLO'});
 await client.callTool(call);assert.equal(charges,2);
 // A new request runs the registered dispatcher; no browser timing race or sleep.
 await client.callTool({name:'studio_catalogue',arguments:{}});
 const state=await db.prepare('SELECT status FROM shop_orders WHERE id=?1').bind(order).first();assert.equal(state.status,'paid');
 const fired=await db.prepare("SELECT value FROM tool_data WHERE namespace='function:order-ready' AND key=?1").bind('purchase_orders:'+order+':paid').first();assert.ok(fired,'order function ran');
 const report={scratch,origin,toolkit:JSON.parse(readFileSync(join(root,'node_modules/@homie-rocks/studio/package.json'))).version,publicTools:names,cartOrder:order,entitlements:(await db.prepare('SELECT key,quantity FROM shop_entitlement_lines WHERE order_id=?1').bind(order).all()).results,service:JSON.parse(service.content[0].text),charges,functionEvent:JSON.parse(fired.value),provider:'Local stateful Stripe stand-in, standard MPP test payment; no real charge',repeatBuildConfigStable:true};
 writeFileSync(join(scratch,'trial.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await client?.close();await mf.dispose();await w.close();}
