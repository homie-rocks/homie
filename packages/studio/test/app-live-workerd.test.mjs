import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
test('real Lobby streams push tool-created records to two clients without a rules room',{timeout:30000},async t=>{
 const meta={id:'place',kind:'app',roles:{customer:{can:['read:spots','create:spots']}},surfaces:{phone:'customer'},records:{persist:true,collections:{spots:{fields:{name:{type:'string'}}}}}};
 const bundled=await build({stdin:{resolveDir:new URL('../worker/',import.meta.url).pathname,contents:`
 import worker,{useTools} from './index.mjs';export {Lobby} from './index.mjs';
 useTools(async()=>[{name:'reserve',audience:'public',description:'Reserve',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},handler:({id},ctx)=>ctx.records({app:'place',role:'customer',collection:'spots',id,operation:'create',data:{name:'Ada'}})}]);
 export default {fetch(request,env,ctx){env.ASSETS={fetch:async()=>Response.json({studio:{name:'Place'},games:[${JSON.stringify(meta)}]})};return worker.fetch(request,env,ctx);}};
 `},bundle:true,write:false,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*']});
 const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'live',compatibilityDate:'2026-10-07',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'entry.mjs',modules:{'entry.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},exports:{Lobby:{type:'durable-object',storage:'sqlite'}},env:{DB:{type:'d1',id:'live'},LOBBY:{type:'durable-object',worker:'live',exportName:'Lobby'}}}}]});t.after(()=>mf.dispose());
 const DB=await mf.getD1Database('DB'),dir=new URL('../../../template/site/migrations/',import.meta.url);
 for(const file of readdirSync(dir).sort())for(const sql of readFileSync(new URL(file,dir),'utf8').replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(sql.trim())await DB.prepare(sql).run();
 const origin=(await mf.ready).origin;
 const plain=await mf.dispatchFetch(origin+'/place/api/app/live?collection=spots');assert.equal(plain.status,426);
 const open=async()=>{
  const res=await mf.dispatchFetch(origin+'/place/api/app/live?collection=spots',{headers:{upgrade:'websocket'}});
  assert.equal(res.status,101,await (res.status===101?Promise.resolve(''):res.text()));const ws=res.webSocket;const messages=[];let wake;ws.addEventListener('message',event=>{messages.push(String(event.data));wake?.();wake=null;});ws.accept();t.after(()=>ws.close());
  return {next:()=>messages.length?messages.shift():new Promise(resolve=>{wake=()=>resolve(messages.shift());})};
 };
 const a=await open();assert.match(await a.next(),/"reset":true/);
 const b=await open();assert.match(await b.next(),/"presence":2/);
 const waitChange=async reader=>{
  for(;;){const text=await reader.next();assert.equal(typeof text,'string');if(text.includes('"collections":["spots"]')&&!text.includes('"reset":true'))return;}
 };
 const changed=Promise.all([waitChange(a),waitChange(b)]);
 const response=await fetch(origin+'/place/api/app/tools',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({name:'reserve',input:{id:'one'}})});
 assert.equal(response.status,200,await response.text());
 let timer;try{await Promise.race([changed,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('push did not arrive before the recovery heartbeat')),4000))]);}finally{clearTimeout(timer);}
 const rows=await (await fetch(origin+'/place/api/app/records/spots')).json();assert.equal(rows.records[0].data.name,'Ada');
});
test('a signed-in app receives the live socket',{timeout:30000},async t=>{
 const meta={id:'place',kind:'app',roles:{staff:{signIn:true,can:['read:spots']}},surfaces:{phone:'staff'},records:{persist:true,collections:{spots:{fields:{name:{type:'string'}}}}}};
 const bundled=await build({stdin:{resolveDir:new URL('../worker/',import.meta.url).pathname,contents:`
 import worker from './index.mjs';export {Lobby} from './index.mjs';
 export default {fetch(request,env,ctx){env.ASSETS={fetch:async()=>Response.json({studio:{name:'Place'},games:[${JSON.stringify(meta)}]})};return worker.fetch(request,env,ctx);}};
 `},bundle:true,write:false,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*']});
 const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'live',compatibilityDate:'2026-10-07',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'entry.mjs',modules:{'entry.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},exports:{Lobby:{type:'durable-object',storage:'sqlite'}},env:{DB:{type:'d1',id:'live-staff'},LOBBY:{type:'durable-object',worker:'live',exportName:'Lobby'}}}}]});t.after(()=>mf.dispose());
 const DB=await mf.getD1Database('DB'),dir=new URL('../../../template/site/migrations/',import.meta.url);
 for(const file of readdirSync(dir).sort())for(const sql of readFileSync(new URL(file,dir),'utf8').replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(sql.trim())await DB.prepare(sql).run();
 const token='b'.repeat(64);
 await DB.prepare('INSERT INTO stats_keys(hash,kind,expires_at) VALUES(?1,?2,?3)').bind(createHash('sha256').update(token).digest('hex'),'session',Date.now()+3600000).run();
 const origin=(await mf.ready).origin;
 const res=await mf.dispatchFetch(origin+'/place/api/app/live?role=staff&collection=spots',{headers:{upgrade:'websocket',cookie:'studio_owner='+token}});
 assert.equal(res.status,101,await (res.status===101?Promise.resolve(''):res.text()));
 assert.ok(res.webSocket);
 res.webSocket.accept();
 t.after(()=>res.webSocket.close());
});
