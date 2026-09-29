/**
 * ============================================================================
 *  Landmark — the things on the horizon, and the litter at your feet.
 * ============================================================================
 *  A gull, a lighthouse, a windmill with a separable rotor, an island, and
 *  tide-line debris. What they have in common is that they are what the eye
 *  uses to place itself: a lighthouse says how far away that headland is, and
 *  a windmill's turning sails say the world is running rather than painted.
 *
 *  `lighthouseGeo` and `windmillGeo` hand back their moving/emissive parts
 *  separately (`lampY`, `rotor`, `hubY`, `hubZ`) so the caller animates and
 *  lights them; neither knows what time of day it is.
 *
 *  `landmassGeo` is the only thing here that reaches for a noise field — it
 *  builds an island from two simplex octaves and a jag term, and it takes the
 *  sea level so the skirt goes below it rather than hovering.
 *
 *  PUBLISHED, NOT DE-DUPLICATED: moved out of one racing game's prop module.
 *  See `Village.ts`'s header for the argument.
 */
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { bevelBox } from '@homie-rocks/geom/prim.js';
import { loft } from '@homie-rocks/geom/loft.js';
import { GeoAccum } from '@homie-rocks/geom/accum.js';
import { trs } from '@homie-rocks/geom/trs.js';
import { mulberry32 } from '@homie-rocks/noise/Noise.js';
import type { RNG } from './Kit.ts';

export type { RNG };

