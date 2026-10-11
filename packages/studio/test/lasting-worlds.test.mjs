import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { defineRules, defineMove, compileRules, compileMap, roomSettings, f } from '../rules/rules.ts';
import { createHost } from '../rules/host.ts';
import { fromBytes } from '../rules/pack.ts';
import { roomStore } from '../worker/room-store.mjs';
import { characterStore } from '../worker/characters.mjs';
import { fakeClock } from './rules-kit.mjs';
import { measureWorldWrites } from './world-writes.mjs';

function storage() {
  const db = new DatabaseSync(':memory:'); let boundary = 0, fail = Infinity, when = 'before', commitCrash = null;
  return {
    sql: { exec(sql, ...args) {
      const hit = !/^SELECT/.test(sql) && ++boundary === fail;
      if (hit && when === 'before') throw new Error('crash');
      const stmt = db.prepare(sql);
      if (/^SELECT/.test(sql)) return { toArray: () => stmt.all(...args) };
      stmt.run(...args); if (hit && when === 'after') throw new Error('crash'); return { toArray: () => [] };
    } },
    transactionSync(fn) { db.exec('BEGIN'); let committed=false; try { const result = fn(); if(commitCrash==='before')throw Error('crash'); db.exec('COMMIT'); committed=true; if(commitCrash==='after')throw Error('crash'); return result; } catch (e) { if(!committed)db.exec('ROLLBACK'); throw e; } },
    fail(n, phase='before') { boundary = 0; fail = n; when=phase; commitCrash=null; },
    failCommit(phase) { commitCrash=phase; }, close() { db.close(); },
  };
}
const map = compileMap({ bounds: { min: [-10,-10], max: [10,10] } });
const def = defineRules({ contract: 2, space: { dims: 2 }, move: defineMove({ runner() {} }),
  shapes: { events: { take: { recipient: f.ref() }, credit: {} }, commands: { pickup: {} }, effects: { got: {} } },
  entities: { runner: { player: true, fields: { coins: f.u32({durable:true,visibility:'owner'}) }, body: { shape: 'circle', radius: .4, maxSpeed: 1 },
    commands: { pickup(w,s) { const coins = w.near(s.pos, 2, 'coin'); if (coins.length) { w.send(coins[0].id, 'take', { recipient: s.id }); } } },
    on: { credit(w,s) { s.coins++; w.emit('got', s.id, {}); } } },
    coin: { fields: { taken: f.bit({durable:true}) }, on: { take(w,s,e) { if (!s.taken) { s.taken=true; w.send(e.recipient, 'credit', {}); w.despawn(s); } } } } },
  // The conserved value crosses two event ticks; recovery must retain both the
  // world item and the pending credit consistently, never mint a second credit.
  room: { join(c,p) { return { kind: 'runner', at: p.character?.at ?? {x:0,y:0,z:0}, fields: p.character?.fields }; },
    start(w) { w.spawn('coin', {x:0,y:0,z:0}); } },
});
// Events are declarations, not transport messages.

const compiled = compileRules(def, { map, settings: roomSettings({ lifetime:'persistent', characters:true }).settings, seats: 8 });

function rig(opts={}) {
  const clock=fakeClock(); const frames=[]; let durable=null; let fail=false;
  const host=createHost({game:'world',compiled,clock,random:()=>.314159,send:m=>frames.push(m),store:{save:b=>{if(fail)throw Error('crash');durable=b.slice();}},...opts});
  return {host,frames,clock,get durable(){return durable;},crashWrite(){fail=true;},join(){host.frame({t:'join',peer:{id:'one',seat:0,occ:1}});},step(n=1){for(let i=0;i<n;i++)host.tickNow();}};
}

