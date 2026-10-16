import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {database} from './place-database.mjs';
import worker,{useTools} from '../worker/index.mjs';
import {appAssetTicket,checkSessionTicket} from '../worker/office.mjs';
import {APP_SHELL_JS} from '../worker/app-shell.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const meta={id:'cafe',name:'Cafe',kind:'app',launch:'public',roles:{staff:{signIn:true,can:['read:notes']}},surfaces:{phone:'staff',wall:'staff'},records:{persist:true,collections:{notes:{fields:{text:{type:'string'}}}}}};
function setup(t){
 const DB=database(t);DB.batch=xs=>Promise.all(xs.map(x=>x.all()));const token='a'.repeat(64);
 DB.sql.prepare('INSERT INTO stats_keys(hash,kind,expires_at) VALUES(?,?,?)').run(hash(token),'session',Date.now()+3600000);
 DB.sql.exec("INSERT INTO app_role_links VALUES('cafe','staff','secret')");
 const env={DB,ASSETS:{fetch:async r=>new URL(r.url).pathname==='/games.json'?Response.json({studio:{name:'Test'},games:[meta]}):new Response('asset')}};
 return {env,token};
}
test('API handoffs slide beyond the original expiry and stop on revocation',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const {env,token}=setup(t);let cookie='studio_owner='+token;
 async function call(path,extra={}){return worker.fetch(new Request('https://place.test/cafe/'+path,{headers:{cookie,origin:'https://place.test'},...extra}),env,{});}
 let res=await call('api/app/records/notes?role=staff&access=secret');assert.equal(res.status,200);
 assert.ok(res.headers.get('set-cookie'),'link+session API response mints handoff');cookie=res.headers.get('set-cookie').split(';')[0];
 for(let i=0;i<3;i++){
  t.mock.timers.tick(240000);
  res=await call('api/app/records/notes?role=staff');assert.equal(res.status,200);assert.ok(res.headers.get('set-cookie'));cookie=res.headers.get('set-cookie').split(';')[0];
 }
 {env.DB.sql.exec("UPDATE app_role_links SET token='rotated'");res=await call('api/app/records/notes?role=staff');assert.equal(res.status,404);assert.equal(res.headers.get('set-cookie'),null);}
 env.DB.sql.exec("UPDATE app_role_links SET token='secret'; DELETE FROM stats_keys");res=await call('api/app/records/notes?role=staff');assert.equal(res.status,404);assert.equal(res.headers.get('set-cookie'),null);
});
test('records-only pages set the handoff before the shell strips access',async t=>{
 const {env,token}=setup(t),res=await worker.fetch(new Request('https://place.test/cafe/open?role=staff&access=secret',{headers:{cookie:'studio_owner='+token}}),env,{});
 assert.equal(res.status,200);assert.ok(res.headers.get('set-cookie'));
});
test('phone shell removes access from address, records, tools and EventSource URLs',async()=>{
 const urls=[],replaced=[],handlers={},source={postMessage(){}};
 vm.runInNewContext(APP_SHELL_JS,{window:{__HOMIE_PLAY:{kind:'app',game:'cafe'}},document:{querySelector:()=>({contentWindow:source})},location:{search:'?role=staff&access=secret&room=lobby',pathname:'/cafe/open',hash:'#hello'},history:{replaceState:(_a,_b,url)=>replaced.push(url)},URLSearchParams,fetch:async url=>{urls.push(url);return {status:200,json:async()=>({ok:true})}},EventSource:class{constructor(url){urls.push(url)}close(){}},addEventListener:(name,fn)=>handlers[name]=fn,Map,Set,Date,Promise,JSON,AbortSignal});
 for(const type of ['homie-app','homie-app-tool','homie-app-subscribe'])await handlers.message({source,data:{type,id:'a'.repeat(32),collection:'notes',collections:['notes'],method:'GET',name:'hello'}});
 assert.equal(urls.length,3);assert.ok(urls.every(url=>!url.includes('access=')&&!url.includes('secret')));assert.deepEqual(replaced,['/cafe/open?role=staff&room=lobby#hello']);
});
test('static requests never load tools; scheduled maintenance refreshes the catalogue',async t=>{
 const {env,token}=setup(t);let loads=0;useTools(async()=>{loads++;return []});t.after(()=>useTools(async()=>[]));
 env.LOBBY={idFromName:x=>x,get:()=>({fetch:async()=>Response.json({rooms:[]})})};env.TABLE=env.LOBBY;
 async function call(path,options={}){const pending=[];const res=await worker.fetch(new Request('https://place.test'+path,options),env,{waitUntil:p=>pending.push(p)});for(let i=0;i<pending.length;i++)await pending[i];return res;}
 await call('/style.css');await call('/other.css');assert.equal(loads,0);
 await worker.scheduled({cron:'17 * * * *'},env,{waitUntil(){}});assert.equal(loads,1);
 const response=await call('/_studio/api/game',{method:'POST',headers:{cookie:'studio_owner='+token,origin:'https://place.test','content-type':'application/json'},body:JSON.stringify({game:'cafe',launch:'private'})});
 assert.equal(response.status,200);await call('/third.css');assert.equal(loads,1);
 await worker.scheduled({cron:'17 * * * *'},env,{waitUntil(){}});assert.equal(loads,2);
});
test('test-kind assets require the same still-valid test session on use',async t=>{
 const {env}=setup(t),origin='https://place.test';
 const session=await checkSessionTicket(env,{app:'cafe',role:'staff',scope:'check-one',origin});
 const request=new Request(origin+'/cafe/open?role=staff',{headers:{cookie:'homie_check='+session}});
 const ticket=await appAssetTicket(env,'cafe',undefined,{request,meta});assert.ok(ticket);
 assert.equal(await appAssetTicket(env,'cafe',ticket,{request,meta}),true);
 const asset=origin+'/cafe/__assets/'+ticket+'/index.html';
 assert.equal((await worker.fetch(new Request(asset,{headers:{cookie:'homie_check='+session}}),env,{})).status,200);
 assert.equal((await worker.fetch(new Request(asset),env,{})).status,404);
 assert.equal(await appAssetTicket(env,'cafe',ticket,{request:new Request(origin+'/cafe/__assets/x/index.html'),meta}),false);
 const other=await checkSessionTicket(env,{app:'cafe',role:'staff',scope:'check-two',origin});
 assert.equal(await appAssetTicket(env,'cafe',ticket,{request:new Request(origin+'/cafe/open',{headers:{cookie:'homie_check='+other}}),meta}),false);
});

