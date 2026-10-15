/** Hard expiry measured from read START: a slow registry never extends stale authority. */
export const ROUTE_TTL_MS=2000;
const caches=new WeakMap();
export function invalidateRoutes(env){caches.delete(env.REGISTRY);}
export async function routeSnapshot(env,now=Date.now,ctx){
 const key=env.REGISTRY;let state=caches.get(key);
 if(!state){state={};caches.set(key,state);}
 const fresh=state.value&&now()<state.expires;
 const refresh=()=>{
  if(!state.pending){
   const start=now();let timer;
   state.pending=Promise.race([key.getByName('routes').snapshot(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Registry timeout')),ROUTE_TTL_MS);})]).then(value=>{
    if(now()>=start+ROUTE_TTL_MS)throw Error('Registry snapshot expired in transit');
    // Version must never move backwards, including when an older refresh completes late.
    if(!state.value||value.version>=state.value.version){state.value=value;state.expires=start+ROUTE_TTL_MS;}
    return state.value;
   }).finally(()=>{clearTimeout(timer);state.pending=null;});
  }
  return state.pending;
 };
 if(fresh){
  // Refresh during active traffic without putting the registry on the response path.
  // The old value remains usable ONLY until its original hard expiry.
  if(ctx&&state.expires-now()<ROUTE_TTL_MS/2)ctx.waitUntil(refresh().catch(()=>{}));
  return state.value;
 }
 return refresh();
}
export function resolveRoute(snapshot,host,path){
 const route=snapshot.routes.flatMap(r=>r.routes.map(route=>({...route,script:r.tenant,disabled:r.disabled,limits:r.limits})))
  .filter(r=>r.hostname===host&&(r.prefix==='/'||path===r.prefix||path.startsWith(r.prefix+'/')))
  .sort((a,b)=>b.prefix.length-a.prefix.length)[0];
 return route&&!route.disabled?route:null;
}
