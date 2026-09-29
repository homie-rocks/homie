/**
 * ============================================================================
 *  Harbour — a lofted boat hull and the working clutter of a quayside.
 * ============================================================================
 *  `hullGeo` is the interesting one: real cross-sections swept along a sheer
 *  line, with a rounded chine and a transom that differs by kind, rather than
 *  a scaled capsule. `boatGeo` dresses it into an open launch or a cabin
 *  cruiser. The rest — bollard, crate, barrel, net, rope, tyre fender — is the
 *  clutter that makes a quay read as used rather than modelled.
 *
 *  PUBLISHED, NOT DE-DUPLICATED: moved out of one racing game's prop module;
 *  the other racing game has no water. See `Village.ts`'s header for the
 *  argument, which is the same one: the next game that wants a harbour should
 *  import this harbour.
 *
 *  Nothing in this file reads an RNG except `boatGeo` and `crateGeo`, and both
 *  consume their draws in a fixed order — the world must rebuild identically
 *  from a seed, so a reordering here is a visible change, not a tidy-up.
 */
import * as THREE from 'three';
import { bevelBox, plainBox } from '@homie-rocks/geom/prim.js';
import { loft } from '@homie-rocks/geom/loft.js';
import { GeoAccum } from '@homie-rocks/geom/accum.js';
import { trs } from '@homie-rocks/geom/trs.js';
import { clamp } from '@homie-rocks/noise/Noise.js';
import { smoothstep } from './Kit.ts';
import type { RNG } from './Kit.ts';

export type { RNG };

/** Lofted boat hull: real cross-sections, rounded chine, sheer line. */
export function hullGeo(len: number, beam: number, depth: number, kind: number): THREE.BufferGeometry {
  const rings = 22,
    sides = 14;
  return loft(
    (t, o) => {
      const z = (t - 0.5) * len;
      // sheer: the deck line rises toward bow and stern
      const sheer = Math.pow(Math.abs(t - 0.5) * 2, 2.2) * depth * 0.28;
      o.set(0, sheer, z);
    },
    rings,
    sides,
    (t, a) => {
      // waterline plan: fine bow, full midships, transom aft
      const bow = smoothstep(1.0, 0.72, t);
      const stern = kind === 0 ? smoothstep(0.0, 0.16, t) : smoothstep(0.0, 0.30, t);
      const plan = Math.pow(Math.sin(clamp(t, 0, 1) * Math.PI), 0.42) * bow * stern;
      // cross-section: rounded V, deeper amidships
      const s = Math.sin(a),
        c = Math.cos(a);
      const vShape = 1 - Math.pow(clamp(-s, 0, 1), 1.7) * 0.35;
      const r = plan * (0.5 + 0.5 * Math.abs(c)) * beam * 0.5 * vShape;
      const rv = plan * depth * 0.5 * (s < 0 ? 1.0 : 0.72);
      return Math.hypot(r * c, rv * s) * 0.5 + (r * 0.5 + Math.abs(rv) * 0.5) * 0.5;
    },
    2,
    true,
    true
  );
}

/**
 * The boat and the measurements a caller needs to place things on it.
 *
 * Both measurements come from the finished, combined hull geometry. That is
 * intentionally a stronger promise than returning the float64 `len` selected
 * from the RNG: positions are stored as float32, and callers place cameras,
 * wakes and berths against the hull that actually renders. `hullBounds` is
 * cloned so those callers cannot accidentally rewrite `hull.boundingBox`.
 */
export interface BoatGeometry {
  readonly hull: THREE.BufferGeometry;
  readonly rig: THREE.BufferGeometry;
  readonly length: number;
  readonly hullBounds: THREE.Box3;
}

export function boatGeo(rng: RNG, kind: number): BoatGeometry {
  const len = kind === 0 ? 6.4 + rng() * 2.6 : 9.5 + rng() * 4.0;
  const beam = len * (0.3 + rng() * 0.06);
  const depth = len * 0.19;
  const hullAcc = new GeoAccum();
  const h = hullGeo(len, beam, depth, kind);
  hullAcc.add(h, trs(0, 0, 0, 0), new THREE.Color(1, 1, 1));
  // gunwale rubbing strake
  const strake = loft(
    (t, o) => {
      const z = (t - 0.5) * len * 0.98;
      o.set(0, Math.pow(Math.abs(t - 0.5) * 2, 2.2) * depth * 0.28 + depth * 0.34, z);
    },
    18,
    6,
    (t) => 0.06 * Math.pow(Math.sin(clamp(t, 0, 1) * Math.PI), 0.3),
    2
  );
  void strake;
  const rigAcc = new GeoAccum();
  const w = new THREE.Color(1, 1, 1);
  // deck
  hullAcc.add(bevelBox(beam * 0.82, 0.08, len * 0.72, 0.02, 1.6), trs(0, depth * 0.36, 0, 0), new THREE.Color(0.82, 0.78, 0.7));
  if (kind === 0) {
    // open launch: thwarts, small cuddy, outboard
    for (let i = 0; i < 3; i++) rigAcc.add(bevelBox(beam * 0.7, 0.07, 0.28, 0.015, 3), trs(0, depth * 0.42, (i - 1) * len * 0.2, 0), w);
    rigAcc.add(bevelBox(beam * 0.62, 0.62, len * 0.2, 0.04, 1.2), trs(0, depth * 0.36 + 0.31, len * 0.24, 0), w);
    rigAcc.add(bevelBox(0.22, 0.5, 0.34, 0.05, 3), trs(0, depth * 0.3, -len * 0.46, 0), new THREE.Color(0.35, 0.35, 0.38));
  } else {
    // cabin cruiser / fishing boat: wheelhouse, mast, boom, davits
    rigAcc.add(bevelBox(beam * 0.66, 1.15, len * 0.26, 0.05, 1.1), trs(0, depth * 0.36 + 0.58, len * 0.06, 0), w);
    rigAcc.add(bevelBox(beam * 0.5, 0.1, len * 0.22, 0.02, 1.6), trs(0, depth * 0.36 + 1.2, len * 0.06, 0), new THREE.Color(0.88, 0.86, 0.8));
    const mast = loft((t, o) => o.set(0, t * (len * 0.62), 0), 4, 7, (t) => 0.075 * (1 - t * 0.45), 2, true, true);
    rigAcc.add(mast, trs(0, depth * 0.42, -len * 0.06, 0), w);
    rigAcc.add(bevelBox(0.09, 0.09, len * 0.34, 0.02, 4), trs(0, depth * 0.42 + len * 0.2, -len * 0.2, 0), w);
  }
  const hull = hullAcc.build()!;
  hull.computeBoundingBox();
  const hullBounds = hull.boundingBox;
  if (hullBounds === null) throw new Error('boatGeo: finished hull has no bounds');
  const length = hullBounds.max.z - hullBounds.min.z;
  return { hull, rig: rigAcc.build()!, length, hullBounds: hullBounds.clone() };
}

