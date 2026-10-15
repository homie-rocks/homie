import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {randomBytes} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {Webhook} from 'standardwebhooks';
import {webhookSecret} from '../worker/event-webhook-config.mjs';

test('a real Worker record write reaches the signed receiver without another request',{timeout:30000},async()=>{
 const id='11111111111111111111111111111111',binding=webhookSecret(id),secret='whsec_'+randomBytes(32).toString('base64'),received=[];
 const bundled=await build({stdin:{resolveDir:new URL('../worker/',import.meta.url).pathname,contents:`
  import worker from './index.mjs';
  export default {fetch(req,env,ctx){env.ASSETS={fetch:async()=>Response.json({studio:{name:'Bookings'},games:[{id:'cafe',kind:'app',roles:{customer:{can:['create:bookings']}},records:{persist:true,collections:{bookings:{fields:{name:{type:'string'}}}}}}]})};return worker.fetch(req,env,ctx);}};
 `},bundle:true,write:false,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*']});
 let resolveReceived;const delivered=new Promise(resolve=>{resolveReceived=resolve;});
 const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'webhook',compatibilityDate:'2026-10-07',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{DB:{type:'d1',id:'webhook'},[binding]:{type:'json',value:secret},STUDIO_EVENT_FEEDS:{type:'json',value:JSON.stringify({bookings:{event:'record.changed',app:'cafe',collection:'bookings',audience:'owner',webhook:{id,secret:binding,url:'https://receiver.example/bookings'}}})}}},dev:{outboundService:{type:'fetcher',handler:async request=>{
  assert.equal(request.url,'https://receiver.example/bookings');assert.equal(request.method,'POST');
  const body=await request.text();const event=new Webhook(secret).verify(body,Object.fromEntries(request.headers));received.push(event);resolveReceived();return new Response(null,{status:204});
 }}}}]});
 let timer;
 try {
  const db=await mf.getD1Database('DB');
  for(const file of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort())for(const sql of readFileSync(new URL('../../../template/site/migrations/'+file,import.meta.url),'utf8').replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(sql.trim())await db.prepare(sql).run();
  // Deployment installs subscriptions before the first record can be written.
  await db.batch(['@events/bookings','@webhook/bookings/'+id].map(name=>db.prepare("INSERT INTO function_subscriptions(name,type,cursor,started) VALUES(?1,'record.changed',0,0)").bind(name)));
  await db.prepare("INSERT INTO meta(key,value) VALUES('function-registry-deployed','1')").run();
  const response=await mf.dispatchFetch('http://localhost/cafe/api/app/records/bookings/one',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({data:{name:'Tea'}})});
  assert.equal(response.status,200,await response.text());
  await Promise.race([delivered,new Promise((_,reject)=>{timer=setTimeout(async()=>reject(new Error('Webhook did not arrive: '+JSON.stringify((await db.prepare('SELECT * FROM function_deliveries').all()).results))),5000);})]);
  assert.equal(received.length,1);assert.equal(received[0].type,'record.changed');assert.equal(received[0].data.record,'one');assert.equal(received[0].data.operation,'insert');assert.ok(!JSON.stringify(received).includes(secret));
 }finally{clearTimeout(timer);await mf.dispose();}
});
