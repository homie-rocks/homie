/** Deterministic storage workload, run: node scripts/measure-world-writes.mjs [--world].
 * The game schema and host envelope are real; virtual poses/value changes drive
 * SQLite directly to isolate persistence cost from browser/network timing.
 */
import {DatabaseSync} from 'node:sqlite';
import {defineRules,defineMove,compileRules,compileMap,roomSettings,f} from '../rules/rules.ts';
import {createHost} from '../rules/host.ts';
import {fakeClock} from './rules-kit.mjs';
import {fromBytes} from '../rules/pack.ts';
import {roomStore} from '../worker/room-store.mjs';

function meter() {
  const db=new DatabaseSync(':memory:'); let rows=0,bytes=0;
  const storage={sql:{exec(query,...args){const statement=db.prepare(query);
    if(/^SELECT/.test(query))return{toArray:()=>statement.all(...args)};
    const result=statement.run(...args);rows+=Number(result.changes);
    if(/^(INSERT|UPDATE)/.test(query))bytes+=args.reduce((n,v)=>n+(typeof v==='string'?Buffer.byteLength(v):ArrayBuffer.isView(v)?v.byteLength:0),0);
    return{toArray:()=>[]};}},transactionSync(fn){db.exec('BEGIN');try{fn();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}};
  return {storage,reset(){rows=0;bytes=0;},get counts(){return{rows,bytes};},close(){db.close();}};
}
function fixture(players,busy) {
  const def=defineRules({contract:2,space:{dims:2},move:defineMove({runner(){}}),entities:{runner:{player:true,
    fields:{pearls:f.u32({durable:true,visibility:'owner'}),collected:f.list(f.u32(),64,{durable:true,visibility:'owner'})},
    input:{ax:f.i8(),ay:f.i8()},body:{shape:'circle',radius:.35,maxSpeed:5}}},room:{join(c,p){return{kind:'runner',at:{x:p.seat,y:0,z:0}};}}});
  const compiled=compileRules(def,{map:compileMap({bounds:{min:[-2000,-100],max:[2000,100]}}),settings:roomSettings({lifetime:'persistent',characters:true}).settings,seats:players});
  const host=createHost({game:'garden',compiled,clock:fakeClock(),random:()=>.3,send(){},characterFor:p=>({account:'p'+p.seat,lease:1,seat:-1,character:null})});
  for(let seat=0;seat<players;seat++)host.frame({t:'join',peer:{id:'p'+seat,seat,occ:seat+1}});
  host.tickNow();const h=fromBytes(host.save());host.stop();
  if(busy)for(const e of h.core.ents)e[17][1]=Array.from({length:64},(_,i)=>i);
  return {at:0,v:1,game:'garden',room:'pub-1',stateHash:'measured-schema',buildHash:'measured-build',pausedAt:null,pauseFromRestore:false,
    accountTokens:Object.fromEntries(Array.from({length:players},(_,i)=>['p'+i,'t'.repeat(32)+i])),
    net:{v:1,room:'pub-1',savedAt:0,seats:Array.from({length:players},(_,i)=>[i,'t'.repeat(32)+i,'Player '+i,null,i+1,0]),hosted:'server'},host:h};
}
/** Cloudflare's published price for SQLite-backed Durable Object storage: $1.00 a million rows written (a delete is a row written). */
const DOLLARS_PER_ROW = 1 / 1e6;
/**
 * Three games, each in a small room and as one 1,000-player world, at 20 ticks a second for a virtual minute:
 * - trial: everybody walks all the time and picks something up every 30 seconds, each on their own tick;
 * - busy: the worst case, every player's count and whole 64-entry inventory change on every tick;
 * - idle: people are seated and nothing moves.
 * `before` saves the whole room every tick (the first design); `after` is the journal and the 30-second checkpoint.
 */
export function measureWorldWrites({ticks=1200,world=false}={}) {
  const results=[];
  for(const [name,players,busy,idle] of (world ? [['trial-world',1000,false,false],['busy-world',1000,true,false],['idle-world',1000,false,true]] : [['trial',8,false,false],['busy',32,true,false],['idle',8,false,true]])) {
    const value=fixture(players,busy), before=meter(), after=meter();
    const old=roomStore(before.storage), journal=roomStore(after.storage,{persistent:true});
    old.write(value);journal.write(value);before.reset();after.reset();
    let cpu=0;
    for(let tick=1;tick<=ticks;tick++) {
      value.at=tick*50;value.net.savedAt=value.at;value.host.core.tick++;
      for(const e of value.host.core.ents) {
        if(!idle)e[7][0]=(tick%100)*.01+e[11];
        if(busy){e[17][0]++;e[17][1]=e[17][1].map(x=>x+1);}
        else if(!idle&&(tick+e[11]*7)%600===0){e[17][0]++;e[17][1][e[17][0]%64]=e[17][0];}
      }
      old.write(value);
      const started=performance.now();
      journal.commit(value,{seconds:30,tickHz:20,fields:{kinds:[[0,1]],shared:[]}});
      cpu+=performance.now()-started;
    }
    const hour=72000/ticks;
    const perPlayerHour=counts=>({rows:Math.round(counts.rows*hour/players*100)/100,bytes:Math.round(counts.bytes*hour/players)});
    const dollars=counts=>Math.round(counts.rows*hour/players*1000*DOLLARS_PER_ROW*1e4)/1e4;
    results.push({name,players,seconds:ticks/20,before:perPlayerHour(before.counts),after:perPlayerHour(after.counts),
      dollarsPer1000PlayerHours:{before:dollars(before.counts),after:dollars(after.counts)},commitMsPerTick:Math.round(cpu/ticks*100)/100});
    before.close();after.close();
  }
  return results;
}
