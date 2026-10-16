import {Webhook} from 'standardwebhooks';
import {boundedBody} from './studios-auth.mjs';
import {studioOrigin} from './studios-client.mjs';
import {signedWebhook} from './event-webhooks.mjs';
import {publishBusinessEvent} from './business-events.mjs';
import {syncFunctions} from './functions.mjs';
export async function sendStudioEvent(env,cat,source,definition,origin,name,{id,data},options={}) {
 origin=studioOrigin(origin);
 const rule=cat.studio?.mcp?.studios?.outbound?.[origin];
 if(!rule?.tools?.includes(definition.name)||!rule.events?.includes(name)||!/^\/hooks\/studios\/[a-zA-Z0-9_-]+$/.test(rule.eventPath??''))throw new Error('Studio event destination not delegated');
 if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('Stable event id required');
 const secret=env[rule.eventSecret];
 if(typeof secret!=='string'||!/^whsec_[A-Za-z0-9+/]{43}=$/.test(secret))throw new Error('Studio event signing secret unavailable');
 const body={eventId:id,name,timestamp:new Date().toISOString(),data};
 if(new TextEncoder().encode(JSON.stringify(body)).length>65536)throw new Error('Studio event size exceeded');
 await signedWebhook(origin+rule.eventPath,{id,body,secrets:[secret]},options);
 return {id};
}
/** Same envelope as MCP Events webhooks; receiver policy selects the local feed. */
export async function receiveStudioEvent(request,env,cat) {
 const id=new URL(request.url).pathname.slice('/hooks/studios/'.length),entries=cat.studio?.mcp?.studios?.inbound??{};
 const rule=Object.hasOwn(entries,id)?entries[id]:null;
 if(request.method!=='POST')return new Response(null,{status:405});
 if(!rule||rule.enabled===false||!rule.webhookSecret)return new Response(null,{status:403});
 let origin;try{origin=studioOrigin(rule.origin);}catch{return new Response(null,{status:403});}
 let body;try{body=await boundedBody(request);}catch{return new Response(null,{status:413});}
 let event;
 try{event=new Webhook(env[rule.webhookSecret]).verify(body,Object.fromEntries(request.headers));}catch{return new Response(null,{status:401});}
 if(typeof event.eventId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(event.eventId)||event.eventId!==request.headers.get('webhook-id')||typeof event.name!=='string')return new Response(null,{status:400});
 const feed=Object.hasOwn(rule.events??{},event.name)?rule.events[event.name]:null;
 if(!feed)return new Response(null,{status:403});
 await syncFunctions(env);
 try{
  await publishBusinessEvent(env,{}, {publish:[feed]},'@studio:'+origin,{feed,id:event.eventId,data:{sender:{origin,verified:true},data:event.data}});
 }catch(error){
  if(/already published/.test(error.message))return new Response(null,{status:409});
  if(/schema|characters/.test(error.message))return new Response(null,{status:400});
  throw error;
 }
 return new Response(null,{status:204});
}
