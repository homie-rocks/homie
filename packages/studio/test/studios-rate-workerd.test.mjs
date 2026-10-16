import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {MCP_MIGRATION} from '../worker/mcp-store.mjs';
test('token and studio hook IP limits reject before catalogue or key discovery',{timeout:15000},async()=>{
 const bundled=await build({stdin:{resolveDir:new URL('../worker/',import.meta.url).pathname,contents:`import {remoteMcp} from './mcp.mjs';export default {fetch(req,env,ctx){return remoteMcp(req,env,ctx,{catalogueOf:async()=>{throw Error('Reached discovery');}});}};`},bundle:true,write:false,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*']});
 const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'studio-rate',compatibilityDate:'2026-10-13',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{DB:{type:'d1',id:'rate'}}}}]});
 try{
  const db=await mf.getD1Database('DB');for(const q of MCP_MIGRATION.split(';').filter(q=>q.trim()))await db.prepare(q).run();
  const minute=Math.floor(Date.now()/60000);
  for(const m of [minute,minute+1])await db.prepare('INSERT INTO mcp_limits(caller,minute,n) VALUES(?1,?2,60)').bind('studio-ingress:192.0.2.1',m).run();
  for(const path of ['/oauth/token','/hooks/studios/one']){
   const response=await mf.dispatchFetch('https://receiver.example'+path,{method:'POST',headers:{'cf-connecting-ip':'192.0.2.1'},body:''});assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'60');
  }
  const row=await db.prepare('SELECT SUM(n) n FROM mcp_limits').first();assert.equal(row.n,122);
 }finally{await mf.dispose();}
});