test('persistent settings are opt-in and existing defaults do not change',()=>{
  assert.equal(roomSettings({}).settings.lifetime,undefined);
  assert.equal(roomSettings({}).settings.offline,true);
  assert.equal(roomSettings({lifetime:'persistent'}).settings.offline,false);
  assert.equal(roomSettings({lifetime:'persistent',offline:true}).settings.offline,true);
  assert.equal(roomSettings({}).settings.durability.movementSeconds,1);
  assert.ok(roomSettings({host:'browser',lifetime:'persistent'}).problems.length);
  assert.ok(roomSettings({characters:true}).problems.length);
});

test('seeded pickup commits effects, pending credits and acknowledgements before output at every crash tick',()=>{
  for(let seed=1;seed<=(process.env.RULES_EXTENDED ? 1024 : 16);seed++) for(let crash=1;crash<=6;crash++) {
    const grant={account:'a',lease:1,seat:-1,character:null};
    const a=rig({characterFor:()=>grant, random:()=>seed/32}); a.join();a.step();
    a.host.frame({t:'ev',from:0,k:'cmd',d:['pickup',{}]});
    a.step(crash-1); const prior=a.durable; const outputs=a.frames.length;
    a.crashWrite();a.step();assert.equal(a.host.running,false);
    assert.equal(a.frames.length,outputs,'nothing from the failed write reaches a player');
    a.host.stop();
    const b=rig({restore:prior,characterFor:()=>grant});b.join();b.step(6);
    const state=b.host.core.character(0);
    // A command accepted only into uncommitted memory may be retried by the game.
    if(state.fields.coins===0) b.host.frame({t:'ev',from:0,k:'cmd',d:['pickup',{}]});
    b.host.frame({t:'ev',from:0,k:'cmd',d:['pickup',{}]});b.step(4);
    assert.equal(b.host.core.character(0).fields.coins,1);
    b.host.stop();
  }
});

test('every SQL piece boundary rolls back the entire world; a committed save remains readable',()=>{
  for(let crash=1;crash<=4;crash++) {
    const db=storage();const store=roomStore(db);store.write({value:'old'});
    db.fail(crash);const next={value:'x'.repeat(2_100_000)};
    assert.throws(()=>store.write(next),/crash/);db.fail(Infinity);
    assert.deepEqual(store.read(),{value:'old'});db.close();
  }
});

test('two rooms contend, every acquire/return write can crash, and replay cannot overwrite a newer lease',()=>{
  for(let seed=1;seed<=(process.env.RULES_EXTENDED ? 4096 : 32);seed++) {
    const db=storage();const chars=characterStore(db);
    db.fail(1);assert.throws(()=>chars.acquire('g','room-a','s'),/crash/);db.fail(Infinity);
    const a=chars.acquire('g','room-a','s');assert.equal(a.lease,1);
    assert.equal(chars.acquire('g','room-b','s').error,'character-held');
    const character={fields:{coins:seed}};
    db.fail(1);assert.throws(()=>chars.return('g','room-a',a.lease,character),/crash/);db.fail(Infinity);
    assert.equal(chars.acquire('g','room-b','s').error,'character-held');
    chars.return('g','room-a',a.lease,character);chars.return('g','room-a',a.lease,character);
    const b=chars.acquire('g','room-b','s');assert.equal(b.lease,2);assert.deepEqual(b.character,character);
    chars.return('g','room-a',a.lease,{fields:{coins:999}});
    assert.equal(chars.read('g').holder,'room-b');assert.deepEqual(chars.read('g').character,character);db.close();
  }
});

test('character return is in the same durable save as body removal, and next join reads the record',()=>{
  const grant={account:'a',lease:1,seat:-1,character:null};
  const a=rig({characterFor:()=>grant});a.join();a.step();
  a.host.frame({t:'ev',from:0,k:'cmd',d:['pickup',{}]});a.step(4);
  a.host.releaseCharacter('a');
  const saved=fromBytes(a.durable);assert.equal(saved.characters[0].returning,true);
  assert.equal(saved.characters[0].character.fields.coins,1);assert.equal(a.host.core.character(0),null);
  const b=rig({characterFor:()=>({...grant,lease:2,character:saved.characters[0].character})});b.join();b.step();
  assert.equal(b.host.core.character(0).fields.coins,1);a.host.stop();b.host.stop();
});

