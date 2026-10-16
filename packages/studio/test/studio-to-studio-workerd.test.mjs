import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Client,StreamableHTTPClientTransport} from 'mcp-studio-client';
import {fixtureSource} from '../../../proof/studio-to-studio/fixture.mjs';
import {studioResult} from '../worker/studios-client.mjs';
test('two studios: official SDK OAuth discovery, availability, named booking, arrival function and denial',{timeout:60000},async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const workers=[];
 for(const role of ['a','b']){
  const bundled=await build({stdin:{contents:fixtureSource(role),resolveDir:root},write:false,bundle:true,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*']});
  workers.push({config:{name:'hm-s2s-'+role,compatibilityDate:'2026-10-13',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{DB:{type:'d1',id:'hm-s2s-'+role},PEER:{type:'text',value:'https://'+(role==='a'?'b':'a')+'.example'},PEER_SECRET:{type:'text',value:'s'.repeat(48)},EVENT_SECRET:{type:'text',value:'whsec_'+btoa('e'.repeat(32))}}},...(role==='a'?{dev:{outboundService:{type:'worker',worker:'hm-s2s-b'}}}:{})});
 }
 const mf=new Miniflare({telemetry:{enabled:false},workers});
 const client=new Client({name:'proof-ai',version:'1'});
 try{
  for(const role of ['a','b']){
   const db=await mf.getD1Database('DB','hm-s2s-'+role);
   for(const file of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort()){
    const sql=readFileSync(new URL('../../../template/site/migrations/'+file,import.meta.url),'utf8');
    for(const statement of sql.replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g).filter(s=>s.trim()))await db.prepare(statement).run();
   }
   if(role==='b')await db.prepare('INSERT INTO app_records(app,collection,id,value,version,updated_at) VALUES(?1,?2,?3,?4,1,1)').bind('venue','slots','morning',JSON.stringify({capacity:1,start:'2030-10-15T10:00:00Z',end:'2030-10-15T11:00:00Z'})).run();
  }
  const fetcher=async(input,init)=>{const req=new Request(input,init);return mf.dispatchFetch(req.url,{method:req.method,headers:Object.fromEntries(req.headers),...(req.body?{body:await req.arrayBuffer()}:{})});};
  await client.connect(new StreamableHTTPClientTransport(new URL('https://a.example/mcp'),{fetch:fetcher}));
  const result=studioResult(await client.callTool({name:'drive',arguments:{}}));assert.equal(result.isError,false,JSON.stringify(result));
  assert.equal(result.data.booked.caller.studio.origin,'https://a.example');assert.equal(result.data.booked.caller.actingFor.handle,'Alex');assert.equal(result.data.booked.caller.actingFor.verified,false);
  const b=await mf.getD1Database('DB','hm-s2s-b');
  const arrived=await b.prepare("SELECT value FROM tool_data WHERE namespace='function:arrival' AND key='arrival'").first();assert.ok(arrived);assert.equal(JSON.parse(arrived.value).data.minutes,10);
  assert.equal((await b.prepare('SELECT COUNT(*) n FROM shop_bookings').first()).n,1);
  await b.prepare("INSERT INTO meta(key,value) VALUES('proof-denied','1')").run();
  const denied=await client.callTool({name:'drive',arguments:{}});assert.equal(denied.isError,true);
 }finally{await client.close();await mf.dispose();}
});
