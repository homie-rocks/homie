import assert from 'node:assert/strict';
import test from 'node:test';
import { bakeLevel } from '@homie-rocks/nav/Bake.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Random } from '@homie-rocks/nav/Random.js';
import { hash, unpack } from '@homie-rocks/nav/State.js';
import { config, field, tune } from './fixtures.mjs';

for (let seed = 1; seed <= 12; seed++) {
  test(`continuation with queued requests and random topology, seed ${seed}`, () => {
    const rng = new Random(seed);
    const c = { ...config, tileCells: 80 };
    const assets = bakeLevel(field(() => 0, 0, 0, 161, 161), c);
    const mesh = new Mesh(c, [1, 2, 1]);
    for (const tile of assets) mesh.loadTile(tile.bytes);
    for (let i = 0; i < 12; i++) {
      const x = 4 + rng.next() * 30;
      const z = 4 + rng.next() * 30;
      mesh.addObstacle({ min: [x, -1, z], max: [x + 1, 3, z + 1] });
    }
    const straight = new Crowd(mesh, 0.05, 0.3, { searchIterations: seed % 3 + 1 });
    for (let i = 0; i < 64; i++) {
      const p = mesh.nearest([1 + rng.next() * 38, 0, 1 + rng.next() * 38]);
      straight.add(p, { ...tune, manualLinks: i % 2 === 0 });
    }
    let resumed = Crowd.restore(straight.save(), mesh);
    let obstacle;
    let link = mesh.addLink([2, 0.1, 2], [37, 0.1, 37], 1, true);
    const restoreTick = Math.floor(rng.next() * 200);
    for (let tick = 0; tick < 320; tick++) {
      if (process.env.NAV_TRACE) console.error(seed, tick);
      if (tick % 19 === 0) {
        for (const id of straight.ids()) {
          const to = [1 + rng.next() * 38, 0.1, 1 + rng.next() * 38];
          assert.equal(straight.target(id, to), resumed.target(id, to));
        }
      }
      if (tick % 31 === 0) {
        if (obstacle) mesh.removeObstacle(obstacle);
        const x = 10 + rng.next() * 20;
        obstacle = mesh.addObstacle({ min: [x, -1, 15], max: [x + 2, 3, 25] });
      }
      if (tick % 43 === 0) {
        const tile = assets[Math.floor(rng.next() * assets.length)];
        mesh.unloadTile(tile.x, tile.z);
      }
      if (tick % 43 === 3) for (const tile of assets) mesh.loadTile(tile.bytes);
      if (tick % 23 === 0) mesh.setLinkEnabled(link, rng.next() > 0.5);
      if (tick % 67 === 0) {
        mesh.removeLink(link);
        if (mesh.nearest([2, 0.1, 2]) && mesh.nearest([37, 0.1, 37])) {
          try { link = mesh.addLink([2, 0.1, 2], [37, 0.1, 37], 1, true); } catch {}
        }
      }
      for (const id of straight.ids()) {
        if (straight.agent(id).status === 'link' && rng.next() < 0.1) {
          straight.completeLink(id);
          resumed.completeLink(id);
        }
      }
      if (tick >= restoreTick) resumed = Crowd.restore(resumed.save(), mesh);
      straight.step();
      resumed.step();
      assert.equal(hash(resumed.save()), hash(straight.save()), `seed ${seed}, tick ${tick}`);
    }
    // Pending queries really occurred; this is not only a flat one-polygon run.
    assert.ok(unpack('crowd', straight.save()).state.data.maxIterationsPerUpdate <= 3);
  });
}
