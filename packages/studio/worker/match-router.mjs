import {lobbyShard,LOBBY_SHARDS} from './lobby-shards.mjs';

// Entry objects partition reservation ownership. They lease 32 routing decisions
// at a time, so the policy object sees 1/32 of join traffic, never room reports.
// A quiet game shares shard zero. Bursts open the remaining matching pools.
export class MatchRouter {
  constructor(ctx,env) { this.ctx=ctx;this.env=env;this.pending=new Map();this.routes=new Map(); }
  async fetch(request) {
    const url=new URL(request.url),now=Date.now();
    if(url.pathname==='/match-policy') {
      this.demand=(this.demand??[]).filter(at=>now-at<10000);this.demand.push(now);
      return Response.json({wide:this.demand.length>4,until:now+10000});
    }
    const identity=url.searchParams.get('reservation');
    const key=JSON.stringify([identity,url.searchParams.get('ver'),url.searchParams.get('host'),url.searchParams.get('not')]);
    if(this.pending.has(key))return Response.json(await this.pending.get(key));
    const task=this.join(url,key,now);this.pending.set(key,task);
    try{return Response.json(await task);}finally{this.pending.delete(key);}
  }
  async join(url,key,now) {
    const game=url.searchParams.get('game');
    for(const [id,row] of this.routes)if(row.until<=now)this.routes.delete(id);
    let route=this.routes.get(key)??await this.ctx.storage.get('match:'+key);
    if(!route||route.until<=now) {
      // Serialize lease consumption, not requests to the matching shards.
      const previous=this.leasing??Promise.resolve();
      const lease=previous.then(async()=>{
        if(!this.policy||this.policy.until<=now||!this.remaining){
          const target=new URL('https://lobby/match-policy');target.searchParams.set('game',game);
          const response=await this.env.LOBBY.get(this.env.LOBBY.idFromName(game+'/match-policy')).fetch(target);
          if(!response.ok)throw Error('Matching policy unavailable');
          this.policy=await response.json();this.remaining=32;
        }
        this.remaining--;
        return this.policy.wide?lobbyShard(url.searchParams.get('reservation')):0;
      });
      this.leasing=lease.then(()=>{},()=>{});
      route={shard:await lease,until:now+20000};
      // Persist ownership before forwarding: a lost response or entry eviction
      // must retry the same shard, even while the game changes routing policy.
      await this.ctx.storage.put('match:'+key,route);this.routes.set(key,route);
      await this.ctx.storage.setAlarm?.(now+20000);
    }
    url.pathname='/join';url.searchParams.set('shard',String(route.shard));
    const name=route.shard?`${game}/shard/${route.shard}`:game;
    const response=await this.env.LOBBY.get(this.env.LOBBY.idFromName(name)).fetch(url);
    if(!response.ok)throw Error('Matching shard unavailable');
    return response.json();
  }
  async alarm() {
    const now=Date.now();let next=Infinity;
    for(const [key,row] of await this.ctx.storage.list({prefix:'match:'})) {
      if(row.until<=now)await this.ctx.storage.delete(key);else next=Math.min(next,row.until);
    }
    if(Number.isFinite(next))await this.ctx.storage.setAlarm(next);
  }
}
