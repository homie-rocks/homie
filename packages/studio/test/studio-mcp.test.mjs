import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {MCP_MIGRATION,oauthStorage,rateLimit,audit} from '../worker/mcp-store.mjs';
import {allowed,currentCaller} from '../worker/mcp-tools.mjs';
import {toolIdentity,withToolIdentity} from '../worker/tool-identity.mjs';
function database(){const sql=new DatabaseSync(':memory:');sql.exec(MCP_MIGRATION);sql.exec('CREATE TABLE players(id TEXT,name TEXT,owner INTEGER,guest INTEGER);CREATE TABLE app_roles(app TEXT,role TEXT,player TEXT);');const stmt=(q,args=[])=>({bind:(...a)=>stmt(q,a),first:async()=>sql.prepare(q).get(...args)??null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}})});return {sql,prepare:stmt,batch:async xs=>Promise.all(xs.map(x=>x.run()))};}
test('OAuth storage honors expiry, prefixes, pagination and deletion',async()=>{const DB=database(),kv=oauthStorage(DB);try{await kv.put('client:a',JSON.stringify({id:1}));await kv.put('client:b','two');await kv.put('expired','no',{expiration:1});assert.deepEqual(await kv.get('client:a',{type:'json'}),{id:1});assert.equal(await kv.get('expired'),null);const first=await kv.list({prefix:'client:',limit:1});assert.equal(first.list_complete,false);assert.deepEqual((await kv.list({prefix:'client:',cursor:first.cursor})).keys,[{name:'client:b'}]);await kv.delete('client:a');assert.equal(await kv.get('client:a'),null);}finally{DB.sql.close();}});
test('authorization follows account changes, staff grants and revocation',async()=>{const DB=database(),env={DB};try{DB.sql.exec("INSERT INTO players VALUES('staff','Staff',0,0);INSERT INTO mcp_connections VALUES('c','staff','client',1,0)");let caller=await currentCaller(env,{connection:'c'});assert.equal(await allowed('owner',caller,env),false);assert.equal(await allowed('signed-in',caller,env),true);assert.equal(await allowed({app:'pub',role:'staff'},caller,env),false);DB.sql.exec("INSERT INTO app_roles VALUES('pub','staff','staff')");assert.equal(await allowed({app:'pub',role:'staff'},caller,env),true);assert.equal(await allowed({app:'other','role':'staff'},caller,env),false);DB.sql.exec('DELETE FROM app_roles');assert.equal(await allowed({app:'pub',role:'staff'},caller,env),false);DB.sql.exec('UPDATE players SET owner=1');caller=await currentCaller(env,{connection:'c'});assert.equal(caller.owner,true);DB.sql.exec('UPDATE mcp_connections SET revoked=1');await assert.rejects(currentCaller(env,{connection:'c'}),/revoked/);assert.equal(await allowed('owner',await currentCaller(env),env),false);}finally{DB.sql.close();}});
test('per-caller limits and audit omit supplied arguments and credentials',async()=>{const DB=database(),env={DB};try{assert.equal(await rateLimit(env,'a',1),true);assert.equal(await rateLimit(env,'a',1),false);assert.equal(await rateLimit(env,'b',1),true);await audit(env,{id:'a',client:'client',token:'never-store'},'example','denied');const row=DB.sql.prepare('SELECT * FROM mcp_audit').get();assert.equal(row.person,'a');assert.equal(row.outcome,'denied');assert.ok(!JSON.stringify(row).includes('never-store'));}finally{DB.sql.close();}});
test('HTTP headers cannot forge trusted tool authority',()=>{const request=new Request('https://studio.test',{headers:{'x-homie-owner':'true',authorization:'Bearer owner'}});assert.equal(toolIdentity(request),null);withToolIdentity(request,{id:'owner',owner:true});assert.equal(toolIdentity(request).owner,true);assert.equal(toolIdentity(request.clone()),null);});

