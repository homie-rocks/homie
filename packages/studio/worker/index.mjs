/** Extracted from the studio runtime; behavior is unchanged. */
import {trackBackground,requestDatabase,databaseBinding,MUTATIONS} from './request-db.mjs';
import {loadShopLinks} from './shop-links.mjs';
import {errorLine} from './room.mjs';
import {appCors,isAppOrigin} from './standalone.mjs';
import {players as playerAccounts} from './players.mjs';
import {usePlayers} from './office.mjs';
import {reconcileOrders,shopOf} from './shop.mjs';
import {toolCatalogues,notifyTools} from './runtime-support.mjs';
import {json,finish} from './responses.mjs';
import {catalogue} from './catalogue.mjs';
import {route} from './routes.mjs';
export { useFunctions } from './functions.mjs';
export { Gate, Concentrator } from './gate.mjs';
export { seatCount, SEAT_MAX } from './seats.mjs';
export { hostRules } from './hosted.mjs';
export { usePlayers } from './office.mjs';
export { countVisit } from './stats.mjs';
export { players, cleanName } from './players.mjs';
export { mergeSaves } from './saves.mjs';
export {directoryOf,useTools,getStudioTools} from './tool-registry.mjs';
export {roomEndAt} from './room-lifecycle.mjs';
export {Table} from './table.mjs';
export {LOBBY_APP_VERSIONS,LOBBY_ROOMS_MAX} from './lobby-limits.mjs';
export {Lobby} from './lobby.mjs';

usePlayers(playerAccounts);

export default {
  async scheduled(event, env, ctx) {
    env=await loadShopLinks(env);
    const maintenance=(async () => {
      const cat = await catalogue(env, 'https://studio.invalid');
      await notifyTools(env,cat,cat.studio?.url??'https://studio.invalid').catch(error=>console.warn('Tool catalogue refresh:',error.message));
      await reconcileOrders(env, shopOf(cat));
      await (await import('./functions.mjs')).scheduleFunctions(event,env,cat,cat.studio?.url??'https://studio.invalid');
    })();
    ctx.waitUntil(maintenance);
    await maintenance;
  },
  async fetch(request, env, ctx) {
    const staticPath=new URL(request.url).pathname;
    if(['GET','HEAD'].includes(request.method)&&staticPath==='/_homie/site.js')return finish(await route(request,env,ctx),staticPath);
    env=await loadShopLinks(env,new URL(request.url).origin);
    env={...env,DB:requestDatabase(env.DB,request)};
    const url = new URL(request.url);
    if(env.HOMIE_CONCEPT==='1' && url.pathname==='/robots.txt')return new Response('User-agent: *\nDisallow: /\n',{headers:{'content-type':'text/plain','x-robots-tag':'noindex, nofollow'}});
    if(env.HOMIE_CONCEPT==='1' && url.pathname==='/.well-known/homie-studio.json')return json({ok:false,error:'concept-unlisted'},404,{'x-robots-tag':'noindex, nofollow'});
    const dispatch=()=>import('./functions.mjs').then(m=>m.runFunctions(env,()=>catalogue(env,url.origin),url.origin));
    // Some routes reconcile shop state in waitUntil after returning their page.
    // Keep dispatch behind those writes too, preserving the runtime context's
    // methods and OAuth verification symbols through the proxy.
    const background=trackBackground(ctx,()=>env.DB?.[MUTATIONS]?dispatch():undefined);
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
      // Refresh after the route has populated the catalogue cache.
      if(env.DB&&env.LOBBY&&ctx?.waitUntil) {
        const binding=databaseBinding(env.DB),mutation=url.pathname.startsWith('/_studio/')&&env.DB[MUTATIONS];
        if(!toolCatalogues.has(binding)||mutation) {
          toolCatalogues.add(binding);
          ctx.waitUntil(catalogue(env,url.origin).then(cat=>notifyTools(env,cat,url.origin)).catch(()=>toolCatalogues.delete(binding)));
        }
      }
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
    if (appLobby || appRecords) return appCors(request, res);
    return res;
  },
};
