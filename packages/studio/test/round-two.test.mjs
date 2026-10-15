import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './place-database.mjs';
import {pushEvents} from '../worker/event-resources.mjs';

test('pushEvents with configured feeds completes its subscription wake',async t=>{
 const DB=database(t),wakes=[];
 await DB.prepare('INSERT INTO mcp_kv(key,value) VALUES(?1,?2)').bind('event-sub:c:feed',JSON.stringify({connection:'c'})).run();
 await pushEvents({DB,STUDIO_EVENT_FEEDS:JSON.stringify({feed:{event:'record.changed'}}),LOBBY:{idFromName:x=>x,get:id=>({fetch:async()=>{wakes.push(id);return new Response(null,{status:204});}})}},{games:[]},'https://test.example');
 assert.deepEqual(wakes,['@studio-events/c']);
});

import {appAssetTicket} from '../worker/office.mjs';
import {withToolIdentity} from '../worker/tool-identity.mjs';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const meta={id:'cafe',launch:'public',roles:{guest:{can:['read:notes']}},surfaces:{phone:'guest'}};
test('invite assets use the effective launch and a revocable pass without a session',async t=>{
 const DB=database(t),env={DB},token='c'.repeat(48);
 DB.sql.prepare("INSERT INTO office_invites(id,game,code,created_at) VALUES('abcdef1234','cafe','ABCD',0)").run();
 DB.sql.prepare("INSERT INTO office_passes VALUES(?,'cafe','abcdef1234',?)").run(hash(token),Date.now()+60000);
 const request=new Request('https://place.test/cafe/open',{headers:{cookie:'studio_pass_cafe='+token}});
 const ticket=await appAssetTicket(env,'cafe',undefined,{request,meta,launch:'invite'});
 assert.ok(ticket);assert.equal(await appAssetTicket(env,'cafe',ticket,{meta,launch:'invite'}),true);
 assert.equal(await appAssetTicket(env,'cafe',ticket,{meta,launch:'private'}),false);
 DB.sql.prepare('UPDATE office_invites SET revoked=1').run();
 assert.equal(await appAssetTicket(env,'cafe',ticket,{meta,launch:'invite'}),false);
});
test('tool owner asset access works without cookies and is revoked with its connection',async t=>{
 const DB=database(t),env={DB};
 DB.sql.prepare("INSERT INTO players(id,name,owner,created_at,seen_at) VALUES('owner','Owner',1,0,0)").run();
 DB.sql.prepare("INSERT INTO mcp_connections VALUES('conn','owner','client',1,0)").run();
 const request=withToolIdentity(new Request('https://place.test/cafe/open'),{id:'owner',owner:true,connection:'conn'});
 const ticket=await appAssetTicket(env,'cafe',undefined,{request,meta,launch:'private'});
 assert.ok(ticket);assert.equal(await appAssetTicket(env,'cafe',ticket,{meta,launch:'private'}),true);
 DB.sql.prepare('UPDATE mcp_connections SET revoked=1').run();
 assert.equal(await appAssetTicket(env,'cafe',ticket,{meta,launch:'private'}),false);
});
test('asset tickets conceal database hashes and validate with one database statement',async t=>{
 const DB=database(t),env={DB},token='a'.repeat(48);
 DB.sql.prepare('INSERT INTO stats_keys(hash,kind,expires_at) VALUES(?,?,?)').run(hash(token),'session',Date.now()+60000);
 const request=new Request('https://place.test/cafe/open',{headers:{cookie:'studio_owner='+token}});
 const ticket=await appAssetTicket(env,'cafe',undefined,{request,meta});assert.ok(ticket);
 assert.ok(!Buffer.from(ticket.split('.')[0],'base64url').toString().includes(hash(token)));
 let reads=0;const prepare=DB.prepare;DB.prepare=(...args)=>{reads++;return prepare(...args);};
 assert.equal(await appAssetTicket(env,'cafe',ticket,{meta}),true);assert.equal(reads,1);
});

