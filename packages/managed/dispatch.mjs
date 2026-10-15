/** Only the operator registry grants a script capability. Headers carry no authority. */
import {routeSnapshot,resolveRoute} from './route-cache.mjs';
export const HTTP_LIMITS = {cpuMs:100, subRequests:32};
export const TICK_LIMITS = {cpuMs:1000, subRequests:128};
const registry=env=>env.REGISTRY.getByName('routes');
function worker(env, script, tick=false, limits) {
  return env.STUDIOS.get(script, tick ? {props:{managedTick:true}} : {}, {
    limits:limits ?? (tick ? TICK_LIMITS : HTTP_LIMITS), outbound:{tenant:script}
  });
}
export default {
  async fetch(request, env, ctx) {
    const url=new URL(request.url);
    if(url.pathname.startsWith('/__managed/'))return new Response('Not found',{status:404});
    const routeStart=performance.now();let snapshot;try{snapshot=await routeSnapshot(env,Date.now,ctx);}catch{return new Response('Routing unavailable',{status:503});}
    const route=resolveRoute(snapshot,url.hostname,url.pathname);
    if(!route)return new Response('Not found',{status:404});
    if(route.prefix!=='/')url.pathname=url.pathname.slice(route.prefix.length)||'/';
    const routeMs=performance.now()-routeStart;
    const response=await worker(env,route.script,false,route.limits).fetch(new Request(url,request));
    if(response.status===101)return response;
    const headers=new Headers(response.headers);headers.set('x-hm-route-version',String(snapshot.version));headers.set('x-hm-route-ms',routeMs.toFixed(2));
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  },
  async scheduled(event,env) {
    const scripts=await registry(env).scheduled();
    // Queue batches are bounded; failures cause cron failure, never unbounded dispatch fan-out.
    for(let i=0;i<scripts.length;i+=100)await env.TICKS.sendBatch(scripts.slice(i,i+100).map(script=>({
      body:{script,scheduledTime:event.scheduledTime,cron:event.cron}
    })));
  },
  async queue(batch,env) {
    for(const message of batch.messages) {
      // Recheck at delivery: queued ticks cannot bypass a tenant kill switch.
      if(batch.queue==='hm-test-ticks-dlq'){await registry(env).alert(message.body);message.ack();continue;}
      const {script,scheduledTime,cron}=message.body??{};
      const claim=await registry(env).claim(script,scheduledTime);
      if(claim==='skip'){message.ack();continue;}
      if(claim==='busy'){message.retry({delaySeconds:5});continue;}
      try {
        const response=await worker(env,script,true).fetch('https://managed.invalid/__managed/tick',{
          method:'POST',body:JSON.stringify({scheduledTime,cron})});
        if(!response.ok)throw new Error(`tick status ${response.status}`);
        console.log(JSON.stringify({tenant:script,event:'tick-complete',calls:response.headers.get('x-hm-tick-calls')}));
        await registry(env).finish(script,scheduledTime,true);
        message.ack();
      } catch(error) {
        console.error(JSON.stringify({tenant:script,event:'tick-failed',error:String(error)}));
        await registry(env).finish(script,scheduledTime,false);
        message.retry({delaySeconds:5});
      }
    }
  }
};