test('a recall waits for a delayed acquisition in the same room before retiring its lease', async () => {
  const {Table}=await import('../worker/index.mjs');const table=Object.create(Table.prototype);
  let resume;const network=new Promise(resolve=>{resume=resolve;});const order=[];
  const acquire=table.withCharacter('a',async()=>{order.push('acquire-write');await network;order.push('room-reserve');});
  const recall=table.withCharacter('a',async()=>{order.push('room-return');});
  const unrelated=table.withCharacter('b',async()=>{order.push('other-account');});
  await unrelated;assert.deepEqual(order,['acquire-write','other-account']);resume();await Promise.all([acquire,recall]);
  assert.deepEqual(order,['acquire-write','other-account','room-reserve','room-return']);assert.equal(table.characterOperations.size,0);
});

test('a world finish and a crash in its break cannot resurrect the inventory from before a spend', () => {
  const rules=defineRules({contract:2,space:{dims:2},move:defineMove({runner(){}}),
    shapes:{events:{finish:{}},commands:{spendAndFinish:{}}},entities:{runner:{player:true,fields:{coins:f.u32({durable:true,visibility:'owner'})},body:{shape:'circle',radius:.4,maxSpeed:1},commands:{spendAndFinish(w,s){s.coins=2;}}}},
    room:{start(w){w.after(3,'finish',{});},on:{finish(w){w.finish();}},join(c,p){return p.character??{kind:'runner',at:{x:0,y:0,z:0}};}}});
  const c=compileRules(rules,{map,settings:roomSettings({lifetime:'persistent',characters:true}).settings,seats:8});
  const grant={account:'a',lease:1,seat:-1,character:{kind:'runner',at:{x:0,y:0,z:0},heading:{x:1,y:0,z:0},fields:{coins:10},motion:{}}};
  const a=rig({compiled:c,characterFor:()=>grant});a.join();a.step();a.host.frame({t:'ev',from:0,k:'cmd',d:['spendAndFinish',{}]});a.step(3);assert.equal(a.host.core.character(0),null,'world is in its empty break');
  const checkpoint=a.durable;a.host.stop();
  for(const reconnect of [false,true]) for(const breakTicks of [0,5]) {
    const b=rig({compiled:c,restore:checkpoint,characterFor:()=>grant});if(reconnect){b.join();b.step();}b.step(breakTicks);b.host.releaseCharacter('a');
    assert.equal(fromBytes(b.durable).characters[0].character.fields.coins,2,'latest balance survives both the empty break and the re-created body');b.host.stop();
  }
});

test('an unacknowledged return cannot be overwritten by a later player in the same seat', () => {
  const character=coins=>({kind:'runner',at:{x:0,y:0,z:0},fields:{coins},motion:{}});
  let grant={account:'a',lease:1,seat:-1,character:character(5)};
  const a=rig({characterFor:()=>grant});a.join();a.step();a.host.frame({t:'leave',seat:0});
  assert.equal(a.host.characters.get('a').character.fields.coins,5);
  // Leave the first return unacknowledged, just as a delayed account object does.
  grant={account:'b',lease:1,seat:-1,character:character(9)};
  a.host.frame({t:'join',peer:{id:'two',seat:0,occ:2}});a.step();a.host.frame({t:'leave',seat:0});
  const records=new Map(fromBytes(a.durable).characters.map(c=>[c.account,c]));
  assert.equal(records.get('a').character.fields.coins,5);assert.equal(records.get('b').character.fields.coins,9);
  assert.equal(records.get('a').seat,-1);assert.equal(records.get('b').seat,-1);a.host.stop();
});