import {requestDatabase,MUTATIONS,databaseBinding} from '../worker/request-db.mjs';
test('request database preserves sessions and observes raw writes',async()=>{
 const session={prepare:()=>({raw:async()=>[]})};
 const DB={withSession:bookmark=>{assert.equal(bookmark,'first-primary');return session;},prepare:session.prepare};
 const wrapped=requestDatabase(DB,new Request('https://place.test/'));
 assert.equal(typeof wrapped.withSession,'function');
 const next=wrapped.withSession('first-primary');assert.equal(databaseBinding(next),DB);
 await next.prepare('UPDATE tool_data SET value=1').raw();assert.equal(wrapped[MUTATIONS],true);
});
test('metadata cache reuses completed rows across requests, invalidating on a revision change',async()=>{
 let revision=1,reads=0,revisions=0;
 const query='SELECT game, launch, max_players, updated_at FROM office_games LIMIT 500';
 const DB={prepare:q=>({first:async()=>{revisions++;return {value:String(revision)};},all:async()=>{reads++;return {results:[{game:'cafe',launch:revision===1?'public':'private'}]};}})};
 const read=()=>requestDatabase(DB,new Request('https://place.test/cafe/open')).prepare(query).all();
 assert.equal((await read()).results[0].launch,'public');await read();assert.equal(reads,1);assert.equal(revisions,2);
 revision++;assert.equal((await read()).results[0].launch,'private');assert.equal(reads,2);
});

test('pending needs are explicitly incomplete without a failing exit code',async()=>{
 const {appNeedsOutcome}=await import('../lib/check.mjs');
 assert.deepEqual(appNeedsOutcome([{status:'pending'}]),{ok:false,pending:true,exitCode:0,why:'Pending needs are not yet proved.'});
 assert.equal(appNeedsOutcome([{status:'met'},{status:'not'}]).exitCode,1);
 assert.equal(appNeedsOutcome([{status:'met'}]).ok,true);
});
test('post-response draining includes work registered by earlier background work',async()=>{
 const {drainPending}=await import('../worker/request-db.mjs');const events=[],pending=[];
 pending.push(Promise.resolve().then(()=>{pending.push(new Promise(resolve=>setTimeout(()=>{events.push('late');resolve();},5)));}));
 await drainPending(pending);assert.deepEqual(events,['late']);
});

import {AppRecordStreams,pushAppRecords} from '../worker/app-streams.mjs';
import {toolDatabase} from '../worker/tool-database.mjs';
test('tool namespaces invalidate only apps that read them and idle wakes skip authorization',async t=>{
 const DB=database(t),env={DB},streams=new AppRecordStreams(env,{}),events=[];
 DB.sql.exec("INSERT INTO app_tool_namespaces VALUES('cafe','orders'); INSERT INTO app_tool_namespaces VALUES('other','elsewhere')");
 const s={app:'cafe',collections:['notes'],seen:new Map(),controller:{desiredSize:1,enqueue:x=>events.push(JSON.parse(new TextDecoder().decode(x).slice(6)))}};
 streams.streams.add(s);let auth=0;streams.authorized=async()=>{auth++;return true;};
 for(const r of await streams.revisions(s))s.seen.set(r.collection,r.revision);
 await toolDatabase(DB,'elsewhere').put('key',1);await streams.pump(s);assert.equal(auth,0);assert.ok(!events.some(e=>e.collections.length));
 await toolDatabase(DB,'orders').put('key',1);await streams.pump(s);assert.deepEqual(events.at(-1).collections,['notes']);
 const wakes=[];env.LOBBY={idFromName:x=>x,get:id=>({fetch:async()=>{wakes.push(id);return new Response('ok');}})};
 const cat={games:[{id:'cafe',kind:'app'},{id:'other',kind:'app'}]};await pushAppRecords(env,cat);wakes.length=0;
 await toolDatabase(DB,'orders').increment('key');await pushAppRecords(env,cat);assert.deepEqual(wakes,['@app-records/cafe']);
});

test('short-lived same-origin role session opens Big screen without the shared role secret',async t=>{
 const {appRoleSession}=await import('../worker/office.mjs'),{appAccess}=await import('../worker/app-records.mjs');
 const DB=database(t),env={DB},token='d'.repeat(48),m={...meta,kind:'app',roles:{staff:{signIn:true,can:['read:notes']},other:{signIn:true,can:['read:notes']}},surfaces:{phone:'staff'}};
 DB.sql.prepare('INSERT INTO stats_keys(hash,kind,expires_at) VALUES(?,?,?)').run(hash(token),'session',Date.now()+60000);
 DB.sql.exec("INSERT INTO app_role_links VALUES('cafe','staff','shared-secret')");
 const response=await appRoleSession(new Response('page'),new Request('https://place.test/cafe/open?role=staff&access=shared-secret',{headers:{cookie:'studio_owner='+token}}),env,m,'public');
 const cookie=response.headers.get('set-cookie');assert.match(cookie,/Max-Age=300; HttpOnly; Secure; SameSite=Strict/);assert.ok(!cookie.includes('shared-secret'));
 const url=new URL('https://place.test/cafe/tv?role=staff'),request=new Request(url,{headers:{cookie:cookie.split(';')[0]}});
 assert.equal((await appAccess(request,env,m,url)).ok,true);
 const other=new URL('https://place.test/cafe/tv?role=other');assert.equal((await appAccess(new Request(other,{headers:{cookie:cookie.split(';')[0].replace('_staff=','_other=')}}),env,m,other)).ok,false);
 DB.sql.exec('DELETE FROM stats_keys');assert.equal((await appAccess(request,env,m,url)).ok,false);
});

