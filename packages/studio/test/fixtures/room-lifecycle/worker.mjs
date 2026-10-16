/** Throwaway deployed proof only. These observation routes are not toolkit routes. */
import worker, {Table as BaseTable, Lobby as BaseLobby, Gate as BaseGate, Concentrator, hostRules} from '../../../worker/index.mjs';
import {LobbyPeak} from '../../../worker/lobby-peak.mjs';
import {lobbyFor} from '../../../worker/lobby-shards.mjs';
import {defineRules, roomSettings} from '../../../rules/rules.ts';
export {Concentrator};
export class Lobby extends BaseLobby {
  async fetch(request){
    if(new URL(request.url).pathname==='/proof-lobby')return Response.json({requests:this.proofRequests??0,peakWrites:this.proofPeakWrites??0});
    if(new URL(request.url).pathname==='/peak'&&!this.peakStore)this.peakStore=new LobbyPeak({storage:{get:key=>this.ctx.storage.get(key),put:(key,value)=>{this.proofPeakWrites=(this.proofPeakWrites??0)+1;return this.ctx.storage.put(key,value);}},waitUntil:p=>this.ctx.waitUntil(p)},this.env);
    this.proofRequests=(this.proofRequests??0)+1;return super.fetch(request);
  }
}
const rules = defineRules({
  contract: 2, space: {dims: 2}, entities: {runner: {player: true}},
  room: {rounds: {seconds: 15, breakSeconds: 60}, join(_world, peer) {
    return {kind: 'runner', at: {x: peer.seat, y: 0, z: 0}};
  }},
});
const games = ['direct', 'gated'];
hostRules(Object.fromEntries(games.map(id => [id, {
  rules, seats: id === 'direct' ? 8 : 300, build: 'proof', stateHash: 'proof',
  map: {bounds: {min: [-10, -10], max: [500, 10]}}, settings: roomSettings({tickHz: 10}).settings,
}])));
const catalogue = {studio: {name: 'Lifecycle proof'}, games: games.map(id => ({
  id, name: id, players: {min: 1, max: id === 'direct' ? 8 : 300},
  netplay: {version: 'proof'}, room: {host: 'server', contract: 2, tickHz: 10},
}))};
const configured = env => ({...env, HOMIE_ROOM_LOG: '0', ASSETS: {fetch: async request =>
  new URL(request.url).pathname === '/games.json' ? Response.json(catalogue) : new Response('', {status: 404})}});
