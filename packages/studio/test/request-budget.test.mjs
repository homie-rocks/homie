import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../worker/index.mjs';

export function requestFixture(t) {
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const name of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort())sql.exec(readFileSync(new URL('../../../template/site/migrations/'+name,import.meta.url),'utf8'));
 sql.exec("INSERT INTO meta(key,value) VALUES('office_key','"+'ab'.repeat(32)+"'),('function-registry-deployed','1')");
 const calls=[];const statement=(q,args=[])=>({bind:(...args)=>statement(q,args),first:async()=>{calls.push(q);return sql.prepare(q).get(...args)??null;},all:async()=>{calls.push(q);return {results:sql.prepare(q).all(...args)};},run:async()=>{calls.push(q);return {meta:{changes:sql.prepare(q).run(...args).changes}};},q,args});
 const DB={prepare:statement,batch:async statements=>{calls.push('BATCH '+statements.map(s=>s.q).join('; '));return statements.map(s=>{const stmt=sql.prepare(s.q);return stmt.columns().length?{results:stmt.all(...s.args),meta:{changes:0}}:{results:[],meta:{changes:stmt.run(...s.args).changes}};});}};
 const cat={studio:{name:'Speed',directory:false},games:[{id:'cafe',name:'Cafe',kind:'app',roles:{customer:{can:['read:notes'],signIn:false}},surfaces:{phone:'customer'},records:{persist:true,collections:{notes:{fields:{text:{type:'string'}}}}}},{id:'race',name:'Race',players:{max:4},room:{host:'browser',tickHz:30}}]};
 const env={DB,ASSETS:{fetch:async request=>new URL(request.url).pathname==='/games.json'?Response.json(cat,{headers:{etag:'test'}}):new Response('asset',{headers:{'content-type':'application/javascript'}})}};
 for(const name of ['LOBBY','TABLE'])env[name]={idFromName:x=>x,get:id=>({fetch:async input=>{calls.push(name+' '+id+' '+(input.url??input));return Response.json({room:'pub-1',ok:true,rooms:[]});}})};
 return {env,calls,sql};
}
for(const [label,path,max] of [['asset','/_homie/site.js',0],['game asset','/race/__game/assets/main.js',0],['game shell','/race/play',1],['records','/cafe/api/app/records/notes',1],['page','/cafe/open',1],['seat','/race/api/lobby',1],['socket','/race/__net?room=pub-1',1]])test(`steady ${label} stays within its D1 request budget`,async t=>{
 const {env,calls}=requestFixture(t);
 const run=async()=>{const background=[];const response=await worker.fetch(new Request('https://speed.example'+path,{headers:label==='socket'?{upgrade:'websocket'}:{}}),env,{waitUntil:p=>background.push(p)});await response.text();return {response,background};};
 const warm=await run();await Promise.all(warm.background);calls.length=0;
 const {response,background}=await run();const foreground=calls.slice();await Promise.all(background);
 assert.equal(response.status,200);
 assert.ok(foreground.filter(q=>!q.startsWith('LOBBY ')&&!q.startsWith('TABLE ')).length<=max,`${label}: ${foreground.join('\n')}`);
 assert.ok(calls.filter(q=>q.startsWith('LOBBY ')||q.startsWith('TABLE ')).length <= (['seat','socket'].includes(label)?1:0),calls.join('\n'));
});
