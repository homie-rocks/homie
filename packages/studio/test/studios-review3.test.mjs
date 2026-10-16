import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database} from './s2s-fixture.mjs';
import {originKey,signAssertion,signBytes,publicKeys} from '../worker/studios-keys.mjs';
import {studioToken,setStudioPolicy} from '../worker/studios-auth.mjs';
import {receiveStudioEvent,signStudioEvent} from '../worker/studios-events.mjs';
const origin='https://sender.example';
async function keyEnv(){const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);return {STUDIO_SIGNING_KEY:JSON.stringify({...await crypto.subtle.exportKey('jwk',pair.privateKey),kid:'current'})};}
const catalogue=()=>({games:[],studio:{mcp:{studios:{inbound:{first:{origin,events:{arrival:'first'}},second:{origin,events:{other:'second'}}}}}}});
test('JWKS failures and unknown kids permit only one fetch per origin per 60 seconds, including concurrent requests',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 for(const failure of ['network','http','json','keys',null]){
  const env={DB:database(t)},sender=await keyEnv();let calls=0;
  const options={fetchFn:async()=>{calls++;if(failure==='network')throw Error('offline');if(failure==='http')return new Response(null,{status:503});if(failure==='json')return new Response('{');return Response.json(failure==='keys'?{keys:[{d:'private'}]}:publicKeys(sender));}};
  await Promise.all(Array.from({length:8},(_,i)=>assert.rejects(originKey(env,origin,'unknown'+i,options))));
  assert.equal(calls,1,failure??'unknown kid');
  now+=59999;await assert.rejects(originKey(env,origin,'another',options));assert.equal(calls,1);
  now+=1;await assert.rejects(originKey(env,origin,'last',options));assert.equal(calls,2);
  if(!failure){await originKey(env,origin,'current',options);assert.equal(calls,2);}
 }
});
test('authentication failures have identical public responses and detailed owner audit stages',async t=>{
 const env={DB:database(t)},sender=await keyEnv(),cat=catalogue();
 const request=async(assertion)=>new Request('https://receiver.example/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'client_credentials',resource:'https://receiver.example/mcp',client_id:origin,client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',client_assertion:assertion??await signAssertion(sender,origin,'https://receiver.example/oauth/token')})});
 const responses=[];
 responses.push(await studioToken(await request('bad'),env,cat));
 responses.push(await studioToken(await request(),env,cat));
 await setStudioPolicy(env,origin,true);
 responses.push(await studioToken(await request(await signAssertion(sender,origin,'https://wrong.example')),env,cat));
 responses.push(await studioToken(await request(),env,cat,{fetchFn:async()=>{throw Error('offline');}}));
 env.DB.sql.exec("DELETE FROM mcp_kv WHERE key LIKE 'studio-jwks%'");
 const options={fetchFn:async()=>Response.json(publicKeys(sender))};
 const impostor=await keyEnv();responses.push(await studioToken(await request(await signAssertion(impostor,origin,'https://receiver.example/oauth/token')),env,cat,options));
 const valid=await request();assert.equal((await studioToken(valid.clone(),env,cat,options)).status,200);
 responses.push(await studioToken(valid,env,cat,options));
 for(const response of responses){assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:'invalid_client',error_description:'Studio authentication failed'});}
 assert.deepEqual(env.DB.sql.prepare("SELECT outcome FROM mcp_audit ORDER BY id").all().map(r=>r.outcome),['denied:assertion','denied:policy','denied:claims','denied:key discovery','denied:signature','denied:replay']);
});
test('event paths use their own mappings and enabled flag for duplicate origins',async t=>{
 const env={DB:database(t)},sender=await keyEnv(),cat=catalogue();await setStudioPolicy(env,origin,true);
 const signed=await signStudioEvent(sender,origin,'arrival',{id:'one',data:{}});
 const receive=()=>receiveStudioEvent(new Request('https://receiver.example/hooks/studios/second',{method:'POST',...signed}),env,cat,{fetchFn:async()=>Response.json(publicKeys(sender))});
 assert.equal((await receive()).status,403);
 cat.studio.mcp.studios.inbound.second.events={arrival:'second'};cat.studio.mcp.studios.inbound.second.enabled=false;
 assert.equal((await receive()).status,403);
});
test('signed non-object JSON bodies are bad requests',async t=>{
 const env={DB:database(t)},sender=await keyEnv(),cat=catalogue();await setStudioPolicy(env,origin,true);
 for(const body of ['null','[]','1','true','"hello"']){
  const timestamp=String(Math.floor(Date.now()/1000)),{kid,signature}=await signBytes(sender,`one.${timestamp}.${body}`);
  const req=new Request('https://receiver.example/hooks/studios/first',{method:'POST',body,headers:{'webhook-id':'one','webhook-timestamp':timestamp,'webhook-signature':'v1a,'+signature,'webhook-key-id':kid,'webhook-origin':origin}});
  assert.equal((await receiveStudioEvent(req,env,cat,{fetchFn:async()=>Response.json(publicKeys(sender))})).status,400);
 }
});
test('studio production dependencies do not advertise an unused v1-only verifier',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));assert.equal(pkg.dependencies.standardwebhooks,undefined);
});
