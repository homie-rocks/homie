/** Throwaway deployed proof only. These observation routes are not toolkit routes. */
import worker, {Table as BaseTable, Lobby, Gate as BaseGate, Concentrator, hostRules} from '../../../worker/index.mjs';
import {defineRules, roomSettings} from '../../../rules/rules.ts';
export {Lobby, Concentrator};
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
    if(path==='/proof-restart'){setTimeout(()=>this.ctx.abort('throwaway proof restart'),25);return Response.json({ok:true});}
    if(path==='/proof-stall'){const start=Date.now();while(Date.now()-start<1200){}return Response.json({stalled:Date.now()-start});}
    if(path==='/proof-control'){return this.room.control('announce',{text:'break control'}).then(result=>{this.officeSaved=this.room.officeSaved();return this.ctx.storage.put('office',this.officeSaved).then(()=>Response.json(result));});}
    if (path === '/proof-status') return Response.json({
      version: this.env.PROOF_VERSION, boot: this.proofBoot, tick: this.hostRt?.tick,
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
      version: this.env.PROOF_VERSION, boot: this.proofBoot, clients: this.clients.size, live: Boolean(this.relaySocket?.isLive()),
    });
    return super.fetch(request);
  }
}
export default {fetch(request, env, ctx) {
  const url = new URL(request.url);
  if(url.pathname==='/proof-watch') {
    const game=url.searchParams.get('game')??'gated',room=url.searchParams.get('room');
    const target=new URL('https://room/__watch');for(const [key,value] of Object.entries({game,room,max:game==='gated'?'300':'8',host:'server',rules:'1',cur:'proof',b:'watch-'+url.searchParams.get('id')}))target.searchParams.set(key,value);
    return env.TABLE.get(env.TABLE.idFromName(game+'/'+room)).fetch(new Request(target,{headers:{Upgrade:'websocket','cf-connecting-ip':'198.51.'+Math.floor(Number(url.searchParams.get('id'))/255)+'.'+Number(url.searchParams.get('id'))%255}}));
  }
  if (url.pathname === '/proof-version') return new Response(env.PROOF_VERSION);
  if (['/proof-status','/proof-stall','/proof-restart','/proof-control'].includes(url.pathname)) {
    const binding = env[url.searchParams.get('kind') === 'GATE' ? 'GATE' : 'TABLE'];
    return binding.get(binding.idFromName(url.searchParams.get('key'))).fetch(request);
  }
  return worker.fetch(request, configured(env), ctx);
}};
