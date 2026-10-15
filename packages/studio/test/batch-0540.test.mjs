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
  vm.runInNewContext(APP_SHELL_JS,{window,document:{},location:{origin:'https://cafe.example',search},URLSearchParams,addEventListener(){},BroadcastChannel:class{},setTimeout,clearTimeout});
  assert.equal(window.homieApp.context.url,'https://cafe.example/cafe/open'+suffix);
 }
});

test('Big screen navigation retains same-origin app role context but share URLs do not',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../worker/pages.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('  function shareReady(room) {'),source.indexOf("    toggle.addEventListener('click'",source.indexOf('  function shareReady(room) {')));
 const nodes=new Map();const ui={querySelector:s=>{if(!nodes.has(s))nodes.set(s,{});return nodes.get(s);}};
 const context={ui,boot:{game:'cafe',kind:'app'},state:{},location:{origin:'https://studio.example',search:'?role=staff&access=private&ticket=never'},URL,URLSearchParams,encodeURIComponent,labelOf:x=>x,LOCAL:false};
 vm.runInNewContext(body+'\n}\nshareReady("pub-2");',context);
 const link=new URL(nodes.get('[data-bigscreen]').href,context.location.origin);
 assert.equal(link.searchParams.get('role'),'staff');assert.equal(link.searchParams.get('access'),'private');assert.equal(link.searchParams.get('ticket'),null);
 assert.equal(context.state.link,'https://studio.example/cafe/open?room=pub-2');
});

test('custom tool data mutations notify record subscribers, but conflicting writes do not',async t=>{
 const {database}=await import('./place-database.mjs');const {toolDatabase}=await import('../worker/tool-database.mjs');const {AppRecordStreams}=await import('../worker/app-streams.mjs');
 const DB=database(t),streams=new AppRecordStreams({DB},{}),data=toolDatabase(DB,'custom');
 const s={app:'cafe',collections:['notes'],seen:new Map(),controller:{desiredSize:1,enqueue:chunk=>events.push(JSON.parse(new TextDecoder().decode(chunk).slice(6)))}};
 const events=[];streams.streams.add(s);streams.authorized=async()=>true;
 for(const row of await streams.revisions(s))s.seen.set(row.collection,row.revision);
 await data.put('key',{ok:true});await streams.pump(s);assert.deepEqual(events.at(-1).collections,['notes']);
 await data.put('key',{ok:false},{version:99});await streams.pump(s);assert.deepEqual(events.at(-1).collections,[]);
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
