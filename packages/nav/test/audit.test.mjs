import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { pack, unpack } from '@homie-rocks/nav/State.js';
import { point } from '@homie-rocks/nav/Query.js';
import { crowd as backend, obstacleAvoidance } from '../dist/internal/Backend.js';
import { meshData, locate } from '../dist/internal/MeshData.js';
import { createSlicedNodePathQuery } from 'navcat';
import { flat, tune } from './fixtures.mjs';

test('omitted buffers are overwritten before use, including stale avoidance samples', () => {
  const mesh = flat();
  const wrapper = new Crowd(mesh, 0.05, 0.3, { searchIterations: 1 });
  for (let i = 0; i < 64; i++) {
    const id = wrapper.add([1 + (i % 8), 0.1, 1 + Math.floor(i / 8)], tune);
    wrapper.target(id, [9 - (i % 8), 0.1, 9 - Math.floor(i / 8)]);
  }
  for (let i = 0; i < 20; i++) wrapper.step();
  const fresh = unpack('crowd', wrapper.save()).state.data;
  const poisoned = unpack('crowd', wrapper.save()).state.data;
  for (const [data, poison] of [
    [fresh, false],
    [poisoned, true],
  ]) {
    for (const agent of Object.values(data.agents)) {
      if (!agent.slicedQuery) agent.slicedQuery = createSlicedNodePathQuery();
      const q = (agent.obstacleAvoidanceQuery = obstacleAvoidance.createObstacleAvoidanceQuery(
        32,
        32,
      ));
      agent.neis = poison ? [{ agentId: 'missing', dist: NaN }] : [];
      if (!poison) continue;
      if (agent.slicedQuery.status === 0) {
        agent.slicedQuery.nodes = { stale: [{ position: [NaN, NaN, NaN] }] };
        agent.slicedQuery.openList = [{ position: [NaN, NaN, NaN] }];
        agent.slicedQuery.lastBestNode = { position: [NaN, NaN, NaN] };
      }
      q.circleCount = q.segmentCount = 32;
      q.invHorizTime = q.invVmax = q.vmax = NaN;
      q.pattern.fill(NaN);
      for (const key of Object.keys(q.params)) q.params[key] = NaN;
      for (const circle of q.circles) {
        for (const key of ['p', 'vel', 'dvel', 'dp', 'np']) circle[key].fill(NaN);
        circle.rad = NaN;
      }
      for (const segment of q.segments) {
        segment.p.fill(NaN);
        segment.q.fill(NaN);
      }
    }
  }
  const persistent = (data) =>
    Object.fromEntries(
      Object.entries(data.agents).map(([id, a]) => [
        id,
        Object.fromEntries(
          Object.entries(a).filter(
            ([key]) =>
              !['neis', 'obstacleAvoidanceQuery', 'obstacleAvoidanceDebugData'].includes(key),
          ),
        ),
      ]),
    );
  for (let tick = 0; tick < 80; tick++) {
    if (tick === 15) mesh.addObstacle({ min: [4, -1, 3], max: [6, 3, 7] });
    if (tick === 35) {
      const goal = locate(mesh, [8, 0.1, 8]);
      for (const data of [fresh, poisoned])
        for (const id of Object.keys(data.agents))
          backend.requestMoveTarget(data, id, goal.nodeRef, goal.position);
    }
    backend.update(fresh, meshData(mesh).nav, 0.05);
    backend.update(poisoned, meshData(mesh).nav, 0.05);
    const a = persistent(fresh),
      b = persistent(poisoned);
    for (const agents of [a, b])
      for (const agent of Object.values(agents)) {
        if (agent.slicedQuery.status === 0) agent.slicedQuery = null;
      }
    assert.deepEqual(pack('agents', a), pack('agents', b));
  }
});

test('the pinned query exponent is only a square and agrees with multiplication', async () => {
  const source = await readFile(
    new URL('../../../node_modules/navcat/dist/index.js', import.meta.url),
    'utf8',
  );
  const operators = source.split('\n').filter((line) => /\*\*\s*\d/.test(line));
  assert.equal(operators.length, 1);
  assert.match(operators[0], /\*\* 2;/);
  let state = 7;
  for (let i = 0; i < 200_000; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const value = (state / 0xffffffff) * 1e6 + 0.001;
    assert.equal(value ** 2, value * value);
  }
});

test(
  'JavaScriptCore squares agree with multiplication',
  { skip: process.platform !== 'darwin' },
  () => {
    execFileSync('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc', [
      '-e',
      `
    let state = 7;
    for (let i = 0; i < 200000; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const value = (state / 0xffffffff) * 1e6 + 0.001;
      if (value ** 2 !== value * value) throw new Error('square differs');
    }
  `,
    ]);
  },
);

test('array-like points intentionally validate dimensions at runtime and ids reject wrong kinds', () => {
  assert.throws(() => point([1, 2]), /nav:/);
  const mesh = flat();
  const id = mesh.addCylinder([5, 0, 5], 1, 2);
  assert.equal(mesh.removeLink(id), false);
  assert.equal(mesh.removeDoor(id), false);
  assert.equal(mesh.removeObstacle(id), true);
});

test('shared package export exceptions require an explicit package opt-in', async () => {
  const source = await readFile(
    new URL('../../../scripts/test/engine-package.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /publicModules/);
  assert.doesNotMatch(source, /if \(pj\.exports\['\.\/\*\.js'\]\)/);
});
