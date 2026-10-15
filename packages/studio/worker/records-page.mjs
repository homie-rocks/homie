import {playerProperties} from './embed.mjs';
import {appRole} from './app-format.mjs';
import {esc} from './site.mjs';
import {SHOP_SHELL_JS, SHOP_SHELL_CSS} from './shop-page.mjs';
import {RECORDS_PREFS_JS} from './records-prefs.mjs';
import {APP_SHELL_JS} from './app-shell.mjs';
/** A records-only app has no room simulation. The shell owns one frame and its authenticated records bridge. */
export function recordsPage(meta,url,cat={},shop=null,test=false,assetTicket=null) {
 const params=new URLSearchParams(url.search);params.delete('access');params.set('pf','1');params.set('role',appRole(meta,url));if(!params.has('surface'))params.set('surface',url.pathname.endsWith('/tv')?'wall':'phone');
 const tags=Object.entries(playerProperties(cat,meta,{origin:url.origin})).map(([name,content])=>`<meta name="${esc(name)}" content="${esc(content)}">`).join('');
 const boot={kind:'app',test,game:meta.id,screen:url.pathname.endsWith('/tv'),shop};
 const source=assetTicket?`/${meta.id}/__assets/${assetTicket}/index.html?${params}`:`/${meta.id}/__game/?${params}`;
 return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(meta.name)}</title>${tags}<style>${SHOP_SHELL_CSS}html,body{margin:0;height:100%;background:#10151c;color:white;font:18px system-ui}iframe{border:0;width:100%;height:100%;display:block}[data-arrive]{position:fixed;inset:0;display:grid;place-items:center;background:#10151c}[data-arrive][hidden]{display:none;opacity:0;visibility:hidden}</style></head><body><div data-arrive>Opening ${esc(meta.name)}…</div><iframe class="game" title="${esc(meta.name)}" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads" allow="autoplay *; fullscreen *; web-share *"></iframe><script>window.__HOMIE_APP=${JSON.stringify(boot).replace(/</g,'\\u003c')};window.__HOMIE_PLAY=window.__HOMIE_APP;window.__shell={room:new URLSearchParams(location.search).get('room')||'main',link:{state:'connecting'},arrival:{phase:'loading'}};</script><script>${APP_SHELL_JS}</script><script>${RECORDS_PREFS_JS}</script><script>${SHOP_SHELL_JS}</script><script>const frame=document.querySelector('iframe');frame.addEventListener('load',()=>{if(!frame.getAttribute('src'))return;requestAnimationFrame(()=>requestAnimationFrame(()=>{document.querySelector('[data-arrive]').hidden=true;window.__shell.link.state='online';window.__shell.arrival.phase='done';}));});frame.src=${JSON.stringify(source).replace(/</g,'\\u003c')};</script></body></html>`,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store, no-transform','x-frame-options':'SAMEORIGIN'}});
}