function journalRig(db, restore = null) {
  const store = roomStore(db, {persistent:true}), clock = fakeClock();
  const frames=[];
  const host=createHost({game:'world',compiled,clock,random:()=>.314159,restore,
    characterFor:()=>({account:'a',lease:1,seat:-1,character:null}),send:m=>frames.push(m),
    store:{save(bytes,options){store.commit({at:clock.now(),host:fromBytes(bytes)},options);}}});
  return {host,store,clock,frames,step(n=1){for(let i=0;i<n;i++){clock.t+=50;host.tickNow();}},join(){host.frame({t:'join',peer:{id:'one',seat:0,occ:1}});}};
}
/** Journal rows a restore would replay: the ones above the floor the last checkpoint wrote. */
const live = db => { const floor=db.sql.exec('SELECT seq FROM world_journal WHERE id=0').toArray()[0]?.seq??0; return db.sql.exec('SELECT id,seq FROM world_journal WHERE id>0 AND seq>? ORDER BY seq',floor).toArray(); };
const restoredBytes = store => new TextEncoder().encode(JSON.stringify(store.read().host));

test('journal restores value and pending credit beyond an older checkpoint, without tick writes',()=>{
  const db=storage(), a=journalRig(db);a.join();a.step();
  const initial=JSON.parse(new TextDecoder().decode(db.sql.exec('SELECT data FROM save WHERE id=0').toArray()[0].data));
  a.host.frame({t:'ev',from:0,k:'cmd',d:['pickup',{}]});a.step(4);
  assert.equal(a.host.core.character(0).fields.coins,1);
  assert.ok(live(db).length>=3);
  assert.equal(initial.host.core.ents.find(e=>e[11]===0)[17][0],0);
  const b=journalRig(db,restoredBytes(roomStore(db,{persistent:true})));b.join();b.step(4);
  b.host.frame({t:'ev',from:0,k:'cmd',d:['pickup',{}]});b.step(4);
  assert.equal(b.host.core.character(0).fields.coins,1);
  // Fail the very next SQL write. An idle room must reach neither journal nor checkpoint.
  db.fail(1);b.step(1200);assert.equal(b.host.running,true);
  db.fail(Infinity);a.host.stop();b.host.stop();db.close();
});

test('journal append and checkpoint fold crash at each SQL boundary without losing or duplicating value',()=>{
  for(const stage of ['append','fold']) for(let boundary=1;boundary<=(stage==='fold'?3:1);boundary++) {
    const db=storage(), a=journalRig(db);a.join();a.step();
    a.host.frame({t:'ev',from:0,k:'cmd',d:['pickup',{}]});
    if(stage==='fold')a.step(4);
    const output=a.frames.length;db.fail(boundary);
    if(stage==='fold')assert.throws(()=>a.host.stop(),/crash/);else a.step();
    assert.equal(a.host.running,false);assert.equal(a.frames.length,output);
    db.fail(Infinity);
    const b=journalRig(db,restoredBytes(roomStore(db,{persistent:true})));b.join();b.step(5);
    b.host.frame({t:'ev',from:0,k:'cmd',d:['pickup',{}]});b.step(5);
    assert.equal(b.host.core.character(0).fields.coins,1);
    b.host.stop();assert.equal(live(db).length,0);db.close();
  }
});

test('restored account inventory is owner-only on reconnect and watcher projections',()=>{
  const grant={account:'a',lease:1,seat:-1,character:{kind:'runner',at:{x:0,y:0,z:0},fields:{coins:17}}};
  const a=rig({characterFor:()=>grant});a.join();a.step();
  const b=rig({restore:a.durable,characterFor:()=>grant});b.join();b.step();
  const snapshot={e:b.host.epoch,k:b.host.tick,d:b.host.core.snapshot(),c:[]};
  for(const seat of [0,1,null]) {
    const row=b.host.projectSnapshot(snapshot,seat).d[1].find(row=>row[9]===0);
    assert.equal(row[7][0],seat===0?17:null);
  }
  a.host.stop();b.host.stop();
});