test('remote owner controls use the office confirmation path',async()=>{
 const {OFFICE_MIGRATION}=await import('../worker/office-schema.mjs');
 const {officeRoutes}=await import('../worker/office.mjs');
 const DB=database();try{
  DB.sql.exec(OFFICE_MIGRATION);const env={DB,TABLE:{},LOBBY:{}};
  const url=new URL('https://studio.test/_studio/api/game');
  const req=withToolIdentity(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({game:'game',launch:'private'})}),{id:'owner',owner:true});
  const result=await officeRoutes(req,env,url,{catalogueOf:async()=>({studio:{name:'Test'},games:[{id:'game',name:'Game'}]})});
  assert.equal(result.status,202);const body=await result.json();assert.equal(body.needs,'owner');assert.match(body.ask.confirm,/\/_studio\/confirm\//);
 }finally{DB.sql.close();}
});

test('webhooks verify the exact body, timestamp, replay ID, schema and current delegated role',async()=>{
 const {toolWebhook}=await import('../worker/tool-webhook.mjs');const {createHmac}=await import('node:crypto');
 const DB=database(),env={DB,ORDERS_HMAC:'local-test-secret-with-at-least-32-characters'};let calls=0;
 const tool={name:'incoming',audience:{app:'pub',role:'staff'},inputSchema:{type:'object',properties:{order:{type:'integer'}},required:['order'],additionalProperties:false},webhook:{secret:'ORDERS_HMAC',person:'staff'},handler:()=>{calls++;}};
 const send=async(body,{id='delivery001',time=String(Math.floor(Date.now()/1000)),signature,raw}={})=>{
   const text=JSON.stringify(body);const sig=signature??createHmac('sha256',env.ORDERS_HMAC).update(`${time}.${id}.${text}`).digest('hex');
   return toolWebhook(new Request('https://studio.test/hooks/tools/incoming',{method:'POST',headers:{'x-studio-timestamp':time,'x-studio-delivery':id,'x-studio-signature':sig},body:raw??text}),env,{cat:{games:[]},definitions:[tool]});
 };
 try{
  DB.sql.exec("INSERT INTO players VALUES('staff','Staff',0,0);INSERT INTO app_roles VALUES('pub','staff','staff')");
  assert.equal((await send({order:1})).status,200);assert.equal(calls,1);
  assert.equal((await send({order:1})).status,409);assert.equal(calls,1);
  assert.equal((await send({order:1},{id:'delivery002',raw:'{"order":2}'})).status,401);
  assert.equal((await send({order:1},{time:'1000000000'})).status,401);
  assert.equal((await send({order:'wrong'},{id:'delivery003'})).status,400);
  DB.sql.exec('DELETE FROM app_roles');assert.equal((await send({order:2},{id:'delivery004'})).status,403);assert.equal(calls,1);
 }finally{DB.sql.close();}
});

test('tool data is isolated by studio and namespace; secret values are not context properties',async()=>{
 const {services}=await import('../worker/mcp-tools.mjs');const a=database(),b=database();
 try{
  const ctx=services({DB:a,API_TOKEN:'must-not-escape'},{games:[]},'https://a.test',{id:'a',owner:false},'one');
  await ctx.database.put('order',{id:1});assert.deepEqual(await ctx.database.get('order'),{id:1});
  assert.equal(await services({DB:a},{games:[]},'https://a.test',{},'two').database.get('order'),null);
  assert.equal(await services({DB:b},{games:[]},'https://b.test',{},'one').database.get('order'),null);
  assert.equal(ctx.env,undefined);assert.equal(ctx.secrets,undefined);assert.equal(ctx.API_TOKEN,undefined);
  await assert.rejects(ctx.fetchWithSecret('API_TOKEN','https://outside.test'),/refused/);
  await assert.rejects(ctx.office('/_studio/api/office'),/owner only/);
 }finally{a.sql.close();b.sql.close();}
});

