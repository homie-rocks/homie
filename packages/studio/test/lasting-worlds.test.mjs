import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { defineRules, defineMove, compileRules, compileMap, roomSettings, f } from '../rules/rules.ts';
import { createHost } from '../rules/host.ts';
import { fromBytes } from '../rules/pack.ts';
import { roomStore } from '../worker/room-store.mjs';
import { characterStore } from '../worker/characters.mjs';
import { fakeClock } from './rules-kit.mjs';

function storage() {
  const db = new DatabaseSync(':memory:'); let boundary = 0, fail = Infinity;
  return {
    sql: { exec(sql, ...args) {
      if (!/^SELECT/.test(sql) && ++boundary === fail) throw new Error('crash');
      const stmt = db.prepare(sql);
      if (/^SELECT/.test(sql)) return { toArray: () => stmt.all(...args) };
      stmt.run(...args); return { toArray: () => [] };
    } },
    transactionSync(fn) { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    fail(n) { boundary = 0; fail = n; }, close() { db.close(); },
  };
}
const map = compileMap({ bounds: { min: [-10,-10], max: [10,10] } });
const def = defineRules({ contract: 2, space: { dims: 2 }, move: defineMove({ runner() {} }),
  shapes: { events: { take: { recipient: f.ref() }, credit: {} }, commands: { pickup: {} }, effects: { got: {} } },
  entities: { runner: { player: true, fields: { coins: f.u32() }, body: { shape: 'circle', radius: .4, maxSpeed: 1 },
    commands: { pickup(w,s) { const coins = w.near(s.pos, 2, 'coin'); if (coins.length) { w.send(coins[0].id, 'take', { recipient: s.id }); } } },
    on: { credit(w,s) { s.coins++; w.emit('got', s.id, {}); } } },
    coin: { fields: { taken: f.bit() }, on: { take(w,s,e) { if (!s.taken) { s.taken=true; w.send(e.recipient, 'credit', {}); w.despawn(s); } } } } },
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
