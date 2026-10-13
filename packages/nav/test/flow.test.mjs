import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bakeGridFlow } from '@homie-rocks/nav/Flow.js';

test('cardinal flow has shortest distances on seeded wrapped and bounded grids', () => {
  let seed = 4700;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
  for (const wrapX of [false, true]) for (const wrapY of [false, true]) for (let run = 0; run < 20; run++) {
    const width = 13, height = 11;
    const data = Array.from({ length: 143 }, () => random() < .25 ? 1 : 0);
    data[0] = data[142] = 0;
    const grid = { width, height, data, wrapX, wrapY }, goals = [0, 142];
    let units = 0;
    const f = bakeGridFlow(grid, goals, n => units += n);
    // Independent repeated relaxation, no queue or flow baker traversal.
    const costs = data.map(() => Infinity);
    costs[0] = costs[142] = 0;
    for (let pass = 0; pass < data.length; pass++) for (let i = 0; i < data.length; i++) if (!data[i]) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        let x = i % width + dx, y = Math.floor(i / width) + dy;
        if (wrapX) x = (x + width) % width;
        if (wrapY) y = (y + height) % height;
        if (x >= 0 && x < width && y >= 0 && y < height && !data[y * width + x]) {
          costs[i] = Math.min(costs[i], costs[y * width + x] + 1);
        }
      }
    }
    assert.deepEqual([...f.distance], costs.map(n => Number.isFinite(n) ? n : -1));
    for (let i = 0; i < data.length; i++) if (f.distance[i] > 0) assert.equal(f.distance[f.next[i]], f.distance[i] - 1);
    assert.equal(units, data.length * 4 + 4 + 16 * costs.filter(Number.isFinite).length);
    assert.deepEqual(bakeGridFlow(grid, goals), f);
  }
});

test('flow bake charges allocation first and validates goals', () => {
  assert.throws(() => bakeGridFlow({ width: 100, height: 100, data: Array(10000).fill(0) }, [0], () => {
    throw Error('quota');
  }), /quota/);
  assert.throws(() => bakeGridFlow({ width: 2, height: 2, data: [0, 0, 0, 0] }, [4]), /outside/);
});
