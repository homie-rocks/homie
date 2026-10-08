import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { bakeTile } from '@homie-rocks/nav/Bake.js';
import { config, field, tune } from './fixtures.mjs';
test('neighbour storage and probes are sparse at kilometre separation', () => {
  const source = readFileSync(new URL('../src/internal/Generated.ts', import.meta.url), 'utf8');
  const query = source.slice(source.indexOf('const updateNeighbours ='), source.indexOf('const updateLocalBoundaries ='));
  assert.doesNotMatch(query, /new Array\(gridSize\)/);
  assert.match(query, /new Map/);
  for (const gap of [20, 4000]) {
    const mesh = new Mesh(config, [1, 2, 1]);
    for (const offset of [0, gap]) mesh.loadTile(bakeTile(field(() => 0, offset - 2, offset - 2),
      config, offset / 10, offset / 10));
    const c = new Crowd(mesh, .05, .3);
    for (const offset of [0, gap]) for (let i = 0; i < 5; i++)
      c.add([offset + 2 + i, 0, offset + 2], { ...tune, neighbours: .75 });
    for (let i = 0; i < 100; i++) c.step();
    assert.equal(c.ids().length, 10);
  }
});
