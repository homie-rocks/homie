import {roomServer} from './servers.mjs';
export const LOBBY_SHARDS=16;
export const SHARDED_ROOM_BASE=100000000;
export function lobbyShard(key) {
  let hash=2166136261;for(const c of String(key))hash=Math.imul(hash^c.charCodeAt(0),16777619);
  return (hash>>>0)%LOBBY_SHARDS;
}
export function roomShard(room) {
  const server=roomServer(room);
  if(server!=='public')return lobbyShard(server);
  const n=/^pub-(\d+)$/.exec(room)?.[1];
  return n ? Number(n)>=SHARDED_ROOM_BASE?(Number(n)-SHARDED_ROOM_BASE)%LOBBY_SHARDS:0 : lobbyShard(room);
}
export function lobbyFor(env,game,identity='') {
  const stub=shard=>env.LOBBY.get(env.LOBBY.idFromName(shard?`${game}/shard/${shard}`:game));
  const send=(shard,url,init)=>{const target=new URL(url);target.searchParams.set('shard',String(shard));return stub(shard).fetch(target.toString(),init);};
  return {async fetch(input,init) {
    const url=new URL(typeof input==='string'?input:input.url??input);
    if(url.pathname==='/join') {
      const server=url.searchParams.get('server')??'public';
      const key=identity||url.searchParams.get('b')||crypto.randomUUID();
      const shard=lobbyShard(server==='public'?key:server);
      url.searchParams.set('reservation',key.slice(0,128));
      if(server==='public'){url.pathname='/match';url.searchParams.set('game',game);return env.LOBBY.get(env.LOBBY.idFromName(`${game}/match/${shard}`)).fetch(url.toString(),init);}
      return send(shard,url,init);
    }
    if(url.pathname==='/report') {
      const body=JSON.parse(init?.body??await input.clone().text());
      return send(roomShard(body.room),url,init??{method:'POST',body:JSON.stringify(body)});
    }
    const rows=await Promise.all(Array.from({length:LOBBY_SHARDS},async(_,shard)=>{
      const response=await send(shard,url,init);if(!response.ok)throw Error('Lobby shard unavailable');return response.json();
    }));
    if(url.pathname==='/busiest')return Response.json(rows.sort((a,b)=>b.players-a.players||String(a.room).localeCompare(String(b.room)))[0]);
    if(url.pathname==='/now'){
      const target=new URL('https://lobby/peak');target.searchParams.set('game',game);
      const response=await env.LOBBY.get(env.LOBBY.idFromName(game+'/peak')).fetch(target);
      if(!response.ok)throw Error('Lobby peak unavailable');
      return Response.json({players:rows.reduce((n,r)=>n+r.players,0),rooms:rows.reduce((n,r)=>n+r.rooms,0),peak:await response.json()});
    }
    return Response.json({rooms:[...new Map(rows.flatMap(r=>r.rooms??[]).map(r=>[r.name??r.room,r])).values()].sort((a,b)=>b.players-a.players)});
  }};
}