test('inbound room events require a declaration, audience and valid data before reaching a room',async()=>{
 const {sendToolEvent}=await import('../worker/tool-events.mjs');const DB=database();let reached=false;
 const env={DB,TABLE:{idFromName(){reached=true;throw new Error('unexpected room access');}}};
 const definition={events:{'external:order':{game:'pub',schema:{type:'object',properties:{order:{type:'integer'}},required:['order'],additionalProperties:false}}}};
 const args={game:'pub',room:'room-1',event:'external:order',data:{order:1}};
 try{
  await assert.rejects(sendToolEvent(env,{id:'member'},definition,args),/permission/);
  await assert.rejects(sendToolEvent(env,{id:'owner',owner:true},definition,{...args,event:'agent:do'}),/declared/);
  await assert.rejects(sendToolEvent(env,{id:'owner',owner:true},definition,{...args,data:{order:'bad'}}),/invalid/);
  assert.equal(reached,false);
 }finally{DB.sql.close();}
});

test('remote seats cannot cross connections and revoked seats close before another look',async()=>{
 const {roomSeat}=await import('../worker/mcp-room.mjs');const DB=database();let closed=0;
 try{
  DB.sql.exec("INSERT INTO mcp_connections VALUES('one','alice','client',1,0);INSERT INTO mcp_connections VALUES('two','bob','client',1,0)");
  const table={env:{DB},mcpSeats:new Map([['one',{handle:{onClose(){closed++;}},frames:[]}]])};
  const room={};
  assert.equal((await roomSeat(table,room,{args:{connection:'two',person:'bob',operation:'look'}})).ok,false);
  assert.equal(closed,0);assert.ok(table.mcpSeats.has('one'));
  await roomSeat(table,room,{args:{connection:'two',person:'bob',operation:'stand'}});assert.ok(table.mcpSeats.has('one'));
  DB.sql.exec("UPDATE mcp_connections SET revoked=1 WHERE id='one'");
  assert.equal((await roomSeat(table,room,{args:{connection:'one',person:'alice',operation:'look'}})).error,'connection revoked');
  assert.equal(closed,1);assert.equal(table.mcpSeats.has('one'),false);
 }finally{DB.sql.close();}
});

test('remote MCP still refuses humans-only rooms, even to the studio owner',async()=>{
 const {remoteSeat}=await import('../worker/mcp-room.mjs');const DB=database();
 try{
  const cat={games:[{id:'pub',servers:[{id:'public',name:'People',policy:'humans-only'}]}]};
  await assert.rejects(remoteSeat({DB},cat,{id:'owner',owner:true,connection:'one'},'sit',{game:'pub',room:'proof'}),/humans only/);
 }finally{DB.sql.close();}
});

test('named secret fetches pin their origin, reject redirects and suppress credential echoes',async()=>{
 const {services}=await import('../worker/mcp-tools.mjs');const DB=database(),original=globalThis.fetch;
 const env={DB,EXTERNAL_API:'private-local-test-credential'},cat={games:[],studio:{mcp:{secrets:{EXTERNAL_API:{origin:'https://supplier.test',tools:['stock']}}}}};
 try{
  const staff=services(env,cat,'https://studio.test',{id:'staff',owner:false},'stock',{name:'stock'});
  await assert.rejects(staff.fetchWithSecret('EXTERNAL_API','https://other.test'),/refused/);
  globalThis.fetch=async(url,init)=>{assert.equal(url.origin,'https://supplier.test');assert.equal(init.redirect,'error');assert.equal(init.headers.get('authorization'),'Bearer '+env.EXTERNAL_API);return new Response('safe result');};
  assert.equal(await (await staff.fetchWithSecret('EXTERNAL_API','https://supplier.test/stock')).text(),'safe result');
  globalThis.fetch=async()=>new Response(env.EXTERNAL_API);
  await assert.rejects(staff.fetchWithSecret('EXTERNAL_API','https://supplier.test/stock'),/credential/);
  const other=services(env,cat,'https://studio.test',{id:'staff',owner:false},'other',{name:'other'});
  await assert.rejects(other.fetchWithSecret('EXTERNAL_API','https://supplier.test/stock'),/refused/);
 }finally{globalThis.fetch=original;DB.sql.close();}
});

