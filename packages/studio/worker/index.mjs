/** Studio Worker event boundaries and public toolkit exports. */
import { catalogue } from './catalogue.mjs';
import {trackBackground,requestDatabase,MUTATION_VERSION} from './request-db.mjs';

import {loadShopLinks} from './shop-links.mjs';

import { errorLine } from './room-protocol.mjs';

import { appCors, isAppOrigin } from './standalone.mjs';



import {json,finish} from './responses.mjs';

export { useFunctions } from './function-registry.mjs';
export { Gate, Concentrator } from './gate.mjs';
export { seatCount, SEAT_MAX } from './seats.mjs';
export { hostRules } from './hosted-registry.mjs';
export {usePlayers} from './player-registry.mjs';
export { countVisit } from './stats.mjs';
export { players, cleanName } from './players.mjs';
export { mergeSaves } from './saves.mjs';
export {Table} from './table.mjs';
export {roomEndAt} from './room-lifecycle.mjs';
export {Lobby} from './lobby.mjs';
export {LOBBY_APP_VERSIONS, LOBBY_ROOMS_MAX} from './lobby-limits.mjs';
export {AppRecordHub, EventHub} from './stream-objects.mjs';
export {directoryOf,useTools,getStudioTools} from './tool-registry.mjs';
const route = async (...args) => (await import('./routes.mjs')).default(...args);
export default {
  async queue(batch,env) {return (await import('./background-queue.mjs')).consumeBackground(batch,await loadShopLinks(env));},
  async scheduled(event, env, ctx) {
    env=await loadShopLinks(env);
    const maintenance=(async () => {
      const [{notifyTools},{reconcileOrders,shopOf}]=await Promise.all([import('./runtime-support.mjs'),import('./shop.mjs')]);
      const cat = await catalogue(env, 'https://studio.invalid');
      // Each independent maintenance task settles before its errors are reported.
      // Owner schedules must run even if pruning or payment recovery fails.
      const tasks=[
        ['tool catalogue',()=>notifyTools(env,cat,cat.studio?.url??'https://studio.invalid')],
        ['orders',()=>reconcileOrders(env,shopOf(cat))],
        ['Stripe retention',async()=>{if(env.DB)await (await import('./stripe-intake.mjs')).pruneStripeEvents(env);}],
        ['MCP retention',async()=> (await import('./event-resources.mjs')).pruneMcpKeys(env)],
        ['guest retention',async()=>{if(event.cron==='17 * * * *')await (await import('./players.mjs')).pruneGuests(env);}],
        ['Stripe recovery',async()=>{if(env.BACKGROUND && event.cron==='17 * * * *')await (await import('./stripe-intake.mjs')).sweepStripeEvents(env,cat);}],
        ['owner functions',async()=> (await import('./functions.mjs')).scheduleFunctions(event,env,cat,cat.studio?.url??'https://studio.invalid')],
      ];
      await Promise.all(tasks.map(async([name,run])=>{try{await run();}catch(error){console.error('Scheduled '+name+' failed:',error.message);}}));
    })();
    ctx.waitUntil(maintenance);
    await maintenance;
  },
  async fetch(request, env, ctx) {
    const staticPath=new URL(request.url).pathname;
    if(['GET','HEAD'].includes(request.method)&&staticPath==='/_homie/site.js')return finish(await route(request,env,ctx),staticPath);
    env=await loadShopLinks(env,new URL(request.url).origin);
    env={...env,DB:requestDatabase(env.DB,request,{mutated:false,summaries:Boolean(env.BACKGROUND)})};
    const url = new URL(request.url);
    if(env.HOMIE_CONCEPT==='1' && url.pathname==='/robots.txt')return new Response('User-agent: *\nDisallow: /\n',{headers:{'content-type':'text/plain','x-robots-tag':'noindex, nofollow'}});
    if(env.HOMIE_CONCEPT==='1' && url.pathname==='/.well-known/homie-studio.json')return json({ok:false,error:'concept-unlisted'},404,{'x-robots-tag':'noindex, nofollow'});
    const dispatch=()=>import('./background-queue.mjs').then(m=>m.enqueueChanges(env,url.origin));
    // Some routes reconcile shop state in waitUntil after returning their page.
    // Keep dispatch behind those writes too, preserving the runtime context's
    // methods and OAuth verification symbols through the proxy.
    let delivered=0;
    let delivery=Promise.resolve();
    const background=trackBackground(ctx,()=>{
      // Serialize late completions and remember the generation acknowledged by
      // Queues. A read-only waitUntil never replays an earlier mutation.
      delivery=delivery.catch(error=>{console.error('Background enqueue retry',error);}).then(async()=>{
        const version=env.DB?.[MUTATION_VERSION]??0;
        if(version===delivered)return;
        await dispatch();delivered=version;
      });
      return delivery;
    });
    const requestCtx=background.context;
    // A standalone copy's Lobby call (worker/standalone.mjs): every answer to it can be read by the app's page, an
    // unknown game's 404 and a failure included, so the app can say why it plays offline. No other address is opened.
    const appRecords = isAppOrigin(request) && /^\/[^/]+\/api\/app\/records\//.test(url.pathname);
    if (appRecords && request.method === 'OPTIONS') return appCors(request, new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'GET, POST, PUT, DELETE', 'access-control-allow-headers': 'content-type' } }));
    const appLobby = isAppOrigin(request) && /^\/[^/]+\/api\/lobby\/?$/.test(url.pathname);
    let res;
    try { res = finish(await route(request, env, requestCtx), url.pathname); } catch (error) {
      if (!appLobby) throw error;
      try { console.error(JSON.stringify({ at: new Date().toISOString(), ev: 'lobby-route-failed', path: url.pathname, error: errorLine(error) })); } catch { /* no console */ }
      res = json({ ok: false, error: 'failed' }, 500);
    } finally {
      // A route can commit a write and then fail. Its outbox still needs delivery.
      if(env.DB) {
        const delivery=background.finish();
        if(ctx?.waitUntil)ctx.waitUntil(delivery);else await delivery;
      }
    }
    if(env.HOMIE_CONCEPT==='1' && res.status!==101) {
      const headers=new Headers(res.headers);headers.set('x-robots-tag','noindex, nofollow');
      let body=res.body;
      if(/text\/html/i.test(headers.get('content-type')??'')) {
        const html=await res.text(),banner='<aside role="status" style="position:fixed;z-index:2147483647;top:0;left:0;right:0;text-align:center;background:#ffda44;color:#171717;padding:6px;font:bold 14px system-ui;pointer-events:none">TEST / CONCEPT</aside>';
        body=/<body[^>]*>/i.test(html)?html.replace(/<body[^>]*>/i,m=>m+banner):banner+html;
        headers.delete('content-length');
      }
      res=new Response(body,{status:res.status,headers});
    }
    const bookmark=env.DB?.getBookmark?.();
    if(bookmark&&res.status!==101){const headers=new Headers(res.headers);headers.set('x-studio-bookmark',bookmark);res=new Response(res.body,{status:res.status,statusText:res.statusText,headers});}
    if (appLobby || appRecords) return appCors(request, res);
    return res;
  },
};
