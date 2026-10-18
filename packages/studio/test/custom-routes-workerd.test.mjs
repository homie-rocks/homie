import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('custom routes and live owner/role checks run in workerd with D1', {timeout:30000}, async t=>{
  const bundled=await build({stdin:{resolveDir:fileURLToPath(new URL('../',import.meta.url)),contents:`
import worker,{useRoutes,isOwner,hasRole} from './worker/index.mjs';
useRoutes(async(request,env)=>{
  const path=new URL(request.url).pathname;
  if(path==='/custom/owner')return Response.json({allowed:await isOwner(request,env)});
  if(path==='/custom/private')return Response.json({allowed:await hasRole(request,env,'closed','visitor')});
  if(path==='/custom/visitor')return Response.json({allowed:await hasRole(request,env,'desk','visitor')});
  if(path==='/custom/staff')return Response.json({allowed:await hasRole(request,env,'desk','staff')});
  if(path==='/custom/html')return new Response('<p>Studio</p>',{headers:{'content-type':'text/html'}});
});
export default {fetch(request,env,ctx){return worker.fetch(request,{...env,ASSETS:{fetch:async request=>new URL(request.url).pathname==='/games.json'?Response.json({studio:{name:'Test'},games:[{id:'closed',kind:'app',launch:'private',roles:{visitor:{signIn:false,can:[]}}},{id:'desk',kind:'app',roles:{visitor:{signIn:false,can:[]},staff:{signIn:true,can:[]}}}]}):new Response('missing',{status:404})}},ctx);}};
`},write:false,bundle:true,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*']});
  const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'custom-routes',compatibilityDate:'2026-10-07',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{DB:{type:'d1',id:'custom-routes'}}}}]});
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE stats_keys(hash TEXT PRIMARY KEY, kind TEXT, expires_at INTEGER)').run();
  await db.prepare('CREATE TABLE app_role_links(app TEXT, role TEXT, token TEXT)').run();
  await db.prepare("INSERT INTO app_role_links (app, role, token) VALUES('desk','staff','private-link')").run();
  const token='b'.repeat(64),hash=createHash('sha256').update(token).digest('hex');
  await db.prepare("INSERT INTO stats_keys VALUES(?1,'session',?2)").bind(hash,Date.now()+60000).run();
  const get=async(path,cookie=true)=>(await mf.dispatchFetch('http://localhost'+path,{headers:cookie?{cookie:'studio_owner='+token}:{}})).json();
  assert.deepEqual(await get('/custom/private',false),{allowed:false});
  assert.deepEqual(await get('/custom/owner'),{allowed:true});
  assert.deepEqual(await get('/custom/owner',false),{allowed:false});
  assert.deepEqual(await get('/custom/staff?access=private-link'),{allowed:true});
  assert.deepEqual(await get('/custom/staff?access=wrong'),{allowed:false});
  await db.prepare('UPDATE stats_keys SET expires_at=1').run();
  assert.deepEqual(await get('/custom/owner'),{allowed:false});
  await db.prepare('UPDATE stats_keys SET expires_at=?1').bind(Date.now()+60000).run();
  assert.deepEqual(await get('/custom/owner'),{allowed:true});
  await db.prepare('DELETE FROM stats_keys').run();
  assert.deepEqual(await get('/custom/owner'),{allowed:false});
  assert.deepEqual(await get('/custom/staff?access=private-link'),{allowed:false});
  await db.prepare('CREATE TABLE office_games(game TEXT PRIMARY KEY, launch TEXT, max_players INTEGER, updated_at INTEGER)').run();
  await db.prepare('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)').run();
  await db.prepare('CREATE TABLE servers(id TEXT)').run();
  await db.prepare('CREATE TABLE chat_rules(game TEXT,server TEXT,rules TEXT,updated_at INTEGER)').run();
  assert.deepEqual(await get('/custom/visitor',false),{allowed:true});
  for(const launch of ['private','invite']) {
    await db.prepare("INSERT OR REPLACE INTO office_games VALUES('desk',?1,4,0)").bind(launch).run();
    assert.deepEqual(await get('/custom/visitor',false),{allowed:false},launch+' app must be closed to anonymous visitors');
  }
  const html=await mf.dispatchFetch('http://localhost/custom/html');
  assert.equal(html.headers.get('x-frame-options'),'DENY');assert.equal(html.headers.get('x-content-type-options'),'nosniff');
  assert.equal(await html.text(),'<p>Studio</p>');
});
