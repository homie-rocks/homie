import { Bake, Mesh, Crowd, Q, State, floor, box, toWorld, W, I, WB } from './lib.mjs';
const D = new URL('../../dist/', import.meta.url).href;
const THREE = await import(
  new URL('../../../../node_modules/three/build/three.module.js', import.meta.url).href
);
const Three = await import(D + 'Three.js');
// 1. the mapping is a rotation
const M = [Q.axes([1, 0, 0], 'z'), Q.axes([0, 1, 0], 'z'), Q.axes([0, 0, 1], 'z')];
const det =
  M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
  M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
  M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
console.log(
  '1. axes() images of x,y,z:',
  JSON.stringify(M),
  'determinant',
  det,
  '; fromAxes(axes(p)) =',
  JSON.stringify(Q.fromAxes(Q.axes([1, 2, 3], 'z'), 'z')),
  '; up maps to',
  JSON.stringify(Q.axes([0, 0, 1], 'z')),
);

// 2. head-on passing side, same world in both frames (asymmetric obstacle so a mirror would show)
function passing(up) {
  const config = {
    origin: W([0, 0, 0], up),
    up,
    retainSpans: true,
    minY: -2,
    maxY: 8,
    cellSize: 0.25,
    cellHeight: 0.1,
    tileCells: 80,
    radius: 0.3,
    height: 1.8,
    stepHeight: 0.3,
    slopeDegrees: 45,
  };
  const tri = [];
  floor(tri, 0, 0, 20, 20);
  box(tri, 6, -0.2, 3, 7.5, 3, 6); // off-centre
  const mesh = new Mesh(config, W([1, 2, 1], up).map(Math.abs));
  for (const a of Bake.bakeLevel({ positions: toWorld(tri, up) }, config)) mesh.loadTile(a.bytes);
  const crowd = new Crowd(mesh, 0.05, 0.3);
  const tune = {
    radius: 0.3,
    height: 1.8,
    speed: 3,
    acceleration: 8,
    neighbours: 3,
    separation: 2,
  };
  const a = crowd.add(W([2, 0, 10], up), tune),
    b = crowd.add(W([18, 0, 10], up), tune);
  crowd.target(a, W([18, 0, 10], up));
  crowd.target(b, W([2, 0, 10], up));
  const upv = up === 'z' ? [0, 0, 1] : [0, 1, 0];
  let side = 0,
    trace = [];
  for (let t = 0; t < 200; t++) {
    crowd.step();
    const pa = crowd.agent(a).position,
      pb = crowd.agent(b).position,
      va = crowd.agent(a).velocity;
    const rel = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const cr = [
      va[1] * rel[2] - va[2] * rel[1],
      va[2] * rel[0] - va[0] * rel[2],
      va[0] * rel[1] - va[1] * rel[0],
    ];
    const s = cr[0] * upv[0] + cr[1] * upv[1] + cr[2] * upv[2]; // > 0: the other agent is on A's left (right-handed, seen from above)
    if (Math.hypot(...rel) < 1.5 && !side) side = Math.sign(s);
    trace.push(...I(pa, up), ...I(pb, up));
  }
  const p = mesh.path(W([1, 0, 1], up), W([19, 0, 2], up));
  return {
    side,
    trace,
    path: p.points.map((q) => I(q, up)),
    tris: mesh.debug().triangles.length / 9,
  };
}
const y = passing('y'),
  z = passing('z');
console.log(
  `2. head-on: y-up the oncoming agent is on A's ${y.side > 0 ? 'left' : 'right'}; ` +
    `z-up on A's ${z.side > 0 ? 'left' : 'right'}; trajectories ` +
    `identical after rotation: ${JSON.stringify(y.trace) === JSON.stringify(z.trace)}; ` +
    `path identical: ${JSON.stringify(y.path) === JSON.stringify(z.path)}; ` +
    `triangles ${y.tris} / ${z.tris}`,
);

