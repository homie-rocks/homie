/** Throwaway deployed proof only. These observation routes are not toolkit routes. */
import worker, {Table as BaseTable, Lobby, Gate as BaseGate, Concentrator, hostRules} from '../../../worker/index.mjs';
import {defineRules, roomSettings} from '../../../rules/rules.ts';
export {Lobby, Concentrator};
const rules = defineRules({
  contract: 2, space: {dims: 2}, entities: {runner: {player: true}},
  room: {rounds: {seconds: 2, breakSeconds: 45}, join(_world, peer) {
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
    if (new URL(request.url).pathname === '/proof-status') return Response.json({
      version: this.env.PROOF_VERSION, boot: this.proofBoot, tick: this.hostRt?.tick,
      round: this.hostRt?.core.round(), idle: this.hostRt?.roundIdleUntil,
      clients: this.room?.clients.size, timer: Boolean(this.timer),
    });
    return super.fetch(request);
  }
}
export class Gate extends BaseGate {
  constructor(ctx, env) { super(ctx, env); this.proofBoot = crypto.randomUUID(); }
  fetch(request) {
    if (new URL(request.url).pathname === '/proof-status') return Response.json({
      version: this.env.PROOF_VERSION, boot: this.proofBoot, clients: this.clients.size,
    });
    return super.fetch(request);
  }
}
export default {fetch(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname === '/proof-version') return new Response(env.PROOF_VERSION);
  if (url.pathname === '/proof-status') {
    const binding = env[url.searchParams.get('kind') === 'GATE' ? 'GATE' : 'TABLE'];
    return binding.get(binding.idFromName(url.searchParams.get('key'))).fetch(request);
  }
  return worker.fetch(request, configured(env), ctx);
}};