test('cookie-free owner-office and remote-test identities can load private app pages',async t=>{
 const {default:worker}=await import('../worker/index.mjs');
 const DB=database(t),token='e'.repeat(48),ownerId='office-'+hash(token),m={...meta,kind:'app',launch:'private',records:{persist:true,collections:{notes:{fields:{text:{type:'string'}}}}}};
 DB.sql.prepare('INSERT INTO stats_keys(hash,kind,expires_at) VALUES(?,?,?)').run(hash(token),'session',Date.now()+60000);
 DB.sql.prepare('INSERT INTO mcp_connections VALUES(?,?,?,1,0)').run('owner-conn',ownerId,'client');
 const env={DB,ASSETS:{fetch:async request=>new URL(request.url).pathname==='/games.json'?Response.json({studio:{name:'Test'},games:[m]}):new Response('<html><head></head><body>Private</body></html>',{headers:{'content-type':'text/html'}})}};
 for(const caller of [{id:ownerId,owner:true,connection:'owner-conn'},{id:'test',remoteTest:true,localTest:true,testApp:'cafe',testScope:'check-test',roles:{cafe:['guest']}}]){
  const request=withToolIdentity(new Request('https://place.test/cafe/open'),caller),response=await worker.fetch(request,env,{});
  assert.equal(response.status,200);assert.match(await response.text(),/__assets\//);
 }
});

test('metadata triggers invalidate warmed settings without reading other tables',async t=>{
 const {settingsOf}=await import('../worker/office.mjs');const DB=database(t),queries=[],prepare=DB.prepare;
 DB.prepare=q=>{queries.push(q);return prepare(q);};
 const request=new Request('https://place.test/cafe/open'),env=()=>({DB:requestDatabase(DB,request)});
 await settingsOf(env());queries.length=0;await settingsOf(env());
 assert.deepEqual(queries,["SELECT value FROM meta WHERE key='metadata-revision'"]);
 DB.sql.exec("INSERT INTO office_games(game,launch,updated_at) VALUES('cafe','invite',1)");queries.length=0;
 assert.equal((await settingsOf(env())).get('cafe').launch,'invite');assert.equal(queries.length,2);assert.ok(queries.every(q=>!q.includes('servers')&&!q.includes('chat_rules')));
});
test('an asset-only test ticket cannot become a production role session',async t=>{
 const {appAccess}=await import('../worker/app-records.mjs'),DB=database(t),env={DB};
 const m={...meta,roles:{staff:{signIn:true,can:['read:notes']}},surfaces:{phone:'staff'}};
 const request=withToolIdentity(new Request('https://place.test/cafe/open?role=staff'),{id:'test',localTest:true,remoteTest:true,testApp:'cafe',roles:{cafe:['staff']}});
 const ticket=await appAssetTicket(env,'cafe',undefined,{request,meta:m});assert.ok(ticket);
 const url=new URL('https://place.test/cafe/api/app/records/notes?role=staff');
 assert.equal((await appAccess(new Request(url,{headers:{cookie:'studio_app_cafe_staff='+ticket}}),env,m,url)).ok,false);
});
test('background work registered after response delivery gets its own delivery pass',async()=>{
 const {trackBackground}=await import('../worker/request-db.mjs');let writes=0;const deliveries=[],waited=[];
 const tracker=trackBackground({waitUntil:p=>waited.push(p)},()=>deliveries.push(writes));
 await tracker.finish();tracker.context.waitUntil(Promise.resolve().then(()=>writes++));
 await Promise.all(waited);assert.deepEqual(deliveries,[0,1]);
});