export class Table extends BaseTable {
  constructor(ctx, env) { super(ctx, configured(env)); this.proofBoot = crypto.randomUUID(); }
  fetch(request) {
    const path=new URL(request.url).pathname;
    if(path==='/proof-miss-start')return this.ctx.storage.deleteAlarm().then(()=>Response.json({ok:true}));
    if(path==='/proof-restart'){setTimeout(()=>this.ctx.abort('throwaway proof restart'),25);return Response.json({ok:true});}
    if(path==='/proof-stall')return this.ctx.blockConcurrencyWhile(async()=>{const start=Date.now();await new Promise(resolve=>setTimeout(resolve,1200));return Response.json({stalled:Date.now()-start});});
    if(path==='/proof-control'){return Promise.resolve(this.room.control('announce',{text:'break control',seconds:300})).then(result=>{this.officeSaved=this.room.officeSaved();return this.ctx.storage.put('office',this.officeSaved).then(()=>Response.json(result));});}
    if (path === '/proof-status') return Response.json({
      inputs:this.room?.stats.ins??0, version: this.env.PROOF_VERSION, boot: this.proofBoot, tick: this.hostRt?.tick,
      round: this.hostRt?.core.round(), idle: this.hostRt?.roundIdleUntil,
      clients: this.room?.clients.size, watchers:this.room?.watchers.size, timer: Boolean(this.timer), announcement:this.room?.announcement,
      sessionBytes:this.ctx.storage.sql.exec('SELECT sum(length(value)) n FROM room_sessions').toArray()[0]?.n,
    });
    return super.fetch(request);
  }
}
export class Gate extends BaseGate {
  constructor(ctx, env) { super(ctx, env); this.proofBoot = crypto.randomUUID(); }
  fetch(request) {
    if(new URL(request.url).pathname==='/proof-restart'){setTimeout(()=>this.ctx.abort('throwaway proof restart'),25);return Response.json({ok:true});}
    if (new URL(request.url).pathname === '/proof-status') return Response.json({
      version: this.env.PROOF_VERSION, boot: this.proofBoot, epoch:this.relayEpoch, clients: this.clients.size, live: Boolean(this.relaySocket?.isLive()),
    });
    return super.fetch(request);
  }
}
export default {fetch(request, env, ctx) {
  const url = new URL(request.url);
  if(url.pathname==='/proof-match')return (async()=>{
    const game=url.searchParams.get('game')??'proof-matches',shard=url.searchParams.get('shard');
    const lobby=shard===null?lobbyFor(env,game,url.searchParams.get('id')):env.LOBBY.get(env.LOBBY.idFromName(Number(shard)?game+'/shard/'+shard:game));
    const query=new URL('https://lobby/join');for(const key of ['max','shard'])if(url.searchParams.has(key))query.searchParams.set(key,url.searchParams.get(key));
    query.searchParams.set('max',url.searchParams.get('max')??'1');query.searchParams.set('reservation',url.searchParams.get('id'));
    const result=await(await lobby.fetch(query.toString(),{method:'POST'})).json();
    if(url.searchParams.has('report'))await lobbyFor(env,game).fetch('https://lobby/report?game='+game,{method:'POST',body:JSON.stringify({room:result.room,players:Number(url.searchParams.get('report'))||1})});
    return Response.json(result);
  })();
  if(url.pathname==='/proof-peak')return env.LOBBY.get(env.LOBBY.idFromName(url.searchParams.get('game')+'/peak')).fetch(new Request('https://lobby/peak?game='+url.searchParams.get('game'),request));
  if(url.pathname==='/proof-capacity')return (async()=>{
    const game=url.searchParams.get('game'),stub=env.LOBBY.get(env.LOBBY.idFromName(game)),start=Date.now();let next=0,errors=0;
    await Promise.all(Array.from({length:32},async()=>{while(next<1024){const id=next++,response=await stub.fetch('https://lobby/join?max=300&shard=0&reservation=capacity-'+id);if(!response.ok)errors++;await response.body?.cancel();}}));
    return Response.json({joins:1024,milliseconds:Date.now()-start,errors});
  })();
  if(url.pathname==='/proof-lobby')return env.LOBBY.get(env.LOBBY.idFromName(url.searchParams.get('name'))).fetch(request);
  if(url.pathname==='/proof-count')return lobbyFor(env,'proof-matches').fetch('https://lobby/rooms');
  if(url.pathname==='/proof-watch') {
    const game=url.searchParams.get('game')??'gated',room=url.searchParams.get('room');
    const target=new URL('https://room/__watch');for(const [key,value] of Object.entries({game,room,max:game==='gated'?'300':'8',host:'server',rules:'1',cur:'proof',b:'watch-'+url.searchParams.get('id')}))target.searchParams.set(key,value);
    return env.TABLE.get(env.TABLE.idFromName(game+'/'+room)).fetch(new Request(target,{headers:{Upgrade:'websocket','cf-connecting-ip':'198.51.'+Math.floor(Number(url.searchParams.get('id'))/255)+'.'+Number(url.searchParams.get('id'))%255}}));
  }
  if (url.pathname === '/proof-version') return new Response(env.PROOF_VERSION);
  if (['/proof-status','/proof-stall','/proof-restart','/proof-control','/proof-miss-start'].includes(url.pathname)) {
    const binding = env[url.searchParams.get('kind') === 'GATE' ? 'GATE' : 'TABLE'];
    return binding.get(binding.idFromName(url.searchParams.get('key'))).fetch(request);
  }
  return worker.fetch(request, configured(env), ctx);
}};
