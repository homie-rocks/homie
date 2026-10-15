/** TEST ONLY. Preserve binding identity so instrumentation does not invalidate runtime caches. */
import {AsyncLocalStorage} from 'node:async_hooks';
export function instrument(worker) {
 const scope=new AsyncLocalStorage(),bindings=new WeakMap();let first=true;
 const bump=key=>{const counts=scope.getStore();if(counts)counts[key]++};
 function wrap(env) {
  if(bindings.has(env.DB))return {...env,...bindings.get(env.DB)};
  const mapped={};
  const statement=s=>new Proxy(s,{get(target,key){
   if(key==='bind')return (...args)=>statement(target.bind(...args));
   if(['first','all','run','raw'].includes(key))return (...args)=>{bump('d1');return target[key](...args)};
   const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
  mapped.DB={prepare:sql=>statement(env.DB.prepare(sql)),batch:queries=>{bump('d1');return env.DB.batch(queries)}};
  mapped.ASSETS={fetch:(...args)=>{bump('assets');return env.ASSETS.fetch(...args)}};
  for(const key of ['TABLE','LOBBY','GATE','CONCENTRATOR'])if(env[key])mapped[key]=new Proxy(env[key],{get(target,prop){
   if(prop==='get')return (...args)=>{const stub=target.get(...args);return new Proxy(stub,{get(s,k){if(k==='fetch')return (...a)=>{bump('do');return s.fetch(...a)};const v=s[k];return typeof v==='function'?v.bind(s):v;}})};
   const value=target[prop];return typeof value==='function'?value.bind(target):value;
  }});
  bindings.set(env.DB,mapped);return {...env,...mapped};
 }
 return {
  async fetch(request,env,ctx) {
   const counts={d1:0,assets:0,do:0},cold=first;first=false;
   return scope.run(counts,async()=>{
    const response=await worker.fetch(request,wrap(env),ctx);
    if(response.status===101)return response;
    const headers=new Headers(response.headers);headers.set('x-hm-calls',JSON.stringify(counts));headers.set('x-hm-first',String(cold));
    return new Response(response.body,{status:response.status,headers});
   });
  },
  async scheduled(event,env,ctx) {
   const counts={d1:0,assets:0,do:0};
   return scope.run(counts,async()=>{await worker.scheduled(event,wrap(env),ctx);console.log(JSON.stringify({event:'tick-calls',counts}));return counts;});
  }
 };
}
