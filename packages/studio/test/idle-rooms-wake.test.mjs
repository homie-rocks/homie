/**
 * The real view and client in a resting room (virtual time): a phone left alone until the room rests, then held
 * forward. The body must move on the server, whether the room wakes in memory or after being rebuilt from its save
 * (as a hibernated Durable Object is), and exactly as it does in a room that never rests.
 */
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

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'idle-rooms-wake-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
// Gem Rush's live rounds and bots keep a 'quiet' room playing; the starter asks for 'idle', an away-from-keyboard pause.
for (const [rest, restSeconds, rebuild] of [['idle', 0, false], ['quiet', 2, false], ['idle', 2, false], ['idle', 2, true]]) test(`rest ${rest}, restSeconds ${restSeconds}${rebuild ? ', rebuilt from its save' : ''}: a held stick moves the body after a rest`, async t => {
  const rests_ = rest === 'idle' && restSeconds > 0;
  const restAt = 5000;
  const id = 'gem-rush';
  const esbuild = await esbuildOf(), dir = join(PKG, 'starters', id);
  const game = { id, dir, players: { max: 8 }, room: { host: 'server' } };
  const rules = await prepareRuntimeFixture(esbuild, scratch, game), L = await loadGame(scratch, dir, id);
  const compiled = L.R.compileRules(L.def, { map: L.R.compileMap(rules.map), tune: rules.tune, settings: { ...rules.settings, rest, restSeconds }, seats: 8 });
  const entry = join(scratch, id + '.ts'), output = join(scratch, id + '.mjs');
  writeFileSync(entry, `export {openRoom} from ${JSON.stringify(join(PKG, 'rules/view.ts'))};`);
  await esbuild.build({ stdin: { contents: `import 'homie:game';export {openRoom} from ${JSON.stringify(entry)};`, resolveDir: scratch }, bundle: true, format: 'esm', outfile: output, plugins: [viewPlugin(game, rules, entry)], logLevel: 'silent' });
  const { openRoom } = await import(pathToFileURL(output).href);
  const clock = virtualTime(t);
  const relay = new NetRoom({ code: 'r', rules: true, maxPlayers: 8, tickHz: 20 });
  const rests = [];
  const options = { game: id, compiled, send: m => relay.hostFrame(m), random: () => .37, onRest: on => rests.push(on),
    clock: { now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: h => clearTimeout(h) } };
  let host = L.H.createHost(options);
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
  if (rests_) assert.equal(host.resting, true, 'room rests'); else { assert.equal(host.resting, false, 'a live round with moving bots is no quiet room'); await clock.wait(4000); }
  const restTick = host.tick;
  if (rebuild) {
    // Hibernated and rebuilt: a new host from the rest's own save, under its own epoch, the same sockets rejoining.
    const bytes = host.save(), epoch = host.epoch;
    host.stop(); host = L.H.createHost({ ...options, restore: bytes, restoreEpoch: epoch });
    relay.setServerHost(host, { restored: true });
    assert.equal(host.resting, true, 'a rebuilt rested room rests on');
  }
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

test('a browser-hosted room rests too: its page stops sending, the relay can sleep, and a held stick wakes it and moves the body', async t => {
  const id = 'gem-rush';
  const esbuild = await esbuildOf(), dir = join(PKG, 'starters', id);
  const game = { id, dir, players: { max: 8 }, room: { host: 'browser', rest: 'idle', restSeconds: 2 } };
  const rules = await prepareRuntimeFixture(esbuild, scratch, game);
  const entry = join(scratch, id + '-browser.ts'), output = join(scratch, id + '-browser.mjs');
  writeFileSync(entry, `export {openRoom} from ${JSON.stringify(join(PKG, 'rules/view.ts'))};`);
  await esbuild.build({ stdin: { contents: `import 'homie:game';export {openRoom} from ${JSON.stringify(entry)};`, resolveDir: scratch }, bundle: true, format: 'esm', outfile: output, plugins: [viewPlugin(game, rules, entry)], logLevel: 'silent' });
  const { openRoom } = await import(pathToFileURL(output).href);
  const clock = virtualTime(t);
  const relay = new NetRoom({ code: 'r', rules: true, maxPlayers: 8, tickHz: 20 });
  const beat = setInterval(() => relay.tick(), 250);
  class Socket {
    constructor() { this.readyState = 0; this.bufferedAmount = 0;
      this.wire = relay.attach({ send: text => setTimeout(() => { if (this.readyState === 1) this.onmessage?.({ data: text }); }, 20), close: () => this.close(), buffered: () => 0, idlePing: true });
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0); }
    send(text) { setTimeout(() => this.wire.onMessage(text), 20); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.wire.onClose(); }
  }
  const v = openRoom({ net: { config: { v: 1, url: 'ws://relay/socket', room: 'r', device: 'phone', want: 'play', name: 'P' }, WebSocketImpl: Socket, post: null } });
  t.after(() => { v.close(); clearInterval(beat); });
  await clock.wait(4000);
  assert.equal(v.status, 'playing');
  v.input({ ax: 0, ay: 0 });
  for (let i = 0; i < 40 && !relay.resting; i++) await clock.wait(250);
  assert.equal(relay.resting, true, 'the hosting page rested its room');
  const mine = () => JSON.stringify(relay.lastSnap.d[1].find(row => row[9] === 0)?.[3]);
  const snaps = relay.stats.snaps, p0 = mine();
  await clock.wait(5000);
  assert.equal(relay.stats.snaps, snaps, 'a resting browser host sends no snapshots');
  for (let i = 0; i < 40; i++) { v.input({ ax: 127, ay: 0 }); await clock.wait(250); }
  assert.equal(relay.resting, false, 'the held stick woke it');
  assert.notEqual(mine(), p0, 'and moved the body');
});
