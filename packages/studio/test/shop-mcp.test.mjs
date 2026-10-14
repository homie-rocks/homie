import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {shopMcpPlan,saveMcpVerification} from '../lib/shop-mcp.mjs';
import {syncPaymentLinks} from '../lib/shop-links.mjs';

function studio(t) {
 const root=mkdtempSync(join(tmpdir(),'shop-mcp-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(join(root,'studio.json'),JSON.stringify({name:'Proof',slug:'proof',cloudflare:{domain:'proof.example'}}));
 writeFileSync(join(root,'shop.json'),JSON.stringify({till:'stripe',currency:'usd',automaticTax:false,items:[{id:'coffee',name:'Coffee',price:300},{id:'cake',name:'Cake',price:400},{id:'giving',name:'Monthly giving',price:1000,interval:'month'}]}));
 return root;
}
function fixture() {
 const rows={products:[],prices:[],payment_links:[],configurations:[]}; let sequence=0;
 return {rows,call(op){
   if(op.path==='/v1/checkout/sessions')return {data:[],has_more:false};
   const segments=op.path.split('/'),kind=segments.at(-2)==='billing_portal'?'configurations':segments[2];
   const data=rows[kind];assert.ok(data,op.path);const id=segments.at(-1)===kind?null:segments.at(-1);
   if(op.method==='GET') {
     if(!id)return {data:structuredClone(data),has_more:false};
     const object=structuredClone(data.find(o=>o.id===id));
     if(kind==='payment_links')object.line_items={data:object.line_items.map(line=>({...line,price:{id:line.price}}))};
     return object;
   }
   let object=id?data.find(o=>o.id===id):null;
   if(!object){object={id:op.params.id??`${kind==='payment_links'?'plink':kind==='prices'?'price':kind==='products'?'prod':'bpc'}_${++sequence}`,active:true,livemode:false};data.push(object);}
   const metadata={...object.metadata,...op.params.metadata};
   const count=object.restrictions?.completed_sessions?.count;
   Object.assign(object,structuredClone(op.params));
   object.metadata=metadata;
   if(count!==undefined && object.restrictions)object.restrictions.completed_sessions.count=count;
   if(kind==='payment_links'){object.url=`https://buy.stripe.com/test_${object.id}`;if(object.restrictions)object.restrictions.completed_sessions.count??=0;}
   if(kind==='configurations')object.login_page={enabled:true,url:'https://billing.stripe.com/p/login/test_fixture'};
   return structuredClone(object);
 }};
}
async function reconcile(root,f,options={}) {
 let observations=[],writes=[];
 for(let i=0;i<150;i++) {
   const p=await shopMcpPlan(root,{...options,observations});
   if(p.verified)return {p,observations,writes};
   assert.ok(p.next,JSON.stringify(p)); const op=p.next;
   const body=f.call(op);
   if(op.method==='GET')observations.push({path:op.path,params:op.params,body});
   else {assert.ok(op.idempotency || op.path.split('/').length>3);writes.push(op);observations=[];}
 }
 throw new Error('Plan did not converge');
}
test('official MCP plan converges and verifies items, menu, slots, recurring and portal from API fixtures',async t=>{
 const root=studio(t),f=fixture(),slots=[{app:'classes',collection:'bookings',slots:'sessions',slot:'monday',item:'coffee',capacity:2}];
 const {p,observations,writes}=await reconcile(root,f,{slots});
 assert.equal(p.config.items.length,3);assert.equal(p.config.menus.length,1);assert.equal(p.config.slots[0].limit,2);assert.ok(p.config.portal);
 assert.equal(writes.some(o=>o.path.includes('webhook')),false);
 assert.ok(writes.some(o=>o.params.recurring?.interval==='month'));
 const again=await saveMcpVerification(root,{slots,observations,account:'acct_fixture'});assert.equal(again.verified,true);
 assert.equal((await reconcile(root,f,{slots})).writes.length,0);
 assert.equal(JSON.parse(readFileSync(join(root,'.studio','stripe-mcp.json'))).result.verified,true);
 f.rows.prices[0].unit_amount=999;
 await assert.rejects(()=>reconcile(root,f,{slots}),/differs from shop.json/);
});
test('verification rejects wrong mode, secrets, pagination gaps and drifted link fields',async t=>{
 const root=studio(t),f=fixture();await reconcile(root,f);
 f.rows.payment_links[0].after_completion.redirect.url='https://wrong.example';
 await assert.rejects(()=>reconcile(root,f),/differs from its planned fields/);
 const first=await shopMcpPlan(root);assert.equal(first.next.method,'GET');
 await assert.rejects(()=>shopMcpPlan(root,{observations:[{...first.next,body:{data:[{livemode:true}],has_more:false}}]}),/wrong mode/);
 await assert.rejects(()=>shopMcpPlan(root,{observations:[{body:{secret:'whsec_fixture'}}]}),/never credentials/);
 const page=await shopMcpPlan(root,{observations:[{...first.next,body:{data:[{id:'prod_cursor'}],has_more:true}}]});
 assert.equal(page.next.params.starting_after,'prod_cursor');
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
