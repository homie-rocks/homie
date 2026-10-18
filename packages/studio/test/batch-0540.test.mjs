import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {proveAppNeeds} from '../lib/app-needs.mjs';
import {APP_SHELL_JS} from '../worker/app-shell.mjs';

test('a need without assertions is a pending placeholder, with no actions run',async()=>{
 const checks=[];
 const [result]=await proveAppNeeds({plan:{needs:[{id:'later',statement:'Add this later',steps:[{mcp:{tool:'never'}}]}]},surfaces:[],headless:()=>{throw Error('must not run');},report:{check:(...args)=>checks.push(args)}});
 assert.equal(result.status,'pending');assert.equal(checks[0][1],'skip');
});
test('app context shares a validated room, without role or credentials',()=>{
 for(const [search,suffix] of [['?room=pub-7&role=staff&access=secret','?room=pub-7'],['?room=%3Cbad%3E&ticket=secret','']]) {
  const window={__HOMIE_APP:{game:'cafe',kind:'app',direct:true}};
  vm.runInNewContext(APP_SHELL_JS,{window,document:{},location:{origin:'https://cafe.example',pathname:'/cafe/open',search},history:{replaceState(){}},URLSearchParams,addEventListener(){},BroadcastChannel:class{},setTimeout,clearTimeout});
  assert.equal(window.homieApp.context.url,'https://cafe.example/cafe/open'+suffix);
 }
});

test('Big screen uses the same-origin session without copying the role-link secret',async()=>{
 const {shell}=await import('./fixtures/page-shell.mjs');
 const page=await shell('?role=staff&access=private&ticket=never',{g:{id:'cafe',name:'Cafe',kind:'app',players:{max:4}}});
 const link=new URL(page.el('[data-bigscreen]').href,'https://owls.example');
 assert.equal(link.searchParams.get('role'),'staff');assert.equal(link.searchParams.get('access'),null);assert.equal(link.searchParams.get('ticket'),null);
 assert.equal(page.ctx.__shell.link,'https://owls.example/cafe/open?room=pub-3');
});

test('custom tool data mutations notify record subscribers, but conflicting writes do not',async t=>{
 const {database}=await import('./place-database.mjs');const {toolDatabase}=await import('../worker/tool-database.mjs');const {AppRecordStreams}=await import('../worker/app-streams.mjs');
 const DB=database(t),streams=new AppRecordStreams({DB},{}),data=toolDatabase(DB,'custom');
 const s={app:'cafe',collections:['notes'],seen:new Map(),controller:{desiredSize:1,enqueue:chunk=>events.push(JSON.parse(new TextDecoder().decode(chunk).slice(6)))}};
 DB.sql.exec("INSERT INTO app_tool_namespaces VALUES('cafe','custom')");
 const events=[];streams.streams.add(s);streams.authorized=async()=>true;
 for(const row of await streams.revisions(s))s.seen.set(row.collection,row.revision);
 await data.put('key',{ok:true});await streams.pump(s);assert.deepEqual(events.at(-1).collections,['notes']);
 const count=events.length;await data.put('key',{ok:false},{version:99});await streams.pump(s);assert.equal(events.length,count);
 await data.increment('count');await streams.pump(s);assert.deepEqual(events.at(-1).collections,['notes']);
 await data.append('log','hello');await streams.pump(s);assert.deepEqual(events.at(-1).collections,['notes']);
});

test('private asset capabilities expire with session logout and role downgrade, including replay',async t=>{
 const {database}=await import('./place-database.mjs');const {appAssetTicket}=await import('../worker/office.mjs');const {createHash}=await import('node:crypto');
 const DB=database(t),env={DB},token='a'.repeat(48),hash=createHash('sha256').update(token).digest('hex');
 DB.sql.prepare('INSERT INTO stats_keys(hash,kind,expires_at) VALUES(?,?,?)').run(hash,'session',Date.now()+60000);
 const meta={id:'cafe',roles:{staff:{signIn:true,can:['read:notes']}},surfaces:{phone:'staff'}},request=new Request('https://place.test/cafe/open?role=staff',{headers:{cookie:'studio_owner='+token}});
 const ticket=await appAssetTicket(env,'cafe',undefined,{request,meta});assert.ok(ticket);
 assert.equal(await appAssetTicket(env,'cafe',ticket,{meta}),true);
 assert.equal(await appAssetTicket(env,'other',ticket,{meta}),false);
 DB.sql.prepare('DELETE FROM stats_keys WHERE hash=?').run(hash);
 assert.equal(await appAssetTicket(env,'cafe',ticket,{meta}),false,'logout revokes copies of the bearer link');
 DB.sql.prepare('INSERT INTO stats_keys(hash,kind,expires_at) VALUES(?,?,?)').run(hash,'session',Date.now()+60000);
 meta.roles.staff.can=[];
 assert.equal(await appAssetTicket(env,'cafe',ticket,{meta}),false,'a deployed role downgrade revokes old links');
});

test('player asset capability rechecks role grants, role-link rotation and session expiry',async t=>{
 const {database}=await import('./place-database.mjs');const {appAssetTicket}=await import('../worker/office.mjs');const {createHash}=await import('node:crypto');
 const DB=database(t),env={DB},token='b'.repeat(48),hash=createHash('sha256').update(token).digest('hex');
 DB.sql.prepare("INSERT INTO players(id,name,created_at,seen_at) VALUES('p','Staff',0,0)").run();
 DB.sql.prepare("INSERT INTO player_sessions(hash,player,expires_at) VALUES(?,'p',?)").run(hash,Date.now()+60000);
 DB.sql.prepare("INSERT INTO app_roles VALUES('cafe','staff','p')").run();
 DB.sql.prepare("INSERT INTO app_role_links (app, role, token) VALUES('cafe','staff','original')").run();
 const meta={id:'cafe',roles:{staff:{signIn:true,can:['read:notes']}},surfaces:{phone:'staff'}},request=new Request('https://place.test/cafe/open?role=staff',{headers:{cookie:'studio_player='+token}});
 const ticket=await appAssetTicket(env,'cafe',undefined,{request,meta});assert.ok(ticket);assert.equal(await appAssetTicket(env,'cafe',ticket,{meta}),true);
 DB.sql.prepare("DELETE FROM app_roles WHERE player='p'").run();assert.equal(await appAssetTicket(env,'cafe',ticket,{meta}),false);
 DB.sql.prepare("INSERT INTO app_roles VALUES('cafe','staff','p')").run();assert.equal(await appAssetTicket(env,'cafe',ticket,{meta}),true);
 DB.sql.prepare("UPDATE app_role_links SET token='rotated'").run();assert.equal(await appAssetTicket(env,'cafe',ticket,{meta}),false);
 const next=await appAssetTicket(env,'cafe',undefined,{request,meta});assert.ok(next);
 DB.sql.prepare('DELETE FROM app_role_links').run();
 const unlinked=await appAssetTicket(env,'cafe',undefined,{request,meta});assert.ok(unlinked);
 DB.sql.prepare("INSERT INTO app_role_links (app, role, token) VALUES('cafe','staff','new-restriction')").run();assert.equal(await appAssetTicket(env,'cafe',unlinked,{meta}),false,'adding a role link invalidates the former context too');
 DB.sql.prepare('UPDATE player_sessions SET expires_at=0').run();assert.equal(await appAssetTicket(env,'cafe',next,{meta}),false);
 DB.sql.prepare('DELETE FROM player_sessions').run();assert.equal(await appAssetTicket(env,'cafe',next,{meta}),false);
});
