#!/usr/bin/env node
/**
 * What the ROOM spends on a tick of a real crowd (not a test file: a measurement, run by hand).
 *
 * The room is the one object every Gate talks to, and a Worker's clock does not move while its code runs, so a
 * room on Cloudflare cannot time its own work. This runs the same objects (the rules host, NetRoom, one
 * multiplexSession a Gate) in Node, where the clock does move, with N seeded players steering as the load probe
 * does (ten inputs a second each, a ping every two), and times each part of the room's second:
 *
 *   in      a Gate's frame of inputs read: parse, one row a player input, the rules' queues
 *   rules, snapshot, checkpoint, send   the host's tick (send is every Gate's world built and written)
 *   save    the once-a-second checkpoint: the whole room as text
 *
 * Cloudflare's processors were measured at five to eight times slower than the laptop these were written on
 * (docs/crowd-transport-0462.md): multiply before reading a share of a 50 ms tick.
 *
 *   node packages/studio/test/crowd-room-cost.mjs [players=1000] [perGate=50] [ticks=200]
 *   LEAD=-1 JITTER=2 node ...   every input late, and the room's clock moving between frames
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GATE_PLAYERS, multiplexSession } from '../worker/gate.mjs';
import { NetRoom } from '../worker/room.mjs';
import { worldSource } from '../worker/world-wire.mjs';
import { PKG, loadGame } from './rules-kit.mjs';

const ms = () => Number(process.hrtime.bigint()) / 1e6;
function socket() {
  const events = new Map();
  return { sent: 0, bytes: 0, last: '', accept() {}, addEventListener(t, fn) { const list = events.get(t) ?? []; list.push(fn); events.set(t, list); },
    emit(t, value) { for (const fn of events.get(t) ?? []) fn(value); }, send(text) {
      this.sent += 1; this.bytes += text.length; this.last = text;
      // While players arrive, the Gate's receipt of each frame comes back by itself; measured ticks carry it in the Gate's own frame.
      const asked = this.auto ? /\["receipt",(\d+),/.exec(text.slice(-40)) : null;
      if (asked) setImmediate(() => this.emit('message', { data: JSON.stringify([['ack', Number(asked[1]), 0]]) }));
    }, close() { this.emit('close', {}); } };
}

export async function roomCost({ players: N = 1000, perGate: PER = GATE_PLAYERS, ticks: TICKS = 200, inputHz = 10, lead = 3, jitterMs = 0, options = {} } = {}) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-room-cost-')));
  try {
    const dir = join(PKG, 'test/fixtures/crowd-circuit/game');
    const L = await loadGame(scratch, dir, 'room-cost');
    const game = JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8'));
    const compiled = L.R.compileRules(L.def, { tune: JSON.parse(readFileSync(join(dir, 'tunables.json'), 'utf8')), settings: L.R.roomSettings(game.room).settings, seats: 1000, map: L.R.compileMap({ ...JSON.parse(readFileSync(join(dir, 'map/main.json'), 'utf8')), name: 'main' }, 'main') });
    let now = 1_000_000;
    const clock = { now: () => now, setTimer: () => 0, clearTimer() {} };
    const room = new NetRoom({ code: 'r', maxPlayers: 1000, now: clock.now, log() {}, rules: true });
    const cost = { in: 0, tick: 0, save: 0, saves: 0, saveBytes: 0, rows: 0, frames: 0 };
    let seed = 20261011; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    // The Table's checkpoint (worker/index.mjs, saveRoom): the host's save as text, the relay's, and the whole as one value.
    const encoder = new TextEncoder(), decoder = new TextDecoder();
    const store = { save(bytes) { const at = ms(); const text = JSON.stringify({ v: 1, game: 'g', room: 'r', at: now, host: decoder.decode(bytes), net: room.saved() }); cost.saveBytes = encoder.encode(text).length; cost.save += ms() - at; cost.saves += 1; } };
    const host = L.H.createHost({ game: 'test', compiled, clock, send: (m, text) => room.hostFrame(m, text), log() {}, random, store, snapshotText: () => false, ...options.host });
    room.setServerHost(host);
    const source = worldSource(), GATES = Math.ceil(N / PER), gates = [];
    for (let g = 0; g < GATES; g += 1) {
      const end = socket(), ids = []; end.auto = true;
      const session = multiplexSession(end, async (req, client) => {
        const h = room.attach({ send: (text) => client.send(text), close: (code, why) => client.close(code, why), buffered: () => client.buffered(), snapshotGroup: client.snapshotGroup, subscribe: (seat) => client.subscribe(seat), transportFacts: client.transportFacts });
        client.addEventListener('message', (e) => h.onMessage(e.data, e.receivedAt));
        client.addEventListener('close', () => h.onClose('close'));
      }, { source });
      gates.push({ end, session, ids, sequence: 0, acked: 0 });
    }
    // Everybody arrives, a Gate's worth a turn, as a join storm does.
    for (let i = 0; i < N; i += 1) {
      const gate = gates[Math.floor(i / PER)], id = String(i);
      gate.ids.push(id);
      gate.end.emit('message', { data: JSON.stringify([['open', id, 'https://table/__net?game=crowd-circuit&room=r', null, null], ['data', id, JSON.stringify({ t: 'hello', rules: true, v: 1, rev: 12, token: null, name: `Cost ${i}`, device: 'desk', want: 'play', canHost: false, coast: 1, game: 'crowd-circuit', max: 1000 }), now]]) });
      if (i % PER === PER - 1 || i === N - 1) { for (let n = 0; n < 40; n += 1) await new Promise((r) => setTimeout(r, 2)); await gate.session.settled(); }
    }
    host.start?.();
    const step = () => { now += 50; const at = ms(); host.tickNow(); return ms() - at; };
    for (let t = 0; t < 40; t += 1) { step(); await new Promise((r) => setTimeout(r, 1)); }
    for (const gate of gates) gate.end.auto = false;
    const seated = room.live ? [...room.live()].filter((c) => c.seat !== null).length : null;
    const before = { ...host.facts() }, sentBefore = gates.reduce((a, g) => a + g.end.bytes, 0), framesBefore = gates.reduce((a, g) => a + g.end.sent, 0);
    cost.save = 0; cost.saves = 0;
    const perTick = [];
    for (let t = 0; t < TICKS; t += 1) {
      const tick = host.tick ?? host.facts().tick, epoch = host.facts().epoch;
      // Each Gate's frame for this tick: the inputs of the players whose turn it is (ten a second each is one in two
      // ticks), stamped three ticks ahead, the receipt of the last world, and a receipt asked for.
      const frames = gates.map((gate, g) => {
        const rows = [];
        const world = /\["receipt",(\d+),/.exec(gate.end.last.slice(-40));
        if (world) rows.push(['ack', Number(world[1]), 0]);
        for (const [i, id] of gate.ids.entries()) {
          if ((i + t) % Math.round(20 / inputHz) === 0) rows.push(['data', id, JSON.stringify({ t: 'in', e: epoch, k: tick + lead, s: [[0, (i + g) % 2 ? 127 : -127, Math.round(Math.sin(now / 3100 + i) * 35)]], r: 0, g: tick }), now]);
          if ((i + g * 7 + t) % 40 === 0) rows.push(['data', id, JSON.stringify({ t: 'ping', c: now, hid: false, g: tick }), now]);
        }
        rows.push(['receipt', ++gate.sequence, now]);
        cost.rows += rows.length; cost.frames += 1;
        return JSON.stringify(rows);
      });
      let at = ms();
      // `jitterMs`: each Gate's frame reaches the room a little later than the last, as frames do: the room's clock moves between them.
      for (const [g, gate] of gates.entries()) { if (jitterMs) now += Math.floor(random() * jitterMs); gate.end.emit('message', { data: frames[g] }); }
      for (const gate of gates) await gate.session.settled();
      const spentIn = ms() - at; cost.in += spentIn;
      const spentTick = step(); cost.tick += spentTick;
      perTick.push(spentIn + spentTick);
      // The receipts the room owes its Gates leave on a timer of their own (60 ms): let them.
      if (t % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
    const after = host.facts(), timing = after.timing?.ms ?? {};
    perTick.sort((a, b) => a - b);
    const stage = (name) => timing[name] ? +timing[name].p50.toFixed(3) : null;
    host.stop?.();
    for (const gate of gates) gate.session.shutdown();
    return {
      players: N, perGate: PER, gates: GATES, seated, ticks: TICKS, inputHz, lead, jitterMs,
      rowsPerSecond: Math.round(cost.rows / TICKS * 20), inputsHeard: after.ins - before.ins, lateInputs: after.lateEntries - before.lateEntries,
      msPerTick: { in: +(cost.in / TICKS).toFixed(3), tick: +(cost.tick / TICKS).toFixed(3), ofWhich: { rules: stage('rules'), frames: stage('frames'), snapshot: stage('snapshot'), checkpoint: stage('checkpoint'), encode: stage('encode'), send: stage('send') }, p50: +perTick[Math.floor(TICKS / 2)].toFixed(3), p95: +perTick[Math.floor(TICKS * 0.95)].toFixed(3), max: +perTick.at(-1).toFixed(3) },
      save: { everyTicks: cost.saves ? Math.round(TICKS / cost.saves) : null, ms: cost.saves ? +(cost.save / cost.saves).toFixed(3) : null, bytes: cost.saveBytes },
      microsecondsPerInputRow: +((cost.in / cost.rows) * 1000).toFixed(2),
      roomSends: { framesPerSecond: Math.round((gates.reduce((a, g) => a + g.end.sent, 0) - framesBefore) / TICKS * 20), MBperSecond: +((gates.reduce((a, g) => a + g.end.bytes, 0) - sentBefore) / TICKS * 20 / 1e6).toFixed(2) },
      // A second of the room's thread, in ms of this computer's processor.
      msPerSecond: +((cost.in + cost.tick) / TICKS * 20).toFixed(1),
    };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1]?.endsWith('crowd-room-cost.mjs')) {
  const [players = 1000, perGate = GATE_PLAYERS, ticks = 200] = process.argv.slice(2).map(Number);
  // LEAD=-1 stamps every input for a tick already run (a room that is behind); JITTER=2 moves the room's clock between frames.
  console.log(JSON.stringify(await roomCost({ players, perGate, ticks, lead: Number(process.env.LEAD ?? 3), jitterMs: Number(process.env.JITTER ?? 0) }), null, 1));
  process.exit(0);
}
