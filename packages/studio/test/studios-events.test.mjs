import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database} from './s2s-fixture.mjs';
import {receiveStudioEvent} from '../worker/studios-events.mjs';
import {signedWebhook} from '../worker/event-webhooks.mjs';
import {useFunctions,runFunctions} from '../worker/functions.mjs';
const secret='whsec_'+btoa('s'.repeat(32));
test('Standard Webhooks acceptance triggers a function once, survives replay and rejects changed or unsigned events',async t=>{
 const DB=database(t),env={DB,A_EVENTS:secret,STUDIO_EVENT_FEEDS:JSON.stringify({arrivals:{event:'guest.arriving',schema:{type:'object',properties:{sender:{type:'object'},data:{type:'object'}},required:['sender','data'],additionalProperties:false}}})};
 const cat={games:[],studio:{mcp:{studios:{inbound:{concierge:{origin:'https://a.example',webhookSecret:'A_EVENTS',events:{arrival:'arrivals'}}}}}}};
 let called=0;useFunctions(async()=>[{name:'arrival',event:'guest.arriving',handler:async(event,ctx)=>{called++;await ctx.database.put('arrived',event.data);}}]);t.after(()=>useFunctions(async()=>[]));
 let request;await signedWebhook('https://b.example/hooks/studios/concierge',{id:'arrival-1',body:{eventId:'arrival-1',name:'arrival',timestamp:new Date().toISOString(),data:{minutes:10}},secrets:[secret]},{fetchFn:async(url,init)=>{request=new Request(url,init);return new Response(null,{status:204});}});
 const receive=req=>receiveStudioEvent(req,env,cat);
 assert.equal((await receive(request.clone())).status,204);await runFunctions(env,cat,'https://b.example');
 assert.equal((await receive(request.clone())).status,204);await runFunctions(env,cat,'https://b.example');assert.equal(called,1);
 const stored=JSON.parse(DB.sql.prepare("SELECT value FROM tool_data WHERE key='arrived'").get().value);assert.deepEqual(stored.sender,{origin:'https://a.example',verified:true});assert.equal(stored.data.minutes,10);
 const changed=new Request(request.url,{method:'POST',headers:request.headers,body:'{}'});assert.equal((await receive(changed)).status,401);
 cat.studio.mcp.studios.inbound.concierge.enabled=false;assert.equal((await receive(request.clone())).status,403);
});
