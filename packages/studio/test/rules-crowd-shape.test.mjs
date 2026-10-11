/**
 * The shape of a big room (0.46.2), on virtual time with seeded players: the room object runs the rules and hands
 * each Gate one world a tick; every Gate selects, encodes and paces its own players and sends the room ONE frame of
 * input a tick; diagnostics are read from an object that is neither. Nothing here opens a socket or waits on a
 * real clock: a real-time load run belongs in `npm run test:rules:extended`.
 *
 *   - a Gate's inputs leave as one frame a tick, timed to make the room's next tick, each once and in order;
 *   - a receipt's latency measures the link, not the cadence it waited for;
 *   - a player on a link that carries six frames a second stays within two seconds of the room and has their own
 *     body in every frame, where sending every tick leaves them further behind each second; a fast player keeps 20 Hz;
 *   - the room visits a Gate, not its players: one world a Gate a tick, one subscription a player;
 *   - a game with owner-only fields keeps each player's view in the room, Gates or not;
 *   - Homie paces no input of a server-hosted game; a studio's own `room.rates` does; a browser host keeps its caps;
 *   - a measurement is answered from the diagnostics object, with its age, and a busy room is not waited on;
 *   - 120 seeded players behind four Gates and a real rules host: everyone sees their own body every tick.
 * Run: node --test packages/studio/test/rules-crowd-shape.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GATE_PLAYERS, Gate, batchLink, deliveryPace, multiplexSession, nextGate, roomLayout } from '../worker/gate.mjs';
import { NetRoom } from '../worker/room.mjs';
import { roomDiagnostics } from '../worker/office.mjs';
import { crowdView, crowdWorlds, interestSnapshot, scheduledView, snapshotDecoder, snapshotEncoder, snapshotText } from '../rules/interest.mjs';
import { worldSink, worldSource } from '../worker/world-wire.mjs';
import { PKG, fakeClock, hostRig, loadGame } from './rules-kit.mjs';
import { virtualTime } from './virtual-time.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-crowd-shape-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

function socket() {
  const events = new Map();
  return { sent: [], accept() {}, addEventListener(t, fn) { const list = events.get(t) ?? []; list.push(fn); events.set(t, list); },
    emit(t, value) { for (const fn of events.get(t) ?? []) fn(value); }, send(text) { this.sent.push(text); }, close(code, reason) { this.closed = [code, reason]; this.emit('close', {}); } };
}
/** A seeded generator: the same players, the same jitter, every run. */
function seeded(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const tableOf = (upstream) => ({ TABLE: { idFromName: (n) => n, get: () => ({ fetch: async () => ({ webSocket: upstream }) }) } });
const request = (gate = 0) => new Request(`https://table/__net?game=g&room=r&gates=16&gate=${gate}`);
const runner = (seat, x, y, k) => [`r${seat}`, 0, 0, [x, y], [k % 7, 0], [1, 0], 0, [k, true], [], seat, 0];
const world = (k, seats, at = (seat) => [seat * 0.5, k * 0.01]) => ({ k, e: 7, st: Date.now(), d: [[1, 0, 0], seats.map((seat) => runner(seat, ...at(seat), k))], c: seats.map((seat) => [seat, 0, k]) });

test('Gates follow from the room\'s size and fill in order: a room opens only the Gates its players need', () => {
  assert.deepEqual(roomLayout(8), { gates: 1, concentrators: 0 });
  assert.deepEqual(roomLayout(64), { gates: 1, concentrators: 0 });
  assert.deepEqual(roomLayout(65), { gates: 2, concentrators: 0 });
  assert.deepEqual(roomLayout(300), { gates: 6, concentrators: 0 });
  assert.deepEqual(roomLayout(1000), { gates: 20, concentrators: 0 });
  // A thousand players arriving in a storm, each asked for before the last has reached its Gate.
  const held = new Map(), promised = new Map(), placed = [];
  for (let i = 0; i < 1000; i += 1) {
    const gate = nextGate(20, held, promised); placed.push(gate); promised.set(gate, (promised.get(gate) ?? 0) + 1);
    if (i % 7 === 6) for (const g of placed.splice(0)) { promised.set(g, promised.get(g) - 1); held.set(g, (held.get(g) ?? 0) + 1); }
    if (i === 49) assert.deepEqual([...new Set([...held.keys(), ...promised.keys()])], [0], 'fifty players are one Gate');
    if (i === 299) assert.equal(new Set([...held.keys(), ...promised.keys()].filter((g) => (held.get(g) ?? 0) + (promised.get(g) ?? 0) > 0)).size, 6);
  }
  for (const g of placed) held.set(g, (held.get(g) ?? 0) + 1);
  assert.deepEqual([...held.values()], Array(20).fill(GATE_PLAYERS), 'a full room is twenty full Gates');
  // Players leave Gate 3; the next to join take their places before any other Gate grows.
  held.set(3, 40); assert.equal(nextGate(20, held), 3);
  // A room over its seats (the count is the game's to enforce) spreads the extra on the least full.
  held.set(3, 50); held.set(7, 51); assert.equal(nextGate(20, held), 0);
});

test('a Gate sends the room at most one frame every 50 ms however many players it holds, at once when the channel is quiet, each input once and in order', async (t) => {
  const clock = virtualTime(t), random = seeded(11);
  const upstream = socket(), gate = new Gate({}, tableOf(upstream));
  const players = Array.from({ length: 50 }, socket), said = players.map(() => []);
  for (const p of players) await gate.connect(request(), p);
  for (const [i, p] of players.entries()) p.emit('message', { data: JSON.stringify({ t: 'hello', i }) });
  await clock.wait(200);
  const frames = []; let receipt = 0, receiptAt = 0, stamp = null;
  upstream.send = (text) => { const rows = JSON.parse(text); frames.push({ at: Date.now(), rows }); for (const row of rows) if (row[0] === 'receipt') { receipt = row[1]; receiptAt = Date.now(); stamp = row[2]; } };
  // A quiet channel: one input goes at once.
  players[0].emit('message', { data: JSON.stringify({ t: 'in', n: 0, at: Date.now() }) }); said[0].push(0);
  await clock.wait(2);
  assert.equal(frames.length, 1, 'nothing to wait for');
  const offsets = players.map(() => [Math.floor(random() * 50), Math.floor(random() * 50)]);
  const ticks = 100; let sequence = 0; const from = Date.now();
  for (let k = 1; k <= ticks; k += 1) {
    // The room acknowledges on the frame its tick sends, with how long it held the Gate's and both its clocks.
    upstream.emit('message', { data: JSON.stringify([...(receipt ? [['ack', receipt, Date.now() - receiptAt, [stamp, receiptAt + 7, Date.now() + 7]]] : []), ['world', '*', world(k, []), {}, 20], ['receipt', k, Date.now() + 7]]) });
    for (let ms = 0; ms < 50; ms += 1) {
      for (const [i, p] of players.entries()) for (const at of offsets[i]) if (at === ms) { const n = ++sequence; said[i].push(n); p.emit('message', { data: JSON.stringify({ t: 'in', e: 7, k: k + 3, n, at: Date.now() }) }); }
      await clock.wait(1);
    }
  }
  await clock.wait(120);
  const input = frames.filter((f) => f.rows.some((row) => row[0] === 'data' || row[0] === 'fan'));
  assert.ok(frames.length <= ticks + 4, `${frames.length} frames for ${ticks} ticks of 100 inputs each`);
  for (let i = 1; i < frames.length; i += 1) assert.ok(frames[i].at - frames[i - 1].at >= 50, 'never two within 50 ms');
  const heard = players.map(() => []); let worst = 0;
  for (const f of input) for (const row of f.rows) if (row[0] === 'data') { const m = JSON.parse(row[2]); heard[Number(row[1]) - 1].push(m.n); assert.equal(row[3], m.at, 'the Gate stamped the moment it arrived'); worst = Math.max(worst, f.at - m.at); }
  assert.deepEqual(heard, said, 'every input reached the room once, in the order its player sent it');
  assert.ok(worst <= 50, `an input waited ${worst} ms for its frame`);
  assert.deepEqual(frames.flatMap((f) => f.rows.filter((row) => row[0] === 'ack').map((row) => row[1])).at(-1), ticks, 'every world was acknowledged, on a frame that was going anyway');
  // The room's clock is 7 ms ahead of this Gate's in this test, and the Gate has measured it.
  const facts = gate.gateFacts(gate.link);
  assert.equal(facts.roomClock.offsetMs, 7); assert.equal(facts.roomClock.delayMs, 0);
  assert.ok(Math.abs(facts.roomTickHz - 20) < 0.5, `the room's ticks by this Gate's clock: ${facts.roomTickHz} a second`);
  assert.ok(Date.now() - from > 0);
  gate.link.disconnect();
});

test('a receipt that waited for its frame is not counted as a slow link', () => {
  const clock = fakeClock(), a = socket(), b = socket();
  const options = { setTimer: clock.setTimer, clearTimer: clock.clearTimer, now: clock.now, delay: 50, receipts: true, autoReceipt: false };
  const left = batchLink(a, options), right = batchLink(b, options);
  a.send = (text) => clock.setTimer(() => { const rows = JSON.parse(text); b.emit('message', { data: text }); right.consumed(rows, 38); }, 3);
  b.send = (text) => clock.setTimer(() => { a.emit('message', { data: text }); left.consumed(JSON.parse(text)); }, 3);
  left.send(['world', '*', { k: 1, d: [[], []] }, {}, 20]); left.flush();
  clock.advance(100);
  assert.equal(left.facts().inFlight, 0);
  assert.equal(left.facts().ackMs, 6, 'three milliseconds each way; the 38 ms the receipt waited for its frame are not the link');
  assert.equal(left.rtt(), 6, 'and that round trip is what a Gate times its input frame by');
  left.close(); right.close();
});

test('deliveryPace halves a lagging player down to one frame a second and restores a recovered one', () => {
  const pace = deliveryPace(20); let now = 0;
  assert.equal(pace.due(1), true); pace.sent(1); assert.equal(pace.due(2), true, 'a player who says nothing gets every tick');
  for (const interval of [2, 4, 8, 16, 20, 20]) { now += 500; pace.report(100, 200, now); assert.equal(pace.facts().interval, interval); }
  pace.sent(200); assert.equal(pace.due(219), false); assert.equal(pace.due(220), true);
  pace.report(215, 220, now + 400); assert.equal(pace.facts().interval, 20, 'not twice inside a second');
  for (const interval of [10, 5, 2.5, 1.25, 1, 1]) { now += 1000; pace.report(now, now + 5, now); assert.equal(pace.facts().interval, interval); }
  pace.report(15, 30, now + 5000); assert.equal(pace.facts().interval, 1, 'between half a second and a second behind: left alone');
  pace.report(900, 30, now + 9000); assert.equal(pace.facts().lag, null, 'a tick from before the room restarted says nothing');
});

/** One Gate, one world a tick, and players whose links carry `perSecond` frames (Infinity: all of them, at once). */
async function slowLinkRun(t, { reports }) {
  const clock = virtualTime(t);
  const upstream = socket(), gate = new Gate({}, tableOf(upstream));
  const seats = Array.from({ length: 40 }, (_, i) => i);
  const make = (seat, perSecond) => {
    const p = socket(), decoder = snapshotDecoder();
    const client = { seat, p, queue: [], held: null, frames: 0, ownMissing: 0, undecodable: 0, worstLag: 0 };
    p.send = (text) => { if (perSecond === Infinity) take(text); else client.queue.push(text); };
    const take = (text) => {
      const m = JSON.parse(text); if (m.t !== 'snap') return;
      const snap = decoder.decode(m);
      if (!snap) { client.undecodable += 1; return; }
      client.frames += 1; client.held = m.k;
      if (!snap.d[1].some((e) => e[9] === seat)) client.ownMissing += 1;
    };
    if (perSecond !== Infinity) setInterval(() => { const text = client.queue.shift(); if (text) take(text); }, Math.round(1000 / perSecond));
    return client;
  };
  const fast = make(0, Infinity), slow = make(1, 6);
  for (const c of [fast, slow]) { await gate.connect(request(), c.p); c.p.emit('message', { data: '{"t":"hello"}' }); }
  await clock.wait(60);
  upstream.emit('message', { data: JSON.stringify([['seat', '1', 0], ['seat', '2', 1]]) });
  const seconds = 30;
  for (let k = 1; k <= seconds * 20; k += 1) {
    upstream.emit('message', { data: JSON.stringify([['world', '*', world(k, seats, (seat) => [seat * 0.5, Math.sin(k / 9 + seat)]), { radiusM: 12 }, 20]]) });
    // Ten inputs a second, each naming the newest tick the player holds (the toolkit's client, 0.46.2).
    if (k % 2 === 0) for (const c of [fast, slow]) if (c.held !== null) c.p.emit('message', { data: JSON.stringify({ t: 'in', e: 7, k: c.held + 3, s: [[0, 1, 0]], r: 0, ...(reports ? { g: c.held } : {}) }) });
    await clock.wait(50);
    if (k > 200 && slow.held !== null) slow.worstLag = Math.max(slow.worstLag, k - slow.held);
  }
  const facts = gate.gateFacts(gate.link);
  gate.link.disconnect();
  return { fast, slow, facts, ticks: seconds * 20 };
}
test('a player on a slow link is sent fewer, fresher frames: never more than two seconds behind, their own body in each', async (t) => {
  const { fast, slow, ticks } = await slowLinkRun(t, { reports: true });
  assert.equal(fast.frames, ticks, 'a player whose link keeps up is sent every tick');
  assert.ok(slow.worstLag <= 40, `the slow player fell ${slow.worstLag} ticks behind`);
  assert.equal(slow.undecodable, 0, 'a delta is from the last frame SENT: a skipped tick breaks nothing');
  assert.equal(slow.ownMissing + fast.ownMissing, 0, 'own body in every frame');
  assert.ok(slow.frames >= 30 * 2, 'and they are still sent at least two frames a second');
});
test('without the player saying what it holds, every tick is sent and the same link falls behind for good', async (t) => {
  const { slow, ticks } = await slowLinkRun(t, { reports: false });
  assert.ok(slow.worstLag > 300, `an older client on that link is ${slow.worstLag} ticks behind after thirty seconds`);
  assert.ok(slow.queue.length > 300 && slow.frames < ticks / 2, 'as before 0.46.2: nothing is dropped, everything is late');
});

test('the room hands each Gate one world a tick and names each player to it once', () => {
  const room = new NetRoom({ maxPlayers: 1000 }); let worlds = 0, subscriptions = 0, perPlayer = 0;
  const groups = Array.from({ length: 16 }, () => ({ snapshot() { worlds += 1; } }));
  const clients = Array.from({ length: 1000 }, (_, seat) => ({ seat, conn: { snapshotGroup: groups[seat % 16], subscribe() { subscriptions += 1; }, send() { perPlayer += 1; } } }));
  room.server = { viewSettings: { radiusM: 12 }, privateDelivery: false }; room.live = () => clients; room.lite = () => false;
  for (let k = 1; k <= 20; k += 1) room.hostSnap(null, { k, e: 1, d: [[], []] }, k * 50);
  assert.equal(worlds, 320); assert.equal(subscriptions, 1000); assert.equal(perPlayer, 0, 'nothing is selected, encoded or written per player in the room');
  clients[5].seat = 2000; room.hostSnap(null, { k: 21, e: 1, d: [[], []] }, 1050);
  assert.equal(subscriptions, 1001, 'a player who changes seat is named again, alone');
});

test('a game with owner-only fields keeps every player\'s view in the room, behind Gates as in front of them', () => {
  const room = new NetRoom({ maxPlayers: 1000 }); let worlds = 0; const sent = [];
  const group = { snapshot() { worlds += 1; } };
  const clients = [0, 1].map((seat) => ({ seat, conn: { snapshotGroup: group, subscribe() { throw new Error('a private view is never delegated'); }, send(text) { sent.push([seat, JSON.parse(text)]); }, buffered: () => 0 } }));
  const secret = (seat, k) => [`r${seat}`, 0, 0, [seat, 0], [0, 0], [1, 0], 0, [`secret-of-${seat}`], [], seat, 0];
  room.server = { viewSettings: {}, viewRadiusM: null, privateDelivery: true,
    projectSnapshot: (snap, seat) => ({ ...snap, d: [snap.d[0], snap.d[1].map((row) => row[9] === seat ? row : [...row.slice(0, 7), [null], ...row.slice(8)])] }) };
  room.tickHz = 20; room.live = () => clients; room.lite = () => false;
  room.hostSnap(null, { k: 1, e: 1, d: [[1, 0, 0], [secret(0, 1), secret(1, 1)]], c: [] }, 50);
  assert.equal(worlds, 0);
  assert.equal(sent.length, 2);
  for (const [seat, snap] of sent) for (const row of snap.d[1]) assert.deepEqual(row[7], row[9] === seat ? [`secret-of-${seat}`] : [null]);
});

test('Homie paces no input of a server-hosted game; a studio\'s own rate does; a browser host keeps its caps', async () => {
  const base = () => { const room = Object.create(NetRoom.prototype); Object.assign(room, { seatCap: 1000, rules: true, rates: null, stats: { drops: 0, oversize: 0 }, now: () => 100_000, roleOf: () => 'replica', send: () => {}, error: () => {}, kick: () => {} }); return room; };
  const client = () => ({ id: 'p', seat: 0, rates: new Map(), drops: [], errAt: 0 });
  const hosted = base(); hosted.server = {};
  // Ten seconds of honest 10 Hz input and a second of events that one stalled TCP connection delivered at once.
  const late = client();
  for (let i = 0; i < 1000; i += 1) assert.equal(hosted.allow(late, 'in', 60, false, 10_000), true);
  for (let i = 0; i < 100; i += 1) assert.equal(hosted.allow(late, 'ev', 60, false, 10_000, 'pickup'), true);
  for (let i = 0; i < 50; i += 1) assert.equal(hosted.allow(late, 'ping', 60, false, 10_000), true);
  assert.equal(hosted.stats.drops, 0);
  // What players say to each other is still paced: ten lines a second from a seat.
  const loud = client();
  for (let i = 0; i < 10; i += 1) assert.equal(hosted.allow(loud, 'ev', 60, false, 10_000, 'say:hello'), true);
  assert.equal(hosted.allow(loud, 'ev', 60, false, 10_000, 'say:hello'), false);
  // The studio's own pace, from game.json.
  const chosen = base(); chosen.server = {}; chosen.rates = { in: 60 };
  const abusive = client();
  for (let i = 0; i < 60; i += 1) assert.equal(chosen.allow(abusive, 'in', 60, false, 10_000), true);
  assert.equal(chosen.allow(abusive, 'in', 60, false, 10_000), false);
  assert.equal(chosen.allow(abusive, 'in', 60, false, 1), false, 'a clock that runs backwards opens no new window');
  // A browser-hosted room is as it was: its host is somebody's phone.
  const phone = base(); const guest = client();
  for (let i = 0; i < 60; i += 1) assert.equal(phone.allow(guest, 'in', 60, false, 10_000), true);
  assert.equal(phone.allow(guest, 'in', 60, false, 10_000), false);
  phone.rates = { in: 0 }; const freed = client();
  for (let i = 0; i < 500; i += 1) assert.equal(phone.allow(freed, 'in', 60, false, 10_000), true, 'and a studio may lift that one too');
});

test('room.rates is a game.json setting: read, held to numbers, absent unless written', async () => {
  const L = await loadGame(scratch, join(PKG, 'test/fixtures/crowd-circuit/game'), 'crowd-rates');
  const none = L.R.roomSettings({ host: 'server' });
  assert.equal('rates' in none.settings, false); assert.deepEqual(none.problems, []);
  const some = L.R.roomSettings({ host: 'server', rates: { in: 60, ev: 0 } });
  assert.deepEqual(some.settings.rates, { in: 60, ev: 0 }); assert.deepEqual(some.problems, []);
  const bad = L.R.roomSettings({ rates: { in: 'fast', 'Not A Kind': 4, ev: -1, ping: 4 } });
  assert.deepEqual(bad.settings.rates, { ping: 4 }); assert.equal(bad.problems.length, 3);
  assert.equal(L.R.roomSettings({ rates: [60] }).problems.length, 1);
});

test('a measurement is answered by the diagnostics object, with its age; a busy room is not waited on', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 50_000 });
  const keeper = new Gate({}, { TABLE: { get() { throw new Error('the diagnostics object never asks the room'); } } });
  const post = (body) => keeper.fetch(new Request('https://diagnostics/__diagnostics', { method: 'POST', body: JSON.stringify(body) }));
  await post({ room: 'r', st: 49_000, counts: { players: 600 }, ticks: { tick: 400 }, tickRate: 20, inputTransitMs: { n: 6000, p50: 14, p95: 41, max: 60 } });
  await post({ kind: 'gate', id: 'gate/10', at: 49_500, clients: 38, deliveredHz: 19.9 });
  await post({ kind: 'gate', id: 'gate/2', at: 49_500, clients: 37, deliveredHz: 20 });
  await post({ kind: 'gate', id: 'gate/3', at: 30_000, clients: 1, deliveredHz: 20 });
  let asked = 0, answer = () => new Promise(() => {});
  const env = {
    GATE: { idFromName: (n) => n, get: (name) => { assert.equal(name, 'g/r/diagnostics'); return { fetch: (input, init) => keeper.fetch(new Request(input, init)) }; } },
    TABLE: { idFromName: (n) => n, get: () => ({ fetch: () => { asked += 1; return answer(); } }) },
  };
  const fresh = await roomDiagnostics(env, 'g', 'r', 1000);
  assert.equal(asked, 0, 'a fresh copy is the answer');
  assert.equal(fresh.tickRate, 20); assert.equal(fresh.counts.players, 600); assert.equal(fresh.diagnostics.ageMs, 1000);
  assert.deepEqual(fresh.gates.map((g) => g.id), ['gate/2', 'gate/10'], 'a Gate that stopped reporting is not shown as live');
  // The room stops posting (it is stalled, or gone): it is asked once, for a second and a half, and the copy is the answer with its age.
  t.mock.timers.tick(10_000);
  const pending = roomDiagnostics(env, 'g', 'r', 1000);
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(1500);
  const stale = await pending;
  assert.equal(asked, 1); assert.equal(stale.diagnostics.ageMs, 11_000); assert.equal(stale.counts.players, 600);
  // A room that answers is believed over an old copy.
  answer = async () => Response.json({ st: 61_500, counts: { players: 2 }, gates: [] });
  const direct = await roomDiagnostics(env, 'g', 'r', 1000);
  assert.equal(direct.counts.players, 2); assert.equal(direct.diagnostics.cached, false);
  // A small room has no Gates and no diagnostics object: it answers for itself, as it always has.
  const small = await roomDiagnostics({ ...env, GATE: { get() { throw new Error('no diagnostics object for a small room'); } } }, 'g', 'r', 8);
  assert.equal(small.counts.players, 2);
});