export function bollardGeo(): THREE.BufferGeometry {
  // Cast-iron mooring bollard: chamfered, mushroom head, base flange.
  const acc = new GeoAccum();
  const w = new THREE.Color(1, 1, 1);
  const body = loft((t, o) => o.set(0, t * 0.62, 0), 6, 12, (t) => 0.16 - t * 0.035 + Math.pow(t, 6) * 0.02, 1.4, true, false);
  acc.add(body, trs(0, 0, 0, 0), w);
  const head = loft((t, o) => o.set(0, 0.6 + t * 0.16, 0), 5, 12, (t) => 0.145 + Math.sin(t * Math.PI) * 0.075, 1.2, false, true);
  acc.add(head, trs(0, 0, 0, 0), w);
  acc.add(loft((t, o) => o.set(0, t * 0.07, 0), 2, 12, () => 0.24, 1, true, true), trs(0, 0, 0, 0), new THREE.Color(0.85, 0.85, 0.85));
  return acc.build()!;
}

export function crateGeo(rng: RNG): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const w = 0.6 + rng() * 0.35,
    h = 0.42 + rng() * 0.3,
    d = 0.5 + rng() * 0.3;
  acc.add(bevelBox(w, h, d, 0.02, 1.8), trs(0, h / 2, 0, 0), new THREE.Color(1, 1, 1));
  // batten frame
  const c2 = new THREE.Color(0.86, 0.82, 0.74);
  for (const s of [-1, 1]) {
    acc.add(bevelBox(w + 0.03, 0.07, 0.06, 0.012, 4), trs(0, h * (0.5 + s * 0.34), d / 2, 0), c2);
    acc.add(bevelBox(0.06, h, 0.06, 0.012, 4), trs(s * (w / 2 - 0.04), h / 2, d / 2, 0), c2);
  }
  return acc.build()!;
}

export function barrelGeo(): THREE.BufferGeometry {
  const acc = new GeoAccum();
  acc.add(loft((t, o) => o.set(0, t * 0.82, 0), 8, 14, (t) => 0.26 + Math.sin(t * Math.PI) * 0.055, 2, true, true), trs(0, 0, 0, 0), new THREE.Color(1, 1, 1));
  for (const y of [0.16, 0.41, 0.66]) acc.add(loft((t, o) => o.set(0, y + t * 0.05, 0), 1, 14, () => 0.29, 1.5), trs(0, 0, 0, 0), new THREE.Color(0.5, 0.44, 0.36));
  return acc.build()!;
}

/** Draped fishing net: a sagging quad grid with a wide alpha weave. */
export function netGeo(w: number, h: number): THREE.BufferGeometry {
  const nx = 8,
    ny = 6;
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const u = i / nx,
        v = j / ny;
      const sag = Math.sin(u * Math.PI) * 0.25 * v;
      pos.push((u - 0.5) * w, -v * h - sag, Math.sin(u * Math.PI * 2) * 0.12 * v);
      uv.push(u * 3, v * 3);
    }
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Catenary rope between two points, as a real tube. */
export function ropeGeo(a: THREE.Vector3, b: THREE.Vector3, sag: number, radius = 0.035): THREE.BufferGeometry {
  return loft(
    (t, o) => {
      o.lerpVectors(a, b, t);
      o.y -= Math.sin(t * Math.PI) * sag;
    },
    10,
    5,
    () => radius,
    1
  );
}

export function tyreGeo(): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const tor = new THREE.TorusGeometry(0.34, 0.13, 6, 14);
  tor.rotateX(Math.PI / 2);
  acc.add(tor, trs(0, 0.13, 0, 0), new THREE.Color(1, 1, 1));
  // tread band so it isn't a smooth donut
  const block = plainBox(0.06, 0.055, 0.16, 6);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    acc.add(block, trs(Math.cos(a) * 0.46, 0.13, Math.sin(a) * 0.46, -a), new THREE.Color(0.8, 0.8, 0.8));
  }
  return acc.build()!;
}