test('app schema discovery reveals the caller’s usable roles and collection fields',async()=>{
 const {builtins}=await import('../worker/mcp-tools.mjs');const DB=database();
 try{
  const cat={games:[{id:'pub',kind:'app',roles:{customer:{can:['read:menu']},staff:{signIn:true,can:['read:jobs','update:jobs']}},records:{persist:true,collections:{menu:{fields:{name:{type:'string'}}},jobs:{fields:{state:{type:'string',enum:['ready','road-test']}}}}}}]};
  const tool=builtins({DB},cat,'https://studio.test').find(t=>t.name==='app_schema');
  const publicSchema=await tool.handler({app:'pub'},{caller:{id:null,owner:false}});assert.deepEqual(Object.keys(publicSchema.collections),['menu']);assert.equal(publicSchema.roles.staff,undefined);
  DB.sql.exec("INSERT INTO app_roles VALUES('pub','staff','person')");
  const staff=await tool.handler({app:'pub'},{caller:{id:'person',owner:false}});assert.deepEqual(staff.collections.jobs.fields.state.enum,['ready','road-test']);
 }finally{DB.sql.close();}
});

// Exercise the real relay and host, not a fake seat: prediction games and old
// browser hosts use the same marked guide seat, vocabulary and revocation path.
for (const mode of ['prediction', 'legacy', 'app']) test(`MCP room tools: ${mode} sit, look, act, speak, stand and revoke`, {timeout:30000}, async()=>{
 const {mkdtempSync,realpathSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {NetRoom,DEFAULT_POLICY}=await import('../worker/room.mjs');
 const {remoteSeat,roomSeat}=await import('../worker/mcp-room.mjs');
 const {verifyControl}=await import('../worker/office.mjs');
 const {fakeClock,loadGame,writeGame,roomRig}=await import('./rules-kit.mjs');
 const {source,vocab}=await import('./rules-feature-kit.mjs');
 const DB=database(),scratch=realpathSync(mkdtempSync(join(tmpdir(),'homie-mcp-room-')));
 let rig,room,person;const clock=fakeClock(),frames=[];
 try{
  DB.sql.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);INSERT INTO mcp_connections VALUES('one','alice','client',1,0);INSERT INTO app_roles VALUES('experience','staff','alice')");
  if(mode==='prediction'){
   const L=await loadGame(scratch,writeGame(scratch,'prediction',{rules:source}),'prediction');
   const compiled=L.R.compileRules(L.def,{settings:L.R.roomSettings({}).settings,seats:4});
   assert.ok(compiled.kinds.some(k=>k.move),'uses slice 6 shared movement');
   rig=roomRig(L,compiled,{maxPlayers:4,roomOpts:{rules:true}});room=rig.room;
   person=rig.conn();room.setPolicy({...DEFAULT_POLICY,at:20,kind:'hybrid',speech:'lines',aiSeats:1,brain:'workers-ai'});
   person.hello('Person',{rev:11,rules:true});rig.run(100);
  }else{
   room=new NetRoom({code:'r',maxPlayers:4,now:clock.now});
   room.setPolicy({...DEFAULT_POLICY,at:20,kind:'hybrid',speech:'lines',aiSeats:1,brain:'workers-ai'});
   person=room.attach({send:text=>frames.push(JSON.parse(text)),close(){},buffered:()=>0});
   person.onMessage(JSON.stringify({t:'hello',v:1,rev:7,name:'Person',want:'play',canHost:true,caps:['agents']}));
  }
  const table={env:{DB},game:'experience',readVocab:async()=>room.setVocabulary(vocab)};
  const env={DB,TABLE:{idFromName:name=>name,get:name=>({async fetch(url,init){
   assert.equal(name,'experience/r');const ctl=JSON.parse(init.body);
   assert.equal(await verifyControl(env,ctl,{game:'experience',room:'r'}),null);
   const result=await roomSeat(table,room,ctl);return Response.json(result,{status:result.ok?200:400});
  }})}};
  const meta={id:'experience',players:{max:4},servers:[{id:'public',name:'Shared',policy:'hybrid',aiSeats:1}],...(mode==='app'?{kind:'app',roles:{staff:{signIn:true,can:[]}}}:{})};
  const cat={games:[meta]},caller={id:'alice',name:'Guide',owner:false,connection:'one'};
  const call=(op,args={})=>remoteSeat(env,cat,caller,op,{game:'experience',room:'r',role:'staff',...args});
  const sat=await call('sit');assert.equal(sat.ok,true);assert.ok(Number.isInteger(sat.seat));assert.match(sat.name,/AI/);
  assert.equal(room.clients.get(table.mcpSeats.get('one').handle.id).canHost,false);
  if(rig){rig.run(1500);}else person.onMessage(JSON.stringify({t:'ev',k:'agent:view',to:sat.seat,d:{nearby:7,places:['camp']}}));
  const looked=await call('look');assert.deepEqual(looked.view.places,['camp']);assert.deepEqual(looked.vocabulary,vocab);
  await assert.rejects(call('act',{goal:'visit',args:{place:'elsewhere'}}),/refused/);
  assert.equal((await call('act',{goal:'visit',args:{place:'camp'}})).ok,true);
  await assert.rejects(call('act',{goal:'guard'}),/refused/,'rate limit is enforced');
  assert.equal((await call('speak',{line:'hello'})).ok,true);
  if(rig){
   rig.run(100);assert.ok(person.of('ev').some(f=>f.k==='agent:goal'),'goal reached the rules host');
   assert.ok(person.of('snap').some(f=>f.c?.length),'prediction snapshots still carry input acknowledgements');
  }else assert.ok(frames.some(f=>f.k==='agent:do'&&f.d.goal==='visit'),'goal reached the browser host');
  assert.equal((await call('stand')).ok,true);assert.equal(table.mcpSeats.size,0);
  assert.equal((await call('sit')).ok,true);
  if(mode==='app'){
   DB.sql.exec('DELETE FROM app_roles');await assert.rejects(call('look'),/app role required/);
   DB.sql.exec("INSERT INTO app_roles VALUES('experience','staff','alice')");
  }
  DB.sql.exec('UPDATE mcp_connections SET revoked=1');await assert.rejects(call('look'),/revoked/);assert.equal(table.mcpSeats.size,0);
 }finally{
  for(const client of [...(room?.clients.values()??[])])room.onClose(client,'test cleanup');
  rig?.host.stop();DB.sql.close();rmSync(scratch,{recursive:true,force:true});
 }
});