test('multi-row journals and checkpoints are atomic before and after every physical write and commit',()=>{
  const fields={kinds:[[0],[0]],shared:[]};
  for(const operation of ['journal','checkpoint']) for(const phase of ['before','after']) for(const boundary of [1,2,3,...(operation==='checkpoint'?[4,5]:[]),'commit']) {
    const db=storage(), store=roomStore(db,{persistent:true});
    const a=rig();a.join();a.step();const base={at:0,host:fromBytes(a.durable)};a.host.stop();
    const coins=(world,value)=>{world.host.core.ents.find(e=>e[11]===0)[17][0]=value;return world;};
    store.write(coins(base,'old'));
    // One record is already in the journal, so the checkpoint has a floor to raise: its fifth write.
    const mid=coins(structuredClone(base),'mid');mid.at=50;mid.host.core.tick++;store.commit(mid,{fields});
    assert.equal(live(db).length,1);
    const next=coins(structuredClone(mid),'x'.repeat(2_100_000));next.at=100;next.host.core.tick++;
    if(boundary==='commit')db.failCommit(phase);else db.fail(boundary,phase);
    assert.throws(()=>operation==='journal'?store.commit(next,{fields}):store.write(next),/crash/);
    db.fail(Infinity);
    const recovered=roomStore(db,{persistent:true}).read();
    assert.deepEqual(recovered,boundary==='commit'&&phase==='after'?next:mid,`${operation} ${phase} ${boundary}`);
    db.close();
  }
});

test('a crash between a journal write and the checkpoint after it restores the checkpoint before plus the journal',()=>{
  const db=storage(), a=journalRig(db);a.join();a.step();
  a.host.frame({t:'ev',from:0,k:'cmd',d:['pickup',{}]});a.step(4);
  assert.equal(a.host.core.character(0).fields.coins,1);
  const records=live(db).length;assert.ok(records>=3);
  // The journal is committed. The checkpoint that would fold it dies at each of its writes and at its commit.
  for(const crash of [1,2,3,'commit']) {
    if(crash==='commit')db.failCommit('before');else db.fail(crash);
    assert.throws(()=>roomStore(db,{persistent:true}).write({...roomStore(db,{persistent:true}).read(),at:9}),/crash/);
    db.fail(Infinity);assert.equal(live(db).length,records);
  }
  const b=journalRig(db,restoredBytes(roomStore(db,{persistent:true})));b.join();b.step(4);
  assert.equal(b.host.core.character(0).fields.coins,1);
  assert.equal(fromBytes(b.host.save()).core.ents.length,1);
  a.host.stop();b.host.stop();db.close();
});

test('the journal is a ring: a checkpoint retires its records for one row, and the next records overwrite them',()=>{
  const db=storage(), store=roomStore(db,{persistent:true}), fields={kinds:[[0],[0]],shared:[]};
  const a=rig();a.join();a.step();const world={at:0,host:fromBytes(a.durable)};a.host.stop();
  const runner=world.host.core.ents.find(e=>e[11]===0);
  store.write(world);
  const earn=()=>{world.at+=50;world.host.core.tick++;runner[17][0]++;store.commit(world,{seconds:1e9,fields});};
  for(let i=0;i<5;i++)earn();
  assert.deepEqual(live(db).map(r=>[r.id,r.seq]),[[1,1],[2,2],[3,3],[4,4],[5,5]]);
  store.write(world);
  // Nothing was deleted: the five rows are still there, below the floor, and a restore ignores them.
  assert.equal(db.sql.exec('SELECT id FROM world_journal WHERE id>0').toArray().length,5);
  assert.equal(live(db).length,0);
  assert.equal(roomStore(db,{persistent:true}).read().host.core.ents.find(e=>e[11]===0)[17][0],5);
  earn();earn();
  assert.deepEqual(live(db).map(r=>[r.id,r.seq]),[[1,6],[2,7]]);
  assert.equal(db.sql.exec('SELECT id FROM world_journal WHERE id>0').toArray().length,5);
  const again=roomStore(db,{persistent:true});
  assert.equal(again.read().host.core.ents.find(e=>e[11]===0)[17][0],7);
  // A store opened after a restart carries the sequence on.
  world.at+=50;world.host.core.tick++;runner[17][0]++;again.commit(world,{seconds:1e9,fields});
  assert.deepEqual(live(db).map(r=>[r.id,r.seq]),[[1,6],[2,7],[3,8]]);
  // A record missing from the middle is refused, never skipped.
  db.sql.exec('DELETE FROM world_journal WHERE seq=7');
  assert.throws(()=>roomStore(db,{persistent:true}).read(),/gap/);
  db.close();
});

