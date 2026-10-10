import * as Bake from '../../dist/Bake.js';
import { Mesh } from '../../dist/Mesh.js';
import { Crowd } from '../../dist/Crowd.js';
import * as Q from '../../dist/internal/Coordinates.js';
import * as Binary from '../../dist/internal/Binary.js';
import * as Chunks from '../../dist/State.js';
import { Grid } from '../../dist/Grid.js';
const State = { ...Binary, ...Chunks };
export { Bake, Mesh, Crowd, Q, State, Grid };
// mulberry32: a different generator from the package's LCG.
export function rng(seed) {
  let a = (seed * 0x9e3779b1) >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = (n) => Math.floor(f() * n);
  f.range = (a, b) => a + f() * (b - a);
  f.pick = (list) => list[f.int(list.length)];
  return f;
}
// Geometry is authored in the INTERNAL y-up frame and rotated to world by fromAxes.
export function quad(out, a, b, c, d) {
  out.push(...a, ...b, ...c, ...a, ...c, ...d);
}
/** Floor [x0,x1]x[z0,z1] at y, upward winding (y-up internal frame). */
export function floor(out, x0, z0, x1, z1, y = 0, step = 4) {
  for (let x = x0; x < x1; x += step)
    for (let z = z0; z < z1; z += step) {
      const X = Math.min(x1, x + step),
        Z = Math.min(z1, z + step);
      quad(out, [x, y, z], [x, y, Z], [X, y, Z], [X, y, z]);
    }
}
/** Solid box as geometry: top face upward plus four walls. */
export function box(out, x0, y0, z0, x1, y1, z1) {
  quad(out, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
  quad(out, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
  quad(out, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  quad(out, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  quad(out, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
}
export function toWorld(positions, up) {
  if (up === 'y') return positions;
  const out = new Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const p = Q.fromAxes([positions[i], positions[i + 1], positions[i + 2]], up);
    out[i] = p[0];
    out[i + 1] = p[1];
    out[i + 2] = p[2];
  }
  return out;
}
export const W = (p, up) => Q.fromAxes(p, up);
export const I = (p, up) => Q.axes(p, up);
export const WB = (min, max, up) => Q.axisBounds(min, max, up, true);
export function fnv(h, n) {
  // hash a float64 by its bits
  f64[0] = n;
  h = Math.imul(h ^ u32[0], 16777619);
  h = Math.imul(h ^ u32[1], 16777619);
  return h >>> 0;
}
const f64 = new Float64Array(1),
  u32 = new Uint32Array(f64.buffer);
export function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}
export function pct(a, p) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}
