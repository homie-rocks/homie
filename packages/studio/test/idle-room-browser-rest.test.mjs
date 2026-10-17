/**
 * A browser-hosted rest survives the relay still ticking, a join during hibernation, and a host handoff.
 * Ending the rest while the next host restores the rest save starts every clock and then drops input.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineRules, compileRules, compileMap, roomSettings } from '../rules/rules.ts';
import { createHost } from '../rules/host.ts';
import { NetRoom } from '../worker/room.mjs';
import { fakeClock } from './rules-kit.mjs';

function page(room, name, conn = {}) {
  const frames = [];
  const wire = room.attach({ send: (s) => frames.push(JSON.parse(s)), close() {}, buffered: () => 0, ...conn });
  wire.onMessage(JSON.stringify({ t: 'hello', v: 1, rev: 11, rules: true, rest: 1, device: 'desk', want: 'play', canHost: true, name }));
  return { wire, frames, id: wire.id, welcome: frames.find((m) => m.t === 'welcome') };
}

const restSave = { rules: 'build', data: { rest: { on: true, at: [] } } };
const ckpt = (st) => ({ t: 'ckpt', rules: true, k: 40, st, d: restSave });

test('a resting browser host is not replaced for sending no snapshots', () => {
  let now = 10_000;
  const room = new NetRoom({ code: 'rest', rules: true, maxPlayers: 4, now: () => now, stallMs: 1500 });
  const a = page(room, 'A');
  const b = page(room, 'B');
  assert.equal(a.welcome.role, 'host');
  a.wire.onMessage(JSON.stringify({ t: 'rest', on: true }));
  a.wire.onMessage(JSON.stringify(ckpt(now)));
  assert.equal(room.resting, true);
  now += 8000;
  for (let i = 0; i < 6; i++) room.tick();
  assert.equal(room.hostId, a.id);
  assert.equal(room.resting, true);
  assert.equal(b.frames.some((m) => m.t === 'rest' && m.on === false), false);
});

test('a fresh edge ping keeps a resting host when somebody joins', () => {
  let now = 50_000;
  const room = new NetRoom({ code: 'ping', rules: true, maxPlayers: 4, now: () => now, silentMs: 2500 });
  const a = page(room, 'A', { lastPing: () => now - 400 });
  assert.equal(a.welcome.role, 'host');
  a.wire.onMessage(JSON.stringify({ t: 'rest', on: true }));
  a.wire.onMessage(JSON.stringify(ckpt(now)));
  room.clients.get(a.id).lastSeen = now - 60_000;
  now += 1000;
  const b = page(room, 'B');
  assert.equal(b.welcome.role, 'replica');
  assert.equal(room.hostId, a.id);
  assert.equal(room.resting, true);
  assert.equal(b.welcome.rest, true);
});

test('a resting host nobody has heard from is replaced, and the rest continues', () => {
  let now = 50_000;
  const room = new NetRoom({ code: 'gone', rules: true, maxPlayers: 4, now: () => now, silentMs: 2500 });
  const a = page(room, 'A', { lastPing: () => 0 });
  a.wire.onMessage(JSON.stringify({ t: 'rest', on: true }));
  a.wire.onMessage(JSON.stringify(ckpt(now)));
  room.clients.get(a.id).lastSeen = now - 60_000;
  now += 1000;
  const b = page(room, 'B');
  assert.equal(b.welcome.role, 'host');
  assert.equal(b.welcome.why, 'host-stalled');
  assert.equal(room.resting, true);
  assert.equal(b.welcome.rest, true);
  assert.equal(b.welcome.ckpt.d.data.rest.on, true);
  assert.equal(a.frames.some((m) => m.t === 'rest' && m.on === false), false);
});

test('a join that replaces a resting host with no rest save ends the rest', () => {
  let now = 50_000;
  const room = new NetRoom({ code: 'awake', rules: true, maxPlayers: 4, now: () => now, silentMs: 2500 });
  const a = page(room, 'A', { lastPing: () => 0 });
  a.wire.onMessage(JSON.stringify({ t: 'rest', on: true }));
  room.clients.get(a.id).lastSeen = now - 60_000;
  now += 1000;
  const b = page(room, 'B');
  assert.equal(b.welcome.role, 'host');
  assert.equal(room.resting, false);
  assert.equal(b.welcome.rest, undefined);
  assert.equal(b.frames.some((m) => m.t === 'rest' && m.on === false), true);
});

test('a handoff keeps a rest whose checkpoint says so, and ends one that has no such save', () => {
  let now = 10_000;
  const kept = new NetRoom({ code: 'keep', rules: true, maxPlayers: 4, now: () => now });
  const host = page(kept, 'A');
  const next = page(kept, 'B');
  host.wire.onMessage(JSON.stringify({ t: 'rest', on: true }));
  host.wire.onMessage(JSON.stringify(ckpt(now)));
  assert.equal(kept.elect(host.id, 'host-hidden').id, next.id);
  assert.equal(kept.resting, true);
  assert.equal(next.frames.some((m) => m.t === 'rest' && m.on === false), false);
  const role = next.frames.find((m) => m.t === 'role');
  assert.equal(role.ckpt.d.data.rest.on, true);

  const dropped = new NetRoom({ code: 'drop', rules: true, maxPlayers: 4, now: () => now });
  const old = page(dropped, 'A');
  const other = page(dropped, 'B');
  old.wire.onMessage(JSON.stringify({ t: 'rest', on: true }));
  dropped.elect(old.id, 'host-hidden');
  assert.equal(dropped.resting, false);
  assert.equal(other.frames.some((m) => m.t === 'rest' && m.on === false), true);
});

test('pause while people remain does not end a rest, and an empty rest still pauses', () => {
  const clock = fakeClock();
  const sent = [];
  const { settings } = roomSettings({ rest: 'idle', restSeconds: 1 });
  const compiled = compileRules(defineRules({
    contract: 2, space: { dims: 2 }, shapes: { events: {} },
    entities: { participant: { player: true } },
    room: { join() { return { kind: 'participant', at: { x: 0, y: 0, z: 0 } }; } },
  }), { map: compileMap({ bounds: { min: [-1, -1], max: [1, 1] } }), seats: 2, settings });
  const host = createHost({ game: 'rest', compiled, clock, random: () => 0.4, onRest: () => {}, send: (m) => sent.push(m) });
  try {
    host.frame({ t: 'join', peer: { id: 'a', seat: 0, occ: 1, rest: true }, rest: true });
    clock.advance(3000);
    assert.equal(host.resting, true, 'an idle room rests once nobody has played');
    const n = sent.length;
    host.pause();
    assert.equal(host.resting, true);
    assert.equal(host.paused, false);
    assert.equal(sent.slice(n).some((m) => m.t === 'rest' && m.on === false), false);
    host.frame({ t: 'leave', seat: 0 });
    assert.equal(host.people, 0);
    assert.equal(host.resting, false);
    assert.equal(host.paused, true);
    assert.equal(sent.slice(n).some((m) => m.t === 'rest' && m.on === false), true);
  } finally { host.stop(); }
});
