import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newStudio} from '../lib/scaffold.mjs';

test('fresh studio delivers an MCP record event during the writing request, without another visitor',{timeout:30000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'homie-event-delivery-'));let mf;
 try {
  newStudio(root,{name:'Quiet booking studio',install:false,kind:'business'});
  const bundled=await build({stdin:{resolveDir:new URL('../worker/',import.meta.url).pathname,contents:`
   import worker,{useTools,useFunctions} from './index.mjs';
   useFunctions(async()=>[{name:'booking-notice',event:'record.changed',handler:async(e,c)=>c.database.put(e.data.record,{delivered:true})}]);
   useTools(async()=>[{name:'book',audience:'public',description:'Book',inputSchema:{type:'object',properties:{}},handler:async(_,c)=>{await new Promise(r=>setTimeout(r,150));return c.records({app:'cafe',collection:'bookings',id:'quiet',operation:'create',data:{name:'Tea'}});}}]);
   export default {fetch(req,env,ctx){env.ASSETS={fetch:async()=>Response.json({studio:{name:'Quiet'},games:[{id:'cafe',kind:'app',roles:{customer:{can:['create:bookings','read:bookings']}},records:{persist:true,collections:{bookings:{fields:{name:{type:'string'}}}}}}]})};return worker.fetch(req,env,ctx);}};
  `},bundle:true,write:false,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*']});
  mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'quiet',compatibilityDate:'2026-10-07',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{DB:{type:'d1',id:'quiet'}}}}]});
  const db=await mf.getD1Database('DB');
  for(const file of readdirSync(join(root,'site/migrations')).sort())for(const sql of readFileSync(join(root,'site/migrations',file),'utf8').replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(sql.trim())await db.prepare(sql).run();
  const response=await mf.dispatchFetch('http://localhost/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json,text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'book',arguments:{}}})});
  assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/isError/);
  await new Promise(r=>setTimeout(r,500));
  // Read D1 directly: no HTTP request can accidentally wake the dispatcher.
  assert.ok(await db.prepare("SELECT value FROM tool_data WHERE namespace='function:booking-notice' AND key='quiet'").first(),'the handler must run without a later status read');
 }finally{await mf?.dispose();rmSync(root,{recursive:true,force:true});}
});
