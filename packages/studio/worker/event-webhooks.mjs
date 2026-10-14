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
export class WebhookFailure extends Error {
  constructor(message){super(message);this.name='WebhookFailure';}
}
export function webhookFailure(error){return error instanceof WebhookFailure?error.message:'Webhook delivery failed';}
export const webhookBackoff=attempt=>Math.min(3600000,60000*2**Math.min(16,attempt-1));
export async function postWebhook(env,name,event,{fetchFn=globalThis.fetch.bind(globalThis),now=Date.now,timeoutMs=10000}={}) {
  const hook=eventFeeds(env)[name]?.webhook;
  if(!hook)throw new WebhookFailure('Webhook removed');
  validateWebhook(name,hook);
  const secret=env[hook.secret];
  if(typeof secret!=='string'||!/^whsec_[A-Za-z0-9+/]{43}=$/.test(secret))throw new WebhookFailure('Webhook signing secret unavailable');
  const id='evt_'+btoa(String.fromCharCode(...new TextEncoder().encode(event.id))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  return signedWebhook(hook.url,{id,body:{id:event.id,type:event.type,at:event.at,data:event.data},secrets:[secret]},{fetchFn,now,timeoutMs});
}
/** Shared transport for configured studio hooks and MCP Events subscriptions. */
export async function signedWebhook(url,{id,body,secrets,headers={}},{fetchFn=globalThis.fetch.bind(globalThis),now=Date.now,timeoutMs=10000}={}) {
  const timestamp=String(Math.floor(now()/1000));
  const encoded=JSON.stringify(body),signatures=[];
  for(const secret of secrets){
    const key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(secret.slice(6)),c=>c.charCodeAt(0)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    signatures.push('v1,'+btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${id}.${timestamp}.${encoded}`))))));
  }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetchFn(url,{method:'POST',redirect:'manual',signal:controller.signal,headers:{'content-type':'application/json','webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':signatures.join(' '),...headers},body:encoded});
    await response.body?.cancel();
    if(!response.ok){const error=new WebhookFailure('Webhook HTTP '+response.status);error.status=response.status;throw error;}
  }catch(error){
    if(error instanceof WebhookFailure)throw error;
    throw new WebhookFailure(controller.signal.aborted?'Webhook timed out':'Webhook network failure');
  }finally{clearTimeout(timer);}
}

export function webhookSubscriptions(env,cat,options={}) {
  return Object.entries(eventFeeds(env)).filter(([,feed])=>feed.webhook).map(([name,feed])=>({
    name:webhookName(name,feed.webhook),event:feed.event,webhook:true,
    matches:event=>matchesFeed(feed,event),
    async handler(event){
      if(event.type!=='webhook.test'&&!matchesFeed(feed,event))return;
      if(!await readableWebhook(env,cat,feed))throw new WebhookFailure('Feed audience cannot read this collection');
      await postWebhook(env,name,event,options);
    },
  }));
}
export async function webhookStatus(env,name,after=0) {
  const feed=eventFeeds(env)[name];if(!feed)throw new Error('Unknown event feed');
  if(!feed.webhook)return {feed:name,enabled:false,latest:null,deliveries:[],next:null};
  const rows=(await env.DB.prepare(`SELECT e.seq,d.event,d.state,d.attempts,d.error,d.due,d.completed FROM function_deliveries d JOIN studio_events e ON e.id=d.event WHERE d.function=?1 AND e.seq>?2 ORDER BY e.seq LIMIT 100`).bind(webhookName(name,feed.webhook),after).all()).results;
  const latest=await env.DB.prepare('SELECT d.event,d.state,d.attempts,d.error,d.due,d.completed FROM function_deliveries d JOIN studio_events e ON e.id=d.event WHERE d.function=?1 ORDER BY e.seq DESC LIMIT 1').bind(webhookName(name,feed.webhook)).first();
  return {feed:name,enabled:true,latest,deliveries:rows,next:rows.length===100?rows.at(-1).seq:null};
}
export async function testWebhook(env,cat,name,origin) {
  const feed=eventFeeds(env)[name];if(!feed?.webhook)throw new Error('Webhook not configured');
  if(!await readableWebhook(env,cat,feed))throw new Error('Feed audience cannot read this collection');
  const {syncFunctions,runFunctions}=await import('./functions.mjs');await syncFunctions(env);
  const id='webhook-test:'+crypto.randomUUID();
  // Only the selected delivery sees this synthetic event; no feed subscribes to this type.
  await env.DB.batch([
    env.DB.prepare('INSERT INTO studio_events(id,type,data,at) VALUES(?1,?2,?3,?4)').bind(id,'webhook.test',JSON.stringify({feed:name,test:true}),Date.now()),
    env.DB.prepare('INSERT INTO function_deliveries(event,function) VALUES(?1,?2)').bind(id,webhookName(name,feed.webhook)),
  ]);
  await runFunctions(env,cat,origin);
  return {id,...await env.DB.prepare('SELECT state,attempts,error,due FROM function_deliveries WHERE event=?1 AND function=?2').bind(id,webhookName(name,feed.webhook)).first()};
}
