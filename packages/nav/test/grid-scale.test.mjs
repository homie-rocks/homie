import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Grid } from '@homie-rocks/nav/Grid.js';

test('Grid bundle excludes navcat and unused path finders', async () => {
  const result = await build({
    entryPoints: ['packages/nav/dist/Grid.js'],
    bundle: true,
    platform: 'neutral',
    format: 'esm',
    minify: true,
    write: false,
    metafile: true,
  });
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.every((p) => !p.includes('navcat') && !p.includes('AStarFinder')));
  assert.ok(result.outputFiles[0].contents.length < 30_000);
});

test('large obstructed grid queries return the nearest cell and complete octile route', () => {
  const grid = new Grid(2000, 2000, 1, [0, 0, 0]);
  grid.setBlocked(1000, 1000, true);
  for (let i = 0; i < 20; i++) {
    const p = grid.nearest([1000.5, 0, 1000.5], [0.5, 0, 0.5]);
    assert.ok(Math.hypot(p[0] - 1000.5, p[2] - 1000.5) <= 1);
  }
  let probes = 0;
  const free = grid.free.bind(grid);
  grid.free = (...args) => {
    probes++;
    return free(...args);
  };
  const path = grid.path([0.5, 0, 10.5], [1999.5, 0, 1998.5], {
    search: 'jps',
  });
  assert.ok(path.complete);
  assert.ok(probes <= 8_000, `clear octile route probes ${probes} cells`);
});
