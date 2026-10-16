import {METADATA_REVISION} from './request-db.mjs';
/** Authorize/filter the catalogue before lookup. Metadata changes get a new key,
 * so an owner closing a room or server does not wait for a shared cache expiry. */
export async function cachedRooms(request,env,ctx,cat,read) {
  const cache=globalThis.caches?.default;
  if(!cache||request.method!=='GET'||!env.DB?.[METADATA_REVISION])return read();
  const revision=await env.DB[METADATA_REVISION]();
  if(revision===null)return read();
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([revision,cat.games])));
  const tag=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const key=new Request(new URL('/api/rooms?__cache='+tag,request.url));
  try {const hit=await cache.match(key);if(hit)return hit;}catch(error){console.warn('Room cache read failed',error.message);}
  const response=await read();
  if(response.ok) {
    const put=cache.put(key,response.clone()).catch(error=>console.warn('Room cache write failed',error.message));
    if(ctx?.waitUntil)ctx.waitUntil(put);else await put;
  }
  return response;
}
