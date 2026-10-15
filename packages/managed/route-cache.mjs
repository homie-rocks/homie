/** Hard expiry measured from read START: a slow registry never extends stale authority. */
export const ROUTE_TTL_MS=2000;
const caches=new WeakMap();
export function invalidateRoutes(env){caches.delete(env.REGISTRY);}
export async function routeSnapshot(env,now=Date.now){
 const key=env.REGISTRY;let state=caches.get(key);
 if(!state){state={};caches.set(key,state);}
 if(state.value&&now()<state.expires)return state.value;
 if(!state.pending){
  const start=now();
  state.pending=key.getByName('routes').snapshot().then(value=>{
   if(now()>=start+ROUTE_TTL_MS)throw Error('Registry snapshot expired in transit');
   state.value=value;state.expires=start+ROUTE_TTL_MS;return value;
  }).finally(()=>{state.pending=null;});
 }
 return state.pending;
}
export function resolveRoute(snapshot,host,path){
 // A disabled specific route must not fall through into a different tenant's root.
 const route=snapshot.routes.flatMap(r=>r.routes.map(route=>({...route,script:r.tenant,disabled:r.disabled,limits:r.limits})))
  .filter(r=>r.hostname===host&&(r.prefix==='/'||path===r.prefix||path.startsWith(r.prefix+'/')))
  .sort((a,b)=>b.prefix.length-a.prefix.length)[0];
 return route&&!route.disabled?route:null;
}