test('a studio explicitly delegates built-ins; other built-ins retain their defaults',async()=>{
 const {builtins}=await import('../worker/mcp-tools.mjs');const DB=database();
 try{
  const tools=builtins({DB},{games:[],studio:{mcp:{audiences:{studio_players:{app:'pub',role:'staff'},studio_stats:'public'}}}},'https://studio.test');
  const staff={id:'staff',owner:false};DB.sql.exec("INSERT INTO app_roles VALUES('pub','staff','staff')");
  assert.equal(await allowed(tools.find(t=>t.name==='studio_players').audience,staff,{DB}),true);
  assert.equal(await allowed(tools.find(t=>t.name==='studio_stats').audience,{}, {DB}),true);
  assert.equal(await allowed(tools.find(t=>t.name==='studio_shop').audience,staff,{DB}),false);
  DB.sql.exec('DELETE FROM app_roles');assert.equal(await allowed(tools.find(t=>t.name==='studio_players').audience,staff,{DB}),false);
 }finally{DB.sql.close();}
});

test('a signed webhook cannot execute a priced tool without purchase approval',async()=>{
 const {toolWebhook}=await import('../worker/tool-webhook.mjs');let ran=false;
 const response=await toolWebhook(new Request('https://studio.test/hooks/tools/paid',{method:'POST',body:'{}'}),{}, {cat:{games:[]},definitions:[{name:'paid',price:{amount:100,currency:'usd'},webhook:{secret:'SECRET',person:'owner'},handler:()=>{ran=true;}}]});
 assert.equal(response.status,402);assert.equal(ran,false);
});
