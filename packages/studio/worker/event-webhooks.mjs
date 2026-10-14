import {eventFeeds,matchesFeed} from './event-resources.mjs';
import {settingsOf,launchOf} from './office.mjs';

import {webhookName,validateWebhook} from './event-webhook-config.mjs';
// A webhook delegates the declared audience, never the configuring owner's wider access.
export async function readableWebhook(env,cat,feed) {
  if(feed.event!=='record.changed')return (feed.audience??'owner')==='owner';
  const app=cat.games.find(g=>g.id===feed.app&&g.kind==='app');
  if(!app?.records?.collections?.[feed.collection])return false;
  if((feed.audience??'owner')==='owner')return true;
  return feed.audience?.app===app.id && app.roles?.[feed.audience.role]?.can?.includes('read:'+feed.collection)===true && launchOf(app,await settingsOf(env,{fresh:true}),env)==='public';
}
class WebhookFailure extends Error {
  constructor(message){super(message);this.name='WebhookFailure';}
}
export function webhookFailure(error){return error instanceof WebhookFailure?error.message:'Webhook delivery failed';}
export const webhookBackoff=attempt=>Math.min(3600000,60000*2**Math.min(16,attempt-1));
export async function postWebhook(env,name,event,{fetchFn=fetch,now=Date.now,timeoutMs=10000}={}) {
  const hook=eventFeeds(env)[name]?.webhook;
  if(!hook)throw new WebhookFailure('Webhook removed');
  validateWebhook(name,hook);
  const secret=env[hook.secret];
  if(typeof secret!=='string'||!/^whsec_[A-Za-z0-9+/]{43}=$/.test(secret))throw new WebhookFailure('Webhook signing secret unavailable');
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(secret.slice(6)),c=>c.charCodeAt(0)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  // Encode the event ID to avoid ambiguous dot-delimited signatures and invalid headers.
  const id='evt_'+btoa(String.fromCharCode(...new TextEncoder().encode(event.id))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const timestamp=String(Math.floor(now()/1000));
  const body=JSON.stringify({id:event.id,type:event.type,at:event.at,data:event.data});
  const signature=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${id}.${timestamp}.${body}`)))));
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetchFn(hook.url,{method:'POST',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json','webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':'v1,'+signature},body});
    // Never read or log receiver content: it may echo credentials or private records.
    await response.body?.cancel();
    if(!response.ok)throw new WebhookFailure('Webhook HTTP '+response.status);
  }catch(error){
    if(error instanceof WebhookFailure)throw error;
    throw new WebhookFailure(controller.signal.aborted?'Webhook timed out':'Webhook network failure');
  }finally{clearTimeout(timer);}
}
export function webhookSubscriptions(env,cat,options={}) {
  return Object.entries(eventFeeds(env)).filter(([,feed])=>feed.webhook).map(([name,feed])=>({
    name:webhookName(name),event:feed.event,webhook:true,
    matches:event=>matchesFeed(feed,event),
    async handler(event){
      if(!await readableWebhook(env,cat,feed))throw new WebhookFailure('Feed audience cannot read this collection');
      await postWebhook(env,name,event,options);
    },
  }));
}
export async function webhookStatus(env,name,after=0) {
  const feed=eventFeeds(env)[name];if(!feed)throw new Error('Unknown event feed');
  const rows=(await env.DB.prepare(`SELECT e.seq,d.event,d.state,d.attempts,d.error,d.due,d.completed FROM function_deliveries d JOIN studio_events e ON e.id=d.event WHERE d.function=?1 AND e.seq>?2 ORDER BY e.seq LIMIT 100`).bind(webhookName(name),after).all()).results;
  return {feed:name,enabled:Boolean(feed.webhook),deliveries:rows,next:rows.length===100?rows.at(-1).seq:null};
}
export async function testWebhook(env,cat,name) {
  const feed=eventFeeds(env)[name];if(!feed?.webhook)throw new Error('Webhook not configured');
  if(!await readableWebhook(env,cat,feed))throw new Error('Feed audience cannot read this collection');
  const {syncFunctions,runFunctions}=await import('./functions.mjs');await syncFunctions(env);
  const id='webhook-test:'+crypto.randomUUID();
  // Only the selected delivery sees this synthetic event; no feed subscribes to this type.
  await env.DB.batch([
    env.DB.prepare('INSERT INTO studio_events(id,type,data,at) VALUES(?1,?2,?3,?4)').bind(id,'webhook.test',JSON.stringify({feed:name,test:true}),Date.now()),
    env.DB.prepare('INSERT INTO function_deliveries(event,function) VALUES(?1,?2)').bind(id,webhookName(name)),
  ]);
  await runFunctions(env,cat,'https://studio.invalid');
  return {id,...await env.DB.prepare('SELECT state,attempts,error,due FROM function_deliveries WHERE event=?1 AND function=?2').bind(id,webhookName(name)).first()};
}
