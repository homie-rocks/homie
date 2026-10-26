import test from 'node:test';
import { checkEdits } from './topology/edits.mjs';
test('links and tile replacements at fixed offsets', checkEdits);

import assert from 'node:assert/strict';
import { Mesh } from '../dist/Mesh.js';
import { Crowd } from '../dist/Crowd.js';
import { makeScene } from './scale-scene.mjs';
import { unpack, pack } from '../dist/internal/Binary.js';
import { meshData } from '../dist/internal/MeshData.js';
import { isValidNodeRef } from 'navcat';
import { flat, config, field, tune } from './fixtures.mjs';
import { bakeTile } from '../dist/Bake.js';

for (const searchIterations of [1, 3, undefined]) {
  test(`every-tick edits repair all crowd references, budget ${searchIterations}`, () => {
    const { mesh, assets } = makeScene(40, 0, true, true);
    let link = mesh.addLink([2, 0.1, 2], [38, 0.1, 38], 1, true);
    const crowds = [
      new Crowd(mesh, 0.05, 0.3, { searchIterations }),
      new Crowd(mesh, 0.05, 0.3, { searchIterations }),
    ];
    for (const c of crowds)
      for (let i = 0; i < (process.env.NAV_FULL ? 300 : 12); i++) {
        const p = mesh.nearest([1 + (i % 30), 0.1, 1 + Math.floor(i / 30)]);
        c.add(p, tune);
      }
    let obstacle;
    for (let tick = 0; tick < 160; tick++) {
      for (const c of crowds) for (const id of c.ids()) c.target(id, [38, 0.1, 38]);
      switch (tick % 8) {
        case 0:
          mesh.loadTile(assets[0].bytes);
          break;
        case 1:
          obstacle = mesh.addObstacle({ min: [19, -1, 19], max: [21, 3, 21] });
          break;
        case 2:
          mesh.removeObstacle(obstacle);
          break;
        case 3:
          mesh.unloadTile(assets[0].x, assets[0].z);
          break;
        case 4:
          mesh.loadTile(assets[0].bytes);
          break;
        case 5:
          mesh.setLinkEnabled(link, false);
          break;
        case 6:
          mesh.removeLink(link);
          break;
        case 7:
          link = mesh.addLink([2, 0.1, 2], [38, 0.1, 38], 1, true);
          break;
      }
      for (const c of crowds) {
        const state = unpack('crowd', c.save()).state;
        assert.equal(state.revision, mesh.revision);
        for (const a of Object.values(state.data.agents)) {
          const refs = [
            ...a.corridor.path,
            ...a.boundary.polys,
            ...a.corners.map((x) => x.nodeRef),
          ];
          if (a.targetRef !== null) refs.push(a.targetRef);
          if (a.offMeshAnimation) refs.push(a.offMeshAnimation.nodeRef);
          for (const ref of refs)
            assert.ok(ref === null || ref === -1 || isValidNodeRef(meshData(mesh).nav, ref));
          if (a.slicedQuery)
            for (const nodes of Object.values(a.slicedQuery.nodes))
              for (const node of nodes) assert.ok(isValidNodeRef(meshData(mesh).nav, node.nodeRef));
        }
        c.step();
      }
      assert.deepEqual(crowds[0].save(), crowds[1].save());
    }
  });
}

test('stranded requests persist and resume when the floor returns', () => {
  const mesh = flat(),
    c = new Crowd(mesh, 0.05, 0.3);
  const id = c.add([1, 0.1, 1], tune);
  mesh.unloadTile(0, 0);
  assert.equal(c.target(id, [8, 0.1, 8]), false);
  const bytes = c.save();
  const restored = Crowd.restore(bytes, mesh);
  mesh.loadTile(bakeTile(field(), config, 0, 0));
  for (let i = 0; i < 200; i++) {
    c.step();
    restored.step();
  }
  assert.ok(c.arrived(id, 0.5));
  assert.deepEqual(c.save(), restored.save());
});

test('new agents serialize identically after a wake', () => {
  const mesh = flat(),
    c = new Crowd(mesh, 0.05, 0.3);
  c.add([1, 0.1, 1], tune);
  const restored = Crowd.restore(c.save(), mesh);
  c.add([2, 0.1, 2], tune);
  restored.add([2, 0.1, 2], tune);
  assert.deepEqual(c.save(), restored.save());
});

test('checksum-valid malformed mesh and crowd structures are refused immediately', () => {
  const mesh = flat();
  mesh.addLink([1, 0.1, 1], [8, 0.1, 8], 1, true);
  const asset = bakeTile(field(), config, 0, 0);
  for (const corrupt of [
    (s) => {
      s.nextId = 1;
    },
    (s) => {
      s.nav.nodes = 'x';
    },
    (s) => {
      s.nav.links = [];
    },
    (s) => {
      s.nav.nodes[0].tileId = -1;
    },
    (s) => {
      s.nav.nodeIndexPool.free = [0];
    },
    (s) => {
      s.nav.tileColumnToTileIds = { '0,0': [999] };
    },
  ]) {
    const state = unpack('mesh', mesh.save());
    corrupt(state);
    assert.throws(() => Mesh.restore(pack('mesh', state), [asset]), /^Error: nav:/);
  }
  const c = new Crowd(mesh, 0.05, 0.3),
    id = c.add([1, 0.1, 1], tune);
  for (const [key, value] of [
    ['maxSpeed', -5],
    ['radius', 50],
    ['height', 50],
    ['separationWeight', -1],
  ]) {
    const state = unpack('crowd', c.save());
    state.state.data.agents[id][key] = value;
    assert.throws(() => Crowd.restore(pack('crowd', state), mesh), /^Error: nav:/);
  }
  const state = unpack('crowd', c.save());
  state.state.data.agents[id].obstacleAvoidance.adaptiveDepth = 999999;
  assert.throws(() => Crowd.restore(pack('crowd', state), mesh), /^Error: nav:/);
});

test('rebuild order is independent of asset order after streaming', async () => {
  await import('./topology/order.mjs');
});

test('a mid-link target waits for a streamed-out landing floor', () => {
  const { mesh, assets } = makeScene(40, 0, false, true);
  const link = mesh.addLink([2, 0.1, 2], [35, 0.1, 35], 1, true);
  const c = new Crowd(mesh, 0.05, 0.3);
  const id = c.add([1, 0.1, 1], { ...tune, manualLinks: true });
  // Separate islands force the link, then remove its landing while paused.
  const obstacle = mesh.addObstacle({ min: [10, -1, -1], max: [30, 3, 41] });
  c.target(id, [38, 0.1, 38]);
  for (let tick = 0; tick < 100 && c.agent(id).status !== 'link'; tick++) c.step();
  assert.equal(c.agent(id).link, link);
  for (const tile of assets) mesh.unloadTile(tile.x, tile.z);
  assert.equal(c.target(id, [36, 0.1, 36]), false);
  for (let tick = 0; tick < 10; tick++) c.step();
  const restored = Crowd.restore(c.save(), mesh);
  assert.deepEqual(restored.save(), c.save());
  c.completeLink(id);
  restored.completeLink(id);
  assert.equal(c.agent(id).status, 'stranded');
  mesh.removeObstacle(obstacle);
  for (const tile of assets) mesh.loadTile(tile.bytes);
  for (let tick = 0; tick < 100; tick++) {
    c.step();
    restored.step();
  }
  assert.deepEqual(restored.save(), c.save());
  assert.ok(c.arrived(id, 0.5));
});
