import { services } from './mcp-tools.mjs';
import { isOwner, sameOrigin } from './office.mjs';
import { esc } from './site.mjs';
let load = async () => [];
export function useFunctions(loader) { load = loader; }
export async function emitEvent(env, type, data, {id = crypto.randomUUID(), at = Date.now()} = {}) {
  await env.DB.prepare('INSERT OR IGNORE INTO studio_events(id,type,data,at) VALUES(?1,?2,?3,?4)').bind(id,type,JSON.stringify(data),at).run();
  return id;
}
/** A lease is for retry after a crashed Worker, not a deadline imposed on studio code. */
export async function runFunctions(env, cat, origin, {definitions, now = Date.now, leaseMs = 60000} = {}) {
  definitions ??= await load();
  if(!definitions.length)return;
  if(typeof cat==='function')cat=await cat();
  for (const fn of definitions) {
    await env.DB.prepare(`INSERT OR IGNORE INTO function_deliveries(event,function) SELECT id,?1 FROM studio_events WHERE type=?2 AND (?3 IS NULL OR json_extract(data,'$.function')=?1)`).bind(fn.name,fn.event,fn.schedule??null).run();
    // Page work without limiting attempts or discarding events. A subsequent tick resumes the cursor.
    const rows=(await env.DB.prepare(`SELECT d.*,e.type,e.data,e.at FROM function_deliveries d JOIN studio_events e ON e.id=d.event WHERE d.function=?1 AND d.state!='complete' AND d.due<=?2 ORDER BY e.at,e.id`).bind(fn.name,now()).all()).results;
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
}
export async function scheduleFunctions(event,env,cat,origin) {
  const definitions=await load();
  for(const fn of definitions) if(fn.schedule===event.cron) await emitEvent(env,fn.event,{function:fn.name,cron:event.cron,scheduledTime:event.scheduledTime},{id:`schedule:${fn.name}:${event.scheduledTime}`,at:event.scheduledTime});
  await runFunctions(env,cat,origin,{definitions});
}
export async function functionsRoute(request,env,cat) {
  const url=new URL(request.url);
  if (!await isOwner(request,env)) return new Response('Sign in to the office',{status:403});
  if(request.method==='POST') {
    if(!sameOrigin(request,url))return new Response('Origin refused',{status:403});
    const form=request.headers.get('content-type')?.includes('application/x-www-form-urlencoded');
    const body=form?Object.fromEntries(await request.formData()):await request.json();
    if(body.retry) await env.DB.prepare(`UPDATE function_deliveries SET due=0 WHERE event=?1 AND state='failed'`).bind(body.retry).run();
    if(body.fire) {
      if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))return new Response('Local testing only',{status:403});
      await emitEvent(env,body.fire,body.data??{},{id:body.id??crypto.randomUUID()});
    }
    await runFunctions(env,cat,url.origin);
    return form?Response.redirect(url.href,303):Response.json({ok:true});
  }
  const rows=(await env.DB.prepare(`SELECT d.*,e.type,e.at FROM function_deliveries d JOIN studio_events e ON e.id=d.event ORDER BY e.at DESC`).all()).results;
  return new Response(`<!doctype html><meta charset="utf-8"><title>Studio functions</title><h1>Studio functions</h1><p>At-least-once delivery. Use the event ID to deduplicate effects.</p><table><tr><th>Function</th><th>Event ID</th><th>Event</th><th>State</th><th>Attempts</th><th>Error</th><th>Retry</th></tr>${rows.map(r=>`<tr>${[r.function,r.event,r.type,r.state,r.attempts,r.error??''].map(v=>`<td>${esc(v)}</td>`).join('')}<td>${r.state==='failed'?`<form method="post"><input type="hidden" name="retry" value="${esc(r.event)}"><button>Retry</button></form>`:''}</td></tr>`).join('')}</table>`,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store'}});
}
