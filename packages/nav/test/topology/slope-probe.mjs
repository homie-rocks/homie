// Slope limit against analytic expectation: straight ramps and procedural hills.
import { Bake, Mesh, quad, toWorld, W } from './lib.mjs';

function area2d(tris, up, inside) {
  // projected (horizontal) area of mesh triangles whose centroid passes `inside`
  let sum = 0;
  for (let i = 0; i < tris.length; i += 9) {
    const a = [tris[i], tris[i + 1], tris[i + 2]],
      b = [tris[i + 3], tris[i + 4], tris[i + 5]],
      c = [tris[i + 6], tris[i + 7], tris[i + 8]];
    const h = up === 'z' ? [0, 1] : [0, 2];
    const ax = a[h[0]],
      az = a[h[1]],
      bx = b[h[0]],
      bz = b[h[1]],
      cx = c[h[0]],
      cz = c[h[1]];
    if (!inside((ax + bx + cx) / 3, (az + bz + cz) / 3)) continue;
    sum += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
  }
  return sum;
}
const tan = (d) => Math.tan((d * Math.PI) / 180);

function ramp(angle, limit, cellSize, cellHeight, stepHeight, minY, up = 'y') {
  const config = {
    origin: [0, 0, 0],
    up,
    minY,
    maxY: 30,
    cellSize,
    cellHeight,
    tileCells: 48,
    radius: 0.3,
    height: 1.8,
    stepHeight,
    slopeDegrees: limit,
  };
  try {
    Bake.checkConfig(config);
  } catch (e) {
    return { refused: e.message };
  }
  const L = 8,
    H = L * tan(angle),
    Wd = 8,
    x0 = 6,
    x1 = x0 + L,
    x2 = x1 + 6;
  const t = [];
  // finely tessellated so triangles are not huge (2 m strips)
  for (let z = 0; z < Wd; z += 2) {
    for (let x = 0; x < x0; x += 2)
      quad(t, [x, 0, z], [x, 0, z + 2], [x + 2, 0, z + 2], [x + 2, 0, z]);
    for (let x = x0; x < x1; x += 2) {
      const y0 = (x - x0) * tan(angle),
        y1 = (x + 2 - x0) * tan(angle);
      quad(t, [x, y0, z], [x, y0, z + 2], [x + 2, y1, z + 2], [x + 2, y1, z]);
    }
    for (let x = x1; x < x2; x += 2)
      quad(t, [x, H, z], [x, H, z + 2], [x + 2, H, z + 2], [x + 2, H, z]);
  }
  const tiles = Bake.bakeLevel({ positions: toWorld(t, up) }, config);
  const mesh = new Mesh(config, [0.5, 1, 0.5]);
  for (const a of tiles) mesh.loadTile(a.bytes);
  const m = 0.3 + 2 * cellSize; // erosion + voxel margin
  const dbg = mesh.debug().triangles;
  const hz = (z) => (up === 'z' ? -z : z); // world horizontal second coordinate back to internal z
  const inRamp = (x, z) => x > x0 + m && x < x1 - m && hz(z) > m && hz(z) < Wd - m;
  const expectArea = (x1 - x0 - 2 * m) * (Wd - 2 * m);
  // clip-free estimate: sample lattice instead of triangle centroids for coverage
  let hit = 0,
    n = 0;
  for (let x = x0 + m; x <= x1 - m; x += 0.25)
    for (let z = m; z <= Wd - m; z += 0.5) {
      n++;
      const y = (x - x0) * tan(angle);
      const p = mesh.nearest(W([x, y, z], up));
      if (p) {
        const q = up === 'z' ? [p[0], p[2], -p[1]] : p;
        if (
          Math.hypot(q[0] - x, q[2] - z) < 1e-6 &&
          Math.abs(q[1] - y) < Math.max(0.35, 2 * cellHeight + cellSize * tan(angle))
        )
          hit++;
      }
    }
  const path = mesh.path(W([1, 0, 4], up), W([x2 - 1, H, 4], up));
  return {
    coverage: hit / n,
    complete: path.complete,
    area: area2d(dbg, up, inRamp) / expectArea,
  };
}

// distinguish holes from height tolerance: nearest() with a tall query box, horizontal-only test
for (const [cs, ch, step, limit, angle, minY] of [
  [0.25, 0.05, 0.5, 60, 50, -1.93],
  [0.4, 0.05, 0.5, 45, 35, -1.93],
  [0.4, 0.1, 0.3, 30, 25, -2],
  [0.4, 0.05, 0.9, 60, 55, -1.47],
  [0.25, 0.1, 0.3, 45, 40, -2],
]) {
  const config = {
    origin: [0, 0, 0],
    minY,
    maxY: 30,
    cellSize: cs,
    cellHeight: ch,
    tileCells: 48,
    radius: 0.3,
    height: 1.8,
    stepHeight: step,
    slopeDegrees: limit,
  };
  const t = [];
  const L = 8,
    x0 = 6,
    x1 = 14,
    x2 = 20,
    H = L * tan(angle);
  for (let z = 0; z < 8; z += 2) {
    for (let x = 0; x < x0; x += 2)
      quad(t, [x, 0, z], [x, 0, z + 2], [x + 2, 0, z + 2], [x + 2, 0, z]);
    for (let x = x0; x < x1; x += 2)
      quad(
        t,
        [x, (x - x0) * tan(angle), z],
        [x, (x - x0) * tan(angle), z + 2],
        [x + 2, (x + 2 - x0) * tan(angle), z + 2],
        [x + 2, (x + 2 - x0) * tan(angle), z],
      );
    for (let x = x1; x < x2; x += 2)
      quad(t, [x, H, z], [x, H, z + 2], [x + 2, H, z + 2], [x + 2, H, z]);
  }
  const mesh = new Mesh(config, [0.01, 3, 0.01]);
  for (const a of Bake.bakeLevel({ positions: t }, config)) mesh.loadTile(a.bytes);
  const m = 0.3 + 2 * cs;
  let n = 0,
    holes = 0,
    worst = 0;
  for (let x = x0 + m; x <= x1 - m; x += 0.1)
    for (let z = m; z <= 8 - m; z += 0.25) {
      n++;
      const y = (x - x0) * tan(angle),
        p = mesh.nearest([x, y, z]);
      if (!p || Math.hypot(p[0] - x, p[2] - z) > 1e-6) holes++;
      else worst = Math.max(worst, Math.abs(p[1] - y));
    }
  console.log(
    `cs ${cs} ch ${ch} step ${step} limit ${limit} ramp ${angle}: ` +
      `${holes}/${n} lattice points have no mesh under them; worst ` +
      `height error of the mesh surface ${worst.toFixed(3)} m (2 ` +
      `voxels = ${(2 * ch).toFixed(2)})`,
  );
}
