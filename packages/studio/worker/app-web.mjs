import {APP_SHELL_JS} from './app-shell.mjs';
/** Explicit same-origin, public app surface for installation. */
export async function appWeb(request,env,meta,url,sub,document) {
 if(!meta.web?.manifest)return null;
 const base=`/${meta.id}/`;
 if(sub==='manifest.webmanifest')return Response.json({...meta.web.manifest,id:base,start_url:base+'install',scope:base,display:meta.web.manifest.display??'standalone'},{headers:{'content-type':'application/manifest+json'}});
 if(sub==='service-worker.js') {
  const file=meta.web.serviceWorker;
  if(typeof file!=='string'||file.includes('..')||!/^[-\w/]+\.js$/.test(file))return new Response('not found',{status:404});
  const res=await env.ASSETS.fetch(new Request(url.origin+`/games/${meta.id}/${file}`));
  return new Response(res.body,{status:res.status,headers:{'content-type':'text/javascript','service-worker-allowed':base,'cache-control':'no-cache'}});
 }
 if(sub!=='install')return null;
 const role=meta.surfaces?.phone;
 if(meta.room||meta.roles?.[role]?.signIn!==false)return new Response('Install requires a public records-only app',{status:409});
 const response=await document(),headers=new Headers(response.headers);
 if(!response.ok)return response;
 headers.set('content-security-policy',"frame-ancestors 'self'");
 const boot=JSON.stringify({kind:'app',direct:true,game:meta.id}).replace(/</g,'\\u003c');
 const tags=`<base href="${base}__game/"><link rel="manifest" href="${base}manifest.webmanifest"><script>window.__HOMIE_APP=${boot};</script><script>${APP_SHELL_JS}</script>${meta.web.serviceWorker?`<script>if('serviceWorker' in navigator)navigator.serviceWorker.register('${base}service-worker.js',{scope:'${base}'}).catch(console.error);</script>`:''}`;
 const html=await response.text();
 return new Response(/<head[^>]*>/i.test(html)?html.replace(/<head[^>]*>/i,m=>m+tags):tags+html,{headers});
}
