#!/usr/bin/env node
/**
 * What one Gate spends on a tick of a real crowd (not a test file: a measurement, run by hand).
 * The crowd-circuit fixture's rules run with N seeded players steering as the load probe does; each tick's world is
 * serialised as the room sends it, then one Gate's worth of players is selected, encoded and deflated as a browser's
 * socket would be. Prints milliseconds a tick, bytes a frame and the kilobytes a second a player costs on the wire.
 *
 *   node packages/studio/test/crowd-gate-cost.mjs [players=1000] [perGate=32] [ticks=200]
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { crowdView, crowdWorlds, scheduledView, snapshotDecoder, snapshotEncoder, snapshotText } from '../rules/interest.mjs';
import { PKG, hostRig, loadGame } from './rules-kit.mjs';

const [N = 1000, PER = 32, TICKS = 200] = process.argv.slice(2).map(Number);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-gate-cost-')));
const dir = join(PKG, 'test/fixtures/crowd-circuit/game');
const L = await loadGame(scratch, dir, 'gate-cost');
const game = JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8'));
const settings = L.R.roomSettings(game.room).settings;
const compiled = L.R.compileRules(L.def, { tune: JSON.parse(readFileSync(join(dir, 'tunables.json'), 'utf8')), settings, seats: 1000, map: L.R.compileMap({ ...JSON.parse(readFileSync(join(dir, 'map/main.json'), 'utf8')), name: 'main' }, 'main') });
const h = hostRig(L, compiled, { host: { enforceOverrun: false } });
for (let seat = 0; seat < N; seat += 1) h.join(seat);
h.ticks(40);
const ms = () => Number(process.hrtime.bigint()) / 1e6;
export function run(options) {
  const view = { ...settings.view, ...options.view }, worlds = crowdWorlds(view);
  const clients = Array.from({ length: PER }, (_, i) => ({ seat: Math.floor(i * N / PER), view: scheduledView(view, 20), enc: snapshotEncoder(Infinity, true), crowd: crowdView(worlds, view, 20), dec: snapshotDecoder(), z: zlib.createDeflateRaw({ level: 6 }), wire: 0, worst: 0 }));
  for (const c of clients) c.z.on('data', (b) => { c.wire += b.length; });
  let parse = 0, encode = 0, deflate = 0, bytes = 0, frames = 0, worldBytes = 0, rows = 0, sum = 0, count = 0; const errors = [];
  for (let t = 0; t < TICKS; t += 1) {
    const snap0 = h.snap(), now = t * 50;
    // Every player steers as the probe does: across, with a slow weave.
    if (t % 2 === 0) for (const own of snap0.d[1]) if (own[9] !== undefined) {
      const y = own[3][1], east = Boolean(own[7][1]);
      h.host.frame({ t: 'in', from: own[9], e: snap0.e, k: snap0.k + 2, s: [[0, east ? 127 : -127, y > 55 ? -35 : y < -55 ? 35 : Math.round(Math.sin(now / 3100 + own[9]) * 35)]], r: own[2] });
    }
    h.ticks(1);
    const text = JSON.stringify(h.snap()); worldBytes += text.length;
    let at = ms(); const snap = JSON.parse(text); parse += ms() - at;
    at = ms(); const outs = clients.map((c) => options.coast ? c.crowd(snap, c.seat) : snapshotText({ t: 'snap', from: null, ...c.enc.encode(c.view(snap, c.seat), c.seat) })); encode += ms() - at;
    at = ms(); for (const [i, c] of clients.entries()) { c.z.write(outs[i]); c.z.flush(zlib.constants.Z_SYNC_FLUSH); } deflate += ms() - at;
    for (const [i, c] of clients.entries()) {
      bytes += outs[i].length; frames += 1;
      const m = JSON.parse(outs[i]); rows += Array.isArray(m.d) ? m.d[1].length : m.d.changed.length;
      // What the player ends up drawing, against the truth: the worst error of any body they can see.
      const seen = c.dec.decode(m); if (!seen) throw new Error('a frame did not decode'); if (options.check) { const want = c.view(snap, c.seat).d[1].map((e) => e[0]).sort().join(), got = seen.d[1].map((e) => e[0]).sort().join(); if (want !== got) throw new Error(`visible set differs at tick ${snap.k} for seat ${c.seat}: ${want.length} ${got.length}`); } const truth = new Map(snap.d[1].map((e) => [e[0], e]));
      const own = seen.d[1].find((e) => e[9] === c.seat);
      for (const e of seen.d[1]) { const real = truth.get(e[0]); if (!real) throw new Error('a body that left is still drawn'); const off = Math.hypot(e[3][0] - real[3][0], e[3][1] - real[3][1]); c.worst = Math.max(c.worst, off); if (own && Math.hypot(e[3][0] - own[3][0], e[3][1] - own[3][1]) <= (view.nearM ?? Infinity)) c.worstNear = Math.max(c.worstNear ?? 0, off); sum += off; count += 1; }
    }
  }
  return new Promise((done) => setTimeout(() => done({
    ...options, players: N, perGate: PER, worldKB: Math.round(worldBytes / TICKS / 1024),
    msPerTick: { parse: +(parse / TICKS).toFixed(2), viewEncode: +(encode / TICKS).toFixed(2), deflate: +(deflate / TICKS).toFixed(2) },
    bytesPerFrame: Math.round(bytes / frames), rowsPerFrame: +(rows / frames).toFixed(1),
    wireKBsPerPlayer: +(clients.reduce((a, c) => a + c.wire, 0) / PER / (TICKS / 20) / 1024).toFixed(2),
    visibleBodies: Math.round(count / frames), meanErrorM: +(sum / count).toFixed(4), worstNearErrorM: +Math.max(...clients.map((c) => c.worstNear ?? 0)).toFixed(3), worstErrorM: +Math.max(...clients.map((c) => c.worst)).toFixed(3),
  }), 200));
}
if (process.argv[1]?.endsWith('crowd-gate-cost.mjs')) {
  if (process.env.ONLY) { console.log(JSON.stringify(await run({ coast: true, check: process.env.ONLY === 'check' }))); process.exit(0); }
  console.log(JSON.stringify(await run({ coast: false })));
  console.log(JSON.stringify(await run({ coast: true })));
  console.log(JSON.stringify(await run({ coast: true, view: { precisionM: 0.05 } })));
  rmSync(scratch, { recursive: true, force: true });
}
