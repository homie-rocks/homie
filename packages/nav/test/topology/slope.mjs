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

const out = {
  ok: 0,
  bad: [],
  refused: 0,
  boundary: 0,
  total: 0,
  refusedList: new Map(),
};
for (const cellSize of [0.15, 0.25, 0.4])
  for (const cellHeight of [0.05, 0.1, 0.2])
    for (const stepHeight of [0.2, 0.3, 0.5, 0.9])
      for (const limit of [10, 20, 30, 40, 45, 50, 60]) {
        const key = `cs ${cellSize} ch ${cellHeight} step ${stepHeight} limit ${limit}`;
        let refused = false;
        for (const angle of [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]) {
          if (refused) break;
          for (const minY of [-2, -1.93, -1.47]) {
            const r = ramp(angle, limit, cellSize, cellHeight, stepHeight, minY);
            out.total++;
            if (r.refused) {
              out.refused++;
              out.refusedList.set(key, r.refused);
              refused = true;
              break;
            }
            if (Math.abs(angle - limit) < 2.5) {
              out.boundary++;
              continue;
            }
            const want = angle < limit;
            const good = want ? r.coverage > 0.98 && r.complete : r.coverage < 0.02 && !r.complete;
            if (good) out.ok++;
            else
              out.bad.push(
                `${key} ramp ${angle} minY ${minY}: coverage ${(r.coverage * 100).toFixed(0)}% ` +
                  `complete ${r.complete} (expected ${want ? 'walkable' : 'blocked'})`,
              );
          }
        }
      }
console.log(
  `RAMPS: ${out.total} bakes; ${out.ok} match the analytic expectation; ` +
    `${out.bad.length} wrong; ${out.boundary} within 2.5 deg of ` +
    `the limit (not judged); ${out.refusedList.size} of 252 configurations ` +
    `refused`,
);
for (const b of out.bad.slice(0, 40)) console.log('  WRONG', b);
if (out.bad.length > 40) console.log(`  ... ${out.bad.length - 40} more`);
console.log('refused configurations:');
const byLimit = {};
for (const k of out.refusedList.keys()) {
  const l = k.split('limit ')[1];
  (byLimit[l] ??= []).push(k.replace(/ limit.*/, ''));
}
for (const [l, v] of Object.entries(byLimit)) console.log(`  limit ${l}: ${v.length}/36 refused`);
console.log('  message:', [...new Set(out.refusedList.values())].join(' | '));

// z-up spot check
for (const [angle, limit] of [
  [30, 45],
  [50, 45],
  [40, 45],
]) {
  const y = ramp(angle, limit, 0.25, 0.1, 0.3, -2, 'y'),
    z = ramp(angle, limit, 0.25, 0.1, 0.3, -2, 'z');
  console.log(`z-up ramp ${angle} limit ${limit}: y ${JSON.stringify(y)}  z ${JSON.stringify(z)}`);
}

// Procedural hills: h = A sin(x/a) sin(z/b) + ridge. Analytic gradient gives the expected set.
function hills(A, limit, cellSize, cellHeight, stepHeight, sampleStep) {
  const config = {
    origin: [0, 0, 0],
    minY: -A - 3,
    maxY: A + 5,
    cellSize,
    cellHeight,
    tileCells: 64,
    radius: 0.3,
    height: 1.8,
    stepHeight,
    slopeDegrees: limit,
  };
  try {
    Bake.checkConfig(config);
  } catch (e) {
    return { refused: true };
  }
  const h = (x, z) => A * Math.sin(x / 4) * Math.sin(z / 5) + 0.3 * A * Math.sin((x + z) / 7);
  const slope = (x, z) => {
    const gx =
      (A / 4) * Math.cos(x / 4) * Math.sin(z / 5) + ((0.3 * A) / 7) * Math.cos((x + z) / 7);
    const gz =
      (A / 5) * Math.sin(x / 4) * Math.cos(z / 5) + ((0.3 * A) / 7) * Math.cos((x + z) / 7);
    return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
  };
  const S = 48;
  const tiles = Bake.bakeHeightfield(
    { heightAt: h },
    config,
    { min: [0, 0], max: [S, S] },
    sampleStep ?? cellSize,
  );
  const mesh = new Mesh(config, [cellSize * 0.4, 1.5, cellSize * 0.4]);
  let warnings = 0;
  for (const t of tiles) warnings += mesh.loadTile(t.bytes).warnings.length;
  const m = 0.3 + 2.5 * cellSize;
  let wantOn = 0,
    on = 0,
    wantOff = 0,
    off = 0,
    maxSlope = 0;
  for (let x = 2; x <= S - 2; x += 0.5)
    for (let z = 2; z <= S - 2; z += 0.5) {
      // classify by the worst/best slope in the erosion neighbourhood
      let lo = 90,
        hi = 0;
      for (let dx = -m; dx <= m + 1e-9; dx += m / 2)
        for (let dz = -m; dz <= m + 1e-9; dz += m / 2) {
          const s = slope(x + dx, z + dz);
          lo = Math.min(lo, s);
          hi = Math.max(hi, s);
        }
      maxSlope = Math.max(maxSlope, hi);
      const p = mesh.nearest([x, h(x, z), z]);
      const meshed = !!p && Math.hypot(p[0] - x, p[2] - z) < 1e-6;
      if (hi < limit - 3) {
        wantOn++;
        if (meshed) on++;
      } else if (lo > limit + 3) {
        wantOff++;
        if (!meshed) off++;
      }
    }
  return { maxSlope, wantOn, on, wantOff, off, warnings };
}
console.log(
  '\nHILLS (48 x 48 m, 9 tiles): lattice points whose whole erosion neighbourhood is under limit-3 deg must be meshed; over limit+3 deg must not',
);
for (const [cs, ch, step] of [
  [0.25, 0.1, 0.3],
  [0.25, 0.1, 0.5],
  [0.15, 0.05, 0.3],
  [0.4, 0.2, 0.9],
  [0.3, 0.2, 0.4],
])
  for (const limit of [20, 30, 45, 60])
    for (const A of [0.6, 1.5, 3, 6]) {
      const r = hills(A, limit, cs, ch, step);
      if (r.refused) {
        console.log(`  cs ${cs} ch ${ch} step ${step} limit ${limit}: REFUSED`);
        break;
      }
      const a = r.wantOn ? ((r.on / r.wantOn) * 100).toFixed(1) : '-',
        b = r.wantOff ? ((r.off / r.wantOff) * 100).toFixed(1) : '-';
      const flag =
        (r.wantOn && r.on / r.wantOn < 0.98) || (r.wantOff && r.off / r.wantOff < 0.98)
          ? '  <-- WRONG'
          : '';
      console.log(
        `  cs ${cs} ch ${ch} step ${step} limit ${limit} A ${A} (max ` +
          `slope ${r.maxSlope.toFixed(0)} deg): should-walk meshed ${a}% ` +
          `of ${r.wantOn}; should-block unmeshed ${b}% of ${r.wantOff}; ` +
          `seam warnings ${r.warnings}${flag}`,
      );
    }
