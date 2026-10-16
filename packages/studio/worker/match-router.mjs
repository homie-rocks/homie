import {lobbyShard,LOBBY_SHARDS} from './lobby-shards.mjs';

// Entry objects partition reservation ownership. They lease 8 routing decisions
// at a time, so the policy object sees 1/8 of join traffic, never room reports.
// A quiet game refills existing pools before opening shard zero. Spread above
// 128 observed joins/s: below half the slowest single-coordinator throughput
// measured by the deployed fixture (1024 durable joins, 32 concurrent).
// Count consumed leases, not all eight slots in a newly issued lease.
export class MatchRouter {
  constructor(ctx,env) { this.ctx=ctx;this.env=env;this.pending=new Map();this.routes=new Map(); }
  async fetch(request) {
    const url=new URL(request.url),now=Date.now();
    if(url.pathname==='/match-policy') {
      this.demand=(this.demand??[]).filter(row=>now-row.at<1000);
      this.demand.push({at:now,joins:Math.max(1,Math.min(8,Number(url.searchParams.get('used'))||1))});
      return Response.json({wide:this.demand.reduce((n,row)=>n+row.joins,0)>128,until:now+1000});
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
          const target=new URL('https://lobby/match-policy');target.searchParams.set('game',game);target.searchParams.set('used',String(this.policy?8-this.remaining:1));
          const response=await this.env.LOBBY.get(this.env.LOBBY.idFromName(game+'/match-policy')).fetch(target);
          if(!response.ok)throw Error('Matching policy unavailable');
          this.policy=await response.json();this.remaining=8;
        }
        this.remaining--;
        return this.policy.wide?lobbyShard(url.searchParams.get('reservation')):null;
      });
      this.leasing=lease.then(()=>{},()=>{});
      let shard=await lease;
      if(shard===null) {
        // Read-only discovery: persist ownership before reserving a seat. Quiet
        // joins may refill any pool left open by a burst, including after eviction.
        shard=0;
        for(let candidate=0;candidate<LOBBY_SHARDS;candidate++){
          const target=new URL(url);target.pathname='/join';target.searchParams.set('peek','1');target.searchParams.set('shard',String(candidate));
          const name=candidate?`${game}/shard/${candidate}`:game;
          const response=await this.env.LOBBY.get(this.env.LOBBY.idFromName(name)).fetch(target);
          if(!response.ok)throw Error('Matching discovery unavailable');
          if((await response.json()).room){shard=candidate;break;}
        }
      }
      route={shard,until:now+20000};
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
