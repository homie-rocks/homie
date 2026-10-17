import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { viewPlugin } from '../lib/rules-build.mjs';
import { NetRoom } from '../worker/room.mjs';
import { PKG, esbuildOf, loadGame, prepareRuntimeFixture } from './rules-kit.mjs';
import { virtualTime } from './virtual-time.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'critic-rest-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
for (const [restSeconds, restAt] of [[0, 5000], [2, 5000]]) test(`restSeconds ${restSeconds}: input after ${restAt} ms idle`, async t => {
  const id = 'gem-rush';
  const esbuild = await esbuildOf(), dir = join(PKG, 'starters', id);
  const game = { id, dir, players: { max: 8 }, room: { host: 'server' } };
  const rules = await prepareRuntimeFixture(esbuild, scratch, game), L = await loadGame(scratch, dir, id);
  const compiled = L.R.compileRules(L.def, { map: L.R.compileMap(rules.map), tune: rules.tune, settings: { ...rules.settings, restSeconds }, seats: 8 });
  const entry = join(scratch, id + '.ts'), output = join(scratch, id + '.mjs');
  writeFileSync(entry, `export {openRoom} from ${JSON.stringify(join(PKG, 'rules/view.ts'))};`);
  await esbuild.build({ stdin: { contents: `import 'homie:game';export {openRoom} from ${JSON.stringify(entry)};`, resolveDir: scratch }, bundle: true, format: 'esm', outfile: output, plugins: [viewPlugin(game, rules, entry)], logLevel: 'silent' });
  const { openRoom } = await import(pathToFileURL(output).href);
  const clock = virtualTime(t);
  const relay = new NetRoom({ code: 'r', rules: true, maxPlayers: 8, tickHz: 20 });
  const rests = [];
  const host = L.H.createHost({ game: id, compiled, send: m => relay.hostFrame(m), random: () => .37, onRest: on => rests.push(on),
    clock: { now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: h => clearTimeout(h) } });
  relay.setServerHost(host);
  let beat = setInterval(() => relay.tick(), 250);
  class Socket {
    constructor() { this.readyState = 0; this.bufferedAmount = 0;
      this.wire = relay.attach({ send: text => setTimeout(() => { if (this.readyState === 1) this.onmessage?.({ data: text }); }, 20), close: () => this.close(), buffered: () => 0 });
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0); }
    send(text) { setTimeout(() => this.wire.onMessage(text), 20); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.wire.onClose(); }
  }
  const v = openRoom({ net: { config: { v: 1, url: 'ws://relay/socket', room: 'r', device: 'phone', want: 'play', name: 'P' }, WebSocketImpl: Socket, post: null } });
  t.after(() => { v.close(); clearInterval(beat); host.stop(); });
  await clock.wait(4000);
  assert.equal(v.status, 'playing');
  v.input({ ax: 0, ay: 0 });
  // idle until it rests
  for (let i = 0; i < 40 && !host.resting; i++) await clock.wait(250);
  if (restSeconds) assert.equal(host.resting, true, 'room rests'); else await clock.wait(4000);
  const restTick = host.tick;
  await clock.wait(restAt);
  const probe = globalThis.__homieNet.probe.prediction();
  const before = host.facts();
  const me = () => host.core.listeners().find(l => l.seat === 0);
  const p0 = JSON.stringify(me().pos ?? me());
  v.input({ ax: 127, ay: 0 });
  for (let i = 0; i < 40; i++) { await clock.wait(250); v.input({ ax: 127, ay: 0 }); }
  const after = host.facts();
  const p1 = JSON.stringify(me().pos ?? me());
  t.diagnostic(JSON.stringify({ restTick, hostTick: host.tick, clientTick: probe.tick, serverTickSeen: probe.serverTick, resting: host.resting, droppedDelta: after.dropped - before.dropped, insDelta: after.ins - before.ins, p0, p1, rebases: globalThis.__homieNet.probe.prediction().rebases, rests }));
  assert.notEqual(p1, p0, 'the held stick moves the body on the server after waking');
});