test('seeded play with a crash at a random write: every published reward is kept and none is paid twice',()=>{
  const rules=defineRules({contract:2,space:{dims:2},move:defineMove({runner(){}}),shapes:{commands:{earn:{},wander:{}},effects:{paid:{}}},
    entities:{runner:{player:true,fields:{coins:f.u32({durable:true,visibility:'owner'}),steps:f.u32()},body:{shape:'circle',radius:.4,maxSpeed:1},
      commands:{earn(w,s){s.coins++;w.emit('paid',s.id,{});},wander(w,s){s.steps++;}}}},
    room:{join(){return{kind:'runner',at:{x:0,y:0,z:0}};}}});
  const c=compileRules(rules,{map,settings:roomSettings({lifetime:'persistent',durability:{movementSeconds:2}}).settings,seats:8});
  for(let seed=1;seed<=(process.env.RULES_EXTENDED ? 2048 : 48);seed++) {
    let x=seed*2654435761>>>0;const rand=n=>{x^=x<<13;x>>>=0;x^=x>>>17;x^=x<<5;x>>>=0;return x%n;};
    const db=storage(), clock=fakeClock();
    let paid=0, sent=0, uncertain=0, host=null, store=null;
    const open=()=>{
      store=roomStore(db,{persistent:true});const saved=store.read();
      host=createHost({game:'seeded',compiled:c,clock,random:()=>.5,...(saved?{restore:new TextEncoder().encode(JSON.stringify(saved.host))}:{}),
        send:m=>{if(m.t==='ev'&&m.k==='fx')paid+=m.d[1].length;},
        store:{save(bytes,options){store.commit({at:clock.now(),host:fromBytes(bytes)},options);}}});
      host.frame({t:'join',peer:{id:'one',seat:0,occ:1}});host.tickNow();
    };
    open();
    for(let round=0;round<6;round++) {
      for(let i=rand(40);i>0;i--) { const earn=rand(3)===0;if(earn)sent++;host.frame({t:'ev',from:0,k:'cmd',d:[earn?'earn':'wander',{}]});clock.t+=50;host.tickNow(); }
      assert.equal(host.running,true,`seed ${seed}`);
      const before=host.core.character(0).fields.coins;
      assert.equal(before,paid+uncertain,`seed ${seed} round ${round}: memory holds exactly what was published`);
      // Kill at the next write, on either side of it or of its commit, with value in flight.
      const phase=['before','after','commit-before','commit-after'][rand(4)];
      if(phase.startsWith('commit-'))db.failCommit(phase.slice(7));else db.fail(1+rand(2),phase);
      const was=paid;
      for(let i=0;i<60&&host.running;i++) { sent++;host.frame({t:'ev',from:0,k:'cmd',d:['earn',{}]});clock.t+=50;host.tickNow(); }
      db.fail(Infinity);host.stop();
      open();
      const coins=host.core.character(0).fields.coins;
      // The one write that died may or may not have landed; its reward was never published either way.
      assert.ok(coins===paid+uncertain||coins===paid+uncertain+1,`seed ${seed} round ${round} ${phase}: ${coins} coins, ${paid} published`);
      assert.ok(coins>=before+(paid-was),`seed ${seed}: nothing published was lost`);
      uncertain=coins-paid;assert.ok(coins<=sent);
    }
    host.stop();db.close();
  }
});