// 3. three.js helpers: a three scene is y-up; a z-up game imports it with {up:'z'}
const root = new THREE.Group();
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20, 4, 4), new THREE.MeshBasicMaterial());
ground.rotation.x = -Math.PI / 2;
ground.position.set(10, 0, 10);
root.add(ground);
const wall = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3, 3), new THREE.MeshBasicMaterial());
wall.position.set(6.75, 1.4, 4.5);
root.add(wall);
const res = {};
for (const up of ['y', 'z']) {
  const tris = Three.trianglesFromObject3D(root, { up });
  const config = {
    origin: [0, 0, 0],
    up,
    minY: -2,
    maxY: 8,
    cellSize: 0.25,
    cellHeight: 0.1,
    tileCells: 80,
    radius: 0.3,
    height: 1.8,
    stepHeight: 0.3,
    slopeDegrees: 45,
  };
  const mesh = new Mesh(config, [1, 2, 1].length && W([1, 2, 1], up).map(Math.abs));
  for (const a of Bake.bakeLevel(tris, config)) mesh.loadTile(a.bytes);
  const crowd = new Crowd(mesh, 0.05, 0.3);
  crowd.add(W([2, 0, 3], up), {
    radius: 0.3,
    height: 1.8,
    speed: 3,
    acceleration: 8,
    neighbours: 3,
    separation: 2,
  });
  mesh.addLink(W([2, 0, 2], up), W([12, 0, 3], up), 1, true);
  const g = Three.debugMesh(mesh, crowd);
  res[up] = g.children.map((c) =>
    Array.from(c.geometry.getAttribute('position').array).map((v) => +v.toFixed(4)),
  );
  // does the nav mesh avoid the wall where three.js drew it? (three space x 6..7.5, z 3..6)
  const onWall = mesh.nearest(W([6.75, 0, 4.5], up)),
    mirrored = mesh.nearest(W([6.75, 0, 15.5], up));
  res[up + 'hole'] = [
    onWall && I(onWall, up).map((v) => +v.toFixed(2)),
    mirrored && I(mirrored, up).map((v) => +v.toFixed(2)),
  ];
  Three.disposeDebugMesh(g);
}
console.log(
  `3. three.js: debugMesh output in three space identical for ` +
    `up 'y' and up 'z': mesh ${JSON.stringify(res.y[0]) === JSON.stringify(res.z[0])}, ` +
    `links ${JSON.stringify(res.y[1]) === JSON.stringify(res.z[1])}, ` +
    `agents ${JSON.stringify(res.y[2]) === JSON.stringify(res.z[2])}; ` +
    `nearest at the wall centre (three 6.75,0,4.5) y ${JSON.stringify(res.yhole[0])} ` +
    `z ${JSON.stringify(res.zhole[0])}; at its mirror image (6.75,0,15.5) ` +
    `y ${JSON.stringify(res.yhole[1])} z ${JSON.stringify(res.zhole[1])}`,
);

// 4. heightfield in a z-up game: what does bakeHeightfield(field, {up:'z'}, {min:[0,0],max:[20,20]}) cover, and which field value lands where?
{
  const field = { heightAt: (a, b) => 0.05 * a + 0.1 * b }; // asymmetric on purpose
  const config = {
    origin: [0, 0, 0],
    up: 'z',
    minY: -4,
    maxY: 8,
    cellSize: 0.25,
    cellHeight: 0.1,
    tileCells: 80,
    radius: 0.3,
    height: 1.8,
    stepHeight: 0.3,
    slopeDegrees: 45,
  };
  const mesh = new Mesh(config, [0.3, 0.3, 4]);
  for (const a of Bake.bakeHeightfield(field, config, {
    min: [0, 0],
    max: [20, 20],
  }))
    mesh.loadTile(a.bytes);
  const at = (X, Y) => {
    const p = mesh.nearest([X, Y, 1]);
    return p ? p.map((v) => +v.toFixed(2)) : null;
  };
  console.log(
    `4. z-up heightfield, rectangle min [0,0] max [20,20], field ` +
      `h(a,b)=0.05a+0.1b: world (5, 8) -> ${JSON.stringify(at(5, 8))}; ` +
      `world (5, -8) -> ${JSON.stringify(at(5, -8))} (h(5,8) = ${(0.05 * 5 + 0.8).toFixed(2)})`,
  );
  const g = new (await import(D + 'Grid.js')).Grid(10, 10, 1, [0, 0, 0], undefined, { up: 'z' });
  g.setBlocked(2, 7, true);
  console.log(
    `   z-up grid 10x10 at origin: cell (2,7) blocked; nearest ` +
      `free to world (2.5, 7.5, 0) -> ${JSON.stringify(g.nearest([2.5, 7.5, 0]))}; ` +
      `to world (2.5, -7.5, 0) -> ${JSON.stringify(g.nearest([2.5, -7.5, 0]))}`,
  );
}