// A channel of 3 ms each way, and one of 10: the Gate times its frame by the round trip it measures, so both make the tick.
for (const hop of [3, 10]) test(`120 seeded players behind four Gates and a real rules host, ${hop} ms from the room: own body every tick, inputs on time, one frame a Gate a tick`, async (t) => {
  const dir = join(PKG, 'test/fixtures/crowd-circuit/game');
  const L = await loadGame(scratch, dir, `crowd-shape-${hop}`);
  const game = JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8'));
  const compiled = L.R.compileRules(L.def, { tune: JSON.parse(readFileSync(join(dir, 'tunables.json'), 'utf8')), settings: L.R.roomSettings(game.room).settings, seats: 1000, map: L.R.compileMap({ ...JSON.parse(readFileSync(join(dir, 'map/main.json'), 'utf8')), name: 'main' }, 'main') });
  const clock = virtualTime(t), random = seeded(20261010);
  const timers = { now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (id) => clearTimeout(id) };
  const room = new NetRoom({ code: 'r', maxPlayers: 1000, now: timers.now, log() {}, rules: true });
  const host = L.H.createHost({ game: 'test', compiled, clock: timers, send: (m, text) => room.hostFrame(m, text), log() {}, random });
  room.setServerHost(host);
  const beat = setInterval(() => room.tick(), 250);
  t.after(() => { clearInterval(beat); host.stop(); });

  const GATES = 4, PER = 30, inbound = Array.from({ length: GATES }, () => []), players = [];
  for (let g = 0; g < GATES; g += 1) {
    // The channel between a Gate and the room: `hop` ms each way, in order.
    const gateEnd = socket(), roomEnd = socket();
    gateEnd.send = (text) => setTimeout(() => { inbound[g].push(Date.now()); roomEnd.emit('message', { data: text }); }, hop);
    roomEnd.send = (text) => setTimeout(() => gateEnd.emit('message', { data: text }), hop);
    multiplexSession(roomEnd, async (req, client) => {
      const h = room.attach({ send: (text) => client.send(text), close: (code, why) => client.close(code, why), buffered: () => client.buffered(), snapshotGroup: client.snapshotGroup, subscribe: (seat) => client.subscribe(seat), transportFacts: client.transportFacts });
      client.addEventListener('message', (e) => h.onMessage(e.data, e.receivedAt));
      client.addEventListener('close', () => h.onClose('close'));
    });
    const gate = new Gate({ waitUntil() {} }, tableOf(gateEnd));
    for (let i = 0; i < PER; i += 1) {
      const p = socket(), decoder = snapshotDecoder(), up = 5 + Math.floor(random() * 30), down = 5 + Math.floor(random() * 30), phase = Math.floor(random() * 100);
      const me = { p, seat: null, held: null, heldAt: 0, epoch: null, r: 0, east: true, snaps: 0, ownMissing: 0, undecodable: 0, sent: 0, lastSent: 0, measured: 0, bytes: 0, from: null, travelled: 0 };
      p.send = (text) => setTimeout(() => {
        const m = JSON.parse(text);
        if (m.t === 'welcome') { me.seat = m.seat; return; }
        if (m.t !== 'snap') return;
        const snap = decoder.decode(m);
        if (!snap) { me.undecodable += 1; return; }
        me.snaps += 1; if (me.measuring) { me.measured += 1; me.bytes += text.length; }
        const own = snap.d[1].find((e) => e[9] === me.seat && e[10] !== 1);
        if (!own) { me.ownMissing += 1; return; }
        me.held = m.k; me.heldAt = Date.now(); me.epoch = snap.e; me.r = own[2]; me.east = Boolean(own[7][1]);
        me.from ??= own[3]; me.travelled = Math.max(me.travelled, Math.abs(own[3][0] - me.from[0]));
      }, down);
      await gate.connect(new Request(`https://table/__net?game=crowd-circuit&room=r&gates=16&gate=${g}`), p);
      setTimeout(() => {
        p.emit('message', { data: JSON.stringify({ t: 'hello', rules: true, v: 1, rev: 12, name: `Seeded ${g}-${i}`, device: 'desk', want: 'play', canHost: false, game: 'crowd-circuit', max: 1000, ...(i % 5 ? { coast: 1 } : {}) }) });
        setInterval(() => {
          if (me.held === null) return;
          // The toolkit's client: the tick it holds, the ticks since, and a lead of three.
          const k = Math.max(me.lastSent + 1, me.held + Math.floor((Date.now() - me.heldAt) / 50) + 3);
          me.lastSent = k; me.sent += 1;
          p.emit('message', { data: JSON.stringify({ t: 'in', e: me.epoch, k, s: [[0, me.east ? 127 : -127, Math.round(Math.sin(Date.now() / 3100 + i) * 35)]], r: me.r, g: me.held }) });
        }, 100);
      }, up + phase + g * 40 + i * 10);
      players.push(me);
    }
  }
  await clock.wait(3000);
  assert.equal(new Set(players.map((p) => p.seat)).size, GATES * PER, 'every player has a seat of their own');
  const before = { ...host.facts() }, from = Date.now();
  for (const p of players) p.measuring = true;
  await clock.wait(5000);
  const after = host.facts();
  for (const [i, p] of players.entries()) {
    assert.ok(p.measured >= 98 && p.measured <= 101, `player ${i} got ${p.measured} frames in five seconds of 20 Hz`);
    assert.equal(p.ownMissing, 0, `player ${i} was sent a frame without their own body`);
    assert.equal(p.undecodable, 0);
  }
  assert.equal(after.ticks - before.ticks, 100, 'the rules kept 20 Hz');
  assert.equal(after.faults, 0, 'and ran without a fault');
  assert.ok(players.every((p) => p.travelled > 3), 'every runner ran');
  // Four players in five are current clients, which coast; the fifth is a page built before 0.46.2 and is sent every body it sees move.
  const each = (list) => list.reduce((a, p) => a + p.bytes, 0) / list.length / 5;
  const coasting = each(players.filter((_, i) => i % PER % 5)), older = each(players.filter((_, i) => i % PER % 5 === 0));
  assert.ok(coasting < older * 0.6, `a coasting client was sent ${Math.round(coasting)} B a second, an older one ${Math.round(older)}`);
  assert.equal(after.dropped, 0); assert.equal(room.stats.drops, 0);
  const sent = players.reduce((a, p) => a + p.sent, 0);
  assert.ok(room.stats.ins >= sent - GATES * PER && room.stats.ins <= sent, `the room heard ${room.stats.ins} of ${sent} inputs`);
  assert.ok(after.lateEntries <= sent * 0.01, `${after.lateEntries} of ${sent} inputs missed their tick`);
  if (process.env.CROWD_SHAPE_FACTS) console.log(JSON.stringify({ measured: [Math.min(...players.map((p) => p.measured)), Math.max(...players.map((p) => p.measured))], sent, ins: room.stats.ins, late: after.lateEntries, ticks: after.ticks - before.ticks, frames: inbound.map((at) => at.filter((ms) => ms >= from).length) }));
  for (const [g, at] of inbound.entries()) {
    const frames = at.filter((ms) => ms >= from).length;
    assert.ok(frames <= 101, `Gate ${g} sent the room ${frames} frames in 100 ticks`);
  }
});

