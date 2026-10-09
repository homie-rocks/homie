/** Slice 2: whole saves, atomic storage, epochs, deploy decisions and the restore-loop circuit breaker. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { defineRules, defineMove, f, compileRules, compileMap, roomSettings } from '../rules/rules.ts';
import { createHost } from '../rules/host.ts';
import { fromBytes } from '../rules/pack.ts';
import { stateHash } from '../lib/rules-build.mjs';
import { roomStore, restoreDelay } from '../worker/room-store.mjs';
import { Table, roomEndAt } from '../worker/index.mjs';
import { MeasuredTable } from './fixtures/rooms-saving.mjs';
import { hostRules } from '../worker/hosted.mjs';
import { shell } from './fixtures/page-shell.mjs';
import { fakeClock } from './rules-kit.mjs';

const map = { bounds: { min: [-10, -10], max: [10, 10] }, spots: { start: [[0, 0]] } };
const rules = () => defineRules({ contract: 2, move: defineMove({ runner() {} }), space: { dims: 2 }, shapes: { events: { later: {} }, commands: {}, effects: {} }, shared: { count: f.u32() }, entities: { runner: { player: { away: 'neutral', leave: 'despawn' }, body: { shape: 'circle', radius: 0.5, maxSpeed: 6, move: 'owner' }, fields: { score: f.u16({ score: true }) }, input: { ax: f.i8(), press: f.press() }, on: { later(w, s) { s.score += 7; } }, tick(w, s) { if (w.tick === 2) w.after(100, 'later', {}); } } }, room: { rounds: { seconds: 60, breakSeconds: 8 }, bots: { keep: 1 }, join() { return { kind: 'runner', at: { x: 0, y: 0, z: 0 } }; } } });
const settings = roomSettings({}).settings;
const compiled = (def = rules()) => compileRules(def, { map: compileMap(map), settings, seats: 8 });
const entry = (build = 'a', def = rules()) => ({ rules: def, map, settings, seats: 8, build, stateHash: stateHash(compiled(def)) });

function storageRig() {
  const db = new DatabaseSync(':memory:');
  const kv = new Map(); const deletes = [];
  const storage = {
    sql: { exec(q, ...args) { const stmt = db.prepare(q); if (/^SELECT/i.test(q)) return { toArray: () => stmt.all(...args) }; stmt.run(...args); return { toArray: () => [] }; } },
    transactionSync(fn) { db.exec('BEGIN'); try { const v = fn(); db.exec('COMMIT'); return v; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    async get(k) { return kv.get(k); }, async put(k, v) { kv.set(k, v); }, async delete(k) { deletes.push(k); kv.delete(k); }, async getAlarm() { return kv.get('__alarm') ?? null; }, async setAlarm(at) { kv.set('__alarm', at); },
  };
  return { storage, kv, deletes, close: () => db.close() };
}

function host(c, clock, opts = {}) {
  const frames = [];
  const h = createHost({ game: 'test', compiled: c, clock, random: () => 0.1, send: (m) => frames.push(m), ...opts });
  return { h, frames, join: () => h.frame({ t: 'join', peer: { seat: 0, occ: 1, name: 'Player' } }) };
}

test('whole state saves once per second and on pause, and restores without ticking the outage', () => {
  const c = compiled(); const clock = fakeClock(); const saves = [];
  const rig = host(c, clock, { store: { save: (b) => saves.push(b) } });
  rig.join(); clock.advance(2950);
  assert.equal(saves.length, 2);
  const saved = fromBytes(saves[1]);
  assert.equal(saved.core.tick, 40);
  assert.ok(saved.core.queue.length, 'the delayed event is part of the save');
  rig.h.frame({ t: 'leave', seat: 0 });
  assert.equal(saves.length, 3);
  assert.equal(fromBytes(saves[2]).core.tick, 59);
  clock.advance(50_000); assert.equal(rig.h.tick, 59);
  const back = host(c, clock, { restore: saves[2], restoreEpoch: rig.h.epoch + 1 });
  assert.equal(back.h.tick, 59); assert.equal(back.h.paused, true);
  back.join(); clock.advance(50); assert.equal(back.h.tick, 60);
  assert.equal(back.h.core.bodyOf(0).id, rig.h.core.bodyOf(0).id);
  clock.advance(2100);
  assert.equal(back.h.core.snapshot()[1].find((row) => row[9] === 0)[7][0], 7, 'the saved delayed event fires once at its original tick');
  back.h.stop(); rig.h.stop();
});

test('catch-up ticks bound the save interval and the whole input queue round-trips', () => {
  const clock = fakeClock(); const saves = [];
  const rig = host(compiled(), clock, { store: { save: (b) => saves.push(b) } });
  rig.join(); rig.h.tickNow();
  rig.h.frame({ t: 'in', from: 0, e: rig.h.epoch, r: 0, k: 3, s: [[0, 127, 1], [3, -127, 0]] });
  const before = fromBytes(rig.h.save());
  const clone = host(compiled(), clock, { restore: rig.h.save() });
  assert.deepEqual(fromBytes(clone.h.save()).inputs, before.inputs);
  assert.equal(before.inputs[0][1].entries.length, 2);
  for (let i = 0; i < 39; i++) rig.h.tickNow();
  assert.deepEqual(saves.map((s) => fromBytes(s).core.tick), [20, 40], 'even when wall time does not advance');
  assert.equal(fromBytes(saves[0]).inputs[0][1].ack, 6);
  clone.h.stop(); rig.h.stop();
});

test('round end and world.finish save immediately; a restored room waits its delay and absent bodies are away', () => {
  for (const finish of [false, true]) {
    const base = rules();
    const def = defineRules({ ...base, room: { ...base.room, rounds: { seconds: finish ? 60 : 1.25, breakSeconds: 8 }, ...(finish ? { start(w) { w.after(25, 'later', {}); }, on: { later(w) { w.finish(); } } } : {}) } });
    const c = compiled(def); const clock = fakeClock(); const saves = [];
    const rig = host(c, clock, { store: { save: (b) => saves.push(b) } });
    rig.join(); rig.h.frame({ t: 'join', peer: { seat: 1, occ: 2, name: 'Second' } });
    clock.advance(1300);
    assert.ok(saves.some((b) => fromBytes(b).core.tick === 25), finish ? 'finish saved at once' : 'round end saved at once');
    const saved = rig.h.save(); rig.h.stop();
    const back = host(c, clock, { restore: saved, restoreEpoch: rig.h.epoch + 1, startDelayMs: 1234 });
    back.join(); clock.advance(1234); assert.equal(back.h.tick, 26);
    clock.advance(50); assert.equal(back.h.tick, 27);
    if (!finish) {
      assert.equal(back.h.core.bodyOf(1).away, true);
      assert.equal(back.h.core.bodyOf(0).away, false);
    }
    back.h.stop();
  }
});

test('state hash includes ordered declarations and settings, but ignores handler bodies and tunables', () => {
  const c = compiled(); const base = stateHash(c);
  assert.equal(stateHash({ ...c, tune: { speed: 999 }, publicTune: { speed: 999 } }), base);
  assert.equal(stateHash({ ...c, kinds: c.kinds.map((k) => ({ ...k, tick() {} })) }), base);
  for (const change of [
    { dims: 3 }, { contract: 3 }, { bots: 4 }, { rounds: { seconds: 90, breakSeconds: 8 } },
    { settings: { ...c.settings, tickHz: 30 } }, { shared: [['other', { t: 'u8' }]] },
    { events: { other: [] } }, { commands: { other: [] } }, { effects: { other: [] } },
    { map: { ...c.map, name: 'other' } }, { asks: { other: { stateFields: [] } } },
    ...['fields', 'motion', 'input', 'body', 'player', 'guide', 'on', 'commands', 'onRoom'].map((key) => ({ kinds: c.kinds.map((k) => ({ ...k, [key]: { changed: true } })) })),
  ]) assert.notEqual(stateHash({ ...c, ...change }), base, JSON.stringify(change));
});

test('SQLite pieces replace atomically and shrinking deletes surplus rows, preserving unrelated keys', () => {
  const r = storageRig(); const store = roomStore(r.storage);
  r.kv.set('office', { held: true }); r.kv.set('recorded', 5);
  const large = { text: 'x'.repeat(4_100_000), epoch: 4 };
  store.write(large); assert.deepEqual(store.read(), large);
  assert.equal(r.storage.sql.exec('SELECT id FROM save').toArray().length, 5);
  const exec = r.storage.sql.exec;
  r.storage.sql.exec = (q, ...args) => { if (q.startsWith('INSERT INTO save') && args[0] === 1) throw new Error('interrupted'); return exec(q, ...args); };
  assert.throws(() => store.write({ text: 'y'.repeat(3_000_000) }));
  assert.deepEqual(store.read(), large);
  r.storage.sql.exec = exec;
  store.write({ epoch: 5 }); assert.deepEqual(store.read(), { epoch: 5 });
  assert.equal(r.storage.sql.exec('SELECT id FROM save').toArray().length, 1);
  store.boot({ epoch: 6, count: 2 }); store.clear();
  assert.equal(store.read(), null); assert.equal(store.boots(), null);
  assert.deepEqual([...r.kv.keys()], ['office', 'recorded']); r.close();
});

async function tableRig(r, build, { Klass = Table, code = 'pub-1', preview = '0' } = {}) {
  hostRules({ test: build });
  let ready;
  const pending = [];
  const ctx = { id: { toString: () => 'measured-object' }, storage: r.storage, blockConcurrencyWhile(fn) { ready = fn(); }, waitUntil(p) { pending.push(p); } };
  const reports = [];
  const t = new Klass(ctx, { HOMIE_PREVIEW: preview, HOMIE_ROOM_LOG: '0', ASSETS: { fetch: async () => new Response('', { status: 404 }) }, LOBBY: { idFromName: (x) => x, get: () => ({ fetch: async (u, o) => { reports.push(JSON.parse(o.body)); return new Response('{}'); } }) } });
  await ready;
  const room = t.roomFor('test', code, 8); t.ensureHost(room, true);
  return { t, room, reports, pending };
}

function connect(room, ver, token, extra = {}) {
  const sent = []; const c = { closed: null, send: (text) => sent.push(JSON.parse(text)), close(code) { this.closed = code; }, buffered: () => 0 };
  const socket = room.attach(c); socket.onMessage(JSON.stringify({ t: 'hello', v: 1, ver, token, want: 'play', name: 'Player', ...extra }));
  return { sent, socket, conn: c, welcome: sent.find((m) => m.t === 'welcome') };
}

test('Table restores seats and whole state across unchanged and same-shape builds, rejects old code, advances epochs, and rematches incompatible saves', async () => {
  const r = storageRig(); const build = entry();
  const first = await tableRig(r, build); const a = connect(first.room, 'a');
  for (let i = 0; i < 12; i++) first.t.hostRt.tickNow();
  first.t.saveRoom(first.t.hostRt.save());
  const core = first.t.hostRt.core.save(); first.t.hostRt.stop();
  const second = await tableRig(r, build);
  assert.equal(second.t.hostRt.tick, core.tick);
  assert.equal(second.t.hostRt.epoch, core.epoch + 1);
  const b = connect(second.room, 'a', a.welcome.token);
  assert.equal(b.welcome.seat, a.welcome.seat);
  assert.deepEqual(second.t.hostRt.core.save().ents, core.ents);
  second.t.hostRt.stop();
  const third = await tableRig(r, { ...build, build: 'b' });
  assert.equal(third.t.hostRt.epoch, core.epoch + 2, 'even two restores from the same save differ');
  assert.equal(connect(third.room, 'a', a.welcome.token).sent[0].code, 'stale');
  const newer = connect(third.room, 'b', a.welcome.token);
  assert.equal(newer.welcome.seat, a.welcome.seat);
  assert.equal(third.t.hostRt.tick, core.tick); third.t.hostRt.stop();
  roomStore(r.storage).boot({ epoch: 4294967295, count: 0 });
  const high = await tableRig(r, { ...build, build: 'b' });
  assert.equal(high.t.hostRt.epoch, 4294967296); high.t.hostRt.stop();
  const changed = await tableRig(r, { ...build, stateHash: 'different' });
  assert.ok(changed.t.hostRt);
  assert.equal(connect(changed.room, 'a', a.welcome.token).sent[0].rematch, true);
  assert.equal(roomStore(r.storage).read(), null);
  assert.ok(connect(changed.room, 'a').welcome); changed.t.hostRt.stop();
  await Promise.all(changed.pending); assert.ok(changed.reports.some((x) => x.ended)); r.close();
});

test('world.finish advances an epoch past 32 bits without reusing an earlier value', () => {
  const base = rules();
  const def = defineRules({ ...base, room: { ...base.room, start(w) { w.after(2, 'later', {}); }, on: { later(w) { w.finish(); } } } });
  const c = compiled(def); const clock = fakeClock();
  const seed = host(c, clock); const saved = seed.h.save(); seed.h.stop();
  const rig = host(c, clock, { restore: saved, restoreEpoch: 4294967295 });
  rig.join(); clock.advance(100);
  assert.equal(rig.h.epoch, 4294967296); assert.equal(fromBytes(rig.h.save()).core.epoch, 4294967296);
  rig.h.stop();
});

test('the boot counter persists before ticking, clears after ten seconds of ticks, delays the second restore and ends the third', async () => {
  const r = storageRig(); const build = entry();
  const first = await tableRig(r, build); connect(first.room, 'a'); first.t.hostRt.tickNow(); first.t.saveRoom(first.t.hostRt.save()); first.t.hostRt.stop();
  const store = roomStore(r.storage);
  const second = await tableRig(r, build); connect(second.room, 'a'); second.t.hostRt.tickNow();
  assert.equal(store.boots().count, 1);
  for (let i = 1; i < 200; i++) second.t.hostRt.tickNow();
  assert.equal(store.boots().count, 0); second.t.hostRt.stop();
  store.boot({ epoch: store.boots().epoch, count: 1 });
  const delayed = await tableRig(r, build); connect(delayed.room, 'a');
  assert.equal(delayed.t.hostRt.tick, store.read().host.core.tick);
  assert.equal(restoreDelay('test/pub-1'), restoreDelay('test/pub-1'));
  assert.ok(restoreDelay('test/pub-1') <= 30_000);
  delayed.t.hostRt.tickNow(); assert.equal(store.boots().count, 2); delayed.t.hostRt.stop();
  const ended = await tableRig(r, build); assert.ok(ended.t.hostRt); assert.equal(ended.room.endedMatch.why, 'restore loop'); ended.t.hostRt.stop();
  await Promise.all(ended.pending); r.close();
});

test('twenty same-shape replacements keep eight seats, the match, scores and pending events', async () => {
  const r = storageRig(); const build = entry();
  let live = await tableRig(r, build);
  const tokens = Array.from({ length: 8 }, () => connect(live.room, 'a').welcome.token);
  for (let n = 1; n <= 20; n++) {
    for (let i = 0; i < 200; i++) live.t.hostRt.tickNow();
    live.t.saveRoom(live.t.hostRt.save());
    const before = live.t.hostRt.core.save(); live.t.hostRt.stop();
    const ver = `build-${n}`;
    live = await tableRig(r, { ...build, build: ver });
    const restored = live.t.hostRt.core.save();
    assert.equal(restored.tick, before.tick); assert.deepEqual(restored.round, before.round);
    assert.deepEqual(restored.ents, before.ents); assert.deepEqual(restored.queue, before.queue);
    assert.equal(restored.rng, before.rng); assert.ok(restored.epoch > before.epoch);
    for (let i = 0; i < tokens.length; i++) assert.equal(connect(live.room, ver, tokens[i]).welcome.seat, i);
  }
  live.t.hostRt.stop(); r.close();
});

test('pause expiry ends rooms with watchers and cold objects, preserving office data and allowing the same name again', async () => {
  const originalNow = Date.now; let now = originalNow(); Date.now = () => now;
  try {
    for (const cold of [false, true]) {
      const r = storageRig(); r.kv.set('office', {}); r.kv.set('recorded', 3);
      const rig = await tableRig(r, entry()); const player = connect(rig.room, 'a');
      connect(rig.room, 'a', null, { watch: true });
      rig.t.hostRt.tickNow(); player.socket.onClose();
      assert.equal(rig.t.hostRt.paused, true);
      assert.equal(roomStore(r.storage).read().pausedAt, now);
      const heldSince = rig.room.seats.get(0).since;
      now += 30_000;
      const restored = await tableRig(r, entry());
      assert.equal(restored.room.seats.get(0).since, heldSince, 'a restart does not extend an absent seat hold');
      restored.t.hostRt.stop();
      if (cold) { rig.t.hostRt.stop(); rig.t.hostRt = null; rig.t.room = null; }
      now += 30_001; await rig.t.roomAlarm(); await Promise.all(rig.pending);
      assert.equal(roomStore(r.storage).read(), null); assert.equal(roomStore(r.storage).boots(), null);
      assert.deepEqual(r.kv.get('office'), {}); assert.equal(r.kv.get('recorded'), 3);
      assert.ok(rig.reports.some((m) => m.ended));
      const late = await tableRig(r, entry());
      assert.ok(late.t.hostRt); assert.ok(connect(late.room, 'a').welcome); late.t.hostRt.stop();
      assert.equal(r.kv.has('ended'), false);
      r.close();
    }
  } finally { Date.now = originalNow; }
});

for (const size of [500_000, 1_500_000, 3_000_000, 8_000_000]) test(`save pieces leave row overhead room at ${size} bytes`, () => {
  const r = storageRig(); const store = roomStore(r.storage);
  const value = { text: 'é'.repeat(size / 2) }; store.write(value);
  assert.deepEqual(store.read(), value);
  const rows = r.storage.sql.exec('SELECT data FROM save').toArray();
  assert.ok(rows.every((r) => r.data.byteLength <= 1_000_000));
  assert.equal(rows.length, Math.ceil(new TextEncoder().encode(JSON.stringify(value)).length / 1_000_000)); r.close();
});

test('save failures back off without stopping ticks or snapshots and recover', () => {
  const clock = fakeClock(); let broken = true; let attempts = 0; const logs = [];
  const rig = host(compiled(), clock, { log: (m) => logs.push(m), store: { save() { attempts++; if (broken) throw new Error('SQLITE_FULL'); } } });
  rig.join(); clock.advance(15_000);
  assert.ok(rig.h.running); assert.equal(rig.h.tick, 300);
  assert.ok(rig.frames.filter((m) => m.t === 'snap' && m.k > 250).length);
  assert.ok(attempts <= 6, `backoff: ${attempts} attempts`);
  broken = false; clock.advance(60_000); assert.ok(rig.h.running);
  assert.ok(logs.some((m) => m.ev === 'persist-failed')); rig.h.stop();
});

for (const damage of ['truncated', 'version', 'game', 'room', 'host-version', 'tick', 'rng', 'kind', 'position', 'fields', 'input', 'event', 'policy', 'seats', 'counter', 'epoch', 'entity-id', 'revision', 'arrival']) test(`unreadable ${damage} save starts fresh on join and never throws in a cold alarm`, async () => {
  for (const alarm of [false, true]) {
    const r = storageRig(); const first = await tableRig(r, entry()); connect(first.room, 'a'); first.t.hostRt.tickNow(); first.t.saveRoom(first.t.hostRt.save()); first.t.hostRt.stop();
    const store = roomStore(r.storage); const s = store.read();
    if (damage === 'version') s.v = 99;
    if (damage === 'game') s.game = 'another';
    if (damage === 'room') s.room = 'another';
    if (damage === 'host-version') s.host.v = 99;
    if (damage === 'tick') s.host.core.tick = -5.5;
    if (damage === 'rng') s.host.core.rng = 'abc';
    if (damage === 'kind') s.host.core.ents[0][2] = 99;
    if (damage === 'position') s.host.core.ents[0][7] = ['NaN', null, {}];
    if (damage === 'fields') s.host.core.ents[0][17] = 'not fields';
    if (damage === 'input') s.host.queues = [[0, { ax: 'unsafe', press: false }, null, 1, 1]];
    if (damage === 'event') s.host.core.queue = [[10, 0, '', 10, '', 'room', 'later', { undeclared: true }, 1, 0]];
    if (damage === 'policy') s.host.core.policy.level = 'unsafe';
    if (damage === 'seats') s.net.seats[0][0] = 99;
    if (damage === 'counter') s.host.core.nextId = 1;
    if (damage === 'epoch') s.host.core.epoch = 0;
    if (damage === 'entity-id') s.host.core.ents[0][0] = 'wrong';
    if (damage === 'revision') s.host.core.ents[0][3] = 65536;
    if (damage === 'arrival') s.host.core.ents[0][6] = { untrusted: true };
    store.write(s);
    if (damage === 'truncated') r.storage.sql.exec('UPDATE save SET data = ?', new TextEncoder().encode('{'));
    if (alarm) { first.t.room = null; first.t.hostRt = null; await assert.doesNotReject(() => first.t.roomAlarm()); }
    const next = await tableRig(r, entry()); assert.ok(next.t.hostRt, damage); assert.ok(connect(next.room, 'a').welcome); assert.equal(next.t.hostRt.tick, 0); next.t.hostRt.stop(); r.close();
  }
});


test('cleanup failure still closes every socket, stops the timer, and a later visitor starts fresh', async () => {
  const r = storageRig(); const rig = await tableRig(r, entry()); const p = connect(rig.room, 'a');
  const watcher = { closed: null, send() {}, close(code) { this.closed = code; } }; rig.room.watch(watcher);
  rig.t.hostRt.tickNow(); rig.t.saveRoom(rig.t.hostRt.save());
  const exec = r.storage.sql.exec; r.storage.sql.exec = (q, ...args) => { if (q.startsWith('DELETE')) throw new Error('write unavailable'); return exec(q, ...args); };
  rig.t.start(); rig.t.endHosted('fault');
  assert.equal(rig.t.hostRt, null); assert.equal(rig.t.timer, null); assert.ok(p.conn.closed); assert.ok(watcher.closed);
  assert.ok(p.sent.some((m) => m.code === 'room-over')); assert.equal(rig.room.watchers.size, 0);
  r.storage.sql.exec = exec; await rig.t.roomAlarm(); await Promise.all(rig.pending);
  const nextRoom = rig.t.roomFor('test', 'pub-1', 8); rig.t.ensureHost(nextRoom, true);
  assert.ok(connect(nextRoom, 'a').welcome); assert.equal(rig.t.hostRt.tick, 0); rig.t.hostRt.stop(); r.close();
});

test('cold storage read failure is logged and the alarm never rejects', async () => {
  const r = storageRig(); const rig = await tableRig(r, entry()); rig.t.hostRt.stop(); rig.t.hostRt = null; rig.t.room = null;
  const exec = r.storage.sql.exec; r.storage.sql.exec = () => { throw new Error('read unavailable'); };
  await assert.doesNotReject(() => rig.t.roomAlarm()); assert.equal(rig.t.storageHealth.ok, false);
  r.storage.sql.exec = exec; r.close();
});

test('a missing piece or oversized save is discarded before allocating its joined bytes', async () => {
  for (const oversized of [false, true]) {
    const r = storageRig(); const store = roomStore(r.storage);
    if (oversized) r.storage.sql.exec('INSERT INTO save (id, data) VALUES (?, ?)', 0, new Uint8Array(16_000_001));
    else r.storage.sql.exec('INSERT INTO save (id, data) VALUES (?, ?)', 1, new TextEncoder().encode('{}'));
    const rig = await tableRig(r, entry()); assert.ok(rig.t.hostRt); assert.equal(store.read(), null); rig.t.hostRt.stop(); r.close();
  }
});

for (const fault of ['schema', 'save-read', 'boot-read', 'boot-write']) test(`storage ${fault} failure cannot strand a joining player`, async () => {
  const r = storageRig(); const first = await tableRig(r, entry()); connect(first.room, 'a'); first.t.hostRt.tickNow(); first.t.saveRoom(first.t.hostRt.save()); first.t.hostRt.stop();
  const exec = r.storage.sql.exec;
  r.storage.sql.exec = (q, ...args) => {
    if (fault === 'schema' && q.startsWith('CREATE') || fault === 'save-read' && q.startsWith('SELECT') && q.includes('FROM save') || fault === 'boot-read' && q.startsWith('SELECT') && q.includes('FROM boots') || fault === 'boot-write' && q.startsWith('INSERT INTO boots')) throw new Error(`unavailable ${fault}`);
    return exec(q, ...args);
  };
  const next = await tableRig(r, entry()); assert.ok(next.t.hostRt); assert.ok(connect(next.room, 'a').welcome);
  for (let i = 0; i < 80; i++) next.t.hostRt.tickNow();
  assert.equal(next.t.hostRt.tick, 80); assert.ok(next.t.hostRt.running);
  next.t.hostRt.stop(); clearTimeout(next.t.saveRetry); r.storage.sql.exec = exec; await Promise.all(next.pending); r.close();
});

for (const fault of ['getAlarm', 'setAlarm', 'delete']) test(`storage ${fault} rejection never escapes the cold alarm`, async () => {
  const r = storageRig(); const first = await tableRig(r, entry()); connect(first.room, 'a'); first.t.hostRt.tickNow(); first.t.saveRoom(first.t.hostRt.save()); first.t.hostRt.stop();
  first.t.hostRt = null; first.t.room = null;
  const original = r.storage[fault]; r.storage[fault] = async () => { throw new Error(`unavailable ${fault}`); };
  first.t.clearRoom(); first.t.armRoom(Date.now()); await assert.doesNotReject(() => first.t.roomAlarm()); await Promise.all(first.pending);
  assert.equal(first.t.storageHealth.ok, false);
  r.storage[fault] = original; clearTimeout(first.t.alarmRetry); await first.t.roomAlarm(); await Promise.all(first.pending); r.close();
});

test('4200 ticks including round transitions remain deterministic across repeated restores', () => {
  const clock = fakeClock(); const c = compiled(); const full = host(c, clock); let restored = host(c, clock);
  full.join(); restored.join();
  try {
    for (let tick = 1; tick <= 4200; tick++) {
      full.h.tickNow(); restored.h.tickNow();
      assert.deepEqual(fromBytes(restored.h.save()), fromBytes(full.h.save()), `tick ${tick}`);
      if (tick < 40 || tick % 37 === 0 || tick % 1200 < 4) {
        const bytes = restored.h.save(); restored.h.stop(); restored = host(c, clock, { restore: bytes });
      }
    }
  } finally { full.h.stop(); restored.h.stop(); }
});

test('relay expiry also closes watch shells and an office-only wake still cleans an expired save', async () => {
  const r = storageRig(); const rig = await tableRig(r, entry()); connect(rig.room, 'a'); rig.t.hostRt.tickNow();
  const watcher = { closed: false, send() {}, close() { this.closed = true; } }; rig.room.watch(watcher);
  rig.t.start(); rig.room.forget(); assert.equal(watcher.closed, true); assert.equal(rig.t.timer, null); assert.equal(rig.t.room, null);
  const next = await tableRig(r, entry()); connect(next.room, 'a'); next.t.hostRt.tickNow(); next.t.saveRoom(next.t.hostRt.save()); next.t.hostRt.stop(); next.t.hostRt = null;
  const store = roomStore(r.storage); const saved = store.read(); saved.pausedAt = Date.now() - 61_000; store.write(saved);
  await next.t.roomAlarm(); assert.equal(store.read(), null); assert.equal(next.t.room, null); await Promise.all(next.pending); r.close();
});


test('a late first visitor to a cold expired named room is welcomed without a redirect', async () => {
  const r = storageRig(); const first = await tableRig(r, entry()); connect(first.room, 'a'); first.t.hostRt.tickNow(); first.t.saveRoom(first.t.hostRt.save()); first.t.hostRt.stop();
  const store = roomStore(r.storage); const saved = store.read(); saved.pausedAt = Date.now() - 61_000; store.write(saved);
  const next = await tableRig(r, entry()); const visitor = connect(next.room, 'a');
  assert.ok(visitor.welcome); assert.ok(!visitor.sent.some((m) => m.rematch)); assert.equal(next.t.hostRt.tick, 0); next.t.hostRt.stop(); r.close();
});


test('client frames cannot claim AI identity, a guide role, or the server policy', async () => {
  const r = storageRig(); const rig = await tableRig(r, entry());
  const refused = connect(rig.room, 'a', null, { agent: { role: 'guide', hands: 'host' } });
  assert.equal(refused.sent[0].code, 'agent-pass');
  const person = connect(rig.room, 'a', null, { peer: { agent: { role: 'guide' } }, policy: { bots: 'off', level: 5 } });
  rig.t.hostRt.tickNow();
  const before = rig.t.hostRt.core.save().policy;
  person.socket.onMessage(JSON.stringify({ t: 'policy', policy: { bots: 'off', level: 5 } }));
  person.socket.onMessage(JSON.stringify({ t: 'join', peer: { seat: 0, agent: { role: 'guide' } } }));
  rig.t.hostRt.tickNow();
  assert.equal(rig.t.hostRt.core.bodyOf(0).driver, 'person');
  assert.deepEqual(rig.t.hostRt.core.save().policy, before); rig.t.hostRt.stop(); r.close();
});


test('T2 instrumentation uses real Table saves of exact sizes and labels their outgoing snapshots', async () => {
  for (const size of [4000, 64000, 1_000_000, 3_000_000]) {
    const r = storageRig(); const rig = await tableRig(r, entry(), { Klass: MeasuredTable, code: `saving-${size}-test`, preview: '1' });
    const player = connect(rig.room, 'a');
    for (let i = 0; i < 40; i++) rig.t.hostRt.tickNow();
    const measured = player.sent.filter((m) => m.t === 'snap' && m.measure?.saved);
    assert.ok(measured.length >= 2); assert.ok(measured.every((m) => m.measure.bytes === size));
    assert.equal(r.storage.sql.exec('SELECT SUM(length(data)) AS bytes FROM save').toArray()[0].bytes, size);
    rig.t.hostRt.stop(); r.close();
  }
});


test('a damaged boot counter without a save does not prevent a fresh room', async () => {
  const r = storageRig(); roomStore(r.storage).boot({ epoch: 'bad', count: -1 });
  const rig = await tableRig(r, entry()); assert.ok(rig.t.hostRt); assert.ok(connect(rig.room, 'a').welcome); rig.t.hostRt.stop(); r.close();
});


test('a synchronous key deletion failure still closes every socket at room end', async () => {
  const r = storageRig(); const rig = await tableRig(r, entry()); const player = connect(rig.room, 'a');
  const watcher = { closed: false, send() {}, close() { this.closed = true; } }; rig.room.watch(watcher);
  const original = r.storage.delete; r.storage.delete = () => { throw new Error('synchronous deletion failed'); };
  try {
    assert.doesNotThrow(() => rig.t.endHosted('fault'));
    await Promise.all(rig.pending);
    assert.ok(player.conn.closed); assert.ok(watcher.closed); assert.equal(rig.t.hostRt, null);
    assert.equal(rig.t.storageHealth.ok, false);
  } finally { r.storage.delete = original; await rig.t.roomAlarm(); await Promise.all(rig.pending); r.close(); }
});

for (const [updates, seconds] of [[10, 10], [30, 5]]) test(`${updates} updates ${seconds} seconds apart keep the match and seats`, async () => {
  const r = storageRig(); const clock = tableClock();
  let live;
  try {
    live = await tableRig(r, entry());
    const tokens = [connect(live.room, 'a').welcome.token, connect(live.room, 'a').welcome.token];
    for (let n = 1; n <= updates; n++) {
      const before = live.t.hostRt.tick; clock.advance(seconds * 1000);
      assert.ok(live.t.hostRt.tick >= before + seconds * 20, 'scheduled ticks advance throughout each update interval');
      live.t.saveRoom(live.t.hostRt.save());
      const tick = live.t.hostRt.tick; live.t.hostRt.stop();
      // Even two replacements before ten seconds of ticking are explained by a new build.
      roomStore(r.storage).boot({ epoch: live.t.hostRt.epoch, count: 2 });
      live = await tableRig(r, entry(`v${n}`));
      assert.equal(live.t.hostRt.tick, tick);
      tokens.forEach((token, seat) => assert.equal(connect(live.room, `v${n}`, token).welcome?.seat, seat));
      assert.equal(roomStore(r.storage).boots().count, 0);
      clock.advance(50); assert.equal(live.t.hostRt.tick, tick + 1);
      assert.equal(roomStore(r.storage).boots().count, 0, 'a deploy never increments the crash count');
    }
  } finally { live?.t.hostRt?.stop(); clock.restore(); r.close(); }
});

for (const kind of ['watcher', 'silent', 'stale']) test(`a never started room opened by ${kind} ends once`, async () => {
  const r = storageRig(); const realNow = Date.now; let now = realNow(); Date.now = () => now;
  let rig;
  try {
    rig = await tableRig(r, entry());
    if (kind === 'silent') rig.room.attach({ send() {}, close() {}, buffered: () => 0 });
    else connect(rig.room, kind === 'stale' ? 'old' : 'a', null, { watch: true });
    now += 60_001; await rig.t.roomAlarm();
    assert.equal(rig.t.hostRt, null);
    const alarm = rig.t.roomAlarmAt;
    now += 60_001; await rig.t.roomAlarm(); assert.equal(rig.t.roomAlarmAt, alarm);
  } finally { rig?.t.hostRt?.stop(); Date.now = realNow; r.close(); }
});

for (const field of ['at', 'pausedAt']) test(`future ${field} cannot restore a match`, async () => {
  const r = storageRig(); const first = await tableRig(r, entry()); connect(first.room, 'a'); first.t.hostRt.tickNow(); first.t.saveRoom(first.t.hostRt.save()); first.t.hostRt.stop();
  const store = roomStore(r.storage); const value = store.read(); value[field] = Date.now() + 3600_000; store.write(value);
  const next = await tableRig(r, entry());
  try { assert.equal(next.t.hostRt.tick, 0); } finally { next.t.hostRt.stop(); r.close(); }
});

test('failed deletion leaves a durable retirement and retries with backoff', async () => {
  const r = storageRig(); const rig = await tableRig(r, entry()); connect(rig.room, 'a'); rig.t.hostRt.tickNow(); rig.t.saveRoom(rig.t.hostRt.save());
  const exec = r.storage.sql.exec; r.storage.sql.exec = (q, ...a) => { if (q.startsWith('DELETE')) throw new Error('deletes unavailable'); return exec(q, ...a); };
  rig.t.endHosted('fault'); await Promise.all(rig.pending);
  const first = rig.t.roomAlarmAt; await rig.t.roomAlarm(); assert.ok(rig.t.roomAlarmAt > first);
  r.storage.sql.exec = exec;
  const next = await tableRig(r, entry());
  try { assert.equal(next.t.hostRt.tick, 0); } finally { next.t.hostRt.stop(); r.close(); }
});

test('failed SQL writes preserve retirement in key-value storage across eviction', async () => {
  const r = storageRig(); const rig = await tableRig(r, entry()); connect(rig.room, 'a'); rig.t.hostRt.tickNow(); rig.t.saveRoom(rig.t.hostRt.save());
  const exec = r.storage.sql.exec; r.storage.sql.exec = (q, ...a) => { if (/^(INSERT|DELETE|UPDATE)/.test(q)) throw new Error('deletes unavailable'); return exec(q, ...a); };
  rig.t.endHosted('fault'); await Promise.all(rig.pending);
  const first = rig.t.roomAlarmAt; await rig.t.roomAlarm(); assert.ok(rig.t.roomAlarmAt > first);
  r.storage.sql.exec = exec;
  const next = await tableRig(r, entry());
  try { assert.equal(next.t.hostRt.tick, 0); } finally { next.t.hostRt.stop(); r.close(); }
});

test('saved AI goals use the bounded plain-value boundary', () => {
  const rig = host(compiled(), fakeClock()); rig.join(); rig.h.tickNow();
  const saved = fromBytes(rig.h.save()); rig.h.stop();
  saved.core.ents[0][15] = { action: 'collect', target: [1, 2] };
  assert.throws(() => host(compiled(), fakeClock(), { restore: new TextEncoder().encode(JSON.stringify(saved)) }), /invalid/, 'a malformed saved goal is refused, never silently erased');
  saved.core.ents[0][15] = { action: 'x'.repeat(257) };
  assert.throws(() => host(compiled(), fakeClock(), { restore: new TextEncoder().encode(JSON.stringify(saved)) }), /invalid/);
});

test('a host end logs exactly once', async () => {
  const r = storageRig(); const rig = await tableRig(r, entry()); const logs = []; rig.t.say = m => logs.push(m);
  rig.t.endHosted('overrun');
  assert.deepEqual(logs.filter(m => m.ev === 'host-over').map(m => m.why), ['overrun']);
  await Promise.all(rig.pending); assert.ok(!r.deletes.includes('ended'), 'no obsolete key writes on wake or end'); r.close();
});

for (const [updates, seconds] of [[10, 10], [30, 5]]) test(`real page scripts and Table survive ${updates} updates at ${seconds} seconds`, async () => {
  const r = storageRig(); const clock = tableClock();
  let live; const pages = [];
  try {
    live = await tableRig(r, entry(), { code: 'friends' });
    for (const watch of [false, false, true]) {
      const page = await shell('?room=friends', { watch, timers: { setTimeout: clock.setTimer, clearTimeout: clock.clearTimer } });
      const client = { page, watch, token: null, seat: null, version: 'a', src: page.el('iframe.game').src };
      const land = () => {
        const url = new URL(client.src, 'https://example.test');
        assert.equal(url.searchParams.get('room'), 'friends');
        const c = connect(live.room, client.version, url.searchParams.get('k'), { watch });
        assert.ok(c.welcome, JSON.stringify(c.sent));
        if (!watch && client.token) { assert.equal(c.welcome.token, client.token); assert.equal(c.welcome.seat, client.seat); }
        client.token = c.welcome.token; client.seat = c.welcome.seat;
        page.fromGame({ what: 'token', token: client.token, seat: client.seat });
        // Deliver after the frame's load, as postMessage does in the browser.
        queueMicrotask(() => page.fromGame({ what: 'build', ver: client.version }));
      };
      Object.defineProperty(page.el('iframe.game'), 'src', { get: () => client.src, set(v) { client.src = v; land(); } });
      land(); pages.push(client);
    }
    await Promise.resolve();
    for (let n = 1; n <= updates; n++) {
      const before = live.t.hostRt.tick; clock.advance(seconds * 1000);
      assert.ok(live.t.hostRt.tick >= before + seconds * 20);
      live.t.saveRoom(live.t.hostRt.save()); const tick = live.t.hostRt.tick; live.t.hostRt.stop();
      const ver = `v${n}`; live = await tableRig(r, entry(ver), { code: 'friends' });
      for (const client of pages) {
        const refused = connect(live.room, client.version, client.token, { watch: client.watch });
        assert.equal(refused.sent[0].code, 'stale');
        client.version = ver;
        client.page.fromGame({ what: 'stale', ver, immediate: true });
      }
      await Promise.resolve();
      assert.equal(live.t.hostRt.tick, tick); clock.advance(50); assert.equal(live.t.hostRt.tick, tick + 1);
      for (const c of pages) assert.equal(c.page.ctx[c.watch ? '__watch' : '__shell'].room, 'friends');
    }
  } finally { live?.t.hostRt?.stop(); clock.restore(); r.close(); }
});

test('an old active save is not evidence that people left', async () => {
  const r = storageRig(); const first = await tableRig(r, entry()); const person = connect(first.room, 'a');
  first.t.hostRt.tickNow(); first.t.saveRoom(first.t.hostRt.save()); first.t.hostRt.stop();
  const store = roomStore(r.storage); const value = store.read(); value.at -= 3600_000; store.write(value); await Promise.all(first.pending);
  const next = await tableRig(r, entry('new'));
  try {
    assert.equal(next.t.hostRt.tick, 1);
    assert.equal(connect(next.room, 'new', person.welcome.token).welcome.seat, 0);
    assert.equal(store.read().pausedAt, null, 'resuming persists the cleared pause before another replacement');
  } finally { next.t.hostRt.stop(); r.close(); }
});

test('failed legacy-key cleanup also backs off', async () => {
  const r = storageRig(); const rig = await tableRig(r, entry());
  r.storage.delete = async () => { throw new Error('key deletion unavailable'); };
  rig.t.endHosted('fault'); await Promise.all(rig.pending);
  const first = rig.t.roomAlarmAt; await rig.t.roomAlarm(); await Promise.all(rig.pending);
  assert.ok(rig.t.roomAlarmAt > first); r.close();
});

function tableClock() {
  const originals = { now: Date.now, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const clock = fakeClock(Date.now());
  Date.now = clock.now; globalThis.setTimeout = clock.setTimer; globalThis.clearTimeout = clock.clearTimer;
  return { ...clock, jump(ms) { clock.t += ms; }, restore() { Date.now = originals.now; globalThis.setTimeout = originals.setTimeout; globalThis.clearTimeout = originals.clearTimeout; } };
}

for (const by of ['ai', 'local', 'floor']) test(`a saved ${by} answer crosses the same bounded data boundary`, () => {
  const base = rules();
  const def = defineRules({ ...base, asks: { next: { state: {}, questions: {}, floor: () => ({ go: true }) } }, entities: { runner: { ...base.entities.runner, tick(w) { w.ask('next', {}); } } } });
  const rig = host(compiled(def), fakeClock(), { check: true }); rig.join(); rig.h.tickNow(); rig.h.tickNow();
  const saved = fromBytes(rig.h.save()); rig.h.stop();
  const answer = [saved.core.tick + 1, 0, '', saved.core.seq++, '', 'room', 'answer', { ask: 'next', by: 'floor', picks: { go: true } }, saved.core.tick, 1];
  saved.core.queue.push(answer);
  answer[7].by = by; delete answer[7].why;
  const back = host(compiled(def), fakeClock(), { restore: new TextEncoder().encode(JSON.stringify(saved)) });
  back.h.stop();
  answer[7].picks = { go: 'x'.repeat(257) };
  assert.throws(() => host(compiled(def), fakeClock(), { restore: new TextEncoder().encode(JSON.stringify(saved)) }), /invalid/);
});

for (const field of ['at', 'pausedAt']) test(`small future ${field} clock skew is clamped`, async () => {
  const r = storageRig(); const rig = await tableRig(r, entry()); connect(rig.room, 'a'); rig.t.hostRt.tickNow(); rig.t.saveRoom(rig.t.hostRt.save()); rig.t.hostRt.stop();
  const store = roomStore(r.storage); const value = store.read(); value[field] = Date.now() + 4000; store.write(value);
  const saved = rig.t.readRoom(); assert.ok(saved[field] <= Date.now());
  r.close();
});

for (const faultMs of [1, 30000]) test(`a cold alarm write failure for ${faultMs} ms preserves the active match`, async () => {
  const r = storageRig(), clock = tableClock(); let next;
  try {
    const first = await tableRig(r, entry()); const p = connect(first.room, 'a'); clock.advance(5000); first.t.saveRoom(first.t.hostRt.save()); const tick = first.t.hostRt.tick; first.t.hostRt.stop(); first.t.hostRt = null; first.t.room = null;
    const exec = r.storage.sql.exec; const until = clock.now() + faultMs;
    r.storage.sql.exec = (q, ...args) => { if (clock.now() < until && q.startsWith('INSERT INTO save')) throw new Error('write unavailable'); return exec(q, ...args); };
    await first.t.roomAlarm(); assert.ok(!first.t.cleanupPending);
    clock.advance(faultMs); await first.t.roomAlarm(); assert.ok(roomStore(r.storage).read());
    next = await tableRig(r, entry()); connect(next.room, 'a', p.welcome.token); assert.equal(next.t.hostRt.tick, tick);
  } finally { next?.t.hostRt?.stop(); clock.restore(); r.close(); }
});

test('watchers cannot renew the absence by restoring an active save repeatedly', async () => {
  const r = storageRig(), clock = tableClock(); let live;
  try {
    live = await tableRig(r, entry()); connect(live.room, 'a'); clock.advance(2000); live.t.saveRoom(live.t.hostRt.save()); live.t.hostRt.stop();
    live = await tableRig(r, entry()); connect(live.room, 'a', null, { watch: true });
    const pause = roomStore(r.storage).read().pausedAt; assert.equal(pause, clock.now());
    clock.advance(50000); live.t.hostRt.stop(); live = await tableRig(r, entry()); connect(live.room, 'a', null, { watch: true });
    assert.equal(roomStore(r.storage).read().pausedAt, pause);
    clock.advance(10001); await live.t.roomAlarm(); assert.equal(roomStore(r.storage).read(), null); assert.equal(live.t.hostRt, null);
  } finally { live?.t.hostRt?.stop(); clock.restore(); r.close(); }
});

test('an active save without a stored alarm has a bounded lifetime after total write failure', async () => {
  const r = storageRig(), clock = tableClock(); let next;
  try {
    const first = await tableRig(r, entry()); const p = connect(first.room, 'a'); clock.advance(3000); first.t.saveRoom(first.t.hostRt.save());
    const exec = r.storage.sql.exec, put = r.storage.put, setAlarm = r.storage.setAlarm;
    r.storage.sql.exec = (q, ...args) => { if (/^(INSERT|DELETE|UPDATE)/.test(q)) throw new Error('allowance spent'); return exec(q, ...args); };
    r.storage.put = r.storage.setAlarm = async () => { throw new Error('allowance spent'); };
    p.socket.onClose(); first.t.hostRt.stop(); await Promise.all(first.pending); r.kv.delete('__alarm');
    clock.advance(86400000); r.storage.sql.exec = exec; r.storage.put = put; r.storage.setAlarm = setAlarm;
    next = await tableRig(r, entry()); assert.equal(next.t.hostRt.tick, 0);
  } finally { next?.t.hostRt?.stop(); clock.restore(); r.close(); }
});

for (const damage of ['duplicate body', 'wrong body', 'driver', 'position', 'policy key', 'occupied join', 'constructor command', 'constructor event', 'constructor area', 'long owner', 'long pending owner']) test(`a saved ${damage} inconsistency is refused`, () => {
  const rig = host(compiled(), fakeClock()); rig.join(); rig.h.frame({ t: 'join', peer: { seat: 1, occ: 2, name: 'Second' } }); rig.h.tickNow();
  const saved = fromBytes(rig.h.save()); rig.h.stop(); const c = saved.core;
  if (damage === 'duplicate body') c.seats[1][3] = c.seats[0][3];
  if (damage === 'wrong body') [c.seats[0][3], c.seats[1][3]] = [c.seats[1][3], c.seats[0][3]];
  if (damage === 'long pending owner') c.ops.push({ op: 'join', info: { seat: 3, driver: 'person', owner: 'x'.repeat(1000000) } });
  if (damage === 'long owner') { c.seats[0][2] = 'x'.repeat(1000000); c.ents.find(e => e[11] === 0)[13] = c.seats[0][2]; }
  if (damage === 'driver') c.ents.find(e => e[11] === 0)[12] = 'ai';
  if (damage === 'position') c.ents[0][7][0] = 1e9;
  if (damage === 'policy key') c.policy.extra = 'x'.repeat(1000000);
  if (damage === 'occupied join') c.ops.push({ op: 'join', info: { seat: 0, driver: 'person', owner: 'p999' } });
  if (damage === 'constructor command') c.ents[0][20].push({ name: 'constructor', data: {} });
  if (damage === 'constructor event') c.queue.push([10, 0, '', c.seq++, '', 'all', 'constructor', {}, 0, 0]);
  if (damage === 'constructor area') c.areas.push([0, '', c.seq++, { k: 's', at: { x: 0, y: 0, z: 0 }, r: 1 }, 'constructor', {}]);
  assert.throws(() => host(compiled(), fakeClock(), { restore: new TextEncoder().encode(JSON.stringify(saved)) }), /saved rules state is invalid/);
});

for (const person of ['none', 'stays', 'leaves']) for (const watcher of [false, true]) for (const ai of [false, true]) for (const origin of ['fresh', 'active', 'paused', 'twice']) test(`Table ends: person ${person}, watcher ${watcher}, AI ${ai}, ${origin}`, async () => {
  const r = storageRig(), clock = tableClock(); let live;
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.all(live.pending.splice(0)); };
  try {
    live = await tableRig(r, entry()); await settle();
    if (origin !== 'fresh') {
      const p = connect(live.room, 'a'); clock.advance(2000);
      if (origin === 'paused') p.socket.onClose();
      live.t.saveRoom(live.t.hostRt.save()); await settle(); live.t.hostRt.stop(); live = await tableRig(r, entry()); await settle();
      if (origin === 'twice') { clock.jump(20000); live.t.hostRt.stop(); live = await tableRig(r, entry()); await settle(); }
    }
    if (watcher) connect(live.room, 'a', null, { watch: true });
    const p = person === 'none' ? null : connect(live.room, 'a');
    if (ai) {
      const sent = []; const a = live.room.attach({ agent: { pass: '1234567890', role: 'party', hands: 'self', by: 'studio' }, send: x => sent.push(JSON.parse(x)), close() {}, buffered: () => 0 });
      a.onMessage(JSON.stringify({ t: 'hello', v: 1, ver: 'a', name: 'Helper', want: 'play' }));
      assert.ok(sent.some(m => m.t === 'welcome') || sent.some(m => m.code === 'agents-alone'));
    }
    clock.advance(50); if (person === 'leaves') p.socket.onClose(); await settle();
    const start = clock.now(); let fired = 0, ended = null;
    while (r.kv.has('__alarm') && clock.now() - start < 3 * 3600000) {
      clock.jump(Math.max(0, r.kv.get('__alarm') - clock.now())); r.kv.delete('__alarm'); fired++;
      await live.t.roomAlarm(); await settle();
      if (!live.t.hostRt && ended === null) ended = clock.now() - start;
      assert.ok(fired < 25, 'no endless alarm loop');
    }
    assert.equal(Boolean(live.t.hostRt), person === 'stays');
    if (person === 'stays') assert.ok(fired >= 18 && fired <= 21);
    else { assert.ok(ended !== null && ended <= 60000); if (person === 'leaves' || origin !== 'twice') assert.ok(ended >= 50000); assert.ok(fired <= 2); assert.equal(roomStore(r.storage).read(), null); assert.ok(!r.kv.has('__alarm')); }
  } finally { live?.t.hostRt?.stop(); clock.restore(); r.close(); }
});

test('a restored seat releases its departed holder name when the hold expires', async () => {
  const r = storageRig(), clock = tableClock(); let live;
  try {
    const base = rules(); const def = defineRules({ ...base, entities: { runner: { ...base.entities.runner, think() { return {}; }, player: { away: 'neutral', leave: 'bot' } } } });
    live = await tableRig(r, entry('a', def)); connect(live.room, 'a', null, { name: 'Departed' }); const p = connect(live.room, 'a', null, { name: 'Returning' });
    clock.advance(2000); live.t.saveRoom(live.t.hostRt.save()); live.t.hostRt.stop();
    live = await tableRig(r, entry('a', def)); connect(live.room, 'a', p.welcome.token, { name: 'Returning' });
    clock.advance(61000); live.room.tick(); live.t.hostRt.tickNow();
    const saved = fromBytes(live.t.hostRt.save()); assert.ok(!saved.names.some(([seat, name]) => seat === 0 && name === 'Departed'));
  } finally { live?.t.hostRt?.stop(); clock.restore(); r.close(); }
});

for (const field of ['names', 'queues', 'inputs']) test(`saved ${field} cannot assign one seat twice`, () => {
  const rig = host(compiled(), fakeClock()); rig.join(); rig.h.tickNow();
  rig.h.frame({ t: 'in', from: 0, e: rig.h.epoch, r: 0, k: 3, s: [[0, 1, 0]] });
  const saved = fromBytes(rig.h.save()); rig.h.stop(); assert.ok(saved[field].length); saved[field].push(saved[field][0]);
  assert.throws(() => host(compiled(), fakeClock(), { restore: new TextEncoder().encode(JSON.stringify(saved)) }), /invalid/);
});

test('two saved seats cannot share a reconnect token', async () => {
  const r = storageRig(); let next;
  try {
    const first = await tableRig(r, entry()); connect(first.room, 'a'); connect(first.room, 'a'); first.t.hostRt.tickNow(); first.t.saveRoom(first.t.hostRt.save()); first.t.hostRt.stop();
    const store = roomStore(r.storage), saved = store.read(); saved.net.seats[1][1] = saved.net.seats[0][1]; store.write(saved);
    next = await tableRig(r, entry()); assert.equal(next.t.hostRt.tick, 0);
  } finally { next?.t.hostRt?.stop(); r.close(); }
});

test('a failed alarm read during construction does not discard or strand a saved match', async () => {
  const r = storageRig(); let next;
  try {
    const first = await tableRig(r, entry()); connect(first.room, 'a'); first.t.hostRt.tickNow(); first.t.saveRoom(first.t.hostRt.save()); first.t.hostRt.stop();
    const read = r.storage.getAlarm; let fail = true;
    r.storage.getAlarm = async () => { if (fail) { fail = false; throw new Error('alarm read unavailable'); } return read(); };
    next = await tableRig(r, entry()); assert.equal(next.t.hostRt.tick, 1); assert.ok(connect(next.room, 'a').welcome);
  } finally { next?.t.hostRt?.stop(); r.close(); }
});

for (const recoveryMs of [0, 5000]) for (const firstPauseFails of [false, true]) test(`a restore pause cannot expire people after refused writes and ${recoveryMs} ms recovery, first pause fails ${firstPauseFails}`, async () => {
  const r=storageRig(), clock=tableClock(); let live;
  try {
    live=await tableRig(r,entry()); const p=connect(live.room,'a'); clock.advance(5000); live.t.saveRoom(live.t.hostRt.save()); const tick=live.t.hostRt.tick; live.t.hostRt.stop();
    const originalExec = r.storage.sql.exec; let failOnce = firstPauseFails;
    r.storage.sql.exec = (q,...args) => { if (failOnce && q.startsWith('INSERT INTO save')) { failOnce = false; throw new Error('first pause write refused'); } return originalExec(q,...args); };
    live=await tableRig(r,entry()); await Promise.all(live.pending);
    const exec=r.storage.sql.exec; r.storage.sql.exec=(q,...args)=>{ if (/^(INSERT|UPDATE|DELETE)/.test(q)) throw new Error('writes refused'); return exec(q,...args); };
    connect(live.room,'a',p.welcome.token); await Promise.all(live.pending); clock.advance(70000);
    r.storage.sql.exec=exec; clock.advance(recoveryMs); live.t.hostRt.stop(); clearTimeout(live.t.saveRetry);
    const last = roomStore(r.storage).read();
    live=await tableRig(r,entry()); assert.ok(live.t.hostRt.tick >= tick, JSON.stringify({ health: live.t.storageHealth, pause: last.pausedAt, provisional: last.pauseFromRestore, tick: last.host.core.tick })); connect(live.room,'a',p.welcome.token);
  } finally { live?.t.hostRt?.stop(); clock.restore(); r.close(); }
});

for (const why of ['fault', 'owner']) test(`an ended ${why} room reasserts retirement when all writes return`, async () => {
  const r=storageRig(), clock=tableClock(); let live;
  try {
    live=await tableRig(r,entry()); connect(live.room,'a'); clock.advance(3000); live.t.saveRoom(live.t.hostRt.save()); await Promise.all(live.pending);
    const exec=r.storage.sql.exec, put=r.storage.put, alarm=r.storage.setAlarm, del=r.storage.delete;
    r.storage.sql.exec=(q,...args)=>{ if (/^(INSERT|UPDATE|DELETE)/.test(q)) throw new Error('writes refused'); return exec(q,...args); };
    r.storage.put=r.storage.setAlarm=r.storage.delete=async()=>{ throw new Error('writes refused'); };
    if (why === 'fault') live.t.endHosted('fault'); else live.room.control('close', {});
    for(let i=0;i<5;i++) await Promise.all(live.pending.splice(0));
    // No new visitor or alarm is needed to retry the forgotten end.
    r.storage.sql.exec=exec; r.storage.put=put; r.storage.setAlarm=alarm; r.storage.delete=del;
    clock.advance(120000); for(let i=0;i<5;i++) await Promise.all(live.pending.splice(0));
    live=await tableRig(r,entry()); assert.equal(live.t.hostRt.tick,0);
  } finally { live?.t.hostRt?.stop(); clock.restore(); r.close(); }
});

test('a reserved AI seat cannot carry a saved holder name', () => {
  const rig = host(compiled(), fakeClock()); rig.join(); rig.h.tickNow();
  const saved = fromBytes(rig.h.save()); rig.h.stop();
  const seat = saved.core.seats[0], body = saved.core.ents.find(e => e[0] === seat[3]);
  seat[1] = body[12] = 'ai'; seat[2] = body[13] = 'reserved';
  assert.throws(() => host(compiled(), fakeClock(), { restore: new TextEncoder().encode(JSON.stringify(saved)) }), /invalid/);
});

test('live owners use the same bounded representation as restored owners', () => {
  const rig = host(compiled(), fakeClock());
  rig.join(); rig.h.tickNow();
  rig.h.core.seatJoin({ seat: 3, driver: 'person', owner: 'x'.repeat(1000000) }); rig.h.tickNow();
  assert.ok(rig.h.core.bodies().find(b => b.seat === 3).owner.length <= 128);
  const back = host(compiled(), fakeClock(), { restore: rig.h.save() }); back.h.stop(); rig.h.stop();
});

test('a late failed end marker cannot retire the next successfully saved match', async () => {
  const r=storageRig(), clock=tableClock(); let live;
  try {
    live=await tableRig(r,entry()); connect(live.room,'a'); clock.advance(2000); live.t.saveRoom(live.t.hostRt.save()); await Promise.all(live.pending);
    const exec=r.storage.sql.exec, put=r.storage.put; let reject;
    r.storage.sql.exec=(q,...args)=>{ if (/^(INSERT|DELETE)/.test(q)) throw new Error('writes refused'); return exec(q,...args); };
    r.storage.put=()=>new Promise((resolve, no)=>{ reject=no; });
    live.t.finishRoom('fault'); await Promise.resolve(); assert.ok(reject);
    r.storage.sql.exec=exec; r.storage.put=put;
    const room=live.t.roomFor('test','pub-1',8); live.t.ensureHost(room,true); connect(room,'a'); clock.advance(1000); live.t.saveRoom(live.t.hostRt.save());
    const tick=live.t.hostRt.tick; reject(new Error('old end write failed'));
    for(let i=0;i<5;i++) await Promise.all(live.pending.splice(0));
    assert.equal(live.t.cleanupPending,false); clock.advance(2000); assert.ok(roomStore(r.storage).read().host.core.tick >= tick);
  } finally { live?.t.hostRt?.stop(); clock.restore(); r.close(); }
});

test('failure to remove an old key marker never clears a newer SQL save', async () => {
  const r=storageRig(), clock=tableClock(); let live;
  try {
    live=await tableRig(r,entry()); connect(live.room,'a'); clock.advance(1000); await Promise.all(live.pending);
    const exec=r.storage.sql.exec;
    r.storage.sql.exec=(q,...args)=>{ if (/^(INSERT|DELETE)/.test(q)) throw new Error('writes refused'); return exec(q,...args); };
    live.t.finishRoom('fault'); for(let i=0;i<5;i++) await Promise.all(live.pending.splice(0));
    const del=r.storage.delete; r.storage.sql.exec=exec; r.storage.delete=async()=>{ throw new Error('key deletion refused'); };
    const room=live.t.roomFor('test','pub-1',8); live.t.ensureHost(room,true); connect(room,'a'); clock.advance(1000); live.t.saveRoom(live.t.hostRt.save()); live.t.hostRt.stop();
    const saved=roomStore(r.storage).read(); for(let i=0;i<5;i++) await Promise.all(live.pending.splice(0));
    clock.advance(3000); await live.t.roomAlarm(); for(let i=0;i<5;i++) await Promise.all(live.pending.splice(0));
    assert.equal(roomStore(r.storage).read()?.host.core.tick,saved.host.core.tick);
    r.storage.delete=del; clock.advance(120000); for(let i=0;i<5;i++) await Promise.all(live.pending.splice(0));
    live=await tableRig(r,entry()); assert.equal(live.t.hostRt.tick,saved.host.core.tick);
  } finally { live?.t.hostRt?.stop(); clock.restore(); r.close(); }
});
