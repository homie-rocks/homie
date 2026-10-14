import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {services,allowed,builtins} from '../worker/mcp-tools.mjs';
import {syncFunctions,emitEvent,runFunctions} from '../worker/functions.mjs';
import {rulesStamp} from '../lib/dev.mjs';
import {appProblems} from '../worker/app-format.mjs';
export function database(t){const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());for(const file of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort())sql.exec(readFileSync(new URL('../../../template/site/migrations/'+file,import.meta.url),'utf8'));const stmt=(q,a=[])=>({bind:(...x)=>stmt(q,x),first:async()=>sql.prepare(q).get(...a)??null,all:async()=>({results:sql.prepare(q).all(...a)}),run:async()=>({meta:{changes:sql.prepare(q).run(...a).changes}})});return {sql,prepare:stmt,batch:async xs=>Promise.all(xs.map(s=>s.run()))};}
const cat={games:[]},owner={id:'owner',owner:true};
test('one studio role authorizes two apps, revocation preserves per-app grants',async t=>{
 const DB=database(t),env={DB},caller={id:'staff',owner:false};
 DB.sql.exec("INSERT INTO app_roles VALUES('*','staff','staff');INSERT INTO app_roles VALUES('boards','staff','staff')");
 assert.equal(await allowed({app:'boards',role:'staff'},caller,env),true);
 assert.equal(await allowed({app:'giving',role:'staff'},caller,env),true);
 DB.sql.exec("DELETE FROM app_roles WHERE app='*'");
 assert.equal(await allowed({app:'giving',role:'staff'},caller,env),false);assert.equal(await allowed({app:'boards',role:'staff'},caller,env),true);
});
test('two record.changed handlers do not lose a versioned read-modify-write',async t=>{
 const DB=database(t),env={DB};let firstRead;const read=new Promise(r=>firstRead=r);let release;const both=new Promise(r=>release=r);let reads=0;
 const definitions=[{name:'log',event:'record.changed',async handler(e,c){
   let row=await c.database.getVersioned('count');if(++reads===1){firstRead();await both;}else release();
   while(!(await c.database.put('count',(row?.value??0)+1,{version:row?.version??0})).ok)row=await c.database.getVersioned('count');
 }}];
 await syncFunctions(env,definitions);await emitEvent(env,'record.changed',{record:'a'},{id:'a'});
 const first=runFunctions(env,cat,'http://localhost',{definitions});await read;
 await emitEvent(env,'record.changed',{record:'b'},{id:'b'});await Promise.all([first,runFunctions(env,cat,'http://localhost',{definitions})]);
 assert.equal(await services(env,cat,'http://localhost',owner,'function:log').database.get('count'),2);
});
test('tools-only event readers receive a cursor and enforce feed audience',async t=>{
 const DB=database(t),env={DB,STUDIO_EVENT_FEEDS:JSON.stringify({paid:{event:'order.paid'}})};
 await syncFunctions(env,[]);for(let i=0;i<101;i++)await emitEvent(env,'order.paid',{order:String(i)},{id:String(i)});
 const tool=builtins(env,cat,'http://localhost').find(t=>t.name==='studio_events_read');assert.ok(tool);
 const page=await tool.handler({feed:'paid'}, {caller:owner});assert.equal(page.events.length,100);assert.equal(typeof page.next,'number');
 const next=await tool.handler({feed:'paid',after:page.next},{caller:owner});assert.equal(next.events.length,1);
 await assert.rejects(tool.handler({feed:'paid'},{caller:{id:'visitor',owner:false}}));
});
test('root HTML CSS and JavaScript edits all change the rebuild stamp',t=>{
 const dir=mkdtempSync(join(tmpdir(),'homie-stamp-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const g={dir,kind:'app'};
 for(const name of ['index.html','app.css','app.js']){const before=rulesStamp(g);writeFileSync(join(dir,name),'one');assert.notEqual(rulesStamp(g),before,name);}
 const before=rulesStamp(g);writeFileSync(join(dir,'app.css'),'different');assert.notEqual(rulesStamp(g),before);
});
test('record field names permit underscores and describe rejected names',()=>{
 const meta={roles:{customer:{signIn:false,can:['read:jobs']}},surfaces:{phone:'customer'},records:{persist:true,collections:{jobs:{fields:{paid_at:{type:'number'}}}}}};
 assert.deepEqual(appProblems(meta),[]);
 meta.records.collections.jobs.fields={'Paid At':{type:'number'}};
 assert.match(appProblems(meta).join(' '),/lowercase.*underscore/);
});
test('atomic append/increment and prefix pages keep concurrent writes and namespace isolation',async t=>{
 const DB=database(t),db=services({DB},cat,'http://localhost',owner,'a').database;
 await Promise.all(Array.from({length:20},(_,i)=>Promise.all([db.increment('count'),db.append('log',i),db.put('entry:'+i,i)])));
 assert.equal(await db.get('count'),20);assert.equal((await db.get('log')).length,20);
 const page=await db.list({prefix:'entry:',limit:7});assert.equal(page.items.length,7);assert.ok(page.next);
 const next=await db.list({prefix:'entry:',after:page.next,limit:100});assert.equal(next.items.length,13);
 assert.equal(await services({DB},cat,'http://localhost',owner,'b').database.get('count'),null);
 assert.equal((await db.put('count',99,{version:1})).conflict,true);
 await assert.rejects(db.increment('log'),/numeric/);
});
test('live unconnected shop and giving retain priced choices and fresh shop exists',async()=>{
 const {shopPage}=await import('../worker/shop-page.mjs');const {shopRoutes}=await import('../worker/shop.mjs');
 for(const giving of [false,true]){
 const shop={currency:'cad',giving:giving?{}:undefined,items:[{id:'tune',name:'Support a fitting',price:4500}],policy:{},refundDays:null};
 const html=await shopPage({studio:{name:'Boards'}},shop,{origin:'https://boards.test'}).text();
 assert.ok(html.includes('Support a fitting'));assert.ok(html.includes('disabled'));
 }
 const request=new Request('https://fresh.test/shop/');const response=await shopRoutes(request,{},null,new URL(request.url),{catalogueOf:async()=>({studio:{name:'Fresh'},games:[]})});
 assert.equal(response?.status,200);
});
test('owner can clear event history through a sequence boundary without clearing newer events',async t=>{
 const DB=database(t),env={DB,STUDIO_EVENT_FEEDS:JSON.stringify({paid:{event:'order.paid'}})};
 await syncFunctions(env,[]);await emitEvent(env,'order.paid',{},{id:'old'});const through=DB.sql.prepare('SELECT max(seq) n FROM studio_events').get().n;await emitEvent(env,'order.paid',{},{id:'new'});
 const tool=builtins(env,cat,'http://localhost').find(t=>t.name==='studio_events_clear');assert.ok(tool);
 await assert.rejects(tool.handler({through},{caller:{id:'staff',owner:false}}));
 await tool.handler({through},{caller:owner});assert.deepEqual(DB.sql.prepare('SELECT id FROM studio_events').all().map(r=>r.id),['new']);
});
test('connected MCP stream announces a changed tool list',async t=>{
 const {EventStreams}=await import('../worker/event-resources.mjs');const DB=database(t);
 DB.sql.exec("INSERT INTO players(id,name,guest,owner,created_at,seen_at) VALUES('owner','Owner',0,1,1,1);INSERT INTO mcp_connections VALUES('conn','owner','client',1,0)");
 const pending=[];const streams=new EventStreams({DB},{waitUntil:p=>pending.push(p)});
 const response=await streams.fetch(new Request('https://events',{method:'POST',body:JSON.stringify({op:'stream',connection:'conn',cat,tools:[{name:'old',audience:'owner'}]})}));
 const reader=response.body.getReader();await reader.read();
 await streams.fetch(new Request('https://events',{method:'POST',body:JSON.stringify({op:'tools',connection:'conn',cat,tools:[{name:'new',audience:'owner'}]})}));
 let timer;try {const chunk=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('No tools/list_changed notification')),500);})]);assert.match(new TextDecoder().decode(chunk.value),/notifications\/tools\/list_changed/);}finally{clearTimeout(timer);await reader.cancel();await Promise.all(pending);}
});
