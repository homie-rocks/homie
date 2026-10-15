import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newStudio} from '../lib/scaffold.mjs';
import {checkApp} from '../lib/check.mjs';
import {needsHeadless} from '../lib/needs-headless.mjs';
import {localCookie} from '../lib/local-test.mjs';
import {Webhook} from 'standardwebhooks';
import {webhookSecret} from '../worker/event-webhook-config.mjs';
import {localCaller} from '../worker/local-test.mjs';

test('signed local identities retain only their named role, scope and loopback authority',async()=>{
 const secret='test';const token=localCookie(secret,{app:'cafe',role:'staff',scope:'one'});
 const headers={authorization:'Bearer test',cookie:'homie_test='+token};
 const caller=await localCaller(new Request('http://localhost/mcp',{headers}),{HOMIE_LOCAL_TEST_SECRET:secret});
 assert.equal(caller.owner,false);assert.deepEqual(caller.roles,{cafe:['staff']});assert.equal(caller.testScope,'one');
 assert.equal(await localCaller(new Request('https://example.com/mcp',{headers}),{HOMIE_LOCAL_TEST_SECRET:secret}),null);
 assert.equal(await localCaller(new Request('http://localhost/mcp',{headers}),{}),null);
 assert.equal(await localCaller(new Request('http://localhost/mcp',{headers:{...headers,cookie:'homie_test=bad'}}),{HOMIE_LOCAL_TEST_SECRET:secret}),null);
});

