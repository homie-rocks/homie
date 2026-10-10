import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interestSnapshot, snapshotEncoder, snapshotDecoder } from '../rules/interest.mjs';

const entity = (id, x, seat = undefined, z = 0) => [String(id), 0, 0, [x, 0, z], [0, 0, 0], [1, 0, 0], 1, [17], [], ...(seat === undefined ? [] : [seat, 0, 0, '', null])];
const snapshot = (k, entities, e = 1) => ({ k, e, st: k * 50, d: [[1, 1, 1200], entities], c: [[0, 0, k, 0], [1, 0, k, 0]] });
const sorted = snap => ({ ...snap, d: [snap.d[0], snap.d[1].toSorted((a, b) => a[0].localeCompare(b[0]))] });

test('interest includes the own body and the radius boundary in 3D; absent body receives no entities; watchers get overview', () => {
  const s = snapshot(1, [entity('own', 0, 0), entity('near', 4), entity('edge', 5), entity('far', 6), entity('up', 0, undefined, 6)]);
  assert.deepEqual(interestSnapshot(s, 0, 5).d[1].map(e => e[0]), ['own', 'near', 'edge']);
  assert.deepEqual(interestSnapshot(s, 0, 0).d[1].map(e => e[0]), ['own']);
  assert.equal(interestSnapshot(s, 0, null).d[1].length, 5);
  assert.equal(interestSnapshot(s, null, 5).d[1].length, 5);
  assert.deepEqual(interestSnapshot(s, 4, 5).d[1], []);
  assert.deepEqual(interestSnapshot(s, 0, 5).c, [[0, 0, 1, 0]]);
});

test('seeded state deltas reconstruct movement, fields, interest exits and reentry despite lost intermediate frames', () => {
  const encoder = snapshotEncoder(20), decoder = snapshotDecoder();
  let seed = 71;
  const rng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let k = 1; k <= 200; k++) {
    const entities = [entity('own', 0, 0)];
    for (let i = 1; i <= 300; i++) if (rng() > .1) {
      const e = entity(i, Math.floor(rng() * 12)); e[7] = [Math.floor(rng() * 30)]; entities.push(e);
    }
    const s = interestSnapshot(snapshot(k, entities), 0, 5);
    const wire = JSON.parse(JSON.stringify(encoder.encode(s)));
    if (k % 7 === 0 && !Array.isArray(wire.d)) continue;
    assert.deepEqual(sorted(decoder.decode(wire)), sorted(s), `tick ${k}`);
  }
});

test('missing keyframe is never patched against stale state; keyframe, reconnect and epoch reset recover', () => {
  const encoder = snapshotEncoder(3), decoder = snapshotDecoder();
  decoder.decode(encoder.encode(snapshot(1, [entity(1, 0)])));
  encoder.encode(snapshot(4, [entity(1, 4)])); // lost keyframe
  assert.equal(decoder.decode(encoder.encode(snapshot(5, [entity(1, 5)]))), null);
  const s = snapshot(7, [entity(2, 7)]);
  assert.deepEqual(decoder.decode(encoder.encode(s)), s);
  encoder.reset(); decoder.reset();
  const resumed = snapshot(8, [entity(2, 8)]);
  assert.deepEqual(decoder.decode(encoder.encode(resumed)), resumed);
  const restarted = snapshot(1, [entity(3, 0)], 2);
  assert.deepEqual(decoder.decode(encoder.encode(restarted)), restarted);
});

test('300 simulated clients receive their own control rows and spatial state on virtual time', async () => {
  const { interestWorkload } = await import('./rules-interest-workload.mjs');
  const result = await interestWorkload({ ticks: process.env.RULES_EXTENDED ? 36000 : 60, measure: !!process.env.RULES_EXTENDED });
  assert.ok(result.peakVisible < 50, 'a local neighbourhood, not all 300 bodies');
  if (process.env.RULES_EXTENDED) console.log(JSON.stringify(result));
});


test('malformed snapshots do not throw in the view or overwrite a valid keyframe', () => {
  const decoder = snapshotDecoder();
  const base = snapshot(1, [entity(1, 0)]);
  assert.deepEqual(decoder.decode(base), base);
  for (const d of [null, [], [[], null], [[], [null]], {base:1}, {base:1,round:[],removed:[],changed:[null]}])
    assert.equal(decoder.decode({...base,k:2,d}), null);
  const encoder = snapshotEncoder(20); encoder.encode(base);
  const next = snapshot(2, [entity(1, 3)]);
  assert.deepEqual(decoder.decode(encoder.encode(next)), next);
});

test('relay backpressure does not advance a client baseline; welcome and watcher overview use the delivery role', async () => {
  const { NetRoom } = await import('../worker/room.mjs');
  const room = new NetRoom({ code:'r', rules:true, maxPlayers:2, tickHz:20, now:()=>1000 });
  room.setServerHost({ viewRadiusM:5, frame(){}, facts(){return {};} });
  const connect = (token, watch = false) => {
    const c = { messages:[], congested:false };
    const h = room.attach({ watch, send:text=>c.messages.push(JSON.parse(text)), close(){}, buffered:()=>c.congested?300000:0 });
    h.onMessage(JSON.stringify({t:'hello',v:1,rev:11,rules:true,name:'A',want:'play',device:'desk',token}));
    return c;
  };
  const a = connect();
  const token = a.messages.find(m=>m.t==='welcome').token;
  const decoder = snapshotDecoder();
  room.hostFrame({t:'snap',...snapshot(1,[entity('own',0,0),entity('far',30,1)])});
  assert.deepEqual(decoder.decode(a.messages.at(-1)).d[1].map(e=>e[0]),['own']);
  a.congested=true;
  room.hostFrame({t:'snap',...snapshot(2,[entity('own',1,0),entity('far',30,1)])});
  a.congested=false;
  room.hostFrame({t:'snap',...snapshot(3,[entity('own',2,0),entity('far',30,1)])});
  assert.equal(decoder.decode(a.messages.at(-1)).d[1][0][3][0],2);
  const resumed=connect(token).messages.find(m=>m.t==='welcome');
  assert.equal(resumed.seat,0);
  assert.deepEqual(resumed.snap.d[1].map(e=>e[0]),['own']);
  const watcher=connect(undefined,true).messages.find(m=>m.t==='welcome');
  assert.equal(watcher.seat,null);
  assert.deepEqual(watcher.snap.d[1].map(e=>e[0]),['own','far']);
});


test('seeded interest-edge collider revisions survive deltas, loss, edits and reconnect', () => {
  let seed = 8441;
  const rng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const encoder = snapshotEncoder(20), decoder = snapshotDecoder();
  for (let k = 1; k <= 120; k++) {
    // The centre crosses interest; its near face remains reachable by a sweep.
    const x = 5 + (rng() - .5) * .2;
    const s = snapshot(k, [entity('own', 0, 0), entity('wall', x)]);
    const collision = [k, k + 1, k % 11 ? [['wall', 'box', x, 0, 0, 2, 4, 3]] : []];
    s.d.push(collision);
    if (k === 61) { encoder.reset(); decoder.reset(); }
    const selected = interestSnapshot(s, 0, 5);
    assert.equal(selected.d[1].some(e => e[0] === 'wall'), x <= 5);
    const wire = JSON.parse(JSON.stringify(encoder.encode(selected)));
    if (k % 7 === 0 && !Array.isArray(wire.d)) continue;
    const received = decoder.decode(wire);
    assert.deepEqual(received.d[2], collision, `current geometry at tick ${k}`);
    assert.deepEqual(sorted(received), sorted(selected));
  }
});