test('a run\'s summary names tick rate and delivered rate for every step, the players\' and the server\'s, and marks a full link', async () => {
  const { summarize, table } = await import('../lib/crowd-summary.mjs');
  const report = { n: 300, total: 302, room: 'r', measurementStarted: '2026-10-11T00:00:10.000Z', ended: '2026-10-11T00:00:20.000Z', measuredSeconds: 10, joined: 300, connectedAtEnd: 300, disconnects: 0,
    inputAckMs: { p50: 150, p95: 210, p99: 260 }, receiveGapMs: { p95: 70, p99: 110 }, tickHz: { min: 19.8, median: 20.004, max: 20.1 }, deliveredHz: { min: 9.9, median: 19.96, max: 20 },
    payload: { downBytes: 80e6, wireDownBytes: 20e6, compressedSockets: 300 }, compression: { offered: true, sockets: 300, of: 300, ratio: 4 }, inputLead: { ticksMedian: 3, ticksMax: 5, lateShare: 0.02 }, errors: [{ text: 'x', count: 2 }], ackExpired: 0 };
  const at = Date.parse('2026-10-11T00:00:12.000Z');
  const row = (i, tickRate) => ({ at: at + i * 1000, ok: true, ticks: { ins: 3000, lateEntries: 30 }, tickRate, inputTransitMs: { p50: 12, p95: 44, max: 61 }, diagnostics: { ageMs: 400 + i },
    gates: [{ id: 'gate/0', subscribed: 150, worldHz: 20, deliveredHz: 20, worldAgeMs: { p50: 4, p95: 9, max: 30 }, ackMs: 3, maxAckMs: 40, rttMs: 4, paced: 0, clientLagTicks: { p95: 4, max: 6 } },
      { id: 'gate/1', subscribed: 150, worldHz: 20, deliveredHz: 17.5, worldAgeMs: { p50: 5, p95: 12, max: 35 }, ackMs: 4, maxAckMs: 44, rttMs: 9, paced: 12, clientLagTicks: { p95: 9, max: 31 } }] });
  const rows = [{ at: at - 60_000, ok: true, ticks: { ins: 1, lateEntries: 1 }, tickRate: 3 }, row(0, 20), row(1, 19.9), row(2, 20.1), { at: at + 3000, ok: false, error: 'timeout' }];
  const s = summarize(report, rows, { downMBps: 2.4 });
  assert.deepEqual(s.client.tickHz, { median: 20, min: 19.8 }); assert.deepEqual(s.client.deliveredHz, { median: 19.96, min: 9.9 });
  assert.deepEqual(s.server.tickRate, { median: 20, min: 19.9 }, 'a row from before the measurement is not in it');
  assert.equal(s.server.gateDeliveredHz.median, 20); assert.equal(s.server.gateDeliveredHz.p05, 17.5); assert.equal(s.client.compression.ratio, 4, 'the server agreed to compress every socket, four to one'); assert.equal(s.server.lateInputs, 0.01);
  assert.equal(s.server.samples, 3); assert.equal(s.server.failedPolls, 1); assert.equal(s.server.pacedPlayers, 12); assert.deepEqual(s.server.playersPerGate, { min: 150, max: 150 });
  assert.equal(s.client.wireMBps, 2); assert.equal(s.link.limited, true, 'two of the 2.4 MB a second this link carries');
  assert.equal(summarize(report, rows, { downMBps: 40 }).link.limited, false);
  assert.match(table([s]), /\| 300 \| home \| 300\/300\/0 \| 150\/210\/260 \| —\/— \| 3 \(0\.02\) \| 20 \| 19\.96 \| 2 \(2\.4, LINK-LIMITED\) \| 6\.67 \| 300\/300 \(4\) \| — \| 0\.01 \| 2 \| —\/— \| 20\/17\.5 \| 9\/9 \| 5\/12 \| 12 \| 3\/1 \|/);
  assert.match(table([summarize({ ...report, driver: { workerLoopP99Ms: [14], peakTimerLagMs: [640] } }, rows, null)]), /\| 640 DRIVER \|/, 'a step the driver could not keep up with says so');
  const empty = summarize({ n: 50, payload: {} }, [], null);
  assert.equal(empty.server.tickRate.median, null); assert.match(table([empty]), /—/, 'a number that was not measured is a dash, never a blank');
});

