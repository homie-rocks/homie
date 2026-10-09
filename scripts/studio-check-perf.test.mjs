import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perfProblems } from './studio-check-perf.mjs';
const runs = (server) => ['computer', 'phone'].map((device) => ({ device, room: server ? { hosted: 'server' } : null, renderer: 'SwiftShader', blocked: 'software', browsers: (server ? ['replica', 'replica-2'] : ['host', 'replica']).map((role) => ({ role, netplay: { hosted: server ? 'server' : 'browser' }, load: { playableMs: 200 }, frames: { n: 30, p95: 50 }, main: { busyPerFrame: 2 }, heap: { afterGcMb: 3 }, net: { msgsOut: 20 } })) }));
test('fresh studio perf accepts server replicas and browser hosting, with all numbers on both devices', () => {
  assert.deepEqual(perfProblems(runs(true), { hosted: 'server' }), []);
  assert.deepEqual(perfProblems(runs(false)), []);
  assert.ok(perfProblems(runs(true)).length);
  assert.ok(perfProblems(runs(false), { hosted: 'server' }).length);
  const r = runs(true); delete r[1].browsers[1].main.busyPerFrame;
  assert.match(perfProblems(r, { hosted: 'server' }).join(), /phone replica-2: no main.busyPerFrame/);
  r[0].room = null; r[0].blocked = null;
  assert.match(perfProblems(r, { hosted: 'server' }).join(), /no server host evidence/);
  assert.match(perfProblems(r, { hosted: 'server' }).join(), /not blocked/);
});
