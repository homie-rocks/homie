import {rateLimit,callsPerMinute} from './mcp-store.mjs';
import {eventFeeds,readableFeed,matchesFeed,eventHub} from './event-resources.mjs';
import {currentCaller} from './mcp-tools.mjs';
import {signedWebhook,WebhookFailure} from './event-webhooks.mjs';
import {EventsError,invalid,eventError,eventDescriptor,occurrence,cursorOf,cursorPosition,validateEventParams,callbackUrl,signingSecret,subscriptionResult,subscriptionHeaders,control} from './mcp-events-wire.mjs';

const prefix='mcp-event-hook:';
export const eventSource=feed=>JSON.stringify([feed.event,feed.app??null,feed.collection??null]);
export const hookFunction=id=>'@mcp-webhook/'+id;
const head=async env=>(await env.DB.prepare('SELECT COALESCE(MAX(seq),0) seq FROM studio_events').first()).seq;
export async function eventCaller(env,connection){
  if(connection==='local-test-owner'&&env.HOMIE_LOCAL_TEST_SECRET)return {id:'local-test-owner',owner:true,connection};
  try{return await currentCaller(env,{connection});}catch{throw new EventsError(-32024);}
}
export async function checkEvent(env,cat,caller,params){
  validateEventParams(params);
  const feeds=eventFeeds(env),feed=Object.hasOwn(feeds,params.name)?feeds[params.name]:null;
  if(!feed)throw new EventsError(-32023,{kind:'event'});
  if(!await readableFeed(env,cat,caller,params.name))throw new EventsError(-32024);
  return feed;
}
export async function listEvents(env,cat,caller,params={}){
  validateEventParams(params,{list:true});const events=[];
  for(const [name,feed] of Object.entries(eventFeeds(env)))if(await readableFeed(env,cat,caller,name))events.push(eventDescriptor(name,feed));
  return {events};
}
export async function eventStart(env,params,now=Date.now()){
  const through=await head(env);let after=cursorPosition(params.name,params.cursor),truncated=false;
  if(after===null)return {after:through,through,truncated};
  if(after>through){after=through;truncated=true;}
  const first=(await env.DB.prepare('SELECT MIN(seq) seq FROM studio_events').first()).seq;
  if(first!==null&&after<first-1){after=first-1;truncated=true;}
  if(params.maxAgeMs!==undefined){const floor=(await env.DB.prepare('SELECT COALESCE(MAX(seq),0) seq FROM studio_events WHERE at<?1 AND seq<=?2').bind(now-params.maxAgeMs,through).first()).seq;if(floor>after){after=floor;truncated=true;}}
  return {after,through,truncated};
}
export async function pollEvents(env,cat,caller,params,now=Date.now()){
  const feed=await checkEvent(env,cat,caller,params),start=await eventStart(env,params,now);
  let after=start.after;const events=[],max=Math.min(params.maxEvents??100,100),scanLimit=1000;let scanned=0;
  while(after<start.through&&scanned<scanLimit){
    const rows=(await env.DB.prepare('SELECT seq,id,type,data,at FROM studio_events WHERE seq>?1 AND seq<=?2 ORDER BY seq LIMIT 100').bind(after,start.through).all()).results;
    if(!rows.length){after=start.through;break;}
    for(const row of rows){after=row.seq;scanned++;const event={...row,data:JSON.parse(row.data)};if(matchesFeed(feed,event))events.push(occurrence(params.name,event,cursorOf(params.name,row.seq)));if(events.length===max)break;}
    if(events.length===max)break;
  }
  return {events,cursor:cursorOf(params.name,after),truncated:start.truncated,hasMore:after<start.through,nextPollMs:5000};
}
async function subId(caller,params,url){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([caller.id,url,params.name,{}])));return 'sub_'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
async function stored(env,id){const row=await env.DB.prepare('SELECT value FROM mcp_kv WHERE key=?1').bind(prefix+id).first();return row?JSON.parse(row.value):null;}
export async function removeEventHook(env,id){await env.DB.batch([env.DB.prepare('DELETE FROM mcp_kv WHERE key=?1').bind(prefix+id),env.DB.prepare('DELETE FROM function_subscriptions WHERE name=?1').bind(hookFunction(id)),env.DB.prepare('DELETE FROM function_deliveries WHERE function=?1').bind(hookFunction(id))]);}
export function deliveryCategory(error){if(error.message==='challenge_failed')return 'challenge_failed';if(error.message==='Webhook timed out')return 'timeout';if(error.status>=500)return 'http_5xx';if(error.status)return 'http_4xx';return 'connection_refused';}
// Worker fetch cannot pin an independently resolved address with original TLS SNI.
// Restrict callbacks to exact owner-declared URLs, rechecked on every attempt.
// This also supplies the draft's server-configured endpoint-consent allowlist.
export function permittedCallback(env,name,url){
  const feed=eventFeeds(env)[name];
  return [...(feed?.receivers??[]),...(feed?.webhook?[feed.webhook.url]:[])].some(value=>callbackUrl(value)===url);
}
async function send(env,sub,body,id,options={}){
  if(!permittedCallback(env,sub.name,sub.url))throw new WebhookFailure('Callback no longer allowed');
  const secrets=[sub.secret,...(sub.previous&&sub.rotateUntil>(options.now??Date.now)()?[sub.previous]:[])];
  return signedWebhook(sub.url,{id,body,secrets,headers:subscriptionHeaders(sub.id)},options);
}
async function watermark(env,sub){
  const registry=await env.DB.prepare('SELECT cursor FROM function_subscriptions WHERE name=?1').bind(hookFunction(sub.id)).first();
  const pending=await env.DB.prepare("SELECT MIN(e.seq) seq FROM function_deliveries d JOIN studio_events e ON e.id=d.event WHERE d.function=?1 AND d.state!='complete'").bind(hookFunction(sub.id)).first();
  return cursorOf(sub.name,Math.max(sub.start,Math.min(registry?.cursor??sub.start,pending.seq===null?Number.MAX_SAFE_INTEGER:pending.seq-1)));
}
export async function subscribeEvents(env,cat,caller,params,{now=Date.now}={}){
  if(!caller.id)throw new EventsError(-32024);
  const feed=await checkEvent(env,cat,caller,params);
  if(!params.delivery||typeof params.delivery!=='object')invalid();
  if(params.delivery.mode!==undefined&&params.delivery.mode!=='webhook')throw new EventsError(-32026,{feature:'deliveryMode',value:params.delivery.mode});
  const url=callbackUrl(params.delivery.url),secret=signingSecret(params.delivery.secret);
  if(!permittedCallback(env,params.name,url))throw new EventsError(-32027,{reason:'challenge_failed'});
  const id=await subId(caller,params,url),previous=await stored(env,id),live=previous&&previous.expires>now();
  if(live&&previous.source!==eventSource(feed)){await removeEventHook(env,id);throw new EventsError(-32026,{feature:'payloadSchema',reason:'schema_changed'});}
  if(previous&&!live)await removeEventHook(env,id);
  if(!live&&feed.maxSubscriptions!==undefined){const rows=(await env.DB.prepare("SELECT value FROM mcp_kv WHERE key LIKE 'mcp-event-hook:%'").all()).results;if(rows.filter(row=>{const sub=JSON.parse(row.value);return sub.name===params.name&&sub.expires>now();}).length>=feed.maxSubscriptions)throw new EventsError(-32025,{limit:'subscriptions',max:feed.maxSubscriptions});}
  const start=await eventStart(env,params,now());
  const sub={id,name:params.name,source:eventSource(feed),url,secret,principal:caller.id,connection:caller.connection??'local-test-owner',start:live?previous.start:start.after,expires:now()+Math.min(params.ttlMs??3600000,86400000)};
  if(live){if(previous.secret!==secret){sub.previous=previous.secret;sub.rotateUntil=now()+300000;}else if(previous.rotateUntil>now()){sub.previous=previous.previous;sub.rotateUntil=previous.rotateUntil;}}
  await env.DB.batch([
    env.DB.prepare('INSERT INTO mcp_kv(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(prefix+id,JSON.stringify(sub)),
    env.DB.prepare('INSERT OR IGNORE INTO function_subscriptions(name,type,cursor,started) VALUES(?1,?2,?3,?4)').bind(hookFunction(id),feed.event,sub.start,now()),
  ]);
  const latest=await env.DB.prepare("SELECT error,completed FROM function_deliveries WHERE function=?1 ORDER BY CASE WHEN state!='complete' AND error IS NOT NULL THEN 0 ELSE 1 END, rowid DESC LIMIT 1").bind(hookFunction(id)).first();
  return subscriptionResult(sub,await watermark(env,sub),live?false:start.truncated,{active:true,lastError:latest?.error??null,lastDeliveryAt:latest?.completed?new Date(latest.completed).toISOString():null});
}
export async function unsubscribeEvents(env,caller,params){
  if(!caller.id)throw new EventsError(-32024);validateEventParams(params);
  const id=await subId(caller,params,callbackUrl(params.delivery?.url)),sub=await stored(env,id);
  if(!sub||sub.expires<=Date.now())throw new EventsError(-32023,{kind:'subscription'});
  await removeEventHook(env,id);return {};
}
/** Dynamic hooks become ordinary durable function deliveries: one queue and retry engine. */
export async function eventHookSubscriptions(env,cat,options={}){
  const now=options.now??Date.now,definitions=[];let after='';
  for(;;){const rows=(await env.DB.prepare("SELECT key,value FROM mcp_kv WHERE key LIKE 'mcp-event-hook:%' AND key>?1 ORDER BY key LIMIT 100").bind(after).all()).results;
    for(const row of rows){const sub=JSON.parse(row.value);if(sub.expires<=now()){await removeEventHook(env,sub.id);continue;}
      let feed;
      try{feed=await checkEvent(env,cat,await eventCaller(env,sub.connection),{name:sub.name});if(!permittedCallback(env,sub.name,sub.url))throw new EventsError(-32024);if(sub.source!==eventSource(feed))throw new EventsError(-32026,{feature:'payloadSchema',reason:'schema_changed'});}
      catch(error){try{await send(env,sub,control('terminated',{error:eventError(error)}),'msg_terminated_'+crypto.randomUUID(),options);}catch{}await removeEventHook(env,sub.id);continue;}
      definitions.push({name:hookFunction(sub.id),event:feed.event,webhook:true,mcpEvent:true,matches:event=>matchesFeed(feed,event),async handler(event){
        const fresh=await stored(env,sub.id);if(!fresh||fresh.expires<=now())return;
        try{await checkEvent(env,cat,await eventCaller(env,fresh.connection),{name:fresh.name});}
        catch(error){try{await send(env,fresh,control('terminated',{error:eventError(error)}),'msg_terminated_'+crypto.randomUUID(),options);}catch{}await removeEventHook(env,fresh.id);return;}
        try{await send(env,fresh,occurrence(fresh.name,event,await watermark(env,fresh)),event.id,options);}
        catch(error){const failure=new WebhookFailure(deliveryCategory(error));failure.permanent=error.status===410||error.status===413;throw failure;}
      }});
    }
    if(rows.length<100)break;after=rows.at(-1).key;
  }return definitions;
}
export async function eventsRequest(request,env,ctx,cat,caller,body){
  const params=body.params??{};
  try{
    if(!await rateLimit(env,caller.id??`public:${request.headers.get('cf-connecting-ip')??'local'}`,callsPerMinute(cat)))throw new EventsError(-32025,{limit:'requests'});
    if(body.jsonrpc!=='2.0'||!['string','number'].includes(typeof body.id))invalid();
    if(body.method==='events/stream'){
      await checkEvent(env,cat,caller,params);
      if(!env.LOBBY)throw new EventsError(-32026,{feature:'deliveryMode',value:'push'});
      const connection=caller.connection??'local-test-owner';
      return eventHub(env,connection).fetch('https://events/__studio_events',{method:'POST',body:JSON.stringify({op:'extension-stream',connection,cat,id:body.id,params})});
    }
    let result=body.method==='events/list'?await listEvents(env,cat,caller,params):body.method==='events/poll'?await pollEvents(env,cat,caller,params):body.method==='events/subscribe'?await subscribeEvents(env,cat,caller,params):await unsubscribeEvents(env,caller,params);
    if(body.method==='events/poll')result={...result,events:result.events.map(({cursor,...event})=>event)};
    if(body.method==='events/subscribe'){const work=import('./functions.mjs').then(m=>m.runFunctions(env,cat,new URL(request.url).origin));if(ctx?.waitUntil)ctx.waitUntil(work);else await work;}
    return Response.json({jsonrpc:'2.0',id:body.id,result},{headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({jsonrpc:'2.0',id:body.id??null,error:eventError(error)},{headers:{'cache-control':'no-store'}});}
}
