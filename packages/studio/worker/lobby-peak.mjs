import {counter,today} from './stats.mjs';

// One total per bookkeeping shard, never a sum of independent historical peaks.
// Reports carry their observation time so a delayed request cannot rewind a shard.
export class LobbyPeak {
  constructor(ctx,env) {this.ctx=ctx;this.env=env;this.chain=Promise.resolve();}
  fetch(request) {
    const task=this.chain.then(()=>this.answer(request));this.chain=task.catch(()=>{});return task;
  }
  async flush() {
    const state=this.state;
    const writes=[state.players>(state.publishedPlayers??0)&&counter(this.env,{metric:'peak',subject:this.subject,n:state.players}),state.room>(state.publishedRoom??0)&&counter(this.env,{metric:'peak-room',subject:this.subject,n:state.room})].filter(Boolean);
    if(writes.length)await this.env.DB.batch(writes);
    // Current totals are volatile. Reusing an old high-water snapshot's shard
    // counts after eviction would incorrectly add players who already left.
    await this.ctx.storage.put('concurrent-peak',{day:state.day,players:state.players,room:state.room,publishedPlayers:state.players,publishedRoom:state.room});
    state.publishedPlayers=state.players;state.publishedRoom=state.room;this.dirty=false;
  }
  schedule() {
    if(this.flushing)return;
    const task=new Promise(resolve=>setTimeout(resolve,1000)).then(()=>{
      const flush=this.chain.then(()=>this.flush());this.chain=flush.catch(()=>{});return flush;
    }).catch(error=>{this.dirty=true;console.warn('Lobby peak write will retry:',error.message);}).finally(()=>{this.flushing=null;});
    this.flushing=task;this.ctx.waitUntil(task);
  }
  async answer(request) {
    if(!this.state)this.state={...await this.ctx.storage.get('concurrent-peak')??{day:today(),players:0,room:0},shards:{}};
    const state=this.state;
    if(state.day!==today()){state.day=today();state.players=0;state.room=0;state.publishedPlayers=0;state.publishedRoom=0;this.dirty=true;}
    if(request.method==='POST') {
      const row=await request.json(),prior=state.shards[row.shard];
      if(!Number.isInteger(row.shard)||row.shard<0||row.shard>=16||!Number.isFinite(row.at)||!Number.isFinite(row.players)||row.players<0)return Response.json({error:'report'},{status:400});
      if(!prior||row.at>prior.at){
        state.shards[row.shard]={players:row.players,at:row.at};
        const concurrent=Object.values(state.shards).filter(r=>r.at>Date.now()-180000).reduce((n,r)=>n+r.players,0);
        const players=Math.max(state.players,concurrent),room=Math.max(state.room,Number(row.room)||0);
        if(players>state.players||room>state.room)this.dirty=true;
        state.players=players;state.room=room;this.subject=new URL(request.url).searchParams.get('game');
      }
    }
    if(this.dirty){if(this.ctx.waitUntil)this.schedule();else await this.flush();}
    return Response.json({players:state.players,room:state.room});
  }
}
