import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import dispatch from './dispatch.mjs';
import {invalidateRoutes,routeSnapshot} from './route-cache.mjs';
import {Registry as Core} from './registry.mjs';
export class Registry extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.core=new Core(ctx,env)}
 snapshot(){return this.core.snapshot()}
 status(...args){return this.core.status(...args)}
 objects(...args){return this.core.objects(...args)}
 routes(){return this.core.routes()}
 put(...args){return this.core.put(...args)}
 kill(...args){return this.core.kill(...args)}
 resolve(...args){return this.core.resolve(...args)}
 scheduled(){return this.core.scheduled()}
 claim(...args){return this.core.claim(...args)}
 finish(...args){return this.core.finish(...args)}
 alerts(){return this.core.alerts()}
 alert(...args){return this.core.alert(...args)}
}
/** Binding identity is set by Homie's deployer, never a request header/body. */
export class StopControl extends WorkerEntrypoint {
 async status(object,strong=false){
  const tenant=this.ctx.props?.tenant;
  if(typeof tenant!=='string'||!/^hm-test-[a-z0-9-]+$/.test(tenant))throw Error('Unauthorized');
  if(object||strong)return this.env.REGISTRY.getByName('routes').status(tenant,object);
  const snapshot=await routeSnapshot(this.env,Date.now,this.ctx);
  return {stopped:!snapshot.routes.some(r=>r.tenant===tenant&&!r.disabled),version:snapshot.version};
 }
}
export default {
 ...dispatch,
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/__operator/')){
   const actual=new TextEncoder().encode(request.headers.get('authorization')??'');
   const expected=new TextEncoder().encode('Bearer '+(env.OPERATOR_TOKEN??''));
   if(!env.OPERATOR_TOKEN||actual.byteLength!==expected.byteLength||!crypto.subtle.timingSafeEqual(actual,expected))return new Response('Not found',{status:404});
   const registry=env.REGISTRY.getByName('routes');
   if(request.method==='PUT'&&url.pathname==='/__operator/route'){const {tenant,routes,ticks,limits}=await request.json();await registry.put(tenant,routes,ticks,limits);invalidateRoutes(env);return new Response(null,{status:204})}
   if(request.method==='POST'&&url.pathname==='/__operator/kill'){const {tenant}=await request.json();await registry.kill(tenant);invalidateRoutes(env);
    const objects=await registry.objects(tenant);
    // Only the trusted dispatcher grants this props capability. Route kill is already durable.
    const notify=env.STUDIOS.get(tenant,{props:{managedNotify:true}}).fetch('https://managed.invalid/__managed/notify',{method:'POST',body:JSON.stringify(objects)});
    ctx.waitUntil(notify.then(r=>{console.log(JSON.stringify({tenant,event:'stop-notify',status:r.status,objects:objects.length}));}).catch(e=>console.error(JSON.stringify({tenant,event:'stop-notify-failed',error:String(e)}))));
    return new Response(null,{status:204})}
   if(request.method==='GET'&&url.pathname==='/__operator/alerts')return Response.json(await registry.alerts());
   if(request.method==='GET'&&url.pathname==='/__operator/routes')return Response.json(await registry.routes());
   return new Response('Not found',{status:404});
  }
  return dispatch.fetch(request,env,ctx);
 }
};