/** Gull: body spindle plus two wing quads, animated entirely in the shader. */
export function gullGeo(): THREE.BufferGeometry {
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const push = (x: number, y: number, z: number, u: number, v: number) => {
    pos.push(x, y, z);
    uv.push(u, v);
  };
  // wings: a single strip spanning u = 0..1 so |u-0.5| is the span coordinate
  const span = 0.62;
  const pts: [number, number][] = [
    [-1, 0.0],
    [-0.55, 0.06],
    [0, 0.02],
    [0.55, 0.06],
    [1, 0.0],
  ];
  for (let i = 0; i < pts.length; i++) {
    const [sx, sz] = pts[i];
    push(sx * span, 0, sz * 0.1 - 0.03, (sx + 1) / 2, 0);
    push(sx * span, 0, sz * 0.1 + 0.14 - Math.abs(sx) * 0.1, (sx + 1) / 2, 1);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  // body
  const base = pos.length / 3;
  const bl = 0.3;
  push(0, 0, -bl, 0.5, 0.5);
  push(-0.045, 0.02, 0, 0.5, 0.5);
  push(0.045, 0.02, 0, 0.5, 0.5);
  push(0, -0.02, 0.06, 0.5, 0.5);
  push(0, 0.01, bl * 0.7, 0.5, 0.5);
  idx.push(base, base + 1, base + 2, base + 1, base + 4, base + 2, base + 1, base + 3, base + 4, base + 2, base + 4, base + 3, base, base + 3, base + 1, base, base + 2, base + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Lighthouse on its own rock plinth — the plinth guarantees it never floats. */
export function lighthouseGeo(baseY: number, seaY: number): { stone: THREE.BufferGeometry; trim: THREE.BufferGeometry; glass: THREE.BufferGeometry; lampY: number } {
  const stoneA = new GeoAccum();
  const trimA = new GeoAccum();
  const w = new THREE.Color(1, 1, 1);
  const plinthH = Math.max(2.5, baseY - seaY + 3.0);
  const plinth = loft((t, o) => o.set(0, -plinthH + t * plinthH, 0), 5, 10, (t, a) => (7.5 - t * 3.4) * (1 + Math.sin(a * 3 + t * 2) * 0.09), 3, false, true);
  stoneA.add(plinth, trs(0, 0, 0, 0), new THREE.Color(0.86, 0.82, 0.74));
  const towerH = 15.5;
  const tower = loft((t, o) => o.set(0, t * towerH, 0), 12, 16, (t) => 2.35 - Math.pow(t, 0.85) * 1.15, 4, true, false);
  stoneA.add(tower, trs(0, 0, 0, 0), w);
  // gallery ring + corbel
  trimA.add(loft((t, o) => o.set(0, towerH + t * 0.42, 0), 3, 16, (t) => 1.75 - t * 0.25, 3, false, true), trs(0, 0, 0, 0), new THREE.Color(0.94, 0.9, 0.84));
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    trimA.add(bevelBox(0.07, 0.9, 0.07, 0.015, 5), trs(Math.cos(a) * 1.6, towerH + 0.86, Math.sin(a) * 1.6, -a), new THREE.Color(0.8, 0.3, 0.28));
  }
  trimA.add(loft((t, o) => o.set(0, towerH + 1.3 + t * 0.12, 0), 1, 16, () => 1.66, 3, false, false), trs(0, 0, 0, 0), new THREE.Color(0.8, 0.3, 0.28));
  // lantern room + cap
  const lampY = towerH + 1.4;
  const glass = loft((t, o) => o.set(0, lampY + t * 2.0, 0), 2, 12, () => 1.15, 2, false, false);
  trimA.add(loft((t, o) => o.set(0, lampY + 2.0 + t * 1.05, 0), 4, 12, (t) => 1.3 * (1 - t * t), 2, false, true), trs(0, 0, 0, 0), new THREE.Color(0.8, 0.3, 0.28));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    trimA.add(bevelBox(0.09, 2.0, 0.09, 0.02, 4), trs(Math.cos(a) * 1.14, lampY + 1.0, Math.sin(a) * 1.14, -a), new THREE.Color(0.35, 0.34, 0.36));
  }
  return { stone: stoneA.build()!, trim: trimA.build()!, glass, lampY: lampY + 1.0 };
}

/** Windmill: tower + cap (static) and a 4-sail rotor (spun on the CPU, 1 object). */
export function windmillGeo(): { tower: THREE.BufferGeometry; trim: THREE.BufferGeometry; rotor: THREE.BufferGeometry; sail: THREE.BufferGeometry; hubY: number; hubZ: number } {
  const towerA = new GeoAccum();
  const trimA = new GeoAccum();
  const w = new THREE.Color(1, 1, 1);
  const H = 9.5;
  towerA.add(loft((t, o) => o.set(0, t * H, 0), 10, 14, (t) => 3.1 - t * 1.25, 3, true, false), trs(0, 0, 0, 0), w);
  // little windows so the tower isn't a bare cone
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    trimA.add(bevelBox(0.6, 0.85, 0.35, 0.03, 2), trs(Math.cos(a) * 2.35, 2.6 + i * 1.9, Math.sin(a) * 2.35, -a), new THREE.Color(0.4, 0.36, 0.34));
  }
  // conical cap
  trimA.add(loft((t, o) => o.set(0, H + t * 2.4, 0), 6, 14, (t) => 2.05 * Math.pow(1 - t, 0.72), 3, false, true), trs(0, 0, 0, 0), new THREE.Color(0.78, 0.42, 0.3));
  trimA.add(loft((t, o) => o.set(0, H - 0.1 + t * 0.22, 0), 1, 14, () => 2.2, 3, false, false), trs(0, 0, 0, 0), new THREE.Color(0.92, 0.88, 0.8));
  const hubY = H + 1.35,
    hubZ = 2.3;
  // rotor: hub + four lattice arms, built around the origin in XY
  const rotorA = new GeoAccum();
  rotorA.add(loft((t, o) => o.set(0, 0, -0.1 + t * 0.6), 3, 10, (t) => 0.34 - t * 0.1, 1.5, true, true), trs(0, 0, 0, 0), w);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const ca = Math.cos(a),
      sa = Math.sin(a);
    const L = 5.6;
    // spar
    rotorA.add(bevelBox(0.16, L, 0.16, 0.03, 3), trs((ca * L) / 2, (sa * L) / 2, 0, 0, 1, 1, 1, 0, a - Math.PI / 2), w);
    // lattice ribs
    for (let k = 1; k <= 7; k++) {
      const r = (k / 8) * L;
      rotorA.add(bevelBox(0.9, 0.07, 0.07, 0.015, 4), trs(ca * r, sa * r, 0.05, 0, 1, 1, 1, 0, a - Math.PI / 2), new THREE.Color(0.9, 0.9, 0.9));
    }
  }
  // one sail cloth per arm, instanced
  const sail = new THREE.PlaneGeometry(0.95, 4.6, 3, 8);
  sail.translate(0.55, 2.6, 0.14);
  const suv = sail.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < suv.count; i++) suv.setXY(i, suv.getX(i) * 0.5, suv.getY(i) * 0.5);
  return { tower: towerA.build()!, trim: trimA.build()!, rotor: rotorA.build()!, sail, hubY, hubZ };
}

