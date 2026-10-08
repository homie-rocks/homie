import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { bakeTile } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { config, field, tune } from '../fixtures.mjs';

test('micro-performance: full bake, queries, and 300 moving agents', () => {
  const c = { ...config, tileCells: 160 },
    triangles = field(() => 0, -2, -2, 177, 177);
  const bakeTimes = [],
    queryTimes = [],
    stepTimes = [];
  let bytes;
  for (let i = 0; i < 4; i++) {
    const start = performance.now();
    bytes = bakeTile(triangles, c, 0, 0);
    if (i) bakeTimes.push(performance.now() - start);
  }
  const mesh = new Mesh(c, [2, 2, 2]);
  mesh.loadTile(bytes);
  mesh.addObstacle({ min: [18, -1, 5], max: [22, 4, 35] });
  for (let i = 0; i < 1100; i++) {
    const start = performance.now(),
      path = mesh.path([2, 0.1, 2 + (i % 35)], [38, 0.1, 38 - (i % 35)]);
    assert.ok(path.complete);
    if (i >= 100) queryTimes.push(performance.now() - start);
  }
  const crowd = new Crowd(mesh, 1 / 20, 0.3),
    ids = [];
  for (let i = 0; i < 300; i++) {
    const x = 1 + (i % 15),
      z = 1 + Math.floor(i / 15) * 1.8;
    const id = crowd.add([x, 0.1, z], tune);
    ids.push(id);
    crowd.target(id, [40 - x, 0.1, z]);
  }
  for (let i = 0; i < 150; i++) {
    const start = performance.now();
    crowd.step();
    if (i >= 30) stepTimes.push(performance.now() - start);
  }
  assert.ok(ids.every((id) => [...crowd.agent(id).position].every(Number.isFinite)));
  assert.ok(
    ids.some((id) => crowd.agent(id).position[0] > 16),
    'agents actually moved',
  );
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const p95 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
  console.log(
    JSON.stringify({
      machine: cpus()[0].model,
      node: process.version,
      triangles: triangles.indices.length / 3,
      bakeMs: median(bakeTimes),
      queryMedianMs: median(queryTimes),
      queryP95Ms: p95(queryTimes),
      agents: 300,
      crowdMedianMs: median(stepTimes),
      crowdP95Ms: p95(stepTimes),
      tileBytes: bytes.length,
    }),
  );
});
