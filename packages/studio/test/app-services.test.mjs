import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appToolsRoute} from '../worker/app-tools.mjs';
import {database} from './place-database.mjs';

const meta={id:'place',kind:'app',roles:{customer:{can:[],signIn:false},staff:{can:[],signIn:true}},surfaces:{phone:'customer'}};
const schema={type:'object',properties:{id:{type:'string',pattern:'^[a-z]+$'}},required:['id'],additionalProperties:false};
const tool={name:'reserve',audience:'public',inputSchema:schema,async handler({id},ctx){const old=await ctx.database.getVersioned('last');if(old?.value===id)return {ok:true};return ctx.database.put('last',id,{version:0});}};
async function call(env,body,definitions=[tool],headers={}){const url=new URL('https://place.test/place/api/app/tools');return appToolsRoute(new Request(url,{method:'POST',headers:{origin:url.origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}),env,meta,url,{games:[meta]},definitions);}
test('app calls the trusted tool with strict schema and atomic idempotent writes',async t=>{
 const env={DB:database(t)};
 assert.equal((await call(env,{name:'reserve',input:{id:'a',owner:true}})).status,400);
 const results=await Promise.all(['a','b'].map(id=>call(env,{name:'reserve',input:{id}}).then(r=>r.json())));
 assert.equal(results.filter(r=>r.data.ok).length,1);
 const winner=results[0].data.ok?'a':'b';assert.equal((await (await call(env,{name:'reserve',input:{id:winner}})).json()).data.ok,true);
 assert.equal(env.DB.sql.prepare('SELECT count(*) n FROM tool_data').get().n,1);
});
test('frame transport cannot manufacture staff or owner authority or bypass origin checks',async t=>{
 const env={DB:database(t)};let called=false;
 for(const audience of ['owner','signed-in',{app:'place',role:'staff'}])assert.equal((await call(env,{name:'reserve',input:{id:'a'},role:'staff'},[{...tool,audience,handler(){called=true;}}])).status,403);
 assert.equal(called,false);
 assert.equal((await call(env,{name:'reserve',input:{id:'a'}},[tool],{origin:'https://elsewhere.test'})).status,403);
});

test('live record streams push changes across screens without a rules room, isolate scopes, and count presence',async t=>{
 const {AppRecordStreams}=await import('../worker/app-streams.mjs');
 const DB=database(t),pending=[];
 const hub=new AppRecordStreams({DB},{waitUntil:p=>pending.push(p)});t.after(()=>hub.dispose());
 const open=async()=>hub.open({meta:{...meta,records:{collections:{spots:{}}}},url:'https://place.test/place/open?room=main',headers:{},collections:['spots']});
 // No read permission: subscriptions cannot reveal even a collection's activity.
 assert.equal((await open()).status,403);
 const allowedMeta={...meta,roles:{customer:{can:['read:spots'],signIn:false}},records:{collections:{spots:{}}}};
 const a=await hub.open({meta:allowedMeta,url:'https://place.test/place/open',headers:{},collections:['spots']});const ar=a.body.getReader();
 assert.match(new TextDecoder().decode((await ar.read()).value),/"presence":1/);
 DB.sql.exec(`INSERT INTO app_records VALUES('place','spots','one','{}',1,100)`);
 await hub.wake();
 assert.match(new TextDecoder().decode((await ar.read()).value),/"collections":\["spots"\]/);
 await ar.cancel();
});

test('live changes survive delete/recreate and isolate signed local proof scopes',async t=>{
 const {AppRecordStreams}=await import('../worker/app-streams.mjs');const {localCookie}=await import('../lib/local-test.mjs');
 const DB=database(t),hub=new AppRecordStreams({DB,HOMIE_LOCAL_TEST_SECRET:'test'},{waitUntil:p=>p.catch(()=>{})});t.after(()=>hub.dispose());
 const allowedMeta={...meta,roles:{customer:{can:['read:spots'],signIn:false}},records:{collections:{spots:{}}}};
 const open=async scope=>(await hub.open({meta:allowedMeta,url:'http://localhost/place/open',headers:{cookie:'homie_test='+localCookie('test',{app:'place',role:'customer',scope})},collections:['spots']})).body.getReader();
 const a=await open('one');await a.read();const b=await open('two');await b.read();
 assert.match(new TextDecoder().decode((await a.read()).value),/"presence":1/);
 DB.sql.exec(`INSERT INTO app_records VALUES('place:check:one','spots','one','{}',1,100);DELETE FROM app_records;INSERT INTO app_records VALUES('place:check:one','spots','one','{}',1,100)`);
 await hub.wake();
 assert.match(new TextDecoder().decode((await a.read()).value),/"collections":\["spots"\]/);
 assert.match(new TextDecoder().decode((await b.read()).value),/"collections":\[\]/);
 await a.cancel();await b.cancel();
});
test('place guide examples bundle against toolkit exports',async()=>{
 const {build}=await import('esbuild');
 const guide=readFileSync(new URL('../../../plugins/homie/skills/app/PLACES.md',import.meta.url),'utf8');
 for(const match of guide.matchAll(/```ts\n([\s\S]*?)```/g))await build({stdin:{contents:match[1],loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent'});
});

test('shell trusts only its own frame, preserves server role, and gates the proof clock',async()=>{
 const {runInNewContext}=await import('node:vm');const {APP_SHELL_JS}=await import('../worker/app-shell.mjs');
 for(const testMode of [false,true]){
  const messages=[],requests=[],handlers={};const child={postMessage:m=>messages.push(m)};
  const window={__HOMIE_APP:{kind:'app',game:'place',test:testMode}};
  const sandbox={window,document:{querySelector:()=>({contentWindow:child})},location:{origin:'https://place.test',search:'?role=staff&access=private',pathname:'/place/open'},URLSearchParams,AbortSignal,history:{replaceState(){}},addEventListener:(name,fn)=>handlers[name]=fn,fetch:async(url,init)=>{requests.push({url,init});return {json:async()=>({ok:true,data:{booked:true}})};}};
  runInNewContext(APP_SHELL_JS,sandbox);
  const data={type:'homie-app-tool',id:'a'.repeat(32),name:'reserve',input:{id:'a'},role:'owner'};
  await handlers.message({source:{},data});assert.equal(requests.length,0);
  await handlers.message({source:child,data});assert.equal(requests.length,1);
  assert.match(requests[0].url,/role=staff/);assert.doesNotMatch(requests[0].url,/access=|private/);assert.doesNotMatch(requests[0].init.body,/owner/);
  assert.equal(messages[0].result.data.booked,true);
  if(testMode){window.homieApp.setTestClock(1234);assert.equal(window.homieApp.context.now,1234);window.homieApp.setTestClock(null);assert.equal(window.homieApp.context.now,null);}
  else assert.throws(()=>window.homieApp.setTestClock(1234),/Local proof/);
  assert.equal(window.homieApp.context.url,'https://place.test/place/open');
 }
});