/**
 * A landmass silhouette: a noise-displaced dome. Used for the offshore islands
 * and the receding headlands that keep the horizon from ever being empty.
 */
export function landmassGeo(radius: number, height: number, seed: number, seaY: number, jag = 1, segs = 40, rings = 12): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const n1 = createNoise2D(rng);
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const skirt = height * 0.6 + 40;
  for (let j = 0; j <= rings; j++) {
    const v = j / rings;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const a = u * Math.PI * 2;
      const wob = 1 + n1(Math.cos(a) * 1.5, Math.sin(a) * 1.5) * 0.34 * jag + n1(Math.cos(a) * 4.1 + 9, Math.sin(a) * 4.1) * 0.14 * jag;
      const r = radius * wob * Math.sqrt(Math.max(0, 1 - v * v));
      const ridge = n1(Math.cos(a) * 2.2 + 30, Math.sin(a) * 2.2) * 0.3 + n1(u * 7 + 51, v * 3) * 0.16;
      const y = seaY + height * Math.pow(v, 0.72) * (1 + ridge * jag);
      // The base ring is dropped well below the waterline so an island never
      // shows a floating rim however the swell moves.
      pos.push(Math.cos(a) * r, j === 0 ? seaY - skirt : y, Math.sin(a) * r);
      uv.push(u * 8, v * 5);
    }
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i;
      idx.push(a, a + segs + 1, a + 1, a + 1, a + segs + 1, a + segs + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Small tide-line debris: driftwood, shells, weed clumps, pebbles. */
export function debrisGeo(rng: RNG): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const k = (rng() * 3) | 0;
  if (k === 0) {
    const L = 0.5 + rng() * 1.1;
    acc.add(loft((t, o) => o.set(0, 0, (t - 0.5) * L), 5, 6, (t) => 0.05 + Math.sin(t * Math.PI) * 0.035, 2, true, true), trs(0, 0.06, 0, rng() * 6), new THREE.Color(0.78, 0.72, 0.62));
  } else if (k === 1) {
    for (let i = 0; i < 4; i++) acc.add(bevelBox(0.12 + rng() * 0.14, 0.07 + rng() * 0.06, 0.12 + rng() * 0.12, 0.02, 4), trs((rng() - 0.5) * 0.4, 0.04, (rng() - 0.5) * 0.4, rng() * 6), new THREE.Color(0.9, 0.87, 0.8));
  } else {
    for (let i = 0; i < 5; i++) acc.add(bevelBox(0.22 + rng() * 0.2, 0.05, 0.1 + rng() * 0.1, 0.02, 4), trs((rng() - 0.5) * 0.5, 0.03, (rng() - 0.5) * 0.5, rng() * 6, 1, 1, 1, 0, rng() * 0.4), new THREE.Color(0.34, 0.36, 0.26));
  }
  return acc.build()!;
}