test('check proves bookings, staff queries, scheduled reminders, owner events and handover over real MCP',{timeout:60000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'homie-needs-'));let mf;
 const hookId='11111111111111111111111111111111', binding=webhookSecret(hookId), hookSecret='whsec_'+Buffer.alloc(32,3).toString('base64'), received=[];
 const meta={id:'cafe',kind:'app',roles:{owner:{signIn:true,can:['read:bookings','read:reminders','create:reminders']},customer:{can:['create:bookings','read:bookings']},staff:{signIn:true,can:['read:bookings','read:reminders']}},records:{persist:true,collections:{bookings:{fields:{name:{type:'string'}}},reminders:{fields:{name:{type:'string'}}}}}};
 try {
  newStudio(root,{name:'Cafe',install:false,kind:'business'});
  const bundled=await build({stdin:{resolveDir:new URL('../worker/',import.meta.url).pathname,contents:`
   import worker,{useTools,useFunctions} from './index.mjs';
   useFunctions(async()=>[{name:'reminders',event:'reminder.due',schedule:'0 9 * * *',handler:async(e,c)=>{const rows=await c.records({app:'cafe',collection:'bookings'});for(const row of rows.records)await c.records({app:'cafe',role:'owner',collection:'reminders',id:row.id,operation:'create',data:row.data});}}]);
   useTools(async()=>[{name:'book',audience:'public',description:'Book in one call',inputSchema:{type:'object',properties:{}},handler:(_,c)=>c.records({app:'cafe',role:'customer',collection:'bookings',id:'one',operation:'create',data:{name:'Ada'}})},
   {name:'open_roles',audience:{app:'cafe',role:'staff'},description:'Open roles',inputSchema:{type:'object',properties:{}},handler:()=>({roles:['cook']})}]);
   export default {async fetch(req,env,ctx){env.ASSETS={fetch:async()=>Response.json({studio:{name:'Cafe'},games:[${JSON.stringify(meta)}]})};return worker.fetch(req,env,ctx);}};
  `},bundle:true,write:false,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*']});
  mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'needs',compatibilityDate:'2026-10-07',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{DB:{type:'d1',id:'needs'},[binding]:{type:'json',value:hookSecret},HOMIE_LOCAL_TEST_SECRET:{type:'json',value:'test'},STUDIO_EVENT_FEEDS:{type:'json',value:JSON.stringify({bookings:{event:'record.changed',app:'cafe',collection:'bookings',audience:'owner',webhook:{id:hookId,secret:binding,url:'https://receiver.example/bookings'}}})}}},dev:{outboundService:{type:'fetcher',handler:async req=>{received.push(new Webhook(hookSecret).verify(await req.text(),Object.fromEntries(req.headers)));return new Response(null,{status:204});}}}}]});
  const db=await mf.getD1Database('DB');
  for(const file of readdirSync(join(root,'site/migrations')).sort())for(const sql of readFileSync(join(root,'site/migrations',file),'utf8').replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(sql.trim())await db.prepare(sql).run();
  mkdirSync(join(root,'.studio'),{recursive:true});writeFileSync(join(root,'.studio/local-test.json'),JSON.stringify({secret:'test'}));
  mkdirSync(join(root,'apps/cafe'),{recursive:true});
  writeFileSync(join(root,'HANDOVER.md'),'Connect your AI to /mcp. Reminders run daily.');
  const needs=[
   {id:'booking',statement:'Customer AI books in one call',role:'customer',steps:[{mcp:{tool:'book'},save:'booking'}],assertions:[{result:'booking',contains:{ok:true,id:'one'}}]},
   {id:'staff',statement:'Staff AI asks which roles are open',role:'staff',steps:[{mcp:{tool:'open_roles'},save:'roles'}],assertions:[{result:'roles',contains:{roles:['cook']}}]},
   {id:'reminders',statement:'Scheduled reminders queue for bookings',role:'owner',steps:[{role:'customer',mcp:{tool:'book'}},{schedule:{name:'reminders',at:1800000000000}}],assertions:[{role:'staff',records:{collection:'reminders'},contains:{records:[{id:'one',data:{name:'Ada'}}]}}]},
   {id:'feed',statement:'Owner AI hears bookings on its event feed',role:'owner',steps:[{role:'customer',mcp:{tool:'book'}}],assertions:[{mcp:{tool:'studio_events_read',arguments:{feed:'bookings'}},contains:{events:[{type:'record.changed',data:{app:'cafe',record:'one'}}]}}]},
   {id:'events',statement:'Owner AI reads MCP Events',role:'owner',steps:[{role:'customer',mcp:{tool:'book'}}],assertions:[{mcp:{method:'events/poll',params:{name:'bookings',cursor:'v1:bookings:0'}},contains:{events:[{name:'bookings',data:{record:'one'}}]}}]},
   {id:'webhook',statement:'Owner webhook acknowledges a signed test event',role:'owner',steps:[{mcp:{tool:'studio_events_webhook_test',arguments:{feed:'bookings'}},save:'delivery'}],assertions:[{mcp:{tool:'studio_events_webhook_status',arguments:{feed:'bookings'}},waitMs:5000,contains:{deliveries:[{event:{$result:'delivery.id'},state:'complete',attempts:1}]}}]},
   {id:'handover',statement:'Owner has connection and reminder instructions',assertions:[{file:'HANDOVER.md',text:['/mcp','Reminders run daily']}]}
  ];
  writeFileSync(join(root,'apps/cafe/CODEX.md'),'# Cafe\n\n## Needs\n```needs\n'+JSON.stringify(needs)+'\n```\n');
  const url=(await mf.ready).origin;
  const result=await checkApp({root,url,game:'cafe',meta});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual(result.surfaces,[]);
  const rooms=await db.prepare("SELECT DISTINCT app FROM app_records WHERE collection='bookings'").all();assert.equal(rooms.results.length,4,'each independent need can create the same booking id in a fresh namespace');
  assert.ok(received.some(e=>e.type==='webhook.test')); 
  const action=needsHeadless({url,secret:'test',app:'cafe',meta,scope:'other'});
  assert.deepEqual((await action({records:{collection:'bookings'}},'customer')).records,[],'another run sees no fixtures');
  await assert.rejects(action({mcp:{tool:'open_roles'}},'customer'),/not found|Unknown|available/i);
  await assert.rejects(action({records:{collection:'reminders'}},'customer'),/permission|capability|read|allowed|cannot perform/i);
  await assert.rejects(action({schedule:{name:'missing',at:1}},'owner'),/Unknown scheduled function/);
  const ordinary=await db.prepare("SELECT count(*) n FROM app_records WHERE app='cafe'").first();assert.equal(ordinary.n,0,'simulated scheduled effects stay isolated');
 }finally{await mf?.dispose();rmSync(root,{recursive:true,force:true});}
});
