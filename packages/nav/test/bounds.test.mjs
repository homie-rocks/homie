import assert from 'node:assert/strict';
import test from 'node:test';
import { Mesh } from '../dist/Mesh.js';
import { Crowd } from '../dist/Crowd.js';
import { bakeTile } from '../dist/Bake.js';
import { pack, unpack } from '../dist/internal/Binary.js';
import { config, field, tune } from './fixtures.mjs';
const asset = bakeTile(field(), config, 0, 0);
const mesh = new Mesh(config, [1, 2, 1]);
mesh.loadTile(asset);
const crowd = new Crowd(mesh, 0.05, 0.3);
crowd.add([2, 0, 2], tune);
for (const [name, mutate] of [
  [
    'leaf polygon index',
    (s) => {
      s.baked.bvTree.nodes[0].i = 2 ** 31;
    },
  ],
  [
    'tree escape count',
    (s) => {
      s.baked.bvTree.nodes[0].i = -(2 ** 31);
    },
  ],
  [
    'detail vertex index',
    (s) => {
      s.baked.detailTriangles[0] = 2 ** 31;
    },
  ],
  [
    'polygon neighbour index',
    (s) => {
      s.baked.polys[0].neis[0] = 2 ** 31;
    },
  ],
])
  test(`checksummed tile rejects invalid ${name}`, () => {
    const s = unpack('tile', asset);
    mutate(s);
    assert.throws(() => new Mesh(config, [1, 2, 1]).loadTile(pack('tile', s)), /^Error: nav:/);
  });
for (const [name, mutate] of [
  [
    'tile width',
    (s) => {
      s.nav.tileWidth = 1e-300;
    },
  ],
  [
    'origin',
    (s) => {
      s.nav.origin = [1e8, 0, 0];
    },
  ],
])
  test(`checksummed mesh rejects inconsistent ${name}`, () => {
    const s = unpack('mesh', mesh.save());
    mutate(s);
    assert.throws(() => Mesh.restore(pack('mesh', s), [asset]), /^Error: nav:/);
  });
for (const [name, mutate] of [
  [
    'query extents',
    (s) => {
      s.state.data.agentPlacementHalfExtents = [1e7, 1e7, 1e7];
    },
  ],
  [
    'search budget',
    (s) => {
      s.state.data.maxIterationsPerUpdate = 2 ** 31;
    },
  ],
  [
    'walking position with no floor',
    (s) => {
      s.state.data.agents[1].position = [4000, 0, 4000];
    },
  ],
])
  test(`checksummed crowd rejects invalid ${name}`, () => {
    const s = unpack('crowd', crowd.save());
    mutate(s);
    assert.throws(() => Crowd.restore(pack('crowd', s), mesh), /^Error: nav:/);
  });

test('mesh headers cannot replace the validated asset geometry', () => {
  const s = unpack('mesh', mesh.save());
  Object.values(s.nav.tiles)[0].bvTree = {nodes: [{bounds: [0, 0, 0, 9, 9, 9], i: 2147483647}], quantFactor: 1};
  assert.throws(() => Mesh.restore(pack('mesh', s), [asset]), /^Error: nav:/);
});
