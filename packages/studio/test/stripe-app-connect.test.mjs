import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shopConnect, captureRestrictedKey, disconnectStripe } from '../lib/stripe-connect.mjs';
function studio(t) {
 const root=mkdtempSync(join(tmpdir(),'homie-rak-'));
 cpSync(new URL('./fixtures/studio-0.51.6-shop/',import.meta.url),root,{recursive:true});
 rmSync(join(root,'.studio','stripe-mcp.json'),{force:true});
 t.after(()=>rmSync(root,{recursive:true,force:true}));return root;
}
function setup(t, changes={}) {
 const root=studio(t), writes=[], logs=[];let value='prior clipboard';
 const options={storage:join(root,'private'),installUrl:'https://marketplace.stripe.com/apps/test/example',
  open:()=>{value='rk_test_fixture';},clipboard:{read:()=>value,clear:()=>{value='';}},log:s=>logs.push(s),
  wrangler:async(args,opts={})=>{writes.push({args,input:opts.input});return {code:0,stdout:args[0]==='secret'&&args[1]==='list'?'[]':'private output rk_test_neverprint'};},
  fetcher:async url=>url.endsWith('/api/shop/stripe-setup')?Response.json({ok:true,webhookId:'we_fixture',account:'acct_fixture',name:'Fixture'}):url.endsWith('/v1/account')?Response.json({id:'acct_fixture',business_profile:{name:'Fixture'}}):Response.json({data:[]}),...changes};
 return {root,options,writes,logs,clipboard:()=>value};
}
test('copy validates, installs over stdin and clears clipboard without leaking any credential',async t=>{
 const f=setup(t);const result=await shopConnect(f.root,f.options);
 assert.deepEqual(result,{ok:true,command:'shop connect',message:'connected to Fixture'});
 assert.equal(f.writes.find(x=>x.args.at(-1)==='STRIPE_KEY').input,'rk_test_fixture');
 assert.equal(f.clipboard(),'');assert.doesNotMatch(JSON.stringify([result,f.logs]),/rk_test_/);
 const dir=join(f.options.storage,readdirSync(f.options.storage)[0]);
 for(const file of readdirSync(dir).filter(f=>f.endsWith('.json')))assert.doesNotMatch(readFileSync(join(dir,file),'utf8'),/rk_test_|whsec_/);
});
test('wrong mode and timeout install nothing; stale clipboard key is never consumed',async t=>{
 for(const value of ['rk_live_fixture','rk_test_fixture']) {
  let now=0,reads=0;
  const f=setup(t,{clipboard:{read:()=>++reads===1?'rk_test_fixture':value,clear:()=>{}},open:()=>{},now:()=>now,timeout:1000,wait:async ms=>{now+=ms;}});
  assert.equal((await shopConnect(f.root,f.options)).needs,'private-terminal');assert.equal(f.writes.length,0);
 }
});
test('validation denial does not install, and captures no provider error text',async t=>{
 const f=setup(t,{fetcher:async()=>Response.json({error:{message:'rk_test_sensitive'}},{status:403})});
 const result=await shopConnect(f.root,f.options);assert.equal(result.ok,false);assert.equal(f.writes.length,0);
 assert.equal(f.clipboard(),'');assert.doesNotMatch(JSON.stringify(result),/sensitive/);
});
test('clipboard changed by user is not overwritten during cleanup',async t=>{
 let value='old';const f=setup(t,{clipboard:{read:()=>value,clear:()=>assert.fail('must preserve newer content')},open:()=>{value='rk_test_fixture';},fetcher:async()=>{value='new clipboard';return Response.json({error:{}},{status:403});}});
 assert.equal((await shopConnect(f.root,f.options)).ok,false);
});
test('disconnect deletes endpoint before Worker key and explains independent key expiry',async t=>{
 const f=setup(t),order=[];
 const result=await disconnectStripe(f.root,{...f.options,fetcher:async(url,opts)=>{assert.equal(JSON.parse(opts.body).action,'disconnect');order.push('endpoint');return Response.json({ok:true});},wrangler:async args=>{if(args[1]==='delete'&&args[2]==='STRIPE_KEY')order.push('key');return{code:0};}});
 assert.equal(result.ok,true);assert.deepEqual(order,['endpoint','key']);assert.match(result.message,/roll\/expire/);
});
test('uninstall revocation still removes local credential and names endpoint cleanup',async t=>{
 const f=setup(t);const result=await disconnectStripe(f.root,{...f.options,fetcher:async()=>Response.json({ok:false,needs:'remove-endpoint-in-stripe'})});
 assert.equal(result.ok,true);assert.match(result.message,/already revoked/);
});
test('migration drains every cursor twice with 30 seconds between passes before retiring hooks',async()=>{
 const {drainStripeLinks}=await import('../lib/stripe-migration.mjs');const actions=[];
 const run=async args=>{
  const [method,path]=args;actions.push([method,path,...args.slice(2)]);
  let body={};
  if(path==='/v1/account')body={id:'acct_owner'};
  else if(path==='/v1/payment_links')body={data:[{id:'plink_ours',active:true,metadata:{origin:'https://studio.example',homie:'shop-links-v1'}},{id:'plink_other',active:true,metadata:{origin:'https://other.example',homie:'shop-links-v1'}}]};
  else if(path==='/v1/webhook_endpoints')body={data:[{id:'we_new',url:'https://studio.example/api/shop/hook',status:'enabled'},{id:'we_old',url:'https://studio.example/api/shop/hook',status:'enabled'}]};
  else if(path==='/v1/checkout/sessions')body=args.includes('status=open')?{data:[{id:'cs_open'}]}:args.includes('starting_after=cs_first')?{data:[{id:'cs_last',payment_status:'paid'}]}:{data:[{id:'cs_first',payment_status:'paid'}],has_more:true};
  return {code:0,stdout:JSON.stringify(body)};
 };
 await drainStripeLinks({origin:'https://studio.example',account:'acct_owner',mode:'test',keepHook:'we_new',process:run,wait:async ms=>actions.push(['wait',ms]),w:async args=>({code:0,stdout:JSON.stringify([{results:args.at(-1).includes('sqlite_master')?[{name:'shop_orders'}]:[{session:'cs_first'},{session:'cs_last'}]}])})});
 assert.deepEqual(actions.filter(a=>a[0]==='wait'),[['wait',30000]]);
 assert.ok(actions.filter(a=>a.includes('starting_after=cs_first')).length>=2);
 assert.deepEqual(actions.at(-1).slice(0,2),['post','/v1/webhook_endpoints/we_old']);
 assert.equal(actions.some(a=>a[1]==='/v1/payment_links/plink_other'),false);
});
test('migration mismatched owner CLI account cannot deactivate anything',async()=>{
 const {drainStripeLinks}=await import('../lib/stripe-migration.mjs');let n=0;
 await assert.rejects(drainStripeLinks({account:'acct_owner',mode:'test',process:async()=>{n++;return{code:0,stdout:'{"id":"acct_other"}'};}}));
 assert.equal(n,1);
});