test('a pulse spent after an old checkpoint cannot spend twice when journal recovery replays input queues',()=>{
  const rules=defineRules({contract:2,space:{dims:2},move:defineMove({runner(){}}),entities:{runner:{player:true,
    fields:{coins:f.u32({durable:true})},input:{buy:f.pulse()},body:{shape:'circle',radius:.4,maxSpeed:1},
    tick(w,s){if(s.input.buy)s.coins++;}}},room:{join(){return{kind:'runner',at:{x:0,y:0,z:0}};}}});
  const c=compileRules(rules,{map,settings:roomSettings({lifetime:'persistent'}).settings,seats:8});
  const db=storage(), store=roomStore(db,{persistent:true}), clock=fakeClock();
  const make=restore=>createHost({game:'pulse',compiled:c,clock,random:()=>.3,restore,send(){},store:{save(bytes,options){store.commit({at:clock.now(),host:fromBytes(bytes)},options);}}});
  const a=make();a.frame({t:'join',peer:{id:'one',seat:0,occ:1}});a.tickNow();
  // Save a real pending pulse in the old checkpoint, then consume it once.
  a.frame({t:'ev',from:0,k:'pulse',d:[a.epoch,'buy',1]});
  store.write({at:clock.now(),host:fromBytes(a.save())});a.tickNow();
  assert.equal(a.core.character(0).fields.coins,1);
  const b=make(restoredBytes(roomStore(db,{persistent:true})));b.tickNow();b.tickNow();
  assert.equal(b.core.character(0).fields.coins,1);a.stop();b.stop();db.close();
});

test('each pickup tick survives pre-write, post-write and uncertain-commit crashes using the actual journal',()=>{
  for(let crashTick=1;crashTick<=6;crashTick++)for(const phase of ['before','after','commit-before','commit-after']) {
    const db=storage(), a=journalRig(db);a.join();a.step();
    a.host.frame({t:'ev',from:0,k:'cmd',d:['pickup',{}]});a.step(crashTick-1);
    const output=a.frames.length;
    if(phase.startsWith('commit-'))db.failCommit(phase.slice(7));else db.fail(1,phase);
    a.step();if(!a.host.running)assert.equal(a.frames.length,output);
    db.fail(Infinity);
    const b=journalRig(db,restoredBytes(roomStore(db,{persistent:true})));b.join();b.step(5);
    b.host.frame({t:'ev',from:0,k:'cmd',d:['pickup',{}]});b.step(5);
    assert.equal(b.host.core.character(0).fields.coins,1,`${crashTick} ${phase}`);
    b.host.stop();db.close();
  }
});

test('durable field declarations and persistent checkpoint defaults are validated without changing match defaults',()=>{
  assert.equal(roomSettings({lifetime:'persistent'}).settings.durability.movementSeconds,30);
  assert.equal(roomSettings({lifetime:'persistent',durability:{movementSeconds:7}}).settings.durability.movementSeconds,7);
  const bad=defineRules({...def,entities:{...def.entities,runner:{...def.entities.runner,fields:{coins:f.u32({durable:'yes'})}}}});
  assert.throws(()=>compileRules(bad,{map}),/durable/);
});

test('writes follow value, not ticks or room size: an idle room writes no row, and no game writes more rows than a save a tick did',()=>{
  const [trial,busy,idle]=measureWorldWrites({ticks:1200});
  assert.deepEqual(idle.after,{rows:0,bytes:0});
  // Eight people each gaining something every 30 seconds: 120 records an hour each, and their share of 120 checkpoints.
  assert.ok(trial.after.rows<=150,`${trial.after.rows} rows a player-hour`);
  assert.ok(trial.after.bytes*100<trial.before.bytes);
  // Value changing on every tick is the bound: a record a tick and a checkpoint row or two an interval.
  assert.ok(busy.after.rows<=busy.before.rows*1.01,`${busy.after.rows} against ${busy.before.rows}`);
  assert.ok(busy.after.bytes<busy.before.bytes);
});
