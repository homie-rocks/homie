import {eventHookSubscriptions} from './mcp-events.mjs';
import {webhookSubscriptions,webhookFailure,webhookBackoff} from './event-webhooks.mjs';
import {parseSchedule,scheduleStatus} from './function-schedule.mjs';
import {redactText} from '../lib/redact.mjs';
import {feedSubscriptions,pushEvents} from './event-resources.mjs';
import { services } from './mcp-tools.mjs';
import { isOwner, sameOrigin } from './office.mjs';
import { esc } from './site.mjs';
let load = async () => [];
export function useFunctions(loader) { load = loader; }
export async function hasFunctionType(type,env={}) { return [...await load(),...feedSubscriptions(env)].some(fn=>fn.event===type); }
export async function syncFunctions(env, definitions = null, now = Date.now()) {
  definitions ??= await load();
  definitions=[...definitions.filter(fn=>!fn.name.startsWith('@events/')&&!fn.name.startsWith('@webhook/')),...feedSubscriptions(env),...webhookSubscriptions(env,null)];
  if (!env.DB || !definitions.length) return definitions;
  // Deploy owns the production registry; an old in-flight Worker must not overwrite it.
  if(await env.DB.prepare("SELECT 1 FROM meta WHERE key='function-registry-deployed'").first())return definitions;
  const statements=definitions.map(fn=>env.DB.prepare(`INSERT INTO function_subscriptions(name,type,cursor,started) VALUES(?1,?2,(SELECT COALESCE(MAX(seq),0) FROM studio_events),?3) ON CONFLICT(name) DO UPDATE SET type=excluded.type,cursor=excluded.cursor,started=excluded.started WHERE type!=excluded.type`).bind(fn.name,fn.event,now));
  statements.push(env.DB.prepare(`DELETE FROM function_subscriptions WHERE name NOT LIKE '@mcp-webhook/%' AND name NOT IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(definitions.map(f=>f.name))));
  await env.DB.batch(statements);
  return definitions;
}
export async function emitEvent(env, type, data, {id = crypto.randomUUID(), at = Date.now()} = {}) {
  await env.DB.prepare('INSERT OR IGNORE INTO studio_events(id,type,data,at) SELECT ?1,?2,?3,?4 WHERE EXISTS (SELECT 1 FROM function_subscriptions WHERE type=?2)').bind(id,type,JSON.stringify(data),at).run();
  return id;
}
export async function replayFunction(env, name, definitions = null) {
  definitions ??= await load();
  if (!definitions.some(fn=>fn.name===name && fn.replay===true)) throw new Error('Declare replay: true before requesting retained history');
  await env.DB.prepare('UPDATE function_subscriptions SET cursor=0 WHERE name=?1').bind(name).run();
}
export async function pruneEvents(env) {
  // Visit a bounded sequence page even when millions of failed events remain.
  const cursor=Number((await env.DB.prepare("SELECT value FROM meta WHERE key='function-prune-cursor'").first())?.value??0);
  const rows=(await env.DB.prepare('SELECT seq,id FROM studio_events WHERE seq>?1 ORDER BY seq LIMIT 100').bind(cursor).all()).results;
  const statements=rows.flatMap(({id})=>[
    env.DB.prepare(`DELETE FROM function_deliveries WHERE event=?1 AND ((state='complete' AND function NOT LIKE '@webhook/%' AND function NOT LIKE '@mcp-webhook/%') OR NOT EXISTS (SELECT 1 FROM function_subscriptions s WHERE s.name=function_deliveries.function))`).bind(id),
    env.DB.prepare(`DELETE FROM studio_events WHERE id=?1 AND NOT EXISTS (SELECT 1 FROM function_subscriptions s WHERE s.type=studio_events.type AND s.cursor<studio_events.seq) AND NOT EXISTS (SELECT 1 FROM function_deliveries d WHERE d.event=studio_events.id)`).bind(id),
  ]);
  statements.push(env.DB.prepare("INSERT INTO meta(key,value) VALUES('function-prune-cursor',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(rows.at(-1)?.seq??0)));
  await env.DB.batch(statements);
}
/** A lease is for retry after a crashed Worker, not a deadline imposed on studio code. */
export async function runFunctions(env, cat, origin, {definitions, now = Date.now, leaseMs = 60000, webhookOptions = {}} = {}) {
  definitions = await syncFunctions(env,definitions,now());
  if(typeof cat==='function')cat=await cat();
  definitions=definitions.filter(fn=>!fn.webhook).concat(webhookSubscriptions(env,cat,webhookOptions),await eventHookSubscriptions(env,cat,{...webhookOptions,now}));
  // An AI notification must not wait behind a slow function handler.
  const notify=()=>pushEvents(env,cat,origin).catch(error=>console.error('Event notification wake failed',error));
  const notifications=notify();
  let more;
  do {
    more=false;
    for (const fn of definitions) {
      if(!fn.handler)continue;
      const subscription=await env.DB.prepare('SELECT cursor,type FROM function_subscriptions WHERE name=?1').bind(fn.name).first();
      if(!subscription || subscription.type!==fn.event)continue;
      const page=(await env.DB.prepare('SELECT seq,id,data FROM studio_events WHERE type=?1 AND seq>?2 ORDER BY seq LIMIT 100').bind(fn.event,subscription.cursor).all()).results;
      if(page.length)more=true;
      if(page.length)await env.DB.batch([
        ...page.filter(e=>(!fn.schedule||JSON.parse(e.data).function===fn.name)&&(!fn.matches||fn.matches({type:fn.event,data:JSON.parse(e.data)}))).map(e=>env.DB.prepare('INSERT OR IGNORE INTO function_deliveries(event,function) SELECT id,?2 FROM studio_events WHERE id=?1').bind(e.id,fn.name)),
        env.DB.prepare('UPDATE function_subscriptions SET cursor=MAX(cursor,?2) WHERE name=?1').bind(fn.name,page.at(-1).seq),
      ]);
      const rows=(await env.DB.prepare(`SELECT d.*,e.type,e.data,e.at FROM function_deliveries d JOIN studio_events e ON e.id=d.event WHERE d.function=?1 AND d.state IN ('pending','failed','running') AND d.due<=?2 ORDER BY d.due LIMIT 100`).bind(fn.name,now()).all()).results;
      if(rows.length===100)more=true;
      for (const row of rows) {
        const lease=crypto.randomUUID();
        const started=now();
        const [claimed]=await env.DB.batch([
          env.DB.prepare(`UPDATE function_deliveries SET state='running',lease=?3,due=?4,attempts=attempts+1 WHERE event=?1 AND function=?2 AND state!='complete' AND due<=?5`).bind(row.event,fn.name,lease,started+leaseMs,started),
          env.DB.prepare("UPDATE function_runs SET outcome='interrupted',error='Worker lease expired before completion was recorded' WHERE event=?1 AND function=?2 AND outcome='running' AND EXISTS(SELECT 1 FROM function_deliveries WHERE event=?1 AND function=?2 AND lease=?3)").bind(row.event,fn.name,lease),
          env.DB.prepare("INSERT INTO function_runs(id,function,event,trigger,started,outcome,attempt) SELECT ?1,?2,?3,?4,?5,'running',attempts FROM function_deliveries WHERE event=?3 AND function=?2 AND lease=?1").bind(lease,fn.name,row.event,row.event.startsWith(`schedule:${fn.name}:`)?`schedule: ${JSON.parse(row.data).cron}`:row.type,started),
        ]);
        if (!claimed.meta.changes) continue;
        let failure=null,permanent=false;
        try {
          const stored=JSON.parse(row.data);
          const isolated=env.HOMIE_LOCAL_TEST_SECRET && /^([a-z][a-z0-9-]*):check:([a-zA-Z0-9-]+)$/.exec(stored?.app??'');
          const event=Object.freeze({id:row.event,type:row.type,at:row.at,data:isolated?{...stored,app:isolated[1]}:stored,attempt:row.attempts+1});
          const testScope=isolated?isolated[2]:null;
          await fn.handler(event,services(env,cat,origin,{id:'studio-function',owner:true,client:null,...(testScope?{testScope}:{})},'function:'+fn.name+(testScope?':check:'+testScope:''),fn));
        } catch(error) {permanent=error.permanent===true;failure=fn.webhook?webhookFailure(error):functionError(error,env);}
        const finished=now();
        const firstAttempt=fn.mcpEvent?(await env.DB.prepare('SELECT MIN(started) at FROM function_runs WHERE event=?1 AND function=?2').bind(row.event,fn.name).first()).at:finished;
        const abandoned=fn.mcpEvent&&failure!==null&&(permanent||row.attempts+1>=5||finished-firstAttempt>=900000);
        await env.DB.batch([
          failure===null
            ? env.DB.prepare(`UPDATE function_deliveries SET state='complete',completed=?4,error=NULL WHERE event=?1 AND function=?2 AND lease=?3`).bind(row.event,fn.name,lease,finished)
            : abandoned ? env.DB.prepare(`UPDATE function_deliveries SET state='complete',completed=?4,error=?5 WHERE event=?1 AND function=?2 AND lease=?3`).bind(row.event,fn.name,lease,finished,failure)
            : env.DB.prepare(`UPDATE function_deliveries SET state='failed',error=?5,due=?4 WHERE event=?1 AND function=?2 AND lease=?3`).bind(row.event,fn.name,lease,finished+(fn.webhook?webhookBackoff(row.attempts+1):leaseMs),fn.webhook?failure:'Function failed; inspect its code and retry'),
          env.DB.prepare("UPDATE function_runs SET outcome=?2,finished=?3,error=?4 WHERE id=?1").bind(lease,failure===null?'complete':'failed',finished,failure),
        ]);
      }
    }
  } while(more);
  await notifications;
  await notify();
  await pruneEvents(env);
}
export async function scheduleFunctions(event,env,cat,origin) {
  const definitions=await syncFunctions(env);
  const scheduledTime=Math.floor(event.scheduledTime/60000)*60000;
  await env.DB.prepare("INSERT INTO meta(key,value) VALUES('function-last-scheduled',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({cron:event.cron,scheduledTime})).run();
  for(const fn of definitions) {
    if(fn.schedule===undefined)continue;
    let due=false;
    try {due=parseSchedule(fn.schedule).matches(scheduledTime);} catch {continue;} // An old invalid declaration stays diagnosable via the owner tool.
    if(!due)continue;
    await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO studio_events(id,type,data,at) SELECT ?1,?2,?3,?4 WHERE EXISTS(SELECT 1 FROM function_subscriptions WHERE name=?5 AND last_tick<?4)`).bind(`schedule:${fn.name}:${scheduledTime}`,fn.event,JSON.stringify({function:fn.name,cron:fn.schedule,scheduledTime}),scheduledTime,fn.name),
    env.DB.prepare('UPDATE function_subscriptions SET last_tick=MAX(last_tick,?2) WHERE name=?1').bind(fn.name,scheduledTime),
  ]);
  }
  await runFunctions(env,cat,origin,{definitions});
}
export async function functionsRoute(request,env,cat) {
  const url=new URL(request.url);
  if (!await isOwner(request,env)) return new Response('Sign in to the office',{status:403});
  if(request.method==='POST') {
    if(!sameOrigin(request,url))return new Response('Origin refused',{status:403});
    const form=request.headers.get('content-type')?.includes('application/x-www-form-urlencoded');
    const body=form?Object.fromEntries(await request.formData()):await request.json();
    if(body.replay) await replayFunction(env,body.replay);
    if(body.retry) await env.DB.prepare(`UPDATE function_deliveries SET due=0 WHERE event=?1 AND state='failed'`).bind(body.retry).run();
    if(body.fire) {
      if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))return new Response('Local testing only',{status:403});
      await emitEvent(env,body.fire,body.data??{},{id:body.id??crypto.randomUUID()});
    }
    await runFunctions(env,cat,url.origin);
    return form?Response.redirect(url.href,303):Response.json({ok:true});
  }
  const rows=(await env.DB.prepare(`SELECT d.*,e.type,e.at FROM function_deliveries d JOIN studio_events e ON e.id=d.event ORDER BY e.at DESC LIMIT 100`).all()).results;
  return new Response(`<!doctype html><meta charset="utf-8"><title>Studio functions</title><h1>Studio functions</h1><p>At-least-once delivery. Use the event ID to deduplicate effects.</p><table><tr><th>Function</th><th>Event ID</th><th>Event</th><th>State</th><th>Attempts</th><th>Error</th><th>Retry</th></tr>${rows.map(r=>`<tr>${[r.function,r.event,r.type,r.state,r.attempts,r.error??''].map(v=>`<td>${esc(v)}</td>`).join('')}<td>${r.state==='failed'?`<form method="post"><input type="hidden" name="retry" value="${esc(r.event)}"><button>Retry</button></form>`:''}</td></tr>`).join('')}</table>`,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store'}});
}

