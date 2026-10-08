import assert from 'node:assert/strict';
import test from 'node:test';
import { bakeLevel, heightfieldTriangles, checkConfig } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { config } from './fixtures.mjs';

for (const degrees of [5, 10, 20, 25, 30, 40, 45, 50, 55, 60]) {
  test(`ramps and hills at ${degrees} degrees respect the slope limit`, () => {
    for (const minY of [-2, -1.07, -0.33]) {
      for (const hill of [false, true]) {
        const k = Math.tan((degrees * Math.PI) / 180);
        const heightAt = hill
          ? (x, z) => 3 * k * (Math.sin(x / 3) * Math.sin(z / 3) + 1)
          : (x) => Math.max(0, x - 3) * k;
        const c = {
          ...config,
          minY,
          maxY: 50,
          slopeDegrees: degrees + 5,
          stepHeight: Math.max(
            0.3,
            Math.ceil((0.25 * Math.tan(((degrees + 5) * Math.PI) / 180)) / 0.1) * 0.1,
          ),
          tileCells: 80,
        };
        const geometry = heightfieldTriangles({ heightAt }, 0, 0, 81, 81, 0.25);
        const mesh = new Mesh(c, [0.3, 1, 0.3]);
        for (const tile of bakeLevel(geometry, c)) mesh.loadTile(tile.bytes);
        for (let x = 2; x <= 18; x += 2) {
          const p = [x, heightAt(x, 10), 10];
          assert.ok(mesh.nearest(p), `${hill ? 'hill' : 'ramp'}, minY ${minY}, x ${x}`);
          assert.ok(mesh.path([2, heightAt(2, 10), 10], p).complete);
        }
        if (!hill) {
          const limited = { ...c, slopeDegrees: degrees - 1 };
          const blocked = new Mesh(limited, [0.3, 1, 0.3]);
          for (const tile of bakeLevel(geometry, limited)) blocked.loadTile(tile.bytes);
          assert.equal(blocked.nearest([18, heightAt(18), 10]), null);
        }
      }
    }
  });
}

test('unsafe voxel slope configuration fails with a useful diagnostic', () => {
  assert.throws(() => checkConfig({ ...config, stepHeight: 0, slopeDegrees: 60 }), /nav:.*slope/);
});
