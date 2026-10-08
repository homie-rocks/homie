import { init, Crowd as RecastCrowd, NavMeshQuery, exportNavMesh } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import { bakeTile, heightfieldTriangles } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { hash } from '@homie-rocks/nav/State.js';
export { init };
const config = {
  origin: [0, 0, 0],
  minY: -2,
  maxY: 12,
  cellSize: 0.25,
  cellHeight: 0.1,
  tileCells: 160,
  radius: 0.3,
  height: 1.8,
  stepHeight: 0.3,
  slopeDegrees: 45,
};
const triangles = heightfieldTriangles({ heightAt: () => 0 }, -2, -2, 177, 177, 0.25);
const tune = { radius: 0.3, height: 1.8, speed: 3, acceleration: 8, neighbours: 2, separation: 2 };
const xyz = (p) => ({ x: p[0], y: p[1], z: p[2] });
const recastConfig = {
  cs: 0.25,
  ch: 0.1,
  walkableSlopeAngle: 45,
  walkableHeight: 18,
  walkableClimb: 2,
  walkableRadius: 2,
  borderSize: 5,
  minRegionArea: 8,
  mergeRegionArea: 20,
  maxEdgeLen: 48,
  maxSimplificationError: 1.3,
  maxVertsPerPoly: 6,
  detailSampleDist: 1.5,
  detailSampleMaxError: 0.1,
  bounds: [
    [-1.25, -2, -1.25],
    [41.25, 12, 41.25],
  ],
};
export function make(engine) {
  let mesh,
    bytes,
    query,
    crowd,
    agents = [];
  function bake() {
    if (engine === 'navcat') {
      bytes = bakeTile(triangles, config, 0, 0);
      mesh = new Mesh(config, [2, 2, 2]);
      mesh.loadTile(bytes);
    } else {
      if (mesh) mesh.destroy();
      const result = generateSoloNavMesh(triangles.positions, triangles.indices, recastConfig);
      if (!result.success) throw Error(result.error);
      mesh = result.navMesh;
      bytes = exportNavMesh(mesh);
    }
    return { bytes: bytes.length, hash: hash(bytes) };
  }
  function prepare() {
    if (engine === 'navcat') crowd = new Crowd(mesh, 0.05, 0.3);
    else {
      query = new NavMeshQuery(mesh);
      crowd = new RecastCrowd(mesh, { maxAgents: 300, maxAgentRadius: 0.3 });
    }
    for (let i = 0; i < 300; i++) {
      const p = [1 + (i % 15), 0.1, 1 + Math.floor(i / 15) * 1.8],
        to = [40 - p[0], 0.1, p[2]];
      if (engine === 'navcat') {
        const id = crowd.add(p, tune);
        crowd.target(id, to);
        agents.push(id);
      } else {
        const a = crowd.addAgent(xyz(p), {
          radius: 0.3,
          height: 1.8,
          maxSpeed: 3,
          maxAcceleration: 8,
          collisionQueryRange: 2,
          separationWeight: 2,
        });
        a.requestMoveTarget(xyz(to));
        agents.push(a);
      }
    }
  }
  function paths(count = 1000) {
    for (let i = 0; i < count; i++) {
      const from = [2, 0.1, 2 + (i % 35)],
        to = [38, 0.1, 38 - (i % 35)];
      const result =
        engine === 'navcat' ? mesh.path(from, to) : query.computePath(xyz(from), xyz(to));
      if (!(result.complete ?? result.success)) throw Error('incomplete path');
    }
  }
  function step(count = 1) {
    for (let i = 0; i < count; i++) engine === 'navcat' ? crowd.step() : crowd.update(0.05);
  }
  function result() {
    const positions = agents.map((a) =>
      engine === 'navcat' ? crowd.agent(a).position : Object.values(a.position()),
    );
    const raw = new Float64Array(positions.flat());
    return {
      tileBytes: bytes.length,
      tileHash: hash(bytes),
      positionHash: hash(new Uint8Array(raw.buffer)),
      snapshotBytes: engine === 'navcat' ? crowd.save().length : null,
    };
  }
  function dispose() {
    if (engine !== 'navcat') {
      crowd?.destroy();
      query?.destroy();
      mesh?.destroy();
    }
  }
  return { bake, prepare, paths, step, result, dispose };
}
export function measure(engine) {
  const scene = make(engine),
    bake = [];
  for (let i = 0; i < 4; i++) {
    const t = performance.now();
    scene.bake();
    if (i) bake.push(performance.now() - t);
  }
  scene.prepare();
  scene.paths(100);
  scene.step(30);
  const q = performance.now();
  scene.paths(1000);
  const query = (performance.now() - q) / 1000;
  const steps = [];
  for (let i = 0; i < 120; i++) {
    const t = performance.now();
    scene.step();
    steps.push(performance.now() - t);
  }
  steps.sort((a, b) => a - b);
  const result = {
    engine,
    bakeMinMs: Math.min(...bake),
    bakeMaxMs: Math.max(...bake),
    queryMs: query,
    stepMedianMs: steps[60],
    stepP95Ms: steps[114],
    ...scene.result(),
  };
  scene.dispose();
  return result;
}
