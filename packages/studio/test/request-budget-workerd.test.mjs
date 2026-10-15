import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
test('real Worker MCP steady reads stay within one D1 round trip and no DO fan-out',{timeout:30000},async t=>{
 const source=`import worker from './index.mjs';
 let binding,DB;let d1=0,durable=0;
 const assets={fetch:async()=>Response.json({studio:{name:'Budget',directory:false},games:[]})};
 export default {async fetch(request,env,ctx){
  if(binding!==env.DB){binding=env.DB;const wrap=s=>({bind:(...a)=>wrap(s.bind(...a)),first:(...a)=>{d1++;return s.first(...a)},all:(...a)=>{d1++;return s.all(...a)},run:(...a)=>{d1++;return s.run(...a)},raw:(...a)=>{d1++;return s.raw(...a)},original:s});DB={prepare:q=>wrap(binding.prepare(q)),batch:ss=>{d1++;return binding.batch(ss.map(s=>s.original??s))}};}
  d1=0;durable=0;const pending=[];
  const response=await worker.fetch(request,{...env,DB,ASSETS:assets,LOBBY:{idFromName:x=>x,get:()=>({fetch:async()=>{durable++;return Response.json({ok:true})}})}},{waitUntil:p=>pending.push(p)});
  await Promise.all(pending);const headers=new Headers(response.headers);headers.set('x-d1',String(d1));headers.set('x-do',String(durable));return new Response(response.body,{status:response.status,headers});
 }};`;
 const bundled=await build({stdin:{resolveDir:new URL('../worker/',import.meta.url).pathname,contents:source},bundle:true,write:false,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*']});
 const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'budget',compatibilityDate:'2026-10-07',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{DB:{type:'d1',id:'budget'}}}}]});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB'),dir=new URL('../../../template/site/migrations/',import.meta.url);
 for(const f of readdirSync(dir).sort())for(const sql of readFileSync(new URL(f,dir),'utf8').replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(sql.trim())await db.prepare(sql).run();
 const invoke=method=>mf.dispatchFetch('https://speed.example/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'budget',version:'1'}}:{}})});
 await (await invoke('initialize')).text();
 for(const method of ['initialize','tools/list']) {const response=await invoke(method);assert.equal(response.status,200,await response.clone().text());assert.ok(Number(response.headers.get('x-d1'))<=1,method+' D1='+response.headers.get('x-d1'));assert.equal(response.headers.get('x-do'),'0');await response.text();}
});
