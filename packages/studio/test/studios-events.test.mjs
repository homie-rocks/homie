import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database} from './s2s-fixture.mjs';
import {receiveStudioEvent} from '../worker/studios-events.mjs';
import {signStudioEvent} from '../worker/studios-events.mjs';
import {setStudioPolicy} from '../worker/studios-auth.mjs';
import {publicKeys} from '../worker/studios-keys.mjs';
import {useFunctions,runFunctions} from '../worker/functions.mjs';

test('Standard Webhooks acceptance triggers a function once, survives replay and rejects changed or unsigned events',async t=>{
 const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']),sender={STUDIO_SIGNING_KEY:JSON.stringify({...await crypto.subtle.exportKey('jwk',pair.privateKey),kid:'test'})};
 const DB=database(t),env={DB,STUDIO_EVENT_FEEDS:JSON.stringify({arrivals:{event:'guest.arriving',schema:{type:'object',properties:{sender:{type:'object'},data:{type:'object'}},required:['sender','data'],additionalProperties:false}}})};
 const cat={games:[],studio:{mcp:{studios:{inbound:{concierge:{origin:'https://a.example',events:{arrival:'arrivals'}}}}}}};
 let called=0;useFunctions(async()=>[{name:'arrival',event:'guest.arriving',handler:async(event,ctx)=>{called++;await ctx.database.put('arrived',event.data);}}]);t.after(()=>useFunctions(async()=>[]));
 await setStudioPolicy(env,'https://a.example',true);
 const sign=async(data,now=Date.now)=>new Request('https://b.example/hooks/studios/concierge',{method:'POST',...await signStudioEvent(sender,'https://a.example','arrival',{id:'arrival-1',data},{now})});
 const request=await sign({minutes:10});assert.match(request.headers.get('webhook-signature'),/^v1a,/);
 const receive=req=>receiveStudioEvent(req,env,cat,{fetchFn:async()=>Response.json(publicKeys(sender))});
 assert.equal((await receive(request.clone())).status,204);await runFunctions(env,cat,'https://b.example');
 assert.equal((await receive(request.clone())).status,204);await runFunctions(env,cat,'https://b.example');assert.equal(called,1);
 const stored=JSON.parse(DB.sql.prepare("SELECT value FROM tool_data WHERE key='arrived'").get().value);assert.deepEqual(stored.sender,{origin:'https://a.example',verified:true});assert.equal(stored.data.minutes,10);
 const changed=new Request(request.url,{method:'POST',headers:request.headers,body:'{}'});assert.equal((await receive(changed)).status,401);
 assert.equal((await receive(await sign({minutes:11}))).status,409);
 assert.equal((await receive(await sign({minutes:10},()=>Date.now()-301000))).status,401);
 assert.equal((await receive(new Request(request.url,{method:'POST',headers:request.headers,body:'x'.repeat(8193)}))).status,413);
 cat.studio.mcp.studios.inbound.concierge.enabled=false;assert.equal((await receive(request.clone())).status,403);
});
