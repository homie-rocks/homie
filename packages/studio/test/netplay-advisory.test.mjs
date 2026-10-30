/**
 * GHSA-px89-jm6h-gwww (reported by @bmoconnor1969-ai): one visitor must not be able to take a netplay room down,
 * or make a public room useless, for everyone else in it.
 *   - a message type the relay does not know shares the "other" rate bucket, so inventing a new type per message
 *     is dropped and then kicked for flooding (it used to get a fresh allowance and map entry every time);
 *   - a pool room (pub-N, s-<id>-<n>) ignores hello.max; a named room's first visitor may still lower it.
 * Run: node --test packages/studio/test/netplay-advisory.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { NetRoom } from '../worker/room.mjs';

test('invented message types share one rate bucket, so a flood is dropped and then kicked', () => {
  const room = new NetRoom({ code: 'main', maxPlayers: 8, now: () => 1_000_000 });
  let closed = null;
  const h = room.attach({ ip: '10.0.0.1', send() {}, close: (code, why) => { closed = why; } });
  h.onMessage(JSON.stringify({ t: 'hello', v: 1 }));
  let c = null;
  for (let i = 0; i < 50_000 && !closed; i += 1) { h.onMessage(JSON.stringify({ t: `z${i}` })); c ??= [...room.clients.values()][0]; }
  assert.ok(room.stats.drops > 0);
  assert.equal(closed, 'flood');
  assert.ok(c.rates.size <= 4, `rate buckets stay bounded (${c.rates.size})`);
});

test('junk types do not starve a known type', () => {
  const room = new NetRoom({ code: 'main', maxPlayers: 8, now: () => 1_000_000 });
  const out = [];
  const h = room.attach({ ip: '10.0.0.1', send: (s) => out.push(JSON.parse(s)), close() {} });
  h.onMessage(JSON.stringify({ t: 'hello', v: 1 }));
  for (let i = 0; i < 20; i += 1) h.onMessage(JSON.stringify({ t: `junk${i}` }));
  out.length = 0;
  h.onMessage(JSON.stringify({ t: 'ping', at: 1 }));
  assert.ok(!out.some((m) => m.t === 'error' && m.code === 'rate' && m.of === 'ping'));
});

const firstThenSecond = (opts) => {
  const room = new NetRoom({ maxPlayers: 8, ...opts });
  const out = [];
  room.attach({ ip: '9.9.9.9', send() {}, close() {} }).onMessage(JSON.stringify({ t: 'hello', v: 1, max: 1 }));
  room.attach({ ip: '10.0.0.2', send: (s) => out.push(JSON.parse(s)), close() {} }).onMessage(JSON.stringify({ t: 'hello', v: 1 }));
  return out.find((m) => m.t === 'welcome');
};

test('a public room ignores hello.max', () => {
  const w = firstThenSecond({ code: 'pub-1', lowerable: false });
  assert.equal(w.max, 8);
  assert.notEqual(w.seat, null);
});

test('a named room keeps the documented first-visitor hello.max', () => {
  const w = firstThenSecond({ code: 'friends' });
  assert.equal(w.max, 1);
});

test('a public room does not recover a lowered seat count from a save', () => {
  const room = new NetRoom({ code: 'pub-2', maxPlayers: 8, lowerable: false });
  room.restore({ v: room.constructor.VERSION ?? 1, room: 'pub-2', savedAt: Date.now(), maxPlayers: 1 });
  assert.equal(room.maxPlayers, 8);
});
