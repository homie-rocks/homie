import { services } from './mcp-tools.mjs';
import { isOwner, sameOrigin } from './office.mjs';
import { esc } from './site.mjs';
let load = async () => [];
export function useFunctions(loader) { load = loader; }
export async function hasFunctionType(type) { return (await load()).some(fn=>fn.event===type); }
export async function syncFunctions(env, definitions = null, now = Date.now()) {
  definitions ??= await load();
  if (!env.DB || !definitions.length) return definitions;
  // Deploy owns the production registry; an old in-flight Worker must not overwrite it.
  if(await env.DB.prepare("SELECT 1 FROM meta WHERE key='function-registry-deployed'").first())return definitions;
  const statements=definitions.map(fn=>env.DB.prepare(`INSERT INTO function_subscriptions(name,type,cursor,started) VALUES(?1,?2,(SELECT COALESCE(MAX(seq),0) FROM studio_events),?3) ON CONFLICT(name) DO UPDATE SET type=excluded.type,cursor=excluded.cursor,started=excluded.started WHERE type!=excluded.type`).bind(fn.name,fn.event,now));
  statements.push(env.DB.prepare(`DELETE FROM function_subscriptions WHERE name NOT IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(definitions.map(f=>f.name))));
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
    env.DB.prepare(`DELETE FROM function_deliveries WHERE event=?1 AND (state='complete' OR NOT EXISTS (SELECT 1 FROM function_subscriptions s WHERE s.name=function_deliveries.function))`).bind(id),
    env.DB.prepare(`DELETE FROM studio_events WHERE id=?1 AND NOT EXISTS (SELECT 1 FROM function_subscriptions s WHERE s.type=studio_events.type AND s.cursor<studio_events.seq) AND NOT EXISTS (SELECT 1 FROM function_deliveries d WHERE d.event=studio_events.id)`).bind(id),
  ]);
  statements.push(env.DB.prepare("INSERT INTO meta(key,value) VALUES('function-prune-cursor',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(rows.at(-1)?.seq??0)));
  await env.DB.batch(statements);
}
/** A lease is for retry after a crashed Worker, not a deadline imposed on studio code. */
export async function runFunctions(env, cat, origin, {definitions, now = Date.now, leaseMs = 60000} = {}) {
  definitions = await syncFunctions(env,definitions,now());
  if(!definitions.length)return;
  if(typeof cat==='function')cat=await cat();
  for (const fn of definitions) {
    const subscription=await env.DB.prepare('SELECT cursor,type FROM function_subscriptions WHERE name=?1').bind(fn.name).first();
    if(!subscription || subscription.type!==fn.event)continue;
    const page=(await env.DB.prepare('SELECT seq,id,data FROM studio_events WHERE type=?1 AND seq>?2 ORDER BY seq LIMIT 100').bind(fn.event,subscription.cursor).all()).results;
    if(page.length)await env.DB.batch([
      ...page.filter(e=>!fn.schedule||JSON.parse(e.data).function===fn.name).map(e=>env.DB.prepare('INSERT OR IGNORE INTO function_deliveries(event,function) SELECT id,?2 FROM studio_events WHERE id=?1').bind(e.id,fn.name)),
      env.DB.prepare('UPDATE function_subscriptions SET cursor=MAX(cursor,?2) WHERE name=?1').bind(fn.name,page.at(-1).seq),
    ]);
    const rows=(await env.DB.prepare(`SELECT d.*,e.type,e.data,e.at FROM function_deliveries d JOIN studio_events e ON e.id=d.event WHERE d.function=?1 AND d.state IN ('pending','failed','running') AND d.due<=?2 ORDER BY d.due LIMIT 100`).bind(fn.name,now()).all()).results;
    for (const row of rows) {
      const lease=crypto.randomUUID();
      const claimed=await env.DB.prepare(`UPDATE function_deliveries SET state='running',lease=?3,due=?4,attempts=attempts+1 WHERE event=?1 AND function=?2 AND state!='complete' AND due<=?5`).bind(row.event,fn.name,lease,now()+leaseMs,now()).run();
      if (!claimed.meta.changes) continue;
      try {
        const event=Object.freeze({id:row.event,type:row.type,at:row.at,data:JSON.parse(row.data),attempt:row.attempts+1});
        await fn.handler(event,services(env,cat,origin,{id:'studio-function',owner:true,client:null},'function:'+fn.name,fn));
        await env.DB.prepare(`UPDATE function_deliveries SET state='complete',completed=?4,error=NULL WHERE event=?1 AND function=?2 AND lease=?3`).bind(row.event,fn.name,lease,now()).run();
      } catch {
        // Handler errors may contain credentials. The office identifies the function/event; Worker logs are the studio's debugging surface.
        await env.DB.prepare(`UPDATE function_deliveries SET state='failed',error='Function failed; inspect its code and retry',due=?4 WHERE event=?1 AND function=?2 AND lease=?3`).bind(row.event,fn.name,lease,now()+leaseMs).run();
      }
    }
  }
  await pruneEvents(env);
}
export async function scheduleFunctions(event,env,cat,origin) {
  const definitions=await syncFunctions(env);
  for(const fn of definitions) if(fn.schedule===event.cron) await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO studio_events(id,type,data,at) SELECT ?1,?2,?3,?4 WHERE EXISTS(SELECT 1 FROM function_subscriptions WHERE name=?5 AND last_tick<?4)`).bind(`schedule:${fn.name}:${event.scheduledTime}`,fn.event,JSON.stringify({function:fn.name,cron:event.cron,scheduledTime:event.scheduledTime}),event.scheduledTime,fn.name),
    env.DB.prepare('UPDATE function_subscriptions SET last_tick=MAX(last_tick,?2) WHERE name=?1').bind(fn.name,event.scheduledTime),
  ]);
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
