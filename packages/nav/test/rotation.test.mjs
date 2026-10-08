import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { bakeLevel } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { trianglesFromObject3D, debugMesh, disposeDebugMesh } from '@homie-rocks/nav/Three.js';
import { config, field, tune } from './fixtures.mjs';
const rotate = ([x, y, z]) => [x, -z, y];

test('z-up is a proper rotation, including avoidance and three helpers', () => {
  const input = field(() => 0, 0, 0, 81, 81);
  const rotated = { indices: input.indices, positions: [] };
  for (let i = 0; i < input.positions.length; i += 3) {
    rotated.positions.push(...rotate(input.positions.slice(i, i + 3)));
  }
  const crowds = ['y', 'z'].map(up => {
    const c = { ...config, up };
    const mesh = new Mesh(c, [1, 1, 1]);
    for (const t of bakeLevel(up === 'y' ? input : rotated, c)) mesh.loadTile(t.bytes);
    const crowd = new Crowd(mesh, 0.05, 0.3);
    for (let i = 0; i < 24; i++) {
      const start = [i % 2 ? 17 : 3, 0.1, 3 + Math.floor(i / 2)];
      const end = [20 - start[0], 0.1, start[2]];
      const id = crowd.add(up === 'z' ? rotate(start) : start, tune);
      crowd.target(id, up === 'z' ? rotate(end) : end);
    }
    return crowd;
  });
  for (let tick = 0; tick < 320; tick++) {
    for (const c of crowds) c.step();
    for (const id of crowds[0].ids()) {
      const expected = rotate(crowds[0].agent(id).position);
      assert.deepEqual(crowds[1].agent(id).position, expected, `tick ${tick}, agent ${id}`);
    }
  }
  const object = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4));
  const y = trianglesFromObject3D(object).positions;
  const z = trianglesFromObject3D(object, { up: 'z' }).positions;
  for (let i = 0; i < y.length; i += 3) assert.deepEqual([...z.slice(i, i + 3)], rotate(y.slice(i, i + 3)));
  const a = debugMesh(crowds[0].mesh, crowds[0]);
  const b = debugMesh(crowds[1].mesh, crowds[1]);
  assert.deepEqual(a.children[0].geometry.attributes.position.array, b.children[0].geometry.attributes.position.array);
  disposeDebugMesh(a);
  disposeDebugMesh(b);
});
