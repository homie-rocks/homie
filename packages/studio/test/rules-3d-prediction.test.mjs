/** Shipped starter prediction: seeded packet streams and drawing frames on virtual time.
 * Chrome owns actual rAF/canvas integration; these cases own numerical correctness. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { viewPlugin } from '../lib/rules-build.mjs';
import { NetRoom } from '../worker/room.mjs';
import { PKG, esbuildOf, loadGame, prepareRuntimeFixture } from './rules-kit.mjs';
import { virtualTime } from './virtual-time.mjs';
import { predictionShaper } from './prediction-shaper.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-3d-prediction-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const kits = new Map();
async function kit(id) {
  if (kits.has(id)) return kits.get(id);
  const esbuild = await esbuildOf(), dir = join(PKG, 'starters', id);
  const game = { id, dir, players: { max: 8 }, room: { host: 'server' } };
  const rules = await prepareRuntimeFixture(esbuild, scratch, game), L = await loadGame(scratch, dir, id);
  const compiled = L.R.compileRules(L.def, { map: L.R.compileMap(rules.map), tune: rules.tune, settings: rules.settings, seats: 8 });
  const entry = join(scratch, id + '.ts'), output = join(scratch, id + '.mjs');
  writeFileSync(entry, `export {openRoom} from ${JSON.stringify(join(PKG, 'rules/view.ts'))};`);
  await esbuild.build({ stdin: { contents: `import 'homie:game';export {openRoom} from ${JSON.stringify(entry)};`, resolveDir: scratch }, bundle: true, format: 'esm', outfile: output, plugins: [viewPlugin(game, rules, entry)], logLevel: 'silent' });
  const result = { L, compiled, ...(await import(pathToFileURL(output).href)) };
  kits.set(id, result); return result;
}
function rig(id, L, compiled, shape) {
  const relay = new NetRoom({ code: 'r', rules: true, maxPlayers: 8, tickHz: 20 });
  const host = L.H.createHost({ game: id, compiled, send: m => relay.hostFrame(m), random: () => .37,
    clock: { now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: h => clearTimeout(h) } });
  relay.setServerHost(host);
  const beat = setInterval(() => relay.tick(), 250);
  let links = 0;
  class Socket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0; this.link = links++;
      this.wire = relay.attach({ send: text => this.deliver(text, 'down', () => this.onmessage?.({ data: text })), close: () => this.close(), buffered: () => 0 });
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
    }
    deliver(text, direction, fn) {
      const ms = shape(JSON.parse(text), `${this.link}:${direction}`);
      if (ms !== null) setTimeout(() => { if (this.readyState === 1) fn(); }, ms);
    }
    send(text) { this.deliver(text, 'up', () => this.wire.onMessage(text)); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.wire.onClose(); }
  }
  return { host, relay, Socket, stop() { clearInterval(beat); host.stop(); } };
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
for (const id of ['gem-rush-3d', 'hero-rush-3d', 'ember-vale'])
for (const delay of [50, 150, 300]) for (const loss of [.02, .10]) for (const seed of [417, 1, 2026])
test(`${id}: virtual prediction ${delay} ms, ${loss} loss, seed ${seed}`, async t => {
  const { L, compiled, openRoom } = await kit(id);
  const clock = virtualTime(t);
  const r = rig(id, L, compiled, predictionShaper({ delay, loss, seed }));
  const probes = [];
  const views = [0, 1].map(n => { const v = openRoom({ net: { config: { v: 1, url: 'ws://relay/socket', room: 'r', device: 'desk', want: 'play', name: 'P' + n }, WebSocketImpl: r.Socket, post: null } }); probes.push(globalThis.__homieNet.probe.prediction); return v; });
  t.after(() => { for (const v of views) v.close(); r.stop(); });
  await clock.wait(12000);
  for (const v of views) assert.equal(v.status, 'playing');
  const probe = globalThis.__homieNet.probe.prediction, startup = probe();
  let previous = views.map(v => v.me), elapsed = 0, leg = -1, responses = 0, landings = 0, peak = 0, remotePeak = 0, remoteSamples = 0;
  const trace = [], digest = createHash('sha256');
  for (let frame = 0; elapsed < 12000; frame++) {
    const nextLeg = Math.floor(elapsed / 900), change = nextLeg !== leg; leg = nextLeg;
    const angle = leg % 4 * Math.PI / 2;
    for (const v of views) v.input({ ax: Math.round(Math.cos(angle) * 100), ay: Math.round(Math.sin(angle) * 100),
      jump: change && id === 'hero-rush-3d', swing: change && id === 'hero-rush-3d', wave: change && id === 'gem-rush-3d', strike: change && id === 'ember-vale' });
    const ms = [16, 16, 33, 5][frame % 4]; await clock.wait(ms); elapsed += ms;
    const current = views.map(v => v.me);
    digest.update(JSON.stringify(current));
    trace.push({ frame, ms, current: current.map(e => ({ pos: e.pos, vel: e.vel, grounded: e.grounded, motion: e.motion })), probes: probes.map(p => p()) }); if (trace.length > 4) trace.shift();
    for (let n = 0; n < 2; n++) {
      const me = current[n], step = distance(me.pos, previous[n].pos);
      assert.ok(step <= 32 * ms / 1000 + .10, `continuous pose: frame ${frame}, view ${n}, step ${step}, ${JSON.stringify(trace)}`);
      assert.ok(Math.abs(Math.hypot(me.heading.x, me.heading.y, me.heading.z) - 1) < .001, 'unit facing');
      // The opening input has clear space. Later turns can meet a wall or a hit-stop,
      // where the rules intentionally hold the body still.
      if (frame === 0) assert.ok(step > .000001, 'fresh input moves on the first drawing frame');
      if (change && step > .000001) responses++;
    }
    peak = Math.max(peak, current[1].pos.z);
    if (current[1].grounded && !previous[1].grounded) landings++;
    views[1].each(id === 'ember-vale' ? 'hero' : 'runner', e => {
      if (e.driver === 'person' && !e.mine) { remoteSamples++; remotePeak = Math.max(remotePeak, e.pos.z); }
    });
    previous = current;
  }
  assert.ok(responses >= 20); assert.ok(remoteSamples > 100);
  assert.equal(probe().snaps, 0, 'ordinary corrections are eased');
  assert.equal(probe().rebases, startup.rebases, 'steady calibrated clock');
  if (id === 'hero-rush-3d') { assert.ok(peak > .8); assert.ok(landings >= 5); assert.ok(remotePeak > .5); }
  assert.equal(r.host.core.stats.errors, 0);
  t.diagnostic(JSON.stringify({ id, delay, loss, seed, digest: digest.digest('hex'), responses, landings, peak, remotePeak, prediction: probe() }));
});

for (const delay of [0, 20, 100]) test(`Gem Rush slides along a wall under held analogue input at ${delay} ms`, async t => {
  const { L, compiled, openRoom } = await kit('gem-rush');
  const clock = virtualTime(t), r = rig('gem-rush', L, compiled, predictionShaper({ delay, loss: 0, seed: 417 }));
  const v = openRoom({ net: { config: { v: 1, url: 'ws://relay/socket', room: 'r', device: 'phone', want: 'play', name: 'P' }, WebSocketImpl: r.Socket, post: null } });
  t.after(() => { v.close(); r.stop(); });
  await clock.wait(12000);
  v.input({ax: 0, ay: 127}); await clock.wait(5000);
  v.input({ax: 0, ay: 0}); await clock.wait(400);
  let previous = v.me.pos; const start = previous, trace = [];
  for (let n = 0; n < 240; n++) {
    await clock.wait([16, 16, 33, 5][n % 4]);
    const now = globalThis.__homieNet.probe.self();
    v.input({ ax: -127, ay: n % 2 ? 4 : -4 });
    const drawn = v.me;
    trace.push({ n, now, drawn, probe: globalThis.__homieNet.probe.prediction() });
    if (trace.length > 5) trace.shift();
    assert.ok(now.x <= previous.x + .001, `frame ${n}: ${previous.x} -> ${now.x}: ${JSON.stringify(trace)}`);
    previous = now;
  }
  assert.ok(start.x - previous.x > 12, 'the hold travels along the wall instead of sticking');
});
