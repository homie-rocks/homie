import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('MCP client reads bookings without a standing event stream; current role checks still hold',{timeout:30000},async()=>{
 const bundled=await build({stdin:{resolveDir:new URL('../worker/',import.meta.url).pathname,contents:`
  import worker,{Lobby} from './index.mjs';export {Lobby};
  const cat={studio:{name:'Bookings'},games:[{id:'cafe',kind:'app',roles:{customer:{can:['create:bookings']},staff:{signIn:true,can:['read:bookings','update:bookings','delete:bookings']}},records:{persist:true,collections:{bookings:{fields:{name:{type:'string'},note:{type:'string'}}},private:{fields:{name:{type:'string'}}}}}}]};
  export default {fetch(req,env,ctx){
    env.ASSETS={fetch:async()=>Response.json(cat)};
    // Test fixture identities stand in for OAuthProvider's verified props.
    const connection=req.headers.get('x-test-connection');
    return worker.fetch(req,env,{props:connection?{connection}:undefined,waitUntil:p=>ctx.waitUntil(p)});
  }};
 `},bundle:true,write:false,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*']});
 const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'push',compatibilityDate:'2026-10-07',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},exports:{Lobby:{type:'durable-object',storage:'sqlite'}},env:{DB:{type:'d1',id:'push'},LOBBY:{type:'durable-object',worker:'push',exportName:'Lobby'},STUDIO_EVENT_FEEDS:{type:'json',value:JSON.stringify({bookings:{event:'record.changed',app:'cafe',collection:'bookings',audience:{app:'cafe',role:'staff'}}})}}}}]});
 const clients=[];let reader;
 try{
  const db=await mf.getD1Database('DB');
  for(const file of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort())for(const sql of readFileSync(new URL('../../../template/site/migrations/'+file,import.meta.url),'utf8').replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(sql.trim())await db.prepare(sql).run();
  for(const [id,owner]of [['owner',1],['staff',0]]){
    await db.prepare('INSERT INTO players(id,name,named,guest,owner,created_at,seen_at) VALUES(?1,?1,1,0,?2,1,1)').bind(id,owner).run();
    await db.prepare('INSERT INTO mcp_connections VALUES(?1,?1,\'client\',1,0)').bind(id).run();
  }
  await db.prepare("INSERT INTO app_roles VALUES('cafe','staff','staff')").run();
  const fetcher=connection=>async(input,init)=>{const req=new Request(input,init);const headers=new Headers(req.headers);if(connection)headers.set('x-test-connection',connection);return mf.dispatchFetch(req.url,{method:req.method,headers:Object.fromEntries(headers),...(req.body?{body:await req.arrayBuffer()}: {})});};
  const client=new Client({name:'booking-ai',version:'1'});clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'),{fetch:fetcher('staff')}));
  const idle=await fetcher('staff')('http://localhost/mcp',{headers:{accept:'text/event-stream'}});assert.equal(idle.status,405);await idle.body?.cancel();
  assert.ok((await client.listResources()).resources.some(r=>r.uri==='studio://events/bookings'));
  await client.subscribeResource({uri:'studio://events/bookings'});
  const booking=async id=>{
    const r=await mf.dispatchFetch('http://localhost/cafe/api/app/records/bookings/'+id,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({data:{name:id}})});
    assert.equal(r.status,200,await r.text());
  };
  await booking('first');
  await client.close();
  const again=await fetcher('staff')('http://localhost/mcp',{headers:{accept:'text/event-stream'}});assert.equal(again.status,405);await again.body?.cancel();
  await booking('second');
  const rpc=async(connection,method,params)=>{
    const response=await fetcher(connection)('http://localhost/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json,text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:99,method,params})});
    const text=await response.text();return text.startsWith('{')?JSON.parse(text):text.split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6))).find(m=>m.id===99);
  };
  const tool=(connection,name,args)=>rpc(connection,'tools/call',{name,arguments:args});
  const read=await rpc('staff','resources/read',{uri:'studio://events/bookings'});
  assert.ok(JSON.parse(read.result.contents[0].text).events.some(event=>event.data.record==='second'));
  const conflict=await tool(null,'app_records',{app:'cafe',collection:'bookings',id:'first',operation:'create',data:{name:'Again'}});
  assert.equal(conflict.result.isError,true);assert.match(conflict.result.content[0].text,/record changed or already exists; reload/);
  assert.doesNotMatch(conflict.result.content[0].text,/Tool failed/);
  // The owner patches one field without a version; the rest of the record is kept.
  const patched=await tool('owner','app_records',{app:'cafe',collection:'bookings',id:'second',operation:'update',data:{note:'replied'}});
  assert.equal(patched.result.isError,undefined,JSON.stringify(patched));
  const kept=JSON.parse((await db.prepare("SELECT value FROM app_records WHERE id='second'").first()).value);
  assert.equal(kept.note,'replied');assert.ok(kept.name);
  const versionless=await tool('staff','app_records',{app:'cafe',role:'staff',collection:'bookings',id:'second',operation:'update',data:{note:'x'}});
  assert.equal(versionless.result.isError,true);
  const removed=await tool('staff','app_records',{app:'cafe',role:'staff',collection:'bookings',id:'first',operation:'delete',version:1});
  assert.equal(removed.result.isError,undefined);assert.equal(await db.prepare("SELECT id FROM app_records WHERE id='first'").first(),null);
  await db.prepare("INSERT INTO player_emails(player,email,verified_at,added_at) VALUES('staff','staff@example.test',1,1)").run();
  // Paging traverses all retained events while excluding another collection.
  await db.batch(Array.from({length:105},(_,i)=>db.prepare('INSERT INTO app_records(app,collection,id,value,version,updated_at) VALUES(?1,?2,?3,?4,1,1)').bind('cafe',i%2?'private':'bookings','page'+i,JSON.stringify({name:i%2?'HIDDEN':'visible'}))));
  let uri='studio://events/bookings',visible=[];
  do {
    const page=await rpc('staff','resources/read',{uri});assert.ok(page.result,JSON.stringify(page));
    const content=JSON.parse(page.result.contents[0].text);visible.push(...content.events);uri=content.next;
  }while(uri);
  assert.equal(visible.filter(e=>e.data.record.startsWith('page')).length,53);
  assert.ok(visible.every(e=>e.data.collection==='bookings'));
  const revoke=await tool('owner','app_role',{app:'cafe',role:'staff',signIn:'staff@example.test',revoke:true});assert.equal(revoke.result.isError,undefined);
  const deniedDelete=await tool('staff','app_records',{app:'cafe',role:'staff',collection:'bookings',id:'second',operation:'delete',version:1});assert.equal(deniedDelete.result.isError,true);
  const grant=await tool('owner','app_role',{app:'cafe',role:'staff',signIn:'staff'});assert.equal(grant.result.isError,undefined);
  assert.ok(await db.prepare("SELECT player FROM app_roles WHERE player='staff'").first());
  await tool('owner','app_role',{app:'cafe',role:'staff',signIn:'staff',revoke:true});
  await db.prepare("UPDATE mcp_connections SET revoked=1 WHERE id='staff'").run();
  await booking('third');
  const denied=await fetcher('staff')('http://localhost/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json,text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:10,method:'resources/read',params:{uri:'studio://events/bookings'}})});
  assert.match(await denied.text(),/error/);
  const anonymous=new Client({name:'public',version:'1'});clients.push(anonymous);await anonymous.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'),{fetch:fetcher(null)}));
  assert.ok((await anonymous.listTools()).tools.some(t=>t.name==='app_records'));assert.ok(!(await anonymous.listResources()).resources.some(r=>r.uri.startsWith('studio://events/')));
 }finally{await reader?.cancel();await Promise.all(clients.map(c=>c.close()));await mf.dispose();}
});
