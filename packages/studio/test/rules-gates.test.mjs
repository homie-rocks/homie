import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batchLink, multiplexSession, roomLayout } from '../worker/gate.mjs';
import { fakeClock } from './rules-kit.mjs';
import { seatCount, perAddress } from '../worker/seats.mjs';
import { scheduledView, snapshotEncoder, snapshotDecoder } from '../rules/interest.mjs';

function socket() {
  const events = new Map();
  return { sent: [], addEventListener(t, fn) { const list = events.get(t) ?? []; list.push(fn); events.set(t, list); },
    emit(t, value) { for (const fn of events.get(t) ?? []) fn(value); }, send(text) { this.sent.push(JSON.parse(text)); }, close() { this.emit('close', {}); } };
}
test('room layouts scale without imposing an admission ceiling; carrier addresses have no default limit', () => {
  assert.deepEqual(roomLayout(300), { gates: 5, concentrators: 0 });
  assert.deepEqual(roomLayout(1000), { gates: 16, concentrators: 2 });
  assert.deepEqual(roomLayout(1280), { gates: 20, concentrators: 3 });
  assert.equal(seatCount(1000), 1000);
  assert.equal(perAddress(300), 0);
});
test('virtual-time batches retain every input and command in order, and stop on link death', () => {
  const clock = fakeClock(), peer = socket();
  const link = batchLink(peer, { setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  for (let i = 0; i < 300; i++) link.send(['data', String(i % 20), JSON.stringify({ t: i % 3 ? 'in' : 'ev', k: i })]);
  clock.advance(5);
  assert.deepEqual(peer.sent.flat().map(row => JSON.parse(row[2]).k), Array.from({ length: 300 }, (_, i) => i));
  link.send(['data', '0', 'pending']); link.close(); clock.advance(1000);
  assert.equal(peer.sent.flat().length, 300);
});
test('multiplex admission awaits attach, preserves commands, and closes every logical connection on Gate death', async () => {
  const peer = socket(), attached = [], messages = [], left = [];
  const session = multiplexSession(peer, async (req, conn) => {
    await Promise.resolve();
    const id = new URL(req.url).searchParams.get('id');
    attached.push(id);
    conn.addEventListener('message', event => messages.push([id, event.data]));
    conn.addEventListener('close', () => left.push(id));
  });
  const batch = [];
  for (let i = 0; i < 1000; i++) batch.push(['open', String(i), `https://table/__net?id=${i}`], ['data', String(i), 'hello'], ['data', String(i), 'command']);
  peer.emit('message', { data: JSON.stringify(batch) });
  await session.settled();
  assert.equal(attached.length, 1000); assert.equal(messages.length, 2000);
  assert.deepEqual(messages.slice(0, 2), [['0', 'hello'], ['0', 'command']]);
  peer.close(); peer.close(); assert.equal(left.length, 1000);
});
test('scheduled delivery keeps controlled state exact, updates far bodies on virtual ticks, removes exits immediately', () => {
  const own = ['a', 0, 0, [0.123456,0,0], [1,0,0], [1,0,0], 0, [], [], 0, 0];
  const far = ['b', 0, 0, [8.123456,0,0], [1,0,0], [1,0,0], 0, [], []];
  const select = scheduledView({ radiusM: 12, nearM: 4, farHz: 5, precisionM: .01 }, 20);
  const snap = (k, rows) => ({ e: 1, k, d: [[], rows], c: [] });
  const first = select(snap(1,[own,far]), 0);
  assert.deepEqual(first.d[1][0], own); assert.equal(first.d[1][1][3][0], 8.12);
  const moved = [...far]; moved[3] = [9.87654,0,0];
  assert.equal(select(snap(2,[own,moved]), 0).d[1][1][3][0], 8.12);
  assert.equal(select(snap(4,[own,moved]), 0).d[1][1][3][0], 9.88);
  moved[3] = [20,0,0]; assert.equal(select(snap(5,[own,moved]), 0).d[1].length, 1);
});
test('ordered deltas reject a missing predecessor and recover at the periodic keyframe or new epoch', () => {
  const encoder = snapshotEncoder(4, true), decoder = snapshotDecoder();
  const snap = k => ({ e: 1, k, d: [[], [['a',0,0,[k,0,0],[0,0,0],[1,0,0],0,[],[]]]], c: [] });
  decoder.decode(encoder.encode(snap(1)));
  encoder.encode(snap(2));
  assert.equal(decoder.decode(encoder.encode(snap(3))), null);
  assert.deepEqual(decoder.decode(encoder.encode(snap(5))), snap(5));
});