import {AppRecordStreams} from '../worker/app-streams.mjs';
test('idle live streams reconnect before handoff expiry and renew on open',async t=>{
 t.mock.timers.enable({apis:['Date','setInterval','setTimeout'],now:Date.now()});
 const {env,token}=setup(t),streams=new AppRecordStreams(env,{waitUntil(){}});t.after(()=>streams.dispose());
 env.LOBBY={idFromName:x=>x,get:()=>({fetch:async(_url,init)=>streams.open(JSON.parse(init.body))})};
 let cookie='studio_owner='+token;
 const open=()=>worker.fetch(new Request('https://place.test/cafe/api/app/live?role=staff&collection=notes'+(cookie.startsWith('studio_owner')?'&access=secret':''),{headers:{cookie}}),env,{});
 let res=await open();assert.equal(res.status,200);assert.ok(res.headers.get('set-cookie'));cookie=res.headers.get('set-cookie').split(';')[0];
 for(let i=0;i<3;i++){
  t.mock.timers.tick(240000);assert.equal(streams.streams.size,0,'server closes idle SSE before the 300-second handoff expires');
  res=await open();assert.equal(res.status,200);assert.ok(res.headers.get('set-cookie'));cookie=res.headers.get('set-cookie').split(';')[0];
 }
 env.DB.sql.exec('DELETE FROM stats_keys');res=await open();assert.equal(res.status,403);assert.equal(res.headers.get('set-cookie'),null);
});
test('tools API renews handoffs and refuses revoked player grants',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const {env}=setup(t),token='b'.repeat(43);
 env.DB.sql.exec("INSERT INTO players(id,name,guest,created_at,seen_at) VALUES('staff','Staff',0,0,0); INSERT INTO app_roles VALUES('cafe','staff','staff')");
 env.DB.sql.prepare("INSERT INTO player_sessions(hash,player,kind,expires_at) VALUES(?,'staff','session',?)").run(hash(token),Date.now()+3600000);
 useTools(async()=>[{name:'hello',audience:'public',inputSchema:{type:'object'},handler:async()=>({hello:true})}]);t.after(()=>useTools(async()=>[]));
 let cookie='studio_player='+token;
 const call=()=>worker.fetch(new Request('https://place.test/cafe/api/app/tools?role=staff'+(cookie.startsWith('studio_player')?'&access=secret':''),{method:'POST',headers:{cookie,origin:'https://place.test','content-type':'application/json'},body:JSON.stringify({name:'hello',input:{}})}),env,{});
 let res=await call();assert.equal(res.status,200);assert.ok(res.headers.get('set-cookie'));cookie=res.headers.get('set-cookie').split(';')[0];
 t.mock.timers.tick(240000);res=await call();assert.equal(res.status,200);assert.ok(res.headers.get('set-cookie'));cookie=res.headers.get('set-cookie').split(';')[0];
 env.DB.sql.exec('DELETE FROM app_roles');res=await call();assert.equal(res.status,404);assert.equal(res.headers.get('set-cookie'),null);
});
