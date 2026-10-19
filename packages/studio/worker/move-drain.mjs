import {LOBBY_SHARDS} from './lobby-shards.mjs';
export const DRAIN_KEY='studio_move_drain';
/** The drain flag, read in the same batch as the request's metadata revision (request-db.mjs), so an admission costs no extra D1 request. */
export const DRAIN_QUERY="SELECT value FROM meta WHERE key='studio_move_drain'";
export async function drainSince(env){
 if(!env.DB)return null;
 const row=await env.DB.prepare(DRAIN_QUERY).first();
 const at=Number(row?.value);return Number.isSafeInteger(at)&&at>0?at:null;
}
export function isAdmission(request){const path=new URL(request.url).pathname;return request.headers.get('upgrade')?.toLowerCase()==='websocket'||/\/api\/(lobby|agents)(\/|$)/.test(path);}
export const drainResponse=()=>Response.json({ok:false,error:'moving',message:'This studio is moving. Existing rooms can finish; please join again shortly.'},{status:503,headers:{'retry-after':'30','cache-control':'no-store'}});
/** Read every shard directly: cached public summaries exclude private games and hide outages. */
export async function drainStatus(env,cat,{now=Date.now()}={}){
 const since=await drainSince(env);if(!since)return {draining:false,drained:false};
 let clients=0,pending=0,rooms=0;
 for(const game of cat.games??[]){
  const names=new Set();
  let cursor='';
  for(;;){
   const rows=(await env.DB.prepare("SELECT key FROM meta WHERE key LIKE ?1 AND key>?2 ORDER BY key LIMIT 500").bind('move-room:'+game.id+':%',cursor).all()).results;
   if(!Array.isArray(rows))throw Error('Room admission registry unavailable');
   for(const row of rows)names.add(row.key.slice(('move-room:'+game.id+':').length));
   if(rows.length<500)break;cursor=rows.at(-1).key;
  }
  for(let shard=0;shard<LOBBY_SHARDS;shard++){
   const stub=env.LOBBY.get(env.LOBBY.idFromName(shard?`${game.id}/shard/${shard}`:game.id));
   const r=await stub.fetch('https://lobby/rooms');if(!r.ok)throw Error('Cannot measure rooms while moving');
   const body=await r.json();if(!Array.isArray(body.rooms))throw Error('Invalid room census');
   for(const room of body.rooms)names.add(room.name);
  }
  for(const name of names){
   const r=await env.TABLE.get(env.TABLE.idFromName(`${game.id}/${name}`)).fetch(`https://table/__move-status?game=${encodeURIComponent(game.id)}&room=${encodeURIComponent(name)}`);
   if(!r.ok)throw Error('Cannot measure a room while moving');
   const body=await r.json();
   if(!Number.isSafeInteger(body.clients)||body.clients<0||!Number.isSafeInteger(body.pending)||body.pending<0)throw Error('Invalid room drain receipt');
   clients+=body.clients;pending+=body.pending;rooms++;
  }
 }
 return {draining:true,since,clients,pending,rooms,drained:now-since>=240000&&clients===0&&pending===0};
}