/** A real crowd: the fixture game's rules with `players` seated, each steering as the load probe does. `step()` is the next world. */
async function crowd(players, name) {
  const dir = join(PKG, 'test/fixtures/crowd-circuit/game');
  const L = await loadGame(scratch, dir, name);
  const settings = L.R.roomSettings(JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8')).room).settings;
  const compiled = L.R.compileRules(L.def, { tune: JSON.parse(readFileSync(join(dir, 'tunables.json'), 'utf8')), settings, seats: 1000, map: L.R.compileMap({ ...JSON.parse(readFileSync(join(dir, 'map/main.json'), 'utf8')), name: 'main' }, 'main') });
  const h = hostRig(L, compiled, { host: { enforceOverrun: false } });
  for (let seat = 0; seat < players; seat += 1) h.join(seat);
  h.ticks(30);
  let n = 0;
  return { h, view: settings.view, step() {
    const now = h.snap(); n += 1;
    if (n % 2) for (const own of now.d[1]) if (own[9] !== undefined) h.host.frame({ t: 'in', from: own[9], e: now.e, k: now.k + 2, s: [[0, own[7][1] ? 127 : -127, Math.round(Math.sin(n / 60 + own[9]) * 35)]], r: own[2] });
    h.ticks(1);
    assert.equal(h.host.facts().faults, 0);
    return h.snap();
  } };
}

test('the world crosses to a Gate as a block of numbers and what changed, and arrives exactly as the room held it', async () => {
  const c = await crowd(200, 'crowd-wire');
  const source = worldSource(), steady = worldSink(), skipping = worldSink(); let late = null;
  let synced = 0, skipSynced = 0, lateSynced = 0, blockBytes = 0, headerBytes = 0, wireBytes = 0, plain = 0, frames = 0;
  const seats = [3, 77, 150];
  for (let t = 0; t < 120; t += 1) {
    if (t === 40) c.h.host.frame({ t: 'leave', seat: 11 });
    if (t === 60) c.h.join(400);
    const { k, st, e, d, c: control } = c.step(), snap = { k, st, e, d, c: control }, world = source.encode(snap); // as the room holds it
    assert.equal(source.encode(snap), world, 'one encoding of a world, whichever link asks');
    assert.equal(world.narrow, true, 'a rules host keeps its bodies in 32-bit numbers: they cross as such, exactly');
    const want = (list) => ({ ...JSON.parse(JSON.stringify(snap)), c: snap.c.filter((row) => list.includes(row[0])) });
    // A link that takes every world.
    const header = JSON.parse(JSON.stringify(source.header(world, synced, seats)));
    assert.deepEqual(steady.decode(header, world.block), want(seats)); synced = world.seq;
    if (t > 5 && t !== 40 && t !== 60) { blockBytes += world.motion.byteLength; headerBytes += JSON.stringify(header).length; wireBytes += JSON.stringify(header).length + world.block.length; plain += JSON.stringify(snap).length; frames += 1; }
    // A link that was busy and had every third world replaced before it was sent.
    if (t % 3 === 0) { assert.deepEqual(skipping.decode(JSON.parse(JSON.stringify(source.header(world, skipSynced, [5]))), world.block), want([5])); skipSynced = world.seq; }
    // A Gate that opens half way through is told everything once.
    if (t >= 50) { late ??= worldSink(); assert.deepEqual(late.decode(JSON.parse(JSON.stringify(source.header(world, lateSynced, []))), world.block), want([])); lateSynced = world.seq; }
  }
  assert.ok(blockBytes / frames <= 200 * 24 + 24, `${Math.round(blockBytes / frames)} bytes of motion for 200 bodies`);
  assert.ok(wireBytes / frames < plain / frames / 4, `a world is ${Math.round(wireBytes / frames)} bytes to a Gate, where its JSON is ${Math.round(plain / frames)}`);
  assert.ok(headerBytes / frames < 800, `beside the block, a steady world says ${Math.round(headerBytes / frames)} bytes to a Gate`);
  assert.throws(() => steady.decode({ k: 1, st: 0, round: [], c: [], w: { seq: 999, n: 200, dims: 2, narrow: true, tails: [] } }, 'AAAA'), /does not fit/);
  // Numbers that are not 32-bit exact, and three dimensions: still exact, in 64 bits.
  const odd = { k: 1, e: 1, st: 5, d: [[1], [['a', 0, 0, [0.1, 0.2, 0.3], [1e-9, 2, 3], [0, 0, 1], 1, [{ deep: [1] }], [], 0, 0]], { walls: 1 }], c: [[0, 0, 1, 16]] };
  const other = worldSource(), wide = other.encode(odd);
  assert.equal(wide.narrow, false);
  assert.deepEqual(worldSink().decode(JSON.parse(JSON.stringify(other.header(wide, 0, [0]))), wide.block), odd);
  assert.equal(worldSource().encode({ k: 1, d: null }), null, 'a frame with no bodies in it is sent as it is');
});

test('a Gate\'s crowd path: the same bodies in view, each within the game\'s precision of the truth, in under half the bytes', async () => {
  const c = await crowd(300, 'crowd-path');
  const view = c.view, worlds = crowdWorlds(view), seats = [0, 37, 111, 205, 299, null];
  const clients = seats.map((seat) => ({ seat, crowd: crowdView(worlds, view, 20), decoder: snapshotDecoder(), old: { view: scheduledView(view, 20), encoder: snapshotEncoder(Infinity, true), decoder: snapshotDecoder() }, bytes: 0, oldBytes: 0, rows: 0, worstNear: 0, worstFar: 0, oldWorst: 0 }));
  const farAllowance = 0.5 * 6 / view.farHz;
  for (let t = 0; t < 200; t += 1) {
    if (t === 70) c.h.host.frame({ t: 'leave', seat: 38 });
    if (t === 90) c.h.join(500);
    const snap = JSON.parse(JSON.stringify(c.step())), truth = new Map(snap.d[1].map((e) => [e[0], e]));
    for (const client of clients) {
      // A paced player is skipped for a few ticks now and then: the next frame is from the last one SENT.
      if (client.seat === 111 && t > 20 && t % 7 < 3) continue;
      const text = client.crowd(snap, client.seat), frame = JSON.parse(text), seen = client.decoder.decode(frame);
      assert.ok(seen, `tick ${snap.k}: the frame decodes`);
      client.bytes += text.length; client.rows += Array.isArray(frame.d) ? frame.d[1].length : frame.d.changed.length;
      const visible = interestSnapshot(snap, client.seat, view.radiusM);
      assert.deepEqual(seen.d[1].map((e) => e[0]).sort(), visible.d[1].map((e) => e[0]).sort(), `tick ${snap.k}, seat ${client.seat}: exactly the bodies in range`);
      assert.deepEqual(seen.c, visible.c); assert.deepEqual(seen.d[0], snap.d[0]);
      const own = client.seat === null ? null : truth.get(snap.d[1].find((e) => e[9] === client.seat)[0]);
      for (const e of seen.d[1]) {
        const real = truth.get(e[0]);
        if (real === own) { assert.deepEqual(e, own, 'a player\'s own body is the room\'s, exactly'); continue; }
        assert.deepEqual([e[0], e[1], e[2], e[6], e[7], e[8], e.slice(9)], [real[0], real[1], real[2], real[6], real[7], real[8], real.slice(9)], 'everything but its motion is as the room has it');
        const off = Math.hypot(e[3][0] - real[3][0], e[3][1] - real[3][1]);
        const near = !own || Math.hypot(real[3][0] - own[3][0], real[3][1] - own[3][1]) <= view.nearM;
        if (near) client.worstNear = Math.max(client.worstNear, off); else client.worstFar = Math.max(client.worstFar, off);
      }
      if (client.seat === 111) continue;
      const before = snapshotText({ t: 'snap', from: null, ...client.old.encoder.encode(client.old.view(snap, client.seat), client.seat) });
      client.oldBytes += before.length;
      for (const e of client.old.decoder.decode(JSON.parse(before)).d[1]) { const real = truth.get(e[0]); client.oldWorst = Math.max(client.oldWorst, Math.hypot(e[3][0] - real[3][0], e[3][1] - real[3][1])); }
    }
  }
  for (const client of clients) {
    assert.ok(client.worstNear <= view.precisionM * 2.5, `seat ${client.seat}: a near body was drawn ${client.worstNear.toFixed(3)} m from where it is`);
    assert.ok(client.worstFar <= farAllowance + view.precisionM * 2.5, `seat ${client.seat}: a far body was drawn ${client.worstFar.toFixed(3)} m from where it is`);
    if (client.seat === 111 || client.seat === null) continue;
    assert.ok(client.bytes < client.oldBytes * 0.5, `seat ${client.seat}: ${client.bytes} bytes where every moving body was sent ${client.oldBytes}`);
    assert.ok(client.worstFar <= client.oldWorst, 'and a far body is never drawn further from the truth than holding it still between refreshes did');
  }
});

test('the in-Cloudflare probe plays its players against a room and reports what the home driver reports', async (t) => {
  const dir = join(PKG, 'test/fixtures/crowd-circuit/game');
  const L = await loadGame(scratch, dir, 'crowd-probe');
  const game = JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8'));
  const compiled = L.R.compileRules(L.def, { tune: JSON.parse(readFileSync(join(dir, 'tunables.json'), 'utf8')), settings: L.R.roomSettings(game.room).settings, seats: 1000, map: L.R.compileMap({ ...JSON.parse(readFileSync(join(dir, 'map/main.json'), 'utf8')), name: 'main' }, 'main') });
  const { default: probe } = await import('../lib/crowd-probe/worker.mjs');
  const { cloudReport } = await import('../lib/crowd-cloud.mjs');
  const { summarize } = await import('../lib/crowd-summary.mjs');
  const clock = virtualTime(t), random = seeded(7);
  const timers = { now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (id) => clearTimeout(id) };
  const room = new NetRoom({ code: 'r', maxPlayers: 1000, now: timers.now, log() {}, rules: true });
  const host = L.H.createHost({ game: 'test', compiled, clock: timers, send: (m, text) => room.hostFrame(m, text), log() {}, random });
  room.setServerHost(host);
  const beat = setInterval(() => room.tick(), 250);
  t.after(() => { clearInterval(beat); host.stop(); });
  // One Gate and its channel to the room, 4 ms each way; a player's socket is 8 ms each way.
  const gateEnd = socket(), roomEnd = socket();
  gateEnd.send = (text) => setTimeout(() => roomEnd.emit('message', { data: text }), 4);
  roomEnd.send = (text) => setTimeout(() => gateEnd.emit('message', { data: text }), 4);
  multiplexSession(roomEnd, async (req, client) => {
    const h = room.attach({ send: (text) => client.send(text), close: (code, why) => client.close(code, why), buffered: () => client.buffered(), snapshotGroup: client.snapshotGroup, subscribe: (seat) => client.subscribe(seat), transportFacts: client.transportFacts });
    client.addEventListener('message', (e) => h.onMessage(e.data, e.receivedAt));
    client.addEventListener('close', () => h.onClose('close'));
  });
  const gate = new Gate({ waitUntil() {} }, tableOf(gateEnd)), asked = [];
  // What the probe sees of the studio: the game's page, which names the socket, and the socket.
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url); asked.push(url.pathname);
    if (url.pathname.endsWith('/__game/')) return new Response(`<script>window.HOMIE_NET=${JSON.stringify({ url: `wss://studio.test/crowd-circuit/__net?room=${url.searchParams.get('room')}&b=${url.searchParams.get('b')}`, room: url.searchParams.get('room') })}</script>`);
    assert.equal(init.headers.Upgrade, 'websocket');
    const theirs = socket(), mine = socket();
    theirs.send = (text) => setTimeout(() => mine.emit('message', { data: text }), 8);
    mine.send = (text) => setTimeout(() => theirs.emit('message', { data: text }), 8);
    mine.close = () => theirs.emit('close', {});
    await gate.connect(new Request(`https://table/__net?game=crowd-circuit&room=r&gates=20&gate=0`), theirs);
    return { status: 101, webSocket: mine };
  });
  const env = { PROBE_KEY: 'k' }, waits = [], ctx = { waitUntil: (p) => waits.push(p) };
  assert.equal((await probe.fetch(new Request('https://probe.test/play?origin=https://studio.test&room=r'), env, ctx)).status, 404, 'nothing without the key');
  const started = Date.now(), joinAt = started + 100, measureAt = joinAt + 3000, endAt = measureAt + 5000, finals = [];
  const requests = [0, 5, 10].map(async (from) => {
    const res = await probe.fetch(new Request(`https://probe.test/play?origin=https://studio.test&game=crowd-circuit&room=r&from=${from}&count=5&joinAt=${joinAt}&rampMs=20&measureAt=${measureAt}&endAt=${endAt}`, { headers: { 'x-probe-key': 'k' } }), env, ctx);
    assert.equal(res.status, 200);
    for (const text of (await res.text()).split('\n').filter(Boolean)) { const row = JSON.parse(text); if (row.t === 'final') finals.push(row); assert.notEqual(row.t, 'failed', text); }
  });
  await clock.wait(endAt - Date.now() + 200);
  await Promise.all(requests); await Promise.all(waits);
  assert.equal(finals.length, 3);
  const report = cloudReport({ origin: 'https://studio.test', room: 'r', n: 15, seconds: 5, started, measureAt, endAt, finals });
  assert.equal(report.joined, 15); assert.equal(report.connectedAtEnd, 15); assert.equal(report.disconnects, 0); assert.deepEqual(report.errors, []);
  assert.ok(report.deliveredHz.min >= 19.5 && report.deliveredHz.max <= 20.5, `every player was sent 20 frames a second (${report.deliveredHz.min} to ${report.deliveredHz.max})`);
  assert.ok(report.tickHz.median > 19.8 && report.tickHz.median < 20.2);
  assert.ok(report.inputAckMs.count > 600, `${report.inputAckMs.count} inputs acknowledged`);
  // 8 ms to the Gate, up to 50 for its frame, 4 to the room, up to 50 for the tick, and 12 back: under three ticks.
  assert.ok(report.inputLoopMs.p50 <= 100 && report.inputLoopMs.p95 <= 150, `an input's loop took ${report.inputLoopMs.p50} ms at the median, ${report.inputLoopMs.p95} at p95`);
  assert.ok(report.inputLead.ticksMedian <= 3 && report.inputLead.lateShare <= 0.05, `players settled on ${report.inputLead.ticksMedian} ticks of lead, ${report.inputLead.lateShare} late`);
  assert.ok(report.inputAckMs.p95 <= report.inputLead.ticksMax * 50 + 40, `ack p95 ${report.inputAckMs.p95} ms with a lead of ${report.inputLead.ticksMax}`);
  assert.ok(asked.filter((path) => path.endsWith('/__game/')).length === 15);
  const line = summarize(report, [], null);
  assert.equal(line.from, 'cloudflare'); assert.equal(line.client.inputLoopMs.p50, report.inputLoopMs.p50); assert.equal(line.link.limited, null);
});
