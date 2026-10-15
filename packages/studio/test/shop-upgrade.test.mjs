import {createHash} from 'node:crypto';
import {readShop} from '../lib/shop.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,mkdirSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {verifiedMcpConfig,shopMcpPlan,saveMcpVerification} from '../lib/shop-mcp.mjs';
import {refreshWorkerConfig} from '../lib/worker-config.mjs';
import {stripeFixture} from './selling-stripe-fixture.mjs';
const json=p=>JSON.parse(readFileSync(p,'utf8'));
function studio(t){const root=mkdtempSync(join(tmpdir(),'stripe-upgrade-'));t.after(()=>rmSync(root,{recursive:true,force:true}));cpSync(new URL('./fixtures/studio-0.51.6-shop/',import.meta.url),root,{recursive:true});mkdirSync(join(root,'site'),{recursive:true});mkdirSync(join(root,'node_modules'),{recursive:true});symlinkSync(resolve('node_modules/esbuild'),join(root,'node_modules/esbuild'));return root;}
async function builtAndDeployed(root){
 const {build}=await import('../lib/build.mjs');const {ciDeploy}=await import('../lib/cloudflare.mjs');
 assert.equal((await build(root)).ok,true);
 const calls=[];const deployed=await ciDeploy(root,{wrangler:args=>{calls.push(args);return {code:0,out:'[]'};}});
 assert.equal(deployed.ok,true,JSON.stringify(deployed));assert.ok(calls.some(a=>a[0]==='deploy'));
 return JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8').replace(/^\s*\/\/.*$/gm,'')).vars;
}
test('0.51.6 verified fixture migrates then builds and deploys without re-verification',async t=>{
 const root=studio(t),before=json(join(root,'.studio/stripe-mcp.json'));
 assert.equal(before.source,undefined);assert.equal(before.result.verified,true);
 assert.ok(verifiedMcpConfig(root).source);await builtAndDeployed(root);
});
test('0.51.6 observations-only fixture builds and deploys with checkout closed',async t=>{
 const root=studio(t);cpSync(join(root,'unverified.json'),join(root,'.studio/stripe-mcp.json'));
 assert.equal(verifiedMcpConfig(root),null);
 const vars=await builtAndDeployed(root);assert.equal(vars.STRIPE_SHOP_LINKS,undefined);
 const {loadShopLinks,linkConfig}=await import('../worker/shop-links.mjs');
 const env=await loadShopLinks({...vars,STRIPE_SHOP_LINKS:'{"v":1,"mode":"test","items":[]}',ASSETS:{fetch:async()=>new Response(readFileSync(join(root,'site/dist/_site/stripe-shop-links.json')))}});
 assert.equal(linkConfig(env),null);assert.match(env.STRIPE_SHOP_SETUP,/verify/i);
});
test('100+ links ship as an asset, never a text binding, and load at runtime',async t=>{
 const root=studio(t);rmSync(join(root,'.studio/stripe-mcp.json'));
 const slots=Array.from({length:120},(_,i)=>({app:'golf',collection:'bookings',slots:'times',slot:'time'+i,item:'round',capacity:4}));
 const f=stripeFixture();let observations=[];
 for(let i=0;i<30;i++){const p=await saveMcpVerification(root,{slots,observations,account:'acct_fixture'});if(p.verified)break;observations.push(...p.operations.map(op=>({...op,body:f.call(op)})));}
 refreshWorkerConfig(root);assert.equal(JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8').replace(/^\s*\/\/.*$/gm,'')).vars.STRIPE_SHOP_LINKS,undefined);
 // A fresh round trips every page, with no per-link reads or writes.
 const reads=[];observations=[];
 for(let i=0;i<10;i++) {
  const plan=await shopMcpPlan(root,{slots,observations,refresh:true});
  if(plan.verified){assert.equal(plan.config.slots.length,120);break;}
  for(const op of plan.operations){assert.equal(op.method,'GET');assert.doesNotMatch(op.path,/\/payment_links\//);reads.push(op);observations.push({...op,body:f.call(op)});}
  if(i===9)assert.fail('paginated refresh did not converge');
 }
 assert.equal(reads.filter(o=>o.path==='/v1/payment_links').length,2);
 const vars=await builtAndDeployed(root);assert.equal(vars.STRIPE_SHOP_LINKS,undefined);
 const asset=readFileSync(join(root,'site/dist/_site/stripe-shop-links.json'),'utf8');assert.ok(Buffer.byteLength(asset)>10000);
 const {loadShopLinks,linkConfig}=await import('../worker/shop-links.mjs');
 const env=await loadShopLinks({...vars,ASSETS:{fetch:async()=>new Response(asset)}});assert.equal(linkConfig(env).slots.length,120);
});
test('golf replanning reuses products but replaces uncapped legacy menu links; refresh batches reads',async t=>{
 const root=studio(t);const p=await shopMcpPlan(root);assert.equal(p.verified,false);assert.ok(p.operations.some(o=>o.path==='/v1/payment_links'&&o.params.line_items?.every(l=>l.adjustable_quantity?.maximum===99)));assert.ok(p.operations.every(o=>!o.path.startsWith('/v1/products')));
 const fresh=await shopMcpPlan(root,{refresh:true});
 assert.ok(fresh.operations.some(o=>o.path==='/v1/payment_links'&&o.params.expand.includes('data.line_items')));
 assert.equal(fresh.operations.some(o=>/^\/v1\/payment_links\//.test(o.path)),false);
 assert.equal(fresh.operations.length,3);
});
test('fresh machine installs official CLI and continues to one browser approval',async t=>{
 const root=studio(t);const saved=json(join(root,'.studio/stripe-mcp.json'));saved.result.verifiedAt=new Date().toISOString();saved.source=createHash('sha256').update(JSON.stringify({shop:readShop(root).shop,slots:saved.options.slots})).digest('hex');writeFileSync(join(root,'.studio/stripe-mcp.json'),JSON.stringify(saved));
 const {shopConnect}=await import('../lib/stripe-connect.mjs');let installed=false,approved=false,opens=0;const installs=[];
 const result=await shopConnect(root,{webhookOnly:true,storage:join(root,'private'),installExec:async(cmd,args)=>{installs.push([cmd,...args]);installed=true;return {code:0};},open:()=>opens++,exec:async args=>{
 if(args.includes('--version'))return {code:installed?0:1,missing:!installed};
 if(args.includes('--complete-device')){approved=true;return {code:0};}
 if(args.includes('login'))return {code:0,stdout:JSON.stringify({browser_url:'https://dashboard.stripe.com/stripecli/confirm_auth',verification_code:'test code',next_step:'stripe login --complete-device'})};
 if(!approved)return {code:1};
 if(args.includes('/v1/account'))return {code:0,stdout:'{"id":"acct_fixture"}'};
 if(args.includes('/v1/webhook_endpoints')&&args.includes('post'))return {code:0,stdout:'{"id":"we_fixture","secret":"whsec_fixture"}'};
 return {code:0,stdout:'{"data":[],"has_more":false}'};
 },wrangler:async()=>({code:0,stdout:'[]'})});
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(opens,1);assert.deepEqual(installs,[[process.platform==='win32'?'npm.cmd':'npm','install','--global','@stripe/cli@latest']]);
});

test('legacy verification rejects real price, slot, origin and receipt text edits with a useful reason',t=>{
 for(const kind of ['price','slots','site','receipt']){
  const root=studio(t);
  if(kind==='slots'){const slots=json(join(root,'.studio/booking-slots.json'));slots[0].capacity++;writeFileSync(join(root,'.studio/booking-slots.json'),JSON.stringify(slots));}
  else if(kind==='site'){const s=json(join(root,'studio.json'));s.cloudflare.domain='different.example';writeFileSync(join(root,'studio.json'),JSON.stringify(s));}
  else {const s=json(join(root,'shop.json'));if(kind==='price')s.items[0].price++;else s.giving={receiptText:'New receipt'};writeFileSync(join(root,'shop.json'),JSON.stringify(s));}
  assert.throws(()=>verifiedMcpConfig(root),kind==='slots'?/booking slots/:kind==='site'?/site URL/:kind==='receipt'?/shop.giving.receiptText/:/shop.items/);
 }
});

test('changed slots reuse products and prices but read fresh link counts; refresh follows 100-link pages',async t=>{
 const root=studio(t);await shopMcpPlan(root);
 const slots=json(join(root,'.studio/booking-slots.json'));slots[0].active=false;
 const changed=await shopMcpPlan(root,{slots});assert.deepEqual(changed.operations.map(o=>o.path),['/v1/payment_links']);
 const page=await shopMcpPlan(root,{refresh:true,observations:[
  {path:'/v1/products/search',params:{query:"metadata['homie']:'shop-links-v1' AND metadata['studio']:'golf' AND metadata['origin']:'https://golf.example'",limit:100,expand:['data.default_price']},body:{data:[],has_more:false}},
  {path:'/v1/prices/search',params:{query:"metadata['homie']:'shop-links-v1' AND metadata['studio']:'golf' AND metadata['origin']:'https://golf.example'",limit:100},body:{data:[],has_more:false}},
  {path:'/v1/payment_links',params:{limit:100,expand:['data.line_items']},body:{data:Array.from({length:100},(_,i)=>({id:'plink_'+i})),has_more:true}},
 ]});assert.equal(page.next.params.starting_after,'plink_99');assert.deepEqual(page.next.params.expand,['data.line_items']);
});

test('asset failures close checkout instead of falling back to stale link secrets',async()=>{
 const {loadShopLinks,linkConfig}=await import('../worker/shop-links.mjs');
 const {readiness}=await import('../worker/shop.mjs');
 const root=new URL('./fixtures/studio-0.51.6-shop/',import.meta.url).pathname;
 for(const fetch of [async()=>new Response('not found',{status:404}),async()=>{throw Error('offline');}]){
  const env=await loadShopLinks({STRIPE_SHOP_LINKS_ASSET:'/_site/stripe-shop-links.json',STRIPE_SHOP_LINKS:JSON.stringify({v:1,mode:'test',items:[]}),ASSETS:{fetch}});
  assert.equal(linkConfig(env),null);const ready=await readiness(env,readShop(root).shop);assert.equal(ready.ready,false);assert.match(ready.next,/verify:true/);
 }
});

test('CLI installation failure stops before browser login and returns an actionable retry',async t=>{
 const root=studio(t),saved=json(join(root,'.studio/stripe-mcp.json'));saved.result.verifiedAt=new Date().toISOString();writeFileSync(join(root,'.studio/stripe-mcp.json'),JSON.stringify(saved));
 const {shopConnect}=await import('../lib/stripe-connect.mjs');
 const r=await shopConnect(root,{webhookOnly:true,storage:join(root,'private'),exec:async args=>{assert.ok(args.includes('--version'));return {code:1,missing:true};},installExec:async()=>({code:1}),open:()=>assert.fail('no login after failed install')});
 assert.equal(r.needs,'stripe-cli');assert.match(r.why,/Automatic.*failed/);
});

test('a new unfinished plan also deploys closed before a verification file exists',async t=>{
 const root=studio(t);rmSync(join(root,'.studio/stripe-mcp.json'));
 const plan=await shopMcpPlan(root);assert.equal(plan.verified,false);
 refreshWorkerConfig(root);
 const vars=JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8').replace(/^\s*\/\/.*$/gm,'')).vars;
 assert.equal(vars.STRIPE_SHOP_LINKS_ASSET,'/_site/stripe-shop-links.json');assert.equal(vars.STRIPE_SHOP_LINKS,undefined);
});

test('pairing is a structured event before completion and saved login emits no pairing',async t=>{
 const {shopConnect}=await import('../lib/stripe-connect.mjs');
 for(const reused of [false,true]) {
  const root=studio(t),saved=json(join(root,'.studio/stripe-mcp.json'));saved.result.verifiedAt=new Date().toISOString();writeFileSync(join(root,'.studio/stripe-mcp.json'),JSON.stringify(saved));
  const events=[];let approved=reused;
  const result=await shopConnect(root,{webhookOnly:true,storage:join(root,'private'),onEvent:e=>events.push(e),open:()=>{},exec:async args=>{
   if(args.includes('--version'))return {code:0};
   if(args.includes('--complete-device')){assert.deepEqual(events,[{type:'stripe.pairing',code:'sample code',url:'https://dashboard.stripe.com/stripecli/confirm_auth'}]);approved=true;return {code:0};}
   if(args.includes('login'))return {code:0,stdout:JSON.stringify({browser_url:'https://dashboard.stripe.com/stripecli/confirm_auth',verification_code:'sample code',next_step:'stripe login --complete-device'})};
   if(!approved)return {code:1};
   if(args.includes('/v1/account'))return {code:0,stdout:'{"id":"acct_fixture"}'};
   if(args.includes('/v1/webhook_endpoints')&&args.includes('post'))return {code:0,stdout:'{"id":"we_fixture","secret":"whsec_fixture"}'};
   return {code:0,stdout:'{"data":[],"has_more":false}'};
  },wrangler:async()=>({code:0,stdout:'[]'})});
  assert.equal(result.ok,true,JSON.stringify(result));if(reused)assert.deepEqual(events,[]);
 }
});

test('MCP job view exposes pairing while the CLI is still waiting',async t=>{
 const {startJob,jobView}=await import('../lib/jobs.mjs');
 const root=studio(t),event={type:'stripe.pairing',code:'sample code',url:'https://dashboard.stripe.com/stripecli/confirm_auth'};
 const job=startJob({root,label:'pairing fixture',cmd:process.execPath,args:['-e',`process.stderr.write(${JSON.stringify('HOMIE_EVENT '+JSON.stringify(event)+'\n')});setInterval(()=>{},1000)`]});
 t.after(()=>job.child?.kill());
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('no pairing event')),5000);job.child.stderr.once('data',()=>{clearTimeout(timer);resolve();});});
 assert.equal(jobView(job).state,'running');assert.deepEqual(jobView(job).events,[event]);
 job.child.kill();await job.done;
});
