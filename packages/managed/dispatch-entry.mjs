import {DurableObject} from 'cloudflare:workers';
import dispatch from './dispatch.mjs';
import {Registry as Core} from './registry.mjs';
export class Registry extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.core=new Core(ctx,env)}
 routes(){return this.core.routes()}
 put(...args){return this.core.put(...args)}
 kill(...args){return this.core.kill(...args)}
 resolve(...args){return this.core.resolve(...args)}
 scheduled(){return this.core.scheduled()}
 claim(...args){return this.core.claim(...args)}
 finish(...args){return this.core.finish(...args)}
 alert(...args){return this.core.alert(...args)}
}
export default {
 ...dispatch,
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/__operator/')){
   if(!env.OPERATOR_TOKEN||request.headers.get('authorization')!=='Bearer '+env.OPERATOR_TOKEN)return new Response('Not found',{status:404});
   const registry=env.REGISTRY.getByName('routes');
   if(request.method==='PUT'&&url.pathname==='/__operator/route'){const {tenant,routes,ticks}=await request.json();await registry.put(tenant,routes,ticks);return new Response(null,{status:204})}
   if(request.method==='POST'&&url.pathname==='/__operator/kill'){await registry.kill((await request.json()).tenant);return new Response(null,{status:204})}
   if(request.method==='GET'&&url.pathname==='/__operator/routes')return Response.json(await registry.routes());
   return new Response('Not found',{status:404});
  }
  return dispatch.fetch(request,env);
 }
};
