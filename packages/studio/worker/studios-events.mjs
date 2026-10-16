import {boundedBody,studioPolicy} from './studios-auth.mjs';
import {studioOrigin,outboundRules,boundedStudioFetch} from './studios-client.mjs';
import {signBytes,originKey,verifyBytes} from './studios-keys.mjs';
import {publishBusinessEvent,BUSINESS_EVENT_MAX_BYTES} from './business-events.mjs';
import {syncFunctions} from './functions.mjs';
export async function signStudioEvent(env,source,name,{id,data},{now=Date.now}={}){
 if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('Stable event id required');
 const body=JSON.stringify({eventId:id,name,timestamp:new Date(now()).toISOString(),source,data});
 if(new TextEncoder().encode(body).length>BUSINESS_EVENT_MAX_BYTES)throw new Error('Studio event exceeds 8192 bytes');
 const timestamp=String(Math.floor(now()/1000)),{kid,signature}=await signBytes(env,`${id}.${timestamp}.${body}`);
 return {body,headers:{'content-type':'application/json','webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':'v1a,'+signature,'webhook-key-id':kid,'webhook-origin':source}};
}
export async function sendStudioEvent(env,cat,source,definition,origin,name,event,options={}) {
 const rule=outboundRules(cat).get(new URL(origin).origin);origin=studioOrigin(origin,{allowPrivate:rule?.allowPrivate===true});
 if(!rule?.tools?.includes(definition.name)||!rule.events?.includes(name)||!/^\/hooks\/studios\/[a-zA-Z0-9_-]+$/.test(rule.eventPath??''))throw new Error('Studio event destination not delegated');
 if(rule.anonymous||!source)throw new Error('Studio event requires origin authentication');
 const signed=await signStudioEvent(env,source,name,event,options);
 const response=await boundedStudioFetch(origin,AbortSignal.timeout(10000),options)(origin+rule.eventPath,{method:'POST',...signed});
 await response.body?.cancel();if(!response.ok)throw new Error('Studio event rejected ('+response.status+')');
 return {id:event.id};
}
/** Standard Webhooks v1a: Ed25519 over id.timestamp.exact-body, keys fetched only from configured origin. */
export async function receiveStudioEvent(request,env,cat,options={}) {
 if(request.method!=='POST')return new Response(null,{status:405});
 const id=new URL(request.url).pathname.slice('/hooks/studios/'.length),entries=cat.studio?.mcp?.studios?.inbound??{};
 const configured=Object.hasOwn(entries,id)?entries[id]:null;
 let origin,rule;try{origin=studioOrigin(configured?.origin,{allowPrivate:configured?.allowPrivate===true});if(configured.enabled!==false&&await studioPolicy(env,cat,origin))rule=configured;}catch{}
 if(!rule)return new Response(null,{status:403});
 let body;try{body=await boundedBody(request,BUSINESS_EVENT_MAX_BYTES);}catch{return new Response('Studio event exceeds 8192 bytes',{status:413});}
 let event;
 try{
  const timestamp=request.headers.get('webhook-timestamp'),eventId=request.headers.get('webhook-id');
  if(!/^\d+$/.test(timestamp??'')||Math.abs(Date.now()/1000-Number(timestamp))>300||!/^[A-Za-z0-9_-]{1,128}$/.test(eventId??'')||request.headers.get('webhook-origin')!==origin)throw Error();
  const key=await originKey(env,origin,request.headers.get('webhook-key-id'),{...options,allowPrivate:rule.allowPrivate===true});
  let valid=false;for(const part of (request.headers.get('webhook-signature')??'').split(' ').slice(0,8)){
   const [version,signature]=part.split(',');if(version==='v1a'&&await verifyBytes(key,signature,`${eventId}.${timestamp}.${body}`)){valid=true;break;}
  }
  if(!valid)throw Error();event=JSON.parse(body);
 }catch{return new Response(null,{status:401});}
 if(!event||typeof event!=='object'||Array.isArray(event)||event.source!==origin||event.eventId!==request.headers.get('webhook-id')||typeof event.name!=='string')return new Response(null,{status:400});
 const feed=Object.hasOwn(rule.events??{},event.name)?rule.events[event.name]:null;
 if(!feed)return new Response(null,{status:403});
 await syncFunctions(env);
 try{await publishBusinessEvent(env,{}, {publish:[feed]},'@studio:'+origin,{feed,id:event.eventId,data:{sender:{origin,verified:true},data:event.data}});}
 catch(error){
  if(/already published/.test(error.message))return new Response(null,{status:409});
  if(/8192 bytes/.test(error.message))return new Response(error.message,{status:413});
  if(/schema|characters/.test(error.message))return new Response(null,{status:400});
  throw error;
 }
 return new Response(null,{status:204});
}