function functionError(error,env) {
  let message=error instanceof Error?error.message:String(error);
  // Remove known binding values as well as recognizable credential formats.
  for(const [key,value] of Object.entries(env))if(typeof value==='string' && value && !['STUDIO_NAME','STUDIO_EVENT_FEEDS','STUDIO_FUNCTION_CRONS','STUDIO_FUNCTION_MANAGED_CRONS'].includes(key))message=message.split(value).join('[redacted]');
  return redactText(message).text;
}
export async function functionRuns(env,{name,errors=false,before}={}) {
  const rows=(await env.DB.prepare(`SELECT seq,function,event,trigger,started,finished,outcome,error,attempt FROM function_runs
    WHERE (?1 IS NULL OR function=?1) AND (?2=0 OR outcome IN ('failed','interrupted')) AND (?3 IS NULL OR seq<?3)
    ORDER BY seq DESC LIMIT 101`).bind(name??null,errors?1:0,before??null).all()).results;
  const page=rows.slice(0,100),definitions=await load();
  let crons=[];try {crons=JSON.parse(env.STUDIO_FUNCTION_CRONS??'[]');if(!Array.isArray(crons))crons=[];}catch {}
  const schedules=scheduleStatus(definitions.filter(f=>!name||f.name===name),crons);
  const tick=await env.DB.prepare("SELECT value FROM meta WHERE key='function-last-scheduled'").first();
  return {runs:page.map(r=>({...r,started:new Date(r.started).toISOString(),finished:r.finished===null?null:new Date(r.finished).toISOString()})),next:rows.length>100?page.at(-1).seq:null,schedules,crons,lastScheduled:tick?JSON.parse(tick.value):null,triggerEvidence:'Generated deployment configuration; lastScheduled proves an observed tick. Provider dashboard changes are not queried.'};
}
