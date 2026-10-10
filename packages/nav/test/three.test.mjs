import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { trianglesFromObject3D, debugMesh, disposeDebugMesh } from '@homie-rocks/nav/Three.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { flat, tune } from './fixtures.mjs';

test('three importer applies nested world transforms, indices, mirror winding and instancing', () => {
  const root = new THREE.Group(),
    geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, 1, 0, 0], 3),
  );
  geometry.setIndex([0, 1, 2]);
  const mesh = new THREE.Mesh(geometry);
  mesh.position.set(4, 2, 3);
  mesh.scale.x = -1;
  root.position.x = 2;
  root.add(mesh);
  const positions = Array.from(trianglesFromObject3D(root).positions);
  assert.deepEqual(positions, [6, 2, 3, 5, 2, 3, 6, 2, 4]);
  const instances = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 2);
  instances.setMatrixAt(0, new THREE.Matrix4());
  instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(3, 0, 0));
  assert.equal(trianglesFromObject3D(instances).positions.length, 18);
  assert.deepEqual(
    Array.from(trianglesFromObject3D(root, { up: 'z' }).positions),
    [6, -3, 2, 5, -3, 2, 6, -4, 2],
  );
  mesh.visible = false;
  assert.equal(trianglesFromObject3D(root).positions.length, 0);
});
test('debug group contains tiles, public links and agents and releases its resources', () => {
  const mesh = flat();
  mesh.addLink([2, 0.1, 2], [8, 0.1, 8], 0.4, true);
  const crowd = new Crowd(mesh, 0.05, 0.3);
  crowd.add([2, 0.1, 2], tune);
  const debug = debugMesh(mesh, crowd);
  assert.equal(debug.children.length, 3);
  assert.ok(debug.children.every((child) => child.geometry.getAttribute('position').count > 0));
  let released = 0;
  debug.children.forEach((child) => child.geometry.addEventListener('dispose', () => released++));
  disposeDebugMesh(debug);
  assert.equal(released, 3);
  assert.equal(debug.children.length, 0);
});
