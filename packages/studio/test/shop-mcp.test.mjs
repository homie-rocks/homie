import {stripeFixture as fixture} from './selling-stripe-fixture.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {shopMcpPlan,saveMcpVerification,readKey} from '../lib/shop-mcp.mjs';
import {syncPaymentLinks} from '../lib/shop-links.mjs';

function studio(t) {
 const root=mkdtempSync(join(tmpdir(),'shop-mcp-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(join(root,'studio.json'),JSON.stringify({name:'Proof',slug:'proof',cloudflare:{domain:'proof.example'}}));
 writeFileSync(join(root,'shop.json'),JSON.stringify({till:'stripe',currency:'usd',automaticTax:false,items:[{id:'coffee',name:'Coffee',price:300},{id:'cake',name:'Cake',price:400},{id:'giving',name:'Monthly giving',price:1000,interval:'month'}]}));
 return root;
}
async function reconcile(root,f,options={}) {
 let observations=[],writes=[];
 for(let i=0;i<150;i++) {
   const p=await shopMcpPlan(root,{refresh:true,...options,observations});
   if(p.verified){await saveMcpVerification(root,{...options,observations});return {p,observations,writes};}
   assert.ok(p.operations,JSON.stringify(p));
   for(const op of p.operations) {
     const body=f.call(op);
     observations.push({...op,body});
     if(op.method!=='GET'){assert.ok(op.idempotency || op.path.split('/').length>3);writes.push(op);}
   }
 }
 throw new Error('Plan did not converge');
}
test('read observations match independently of parameter ordering',()=>{
 assert.equal(readKey('/v1/products',{limit:100,starting_after:'prod_1'}),readKey('/v1/products',{starting_after:'prod_1',limit:100}));
});

test('official MCP plan converges and verifies items, menu, slots, recurring and portal from API fixtures',async t=>{
 const root=studio(t),f=fixture(),slots=[{app:'classes',collection:'bookings',slots:'sessions',slot:'monday',item:'coffee',capacity:2}];
 const {p,observations,writes}=await reconcile(root,f,{slots});
 assert.equal(p.config.items.length,3);assert.equal(p.config.menus.length,1);assert.equal(p.config.slots[0].limit,2);assert.ok(p.config.portal);
 assert.equal(writes.some(o=>o.path.includes('webhook')),false);
 assert.ok(writes.some(o=>o.params.default_price_data?.recurring?.interval==='month'));
 const again=await saveMcpVerification(root,{slots,observations,account:'acct_fixture'});assert.equal(again.verified,true);
 assert.equal((await reconcile(root,f,{slots})).writes.length,0);
 assert.equal(JSON.parse(readFileSync(join(root,'.studio','stripe-mcp.json'))).result.verified,true);
 f.rows.prices[0].unit_amount=999;
 await assert.rejects(()=>reconcile(root,f,{slots}),/differs from shop.json|Slot service price changed/);
});
test('verification rejects wrong mode, secrets, pagination gaps and drifted link fields',async t=>{
 const root=studio(t),f=fixture();await reconcile(root,f);
 f.rows.payment_links[0].after_completion.redirect.url='https://wrong.example';
 await assert.rejects(()=>reconcile(root,f),/differs from its planned fields/);
 const first=await shopMcpPlan(root,{refresh:true});assert.equal(first.next.method,'GET');
 await assert.rejects(()=>shopMcpPlan(root,{observations:[{...first.next,body:{data:[{livemode:true}],has_more:false}}]}),/wrong mode/);
 await assert.rejects(()=>shopMcpPlan(root,{observations:[{body:{secret:'whsec_fixture'}}]}),/never credentials/);
 const page=await shopMcpPlan(root,{observations:[{...first.next,body:{data:[{id:'prod_cursor'}],has_more:true,next_page:'page_cursor'}}]});
 assert.equal(page.next.params.page,'page_cursor');
});
test('private webhook installer sends secret only to Wrangler stdin without outputting it',async()=>{
 const secret='whsec_private_fixture',saved=[],receipts=[];
 const options={api:async(method,path)=>path==='/v1/webhook_endpoints'?method==='GET'?{data:[],has_more:false}:{id:'we_fixture',secret}:assert.fail(path),shop:{},slug:'proof',site:'https://proof.example',mode:'test',catalog:{config:{v:1,mode:'test',items:[]},retire:[]},saveReceipt:r=>receipts.push(r),w:async(args,opts)=>{if(args[1]==='list')return {code:0,stdout:'[]'};saved.push({args,opts});return {code:0};}};
 const result=await syncPaymentLinks(options);
 assert.equal(result.ok,true);assert.ok(saved[0].opts.input.includes(secret));assert.equal(saved[0].args.includes(secret),false);
 assert.equal(JSON.stringify({result,receipts}).includes(secret),false);
});

test('booking pause, recount and repeated verification never grant additional seats',async t=>{
 const root=studio(t),f=fixture();
 const slot={app:'classes',collection:'bookings',slots:'sessions',slot:'monday',item:'coffee',capacity:3};
 const initial=await reconcile(root,f,{slots:[slot]});
 const link=f.rows.payment_links.find(l=>l.id===initial.p.config.slots[0].id);
 link.restrictions.completed_sessions.count=1;
 const paused=await reconcile(root,f,{slots:[{...slot,active:false}]});assert.equal(paused.p.config.slots[0].active,false);
 const slots=[{...slot,active:true,confirmed:0}];
 const resumed=await reconcile(root,f,{slots});assert.equal(resumed.p.config.slots[0].limit,4);
 link.restrictions.completed_sessions.count=2;
 const again=await reconcile(root,f,{slots});assert.equal(again.p.config.slots[0].limit,4);assert.equal(again.writes.length,0);
 const removed=await reconcile(root,f,{slots:[]});assert.equal(removed.p.config.slots.length,0);assert.equal(link.active,false);
});

test('private installer refuses missing verification before login and a different CLI account before writes',async t=>{
 const {shopConnect}=await import('../lib/stripe-connect.mjs');
 const root=studio(t),f=fixture();
 const noPlan=await shopConnect(root,{webhookOnly:true,exec:()=>assert.fail('No login before verification')});assert.equal(noPlan.needs,'verify');
 const {observations}=await reconcile(root,f);
 await saveMcpVerification(root,{observations,account:'acct_fixture'});
 const result=await shopConnect(root,{webhookOnly:true,storage:join(root,'private'),exec:async args=>({code:0,stdout:JSON.stringify(args.includes('/v1/account')?{id:'acct_other'}:{data:[]})}),wrangler:()=>assert.fail('No secret write for a different account')});
 assert.equal(result.needs,'account');
});

test('local forwarding captures split secret output privately and never logs it',async t=>{
 const {EventEmitter}=await import('node:events');const {PassThrough}=await import('node:stream');
 const {shopListen}=await import('../lib/shop-listen.mjs');
 const root=studio(t),lines=[],secret='whsec_fixturePrivateListenerValue';
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',0);
 const done=shopListen(root,{profile:'fixture',exec:async()=>({code:0}),spawnProcess:()=>{queueMicrotask(()=>{
   child.stderr.write('Ready! Signing secret: whsec_fixture');
   assert.equal(lines.length,0);
   child.stderr.write('PrivateListenerValue\n');
   child.emit('close',0);
 });return child;},log:line=>lines.push(line)});
 assert.equal((await done).ready,true);
 assert.equal(lines.length,1);assert.equal(lines.join('').includes(secret),false);
 assert.ok(readFileSync(join(root,'.dev.vars'),'utf8').includes(secret));
});

test('CLI verification preserves the next operation without requiring --json',async t=>{
 const {spawnSync}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const root=studio(t);
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../bin/homie-studio.mjs',import.meta.url)),'shop','verify'],{cwd:root,encoding:'utf8'});
 assert.equal(result.status,1);
 const report=JSON.parse(result.stdout);
 assert.equal(report.verified,false);assert.equal(report.next.method,'GET');assert.equal(report.next.path,'/v1/products/search');
});

test('planner batches independent product writes and retains write observations',async t=>{
 const root=studio(t), observations=[];
 for(let i=0;i<10;i++) {
   const plan=await shopMcpPlan(root,{observations});
   const operations=plan.operations??[plan.next];
   if(operations.some(op=>op.method==='POST')) {
     assert.equal(operations.filter(op=>op.path==='/v1/products').length,3);
     assert.ok(operations.every(op=>op.params.default_price_data));
     return;
   }
   observations.push(...operations.map(op=>({...op,body:op.path.startsWith('/v1/products/')&&!op.path.endsWith('/search')?{error:{code:'resource_missing'}}:{data:[],has_more:false}})));
 }
 assert.fail('No product batch');
});

test('verified public links become deploy bindings and storage omits observations',async t=>{
 const {refreshWorkerConfig}=await import('../lib/worker-config.mjs');
 const root=studio(t), f=fixture();
 writeFileSync(join(root,'studio.json'),JSON.stringify({name:'Proof',slug:'proof',cloudflare:{domain:'proof.example',worker:'proof',d1:'proof'}}));
 mkdirSync(join(root,'site'),{recursive:true});
 const {observations}=await reconcile(root,f);await saveMcpVerification(root,{observations,account:'acct_fixture'});
 const saved=JSON.parse(readFileSync(join(root,'.studio','stripe-mcp.json')));assert.equal(saved.options.observations,undefined);
 refreshWorkerConfig(root);
 const config=JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8').replace(/^\s*\/\/.*$/gm,''));
 assert.equal(config.vars.STRIPE_CHECKOUT_MODE,'links');assert.equal(config.vars.STRIPE_SHOP_LINKS_ASSET,'/_site/stripe-shop-links.json');
});

test('public checkout with verified links names only the private webhook step',async t=>{
 const {DatabaseSync}=await import('node:sqlite');const {readdirSync}=await import('node:fs');
 const {customerTools}=await import('../worker/customer-mcp.mjs');const {readShop}=await import('../lib/shop.mjs');
 const root=studio(t),f=fixture(),{p}=await reconcile(root,f),sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const file of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort())sql.exec(readFileSync(new URL('../../../template/site/migrations/'+file,import.meta.url),'utf8'));
 const DB={prepare:q=>({first:async()=>sql.prepare(q).get()??null})};
 const env={DB,STRIPE_CHECKOUT_MODE:'links',STRIPE_SHOP_LINKS:JSON.stringify(p.config)};
 const tool=customerTools(env,{shop:readShop(root).shop,games:[]},'https://proof.example').find(t=>t.name==='studio_checkout');
 const result=await tool.handler({lines:[{item:'coffee'}]},{caller:{id:null,owner:false}});
 assert.equal(result.error,'closed');assert.deepEqual(result.missing,['webhook-secret']);assert.match(result.next,/shop webhook/);
});

test('partial batches resume from responses without account-wide reads or separate default updates',async t=>{
 const root=studio(t),f=fixture(),observations=[];
 writeFileSync(join(root,'shop.json'),JSON.stringify({till:'stripe',currency:'usd',automaticTax:false,items:[{id:'one',name:'One',price:300},{id:'tip',name:'Tip',price:'choose',min:200,max:2000},{id:'month',name:'Monthly',price:500,interval:'month'}]}));
 const first=await shopMcpPlan(root);assert.deepEqual(first.operations.map(o=>o.path),['/v1/products/search','/v1/prices/search','/v1/payment_links']);
 for(const op of first.operations){if(op.params.query)assert.match(op.params.query,/metadata\['studio'\]:'proof'/);observations.push({...op,body:f.call(op)});}
 const lookups=await shopMcpPlan(root,{observations});
 for(const op of lookups.operations)observations.push({...op,body:f.call(op)});
 const products=await shopMcpPlan(root,{observations});assert.equal(products.operations.length,3);
 const op=products.operations[0];observations.push({...op,body:f.call(op)});
 const resumed=await shopMcpPlan(root,{observations});assert.equal(resumed.operations.filter(o=>o.path==='/v1/products').length,2);assert.equal(resumed.operations.some(o=>o.method==='GET'),false);
 const writes=[];
 for(let i=0;i<20;i++){
   const plan=await shopMcpPlan(root,{observations});if(plan.verified){assert.equal(plan.config.items.length,3);break;}
   for(const operation of plan.operations){writes.push(operation);observations.push({...operation,body:f.call(operation)});}
 }
 assert.equal(writes.some(op=>op.path==='/v1/prices'),false);assert.equal(writes.some(op=>Object.hasOwn(op.params,'default_price')),false);
 const verified=await saveMcpVerification(root,{observations,account:'acct_fixture'});assert.equal(verified.verified,true);
 const file=readFileSync(join(root,'.studio/stripe-mcp.json'),'utf8');assert.ok(Buffer.byteLength(file)<8000);assert.equal(file.includes('observations'),false);
});

test('deploy refuses changed shop configuration until verified again',async t=>{
 const {verifiedMcpConfig}=await import('../lib/shop-mcp.mjs');const root=studio(t),f=fixture();await reconcile(root,f);
 assert.ok(verifiedMcpConfig(root));const shop=JSON.parse(readFileSync(join(root,'shop.json')));shop.items[0].price+=1;writeFileSync(join(root,'shop.json'),JSON.stringify(shop));
 assert.throws(()=>verifiedMcpConfig(root),/verify/);
});

test('verified MCP baskets retain the released aggregate link and verify its fields',async t=>{
 const root=studio(t),f=fixture();const shop=JSON.parse(readFileSync(join(root,'shop.json')));shop.items=shop.items.slice(0,2);shop.basket={name:'Order',description:'Your order'};writeFileSync(join(root,'shop.json'),JSON.stringify(shop));
 const {p,writes}=await reconcile(root,f);assert.equal(p.config.menus[0].basket,true);assert.equal(writes.filter(op=>op.path==='/v1/products').length,3);assert.equal(writes.some(op=>op.path==='/v1/prices'),false);
 f.rows.payment_links.find(l=>l.id===p.config.menus[0].id).automatic_tax.enabled=true;
 await assert.rejects(()=>reconcile(root,f),/differs from its planned fields/);
});

test('verification fingerprints the effective file-backed slot manifest for deployment',async t=>{
 const {verifiedMcpConfig}=await import('../lib/shop-mcp.mjs');const root=studio(t),f=fixture();mkdirSync(join(root,'.studio'),{recursive:true});
 const slots=[{app:'classes',collection:'bookings',slots:'sessions',slot:'monday',item:'coffee',capacity:2}];writeFileSync(join(root,'.studio/booking-slots.json'),JSON.stringify(slots));
 await reconcile(root,f);assert.equal(verifiedMcpConfig(root).result.config.slots.length,1);
});

test('write observations match nested API parameter ordering',()=>{
 assert.equal(readKey('/v1/products',{default_price_data:{currency:'usd',unit_amount:300},metadata:{studio:'proof',origin:'https://proof.example'}}),readKey('/v1/products',{metadata:{origin:'https://proof.example',studio:'proof'},default_price_data:{unit_amount:300,currency:'usd'}}));
});

test('local verification remains usable for dev builds without installing localhost links in deploy vars',async t=>{
 const {verifiedMcpConfig}=await import('../lib/shop-mcp.mjs');const root=studio(t),f=fixture();await reconcile(root,f,{url:'http://localhost:8787'});
 assert.equal(verifiedMcpConfig(root),null);assert.match(readFileSync(join(root,'.dev.vars'),'utf8'),/STRIPE_SHOP_LINKS=base64:/);
});

test('missing legacy portal ID discovers the existing portal without a duplicate',async t=>{
 const root=studio(t),f=fixture();await reconcile(root,f);
 const file=join(root,'.studio','stripe-mcp.json'),saved=JSON.parse(readFileSync(file));
 delete saved.result.config.portalId;writeFileSync(file,JSON.stringify(saved));
 rmSync(join(root,'.studio','stripe-mcp-observations.json'));
 const result=await reconcile(root,f);
 assert.equal(f.rows.configurations.length,1);
 assert.equal(result.writes.filter(o=>o.path==='/v1/billing_portal/configurations').length,0);
 assert.equal(result.p.config.portalId,f.rows.configurations[0].id);
});

test('legacy verification without account migrates from the signed-in account after reading its links',async t=>{
 const {shopConnect}=await import('../lib/stripe-connect.mjs');
 const root=studio(t),f=fixture();await reconcile(root,f);
 const file=join(root,'.studio','stripe-mcp.json'),saved=JSON.parse(readFileSync(file));delete saved.result.config.portalId;writeFileSync(file,JSON.stringify(saved));
 const reads=[];
 const result=await shopConnect(root,{webhookOnly:true,storage:join(root,'private'),open:()=>assert.fail('saved login'),exec:async args=>{
   const path=args.find(a=>a.startsWith('/v1/'));reads.push(path);
   if(path==='/v1/billing_portal/configurations')return {code:0,stdout:JSON.stringify(f.call({method:'GET',path,params:{}}))};
   if(path==='/v1/account')return {code:0,stdout:'{"id":"acct_fixture"}'};
   if(path?.startsWith('/v1/payment_links/'))return {code:0,stdout:JSON.stringify(f.call({method:'GET',path,params:{}}))};
   if(path==='/v1/webhook_endpoints'&&args.includes('post'))return {code:0,stdout:'{"id":"we_fixture","secret":"whsec_fixture"}'};
   return {code:0,stdout:'{"data":[],"has_more":false}'};
 },wrangler:async()=>({code:0,stdout:'[]'})});
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.ok(reads.some(p=>p?.startsWith('/v1/payment_links/')));
 assert.equal(JSON.parse(readFileSync(join(root,'.studio','stripe-mcp.json'))).options.account,'acct_fixture');
 assert.equal(JSON.parse(readFileSync(file)).result.config.portalId,f.rows.configurations[0].id);
});

test('observation helper accumulates incremental official-plugin responses and reuses links by metadata',async t=>{
 const {recordShopObservations}=await import('../lib/shop-mcp.mjs');
 const root=studio(t),f=fixture();const first=await reconcile(root,f);
 rmSync(join(root,'.studio'),{recursive:true});
 let plan=await shopMcpPlan(root),writes=[];
 for(let i=0;i<30&&!plan.verified;i++) {
   const observations=plan.operations.map(op=>{if(op.method==='POST')writes.push(op);return {...op,body:f.call(op)};});
   plan=await recordShopObservations(root,{observations});
 }
 assert.equal(plan.verified,true);assert.deepEqual(writes,[]);
 assert.deepEqual(plan.config.items.map(i=>i.id).sort(),first.p.config.items.map(i=>i.id).sort());
});

test('supporter and deposit Payment Links lock quantity while ordinary items remain adjustable',async t=>{
 const root=studio(t);writeFileSync(join(root,'shop.json'),JSON.stringify({till:'stripe',currency:'usd',items:[{id:'support',kind:'supporter',name:'Support',price:500},{id:'deposit',kind:'deposit',name:'Deposit',price:'choose'},{id:'item',name:'Item',price:300}]}));
 const f=fixture();const {p}=await reconcile(root,f);
 for(const id of ['support','deposit']) {const link=f.rows.payment_links.find(l=>l.id===p.config.items.find(i=>i.item===id).id);assert.equal(link.line_items[0].quantity,1);assert.equal(link.line_items[0].adjustable_quantity?.enabled??false,false);}
 assert.equal(f.rows.payment_links.find(l=>l.id===p.config.items.find(i=>i.item==='item').id).line_items[0].adjustable_quantity.enabled,true);
});

test('a stale product search observes the deterministic product ID before creating it',async t=>{
 const root=studio(t),f=fixture();const {observations}=await reconcile(root,f);
 const reads=observations.filter(o=>o.method==='GET'&&!/^\/v1\/products\/(?!search$)/.test(o.path)).map(o=>o.path==='/v1/products/search'?{...o,body:{data:[],has_more:false}}:o);
 const plan=await shopMcpPlan(root,{refresh:true,observations:reads,verify:true});
 assert.ok(plan.operations.every(o=>o.method==='GET'&&o.path.startsWith('/v1/products/')),JSON.stringify(plan.operations));
 const resumed=await shopMcpPlan(root,{refresh:true,observations:[...reads,...plan.operations.map(op=>({...op,body:f.call(op)}))],verify:true});
 assert.equal(resumed.operations?.some(o=>o.method==='POST'&&o.path==='/v1/products')??false,false);
});

test('webhook installation keeps public checkout mode out of secrets and surfaces Wrangler errors',async()=>{
 const calls=[];
 const result=await syncPaymentLinks({catalog:{config:{v:1,mode:'test',items:[]},retire:[]},api:async(method,path)=>method==='GET'?{data:[],has_more:false}:{id:'we_fixture',secret:'whsec_fixture'},shop:{},slug:'proof',site:'https://proof.example',mode:'test',saveReceipt(){},w:async(args,options)=>{if(args[1]==='list')return {code:0,stdout:'[]'};calls.push(JSON.parse(options.input));return {code:1,stderr:'Binding name already in use: STRIPE_CHECKOUT_MODE'};}});
 assert.equal(calls[0].STRIPE_CHECKOUT_MODE,undefined);
 assert.match(result.why,/Binding name already in use: STRIPE_CHECKOUT_MODE/);
});

test('full connect saves public JSON configuration, never link secrets',async t=>{
 const {readShop}=await import('../lib/shop.mjs');const root=studio(t),f=fixture(),saved=[];
 const result=await syncPaymentLinks({root,shop:readShop(root).shop,slug:'proof',site:'https://proof.example',mode:'test',api:async(method,path,params)=>path==='/v1/webhook_endpoints'?method==='GET'?{data:[],has_more:false}:{id:'we_fixture',secret:'whsec_fixture'}:f.call({method,path,params}),saveReceipt(){},w:async(args,options)=>{if(args[1]==='list')return {code:0,stdout:'[]'};saved.push(JSON.parse(options.input));return {code:0};}});
 assert.equal(result.ok,true);assert.equal(saved[0].STRIPE_SHOP_LINKS,undefined);assert.equal(saved[0].PURCHASE_LINKS,undefined);
 assert.equal(JSON.parse(readFileSync(join(root,'.studio','stripe-mcp.json'))).result.config.items.length,3);
});

test('menu quantities honor the studio item maximum and slots allow remaining group capacity',async t=>{
 const root=studio(t);const raw=JSON.parse(readFileSync(join(root,'shop.json')));raw.items[0].maxQuantity=8;writeFileSync(join(root,'shop.json'),JSON.stringify(raw));
 const f=fixture();const {p}=await reconcile(root,f,{slots:[{app:'classes',collection:'bookings',slots:'sessions',slot:'one',item:'coffee',capacity:7,confirmed:2}]});
 const menu=f.rows.payment_links.find(l=>l.id===p.config.menus[0].id);
 assert.equal(menu.line_items[0].adjustable_quantity.maximum,8);assert.equal(menu.line_items[1].adjustable_quantity.maximum,99);
 const slot=f.rows.payment_links.find(l=>l.id===p.config.slots[0].id);assert.equal(slot.line_items[0].adjustable_quantity.maximum,5);
});

test('single item payment link advertises the configured maximum',async t=>{
 const root=studio(t),file=join(root,'shop.json'),shop=JSON.parse(readFileSync(file));shop.items[0].maxQuantity=3;writeFileSync(file,JSON.stringify(shop));
 const f=fixture(),{writes}=await reconcile(root,f);
 const link=writes.find(o=>o.path==='/v1/payment_links'&&o.params.line_items?.length===1&&o.params.line_items[0].adjustable_quantity);
 assert.equal(link.params.line_items[0].adjustable_quantity.maximum,3);
});
