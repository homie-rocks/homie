/** Only the operator registry grants a script capability. Headers carry no authority. */
export const HTTP_LIMITS = {cpuMs:100, subRequests:64};
export const TICK_LIMITS = {cpuMs:1000, subRequests:256};
const active = env => env.ROUTES.filter(r => !r.disabled);
function worker(env, script, tick=false) {
  return env.STUDIOS.get(script, tick ? {props:{managedTick:true}} : {}, {
    limits:tick ? TICK_LIMITS : HTTP_LIMITS, outbound:{tenant:script}
  });
}
export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    if(url.pathname.startsWith('/__managed/'))return new Response('Not found',{status:404});
    const route=active(env).find(r=>r.hostname===url.hostname &&
      (r.prefix==='/' || url.pathname===r.prefix || url.pathname.startsWith(r.prefix+'/')));
    if(!route)return new Response('Not found',{status:404});
    if(route.prefix!=='/')url.pathname=url.pathname.slice(route.prefix.length)||'/';
    return worker(env,route.script).fetch(new Request(url,request));
  },
  async scheduled(event,env) {
    const scripts=[...new Set(active(env).map(r=>r.script))];
    // Queue batches are bounded; failures cause cron failure, never unbounded dispatch fan-out.
    for(let i=0;i<scripts.length;i+=100)await env.TICKS.sendBatch(scripts.slice(i,i+100).map(script=>({
      body:{script,scheduledTime:event.scheduledTime,cron:event.cron}
    })));
  },
  async queue(batch,env) {
    for(const message of batch.messages) {
      const {script,scheduledTime,cron}=message.body;
      // Recheck at delivery: queued ticks cannot bypass a tenant kill switch.
      if(!active(env).some(r=>r.script===script)){message.ack();continue;}
      try {
        const response=await worker(env,script,true).fetch('https://managed.invalid/__managed/tick',{
          method:'POST',body:JSON.stringify({scheduledTime,cron})});
        if(!response.ok)throw new Error(`tick status ${response.status}`);
        console.log(JSON.stringify({tenant:script,event:'tick-complete',calls:response.headers.get('x-hm-tick-calls')}));
        message.ack();
      } catch(error) {
        console.error(JSON.stringify({tenant:script,event:'tick-failed',error:String(error)}));
        message.retry({delaySeconds:30});
      }
    }
  }
};
