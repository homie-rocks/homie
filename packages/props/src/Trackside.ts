/**
 * ============================================================================
 *  Trackside — the furniture of a course, and the crowd that watches it.
 * ============================================================================
 *  Parasols, deckchairs, a marshal's post, a banner arch with its own UV pass,
 *  a grandstand that hands back its seat positions, a bell tower, market
 *  stalls, tents, a buoy, the start gantry, signage, bunting — and
 *  `spectatorGeo`, which is the one that matters. A crowd is the cheapest
 *  thing to get wrong and the most expensive thing to look at: this builds a
 *  real torso, legs, two arms in a chosen pose and an optional hat, with UVs
 *  set per part so one atlas colours skin and clothing separately.
 *
 *  `grandstandGeo` returns `{ struct, seats }` rather than a finished mesh, so
 *  the caller decides what sits in the seats — this file has no opinion about
 *  whether that is an instanced crowd, a sprite, or nothing.
 *
 *  PUBLISHED, NOT DE-DUPLICATED: moved out of one racing game's prop module.
 *  See `Village.ts`'s header for the argument. `bannerUvs` is exported beside
 *  `bannerArchGeo` because the arch calls it and a caller building its own
 *  banner geometry needs the same UV convention.
 */
import * as THREE from 'three';
import { bevelBox } from '@homie-rocks/geom/prim.js';
import { loft } from '@homie-rocks/geom/loft.js';
import { GeoAccum } from '@homie-rocks/geom/accum.js';
import { trs } from '@homie-rocks/geom/trs.js';
import { clamp, lerp } from '@homie-rocks/noise/Noise.js';
import { smoothstep } from './Kit.ts';
import type { RNG } from './Kit.ts';

export type { RNG };

export function parasolGeo(): { pole: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
  const pole = loft((t, o) => o.set(0, t * 2.3, 0), 3, 7, (t) => 0.045 - t * 0.012, 1, true, true);
  // scalloped cone with visible rib creases
  const segs = 16,
    rows = 3;
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const a = u * Math.PI * 2;
      const rib = Math.abs(((u * 8) % 1) - 0.5) * 2;
      const r = v * 1.35 * (1 + (1 - rib) * 0.035 * v);
      pos.push(Math.cos(a) * r, 2.3 - v * v * 0.44 - (1 - rib) * 0.05 * v, Math.sin(a) * r);
      uv.push(u * 2, v);
    }
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i;
      idx.push(a, a + 1, a + segs + 1, a + 1, a + segs + 2, a + segs + 1);
    }
  const canopy = new THREE.BufferGeometry();
  canopy.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  canopy.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  canopy.setIndex(idx);
  canopy.computeVertexNormals();
  return { pole, canopy };
}

export function deckchairGeo(): { frame: THREE.BufferGeometry; cloth: THREE.BufferGeometry } {
  const acc = new GeoAccum();
  const w = new THREE.Color(1, 1, 1);
  for (const s of [-1, 1]) {
    acc.add(bevelBox(0.05, 1.06, 0.05, 0.012, 6), trs(s * 0.28, 0.44, -0.16, 0, 1, 1, 1, -0.5), w);
    acc.add(bevelBox(0.05, 0.92, 0.05, 0.012, 6), trs(s * 0.28, 0.3, 0.22, 0, 1, 1, 1, 0.66), w);
  }
  acc.add(bevelBox(0.62, 0.05, 0.05, 0.012, 6), trs(0, 0.02, -0.42, 0), w);
  acc.add(bevelBox(0.62, 0.05, 0.05, 0.012, 6), trs(0, 0.02, 0.42, 0), w);
  const clothG = new THREE.PlaneGeometry(0.56, 1.25, 1, 5);
  const p = clothG.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const v = p.getY(i) / 1.25 + 0.5;
    p.setXYZ(i, p.getX(i), 0.16 + v * 0.62 - Math.sin(v * Math.PI) * 0.06, -0.42 + v * 0.72);
  }
  clothG.computeVertexNormals();
  return { frame: acc.build()!, cloth: clothG };
}

/** Marshal post: a booth, a pole and a flag socket. */
export function marshalGeo(): { post: THREE.BufferGeometry; flag: THREE.BufferGeometry } {
  const acc = new GeoAccum();
  const w = new THREE.Color(1, 1, 1);
  acc.add(bevelBox(0.9, 1.1, 0.7, 0.04, 1.2), trs(0, 0.55, 0, 0), w);
  acc.add(bevelBox(1.06, 0.09, 0.86, 0.02, 1.6), trs(0, 1.14, 0, 0), new THREE.Color(0.85, 0.85, 0.85));
  acc.add(loft((t, o) => o.set(0, t * 2.5, 0), 3, 7, () => 0.045, 1, true, true), trs(0.5, 1.1, 0.28, 0), w);
  const flag = new THREE.PlaneGeometry(1.0, 0.62, 8, 3);
  flag.translate(0.5, 0, 0);
  flag.rotateY(Math.PI / 2);
  flag.translate(0.5, 3.3, 0.28);
  return { post: acc.build()!, flag };
}

/** Banner arch spanning the road. `span` is the clear width. */
export function bannerArchGeo(span: number, height: number): { struct: THREE.BufferGeometry; banner: THREE.BufferGeometry } {
  const acc = new GeoAccum();
  const w = new THREE.Color(1, 1, 1);
  for (const s of [-1, 1]) {
    const x = (s * span) / 2;
    acc.add(bevelBox(0.75, height, 0.75, 0.05, 1.0), trs(x, height / 2, 0, 0), w);
    acc.add(bevelBox(1.15, 0.24, 1.15, 0.04, 1.2), trs(x, 0.12, 0, 0), new THREE.Color(0.86, 0.86, 0.86));
    acc.add(bevelBox(1.0, 0.2, 1.0, 0.04, 1.2), trs(x, height + 0.1, 0, 0), new THREE.Color(0.9, 0.9, 0.9));
    // diagonal brace
    acc.add(bevelBox(0.16, 2.2, 0.16, 0.03, 3), trs(x - s * 0.7, height - 1.0, 0, 0, 1, 1, 1, 0, s * 0.5), w);
  }
  // ------------------------------------------------------------------------
  //  THE BEAM IS A TRUSS, AND THE BANNER IS A BANNER.
  // ------------------------------------------------------------------------
  //  The first version's beam was a single 0.42 m box with a 1.05 m ribbon of
  //  cloth under it. Over a 28 m span that ribbon is 27:1, which is why the
  //  arch read in a wide shot as a bare telegraph crossbar ruling a hard
  //  horizontal line through the middle of the frame rather than as start-line
  //  dressing, and why the start straight had no readable banner at all.
  //
  //  A real gantry has depth: a top and a bottom chord with diagonal webbing
  //  between them. That breaks the silhouette into a lattice instead of one
  //  solid bar, gives the low sun several edges to catch, and is what stops it
  //  reading as an untextured box (hard unchamfered edges are an amateur tell —
  //  every member here is a bevelBox). And the banner itself goes to 2.8 m, which at 28 m of
  //  span is a 10:1 sheet: a printed banner, not a tape.
  const chord = 0.34;
  for (const y of [height + 0.28, height + 1.42]) acc.add(bevelBox(span + 1.6, chord, 0.5, 0.05, 0.35), trs(0, y, 0, 0), w);
  const webN = Math.max(6, Math.round(span / 2.2));
  for (let i = 0; i <= webN; i++) {
    const x = -((span + 1.0) / 2) + (i / webN) * (span + 1.0);
    acc.add(bevelBox(0.14, 1.34, 0.34, 0.03, 2.4), trs(x, height + 0.85, 0, 0, 1, 1, 1, 0, (i % 2 ? 1 : -1) * 0.62), new THREE.Color(0.92, 0.92, 0.92));
  }
  acc.add(bevelBox(span + 1.2, 0.2, 0.4, 0.03, 2), trs(0, height + 2.2, 0, 0), new THREE.Color(0.9, 0.9, 0.9));
  const banner = new THREE.PlaneGeometry(span + 1.2, 2.8, 14, 3);
  banner.translate(0, height + 0.78, 0.34);
  bannerUvs(banner);
  return { struct: acc.build()!, banner };
}

/**
 * Wire a hanging-banner plane's two UV channels.
 *
 * THE BANNER PRINT WAS ROTATED 90° AND NOBODY COULD SEE IT. `patchCloth` needs
 * uv.x to run 0 at the rooted edge to 1 at the free edge, and for a sheet hung
 * from a top rail that edge is VERTICAL — so the original code swapped the
 * plane's u and v wholesale and then sampled the albedo through the same
 * swapped coordinate. Canvas X therefore mapped to the banner's height and
 * canvas Y to its width: the lettering was being drawn sideways, crushed into a
 * strip a tenth of the banner wide, on a ribbon 1.05 m tall over a 28 m span.
 * Which is why there was no readable banner anywhere in the first version, and
 * why the arch read as a bare telegraph crossbar.
 *
 * Two channels fixes it without touching either the texture or the cloth patch:
 *   uv  — the cloth coordinate, vertical, as `patchCloth` requires
 *   uv1 — the real texture coordinate, upright, and mapped onto the printed top
 *         quarter of `bannerCloth` so the print fills the whole sheet
 */
export function bannerUvs(g: THREE.BufferGeometry) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const n = uv.count;
  const uv1 = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    uv1[i * 2] = u;
    // the printed band is the top quarter of the sheet (canvas rows 0..size/4),
    // which after flipY is v = 0.75..1
    uv1[i * 2 + 1] = 0.752 + v * 0.246;
    uv.setXY(i, 1 - v, u);
  }
  uv.needsUpdate = true;
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
}

/** Tiered grandstand with a canopy; returns structure + the crowd row anchors. */
export function grandstandGeo(len: number, rows: number): { struct: THREE.BufferGeometry; seats: { x: number; y: number; z: number }[] } {
  const acc = new GeoAccum();
  const w = new THREE.Color(1, 1, 1);
  const seats: { x: number; y: number; z: number }[] = [];
  const rowH = 0.52,
    rowD = 0.82;
  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    const z = -r * rowD;
    acc.add(bevelBox(len, rowH, rowD, 0.03, 0.35), trs(0, y + rowH / 2, z, 0), r % 2 ? new THREE.Color(0.92, 0.9, 0.86) : new THREE.Color(0.84, 0.82, 0.78));
    acc.add(bevelBox(len, 0.34, 0.09, 0.02, 0.9), trs(0, y + rowH + 0.17, z - rowD * 0.44, 0), new THREE.Color(0.78, 0.8, 0.84));
    seats.push({ x: 0, y: y + rowH, z });
  }
  const totalD = rows * rowD;
  // back wall + roof canopy on columns
  acc.add(bevelBox(len + 0.6, rows * rowH + 1.4, 0.35, 0.05, 0.4), trs(0, (rows * rowH + 1.4) / 2, -totalD - 0.1, 0), w);
  const capH = rows * rowH + 3.4;
  for (let i = 0; i <= 6; i++) {
    const x = -len / 2 + (i / 6) * len;
    acc.add(bevelBox(0.22, capH, 0.22, 0.03, 3), trs(x, capH / 2, 0.5, 0), w);
  }
  acc.add(bevelBox(len + 1.2, 0.22, totalD + 1.6, 0.04, 0.45), trs(0, capH + 0.6, -totalD / 2 + 0.4, 0, 1, 1, 1, 0.08), new THREE.Color(0.9, 0.88, 0.84));
  acc.add(bevelBox(len + 1.2, 0.34, 0.24, 0.03, 2), trs(0, capH + 0.42, 0.9, 0), new THREE.Color(0.86, 0.4, 0.36));
  // side walls
  for (const s of [-1, 1]) acc.add(bevelBox(0.3, rows * rowH + 0.6, totalD, 0.04, 0.45), trs((s * len) / 2, (rows * rowH) / 2, -totalD / 2, 0), w);
  return { struct: acc.build()!, seats };
}

/**
 * Campanile / bell tower — the landmark that gives the village a silhouette
 * apex. Returns the three material streams the terrace builder already merges.
 */
export function bellTowerGeo(rng: RNG, base: number, h: number): { wall: THREE.BufferGeometry; trim: THREE.BufferGeometry; roof: THREE.BufferGeometry; height: number } {
  const wall = new GeoAccum();
  const trim = new GeoAccum();
  const roof = new GeoAccum();
  const white = new THREE.Color(1, 1, 1);
  const shaftH = h * 0.74;
  // shaft, very slightly battered so it does not read as an extrusion
  wall.add(bevelBox(base, shaftH, base, 0.07, 0.42), trs(0, shaftH / 2, 0, 0), white, (_x, y) => lerp(0.4, 1, smoothstep(0, 2.2, y)));
  // string courses breaking the shaft into stages
  for (let i = 1; i <= 3; i++) {
    const y = (shaftH * i) / 4;
    trim.add(bevelBox(base + 0.22, 0.16, base + 0.22, 0.035, 0.9), trs(0, y, 0, 0), new THREE.Color(0xdfd3bc));
  }
  // narrow slit windows up the shaft
  for (let i = 0; i < 3; i++) {
    const y = shaftH * (0.24 + i * 0.22);
    for (const s of [-1, 1]) {
      wall.add(new THREE.PlaneGeometry(0.28, 1.0, 1, 1), trs((s * base) / 2 + s * 0.006, y, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2), new THREE.Color(0x2a2a30));
      wall.add(new THREE.PlaneGeometry(0.28, 1.0, 1, 1), trs(0, y, (s * base) / 2 + s * 0.006, s > 0 ? 0 : Math.PI), new THREE.Color(0x2a2a30));
    }
  }
  // belfry: open arched stage, deliberately wider than the shaft
  const belH = h * 0.16;
  const belW = base + 0.5;
  const py = shaftH;
  trim.add(bevelBox(belW + 0.3, 0.2, belW + 0.3, 0.04, 0.9), trs(0, py + 0.1, 0, 0), new THREE.Color(0xe4d9c2));
  // four corner piers leave the openings
  const pier = 0.42;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      wall.add(bevelBox(pier, belH, pier, 0.04, 0.9), trs((sx * (belW - pier)) / 2, py + belH / 2 + 0.2, (sz * (belW - pier)) / 2, 0), white, () => 0.9);
    }
  // dark void behind the arches so the belfry reads as open, not solid
  for (const s of [-1, 1]) {
    wall.add(new THREE.PlaneGeometry(belW - pier * 1.4, belH * 0.82, 1, 1), trs(0, py + belH * 0.55, (s * (belW - pier)) / 2 - s * 0.02, s > 0 ? 0 : Math.PI), new THREE.Color(0x241f22));
    wall.add(new THREE.PlaneGeometry(belW - pier * 1.4, belH * 0.82, 1, 1), trs((s * (belW - pier)) / 2 - s * 0.02, py + belH * 0.55, 0, (s * Math.PI) / 2), new THREE.Color(0x241f22));
  }
  // bell
  wall.add(loft((t, o) => o.set(0, -t * 0.5, 0), 4, 8, (t) => 0.1 + Math.pow(t, 1.6) * 0.2, 1, false, true), trs(0, py + belH * 0.82, 0, 0), new THREE.Color(0x6d5a34));
  // pyramid cap in roof tile
  const capH = h * 0.1;
  trim.add(bevelBox(belW + 0.44, 0.18, belW + 0.44, 0.04, 0.9), trs(0, py + belH + 0.29, 0, 0), new THREE.Color(0xe4d9c2));
  const cap = loft((t, o) => o.set(0, t * capH, 0), 2, 4, (t) => (1 - t) * (belW + 0.5) * 0.72, 1.6, false, false);
  cap.rotateY(Math.PI / 4);
  roof.add(cap, trs(0, py + belH + 0.38, 0, 0), new THREE.Color().setHSL(0.04, 0.2, 0.74));
  // finial
  trim.add(loft((t, o) => o.set(0, t * 1.1, 0), 2, 5, (t) => 0.06 * (1 - t * 0.6), 1, true, true), trs(0, py + belH + capH + 0.38, 0, 0), new THREE.Color(0xcfc0a4));
  void rng;
  return { wall: wall.build()!, trim: trim.build()!, roof: roof.build()!, height: py + belH + capH + 1.5 };
}

/** Market stall: four posts, a counter, and a striped canopy (fabric stream). */
export function stallGeo(rng: RNG): { frame: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
  const acc = new GeoAccum();
  const w = 2.6 + rng() * 1.1;
  const d = 1.7 + rng() * 0.5;
  const hh = 2.15 + rng() * 0.25;
  const white = new THREE.Color(1, 1, 1);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) acc.add(bevelBox(0.1, hh, 0.1, 0.02, 3), trs((sx * (w - 0.2)) / 2, hh / 2, (sz * (d - 0.2)) / 2, 0), white);
  // counter + a crate or two of produce
  acc.add(bevelBox(w, 0.12, d, 0.025, 1.1), trs(0, 0.95, 0, 0), new THREE.Color(0.88, 0.84, 0.76));
  acc.add(bevelBox(w - 0.2, 0.85, 0.1, 0.02, 1.1), trs(0, 0.5, (d - 0.1) / 2, 0), new THREE.Color(0.8, 0.76, 0.68));
  for (let i = 0; i < 3; i++) {
    const s = 0.3 + rng() * 0.14;
    acc.add(bevelBox(s, s * 0.7, s * 0.8, 0.02, 2), trs(-w / 2 + 0.4 + i * (w / 3.4), 1.06 + (s * 0.7) / 2, (rng() - 0.5) * 0.4, rng() * 3), new THREE.Color(0.9, 0.78, 0.6));
  }
  acc.add(bevelBox(w + 0.16, 0.08, 0.1, 0.02, 2), trs(0, hh, (d - 0.2) / 2, 0), white);
  // canopy: a shallow gable in the fabric atlas
  const can = new GeoAccum();
  const sl = Math.hypot(d / 2 + 0.28, 0.34);
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(w + 0.5, sl, 1, 1);
    g.rotateX(-Math.PI / 2);
    can.add(g, trs(0, hh + 0.16 - 0.17, (s * (d / 2 + 0.28)) / 2, 0, 1, 1, 1, (-s * 0.62) / 1.0), white);
  }
  const canopy = can.build()!;
  return { frame: acc.build()!, canopy };
}

/** Ridge tent for the support paddock bands. */
export function tentGeo(rng: RNG): { body: THREE.BufferGeometry } {
  const acc = new GeoAccum();
  const w = 2.8 + rng() * 1.4;
  const d = 3.4 + rng() * 1.6;
  const hh = 1.5 + rng() * 0.5;
  const wall = 0.6 + rng() * 0.35;
  const white = new THREE.Color(1, 1, 1);
  acc.add(bevelBox(w, wall, d, 0.04, 0.55), trs(0, wall / 2, 0, 0), white, (_x, y) => lerp(0.5, 1, smoothstep(0, 0.8, y)));
  const sl = Math.hypot(w / 2 + 0.2, hh);
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(sl, d + 0.4, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.rotateZ(s * Math.atan2(hh, w / 2 + 0.2));
    g.translate((-s * (w / 2 + 0.2)) / 2, wall + hh / 2, 0);
    acc.add(g, trs(0, 0, 0, 0), new THREE.Color(0.94, 0.92, 0.88));
  }
  // gable triangles so the tent is closed
  for (const s of [-1, 1]) {
    const t = new THREE.BufferGeometry();
    const x = w / 2 + 0.2;
    t.setAttribute('position', new THREE.Float32BufferAttribute(s > 0 ? [-x, wall, 0, x, wall, 0, 0, wall + hh, 0] : [x, wall, 0, -x, wall, 0, 0, wall + hh, 0], 3));
    t.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, s, 0, 0, s, 0, 0, s], 3));
    t.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    acc.add(t, trs(0, 0, (s * (d + 0.4)) / 2, 0), new THREE.Color(0.8, 0.78, 0.75));
  }
  return { body: acc.build()! };
}

/** Channel buoy: a float, a cage and a topmark. */
export function buoyGeo(): THREE.BufferGeometry {
  const acc = new GeoAccum();
  acc.add(loft((t, o) => o.set(0, -0.4 + t * 1.3, 0), 5, 8, (t) => Math.sin((0.12 + t * 0.78) * Math.PI) * 0.42, 1.4, true, true), trs(0, 0, 0, 0), new THREE.Color(1, 1, 1));
  acc.add(bevelBox(0.06, 1.5, 0.06, 0.015, 3), trs(0, 1.4, 0, 0), new THREE.Color(0.8, 0.8, 0.84));
  acc.add(loft((t, o) => o.set(0, t * 0.34, 0), 2, 4, (tt) => (1 - tt) * 0.2, 1, false, false), trs(0, 1.95, 0, 0), new THREE.Color(0.2, 0.2, 0.24));
  return acc.build()!;
}

/** Start-light gantry: five housings under the arch beam plus their lenses. */
export function startLightsGeo(span: number): { frame: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const acc = new GeoAccum();
  const lens = new GeoAccum();
  const white = new THREE.Color(1, 1, 1);
  const n = 5;
  const wBox = Math.min(0.78, (span * 0.5) / n);
  acc.add(bevelBox(wBox * n * 1.35, 0.16, 0.34, 0.03, 1.4), trs(0, 0.42, 0, 0), new THREE.Color(0.28, 0.28, 0.32));
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * wBox * 1.3;
    acc.add(bevelBox(wBox, wBox * 1.05, 0.3, 0.035, 1.6), trs(x, 0, 0, 0), new THREE.Color(0.22, 0.22, 0.26));
    acc.add(bevelBox(wBox * 1.1, 0.1, 0.42, 0.02, 2), trs(x, wBox * 0.56, 0.06, 0, 1, 1, 1, 0.25), new THREE.Color(0.18, 0.18, 0.21));
    const g = new THREE.CircleGeometry(wBox * 0.34, 12);
    lens.add(g, trs(x, 0, 0.17, 0), white);
  }
  return { frame: acc.build()!, lens: lens.build()! };
}

/** A-frame roadside board: two hinged panels on a folding frame. */
export function aFrameSignGeo(): { frame: THREE.BufferGeometry; panel: THREE.BufferGeometry } {
  const acc = new GeoAccum();
  const pan = new GeoAccum();
  const white = new THREE.Color(1, 1, 1);
  const hh = 1.25;
  const wdt = 1.9;
  for (const s of [-1, 1]) {
    for (const sx of [-1, 1]) acc.add(bevelBox(0.08, hh, 0.08, 0.02, 3), trs((sx * wdt) / 2, hh / 2, s * 0.3, 0, 1, 1, 1, (-s * 0.42) / 1.0), white);
    acc.add(bevelBox(wdt + 0.1, 0.07, 0.07, 0.015, 2), trs(0, 0.14, s * 0.55, 0), new THREE.Color(0.85, 0.85, 0.85));
    const g = new THREE.PlaneGeometry(wdt * 0.94, hh * 0.72, 1, 1);
    g.rotateX(s > 0 ? 0.42 : -0.42);
    g.translate(0, hh * 0.56, s * 0.24);
    if (s < 0) g.rotateY(Math.PI);
    pan.add(g, trs(0, 0, 0, 0), s > 0 ? white : new THREE.Color(0.9, 0.9, 0.9));
  }
  return { frame: acc.build()!, panel: pan.build()! };
}

/** Wall-mounted hoarding: a flat board on two short brackets. */
export function wallSignGeo(): { frame: THREE.BufferGeometry; panel: THREE.BufferGeometry } {
  const acc = new GeoAccum();
  const pan = new GeoAccum();
  const white = new THREE.Color(1, 1, 1);
  acc.add(bevelBox(3.2, 0.1, 0.12, 0.02, 2), trs(0, 1.62, 0, 0), white);
  acc.add(bevelBox(3.2, 0.1, 0.12, 0.02, 2), trs(0, 0.72, 0, 0), white);
  for (const s of [-1, 1]) acc.add(bevelBox(0.1, 1.15, 0.24, 0.02, 2), trs(s * 1.5, 1.17, -0.1, 0), new THREE.Color(0.86, 0.86, 0.86));
  const g = new THREE.PlaneGeometry(3.1, 0.82, 1, 1);
  g.translate(0, 1.17, 0.07);
  pan.add(g, trs(0, 0, 0, 0), white);
  return { frame: acc.build()!, panel: pan.build()! };
}

/**
 * A hoarding's PRINTED FACE, printed on both sides.
 *
 * A double-sided single quad shows mirrored lettering from the far side of the
 * course, which is exactly the kind of thing that gets noticed. Two quads,
 * back to back, with the back one's U flipped, 3 cm either side of the mount
 * plane so neither z-fights the frame.
 */
export function hoardingPanelGeo(w: number, h: number, y: number): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  const front = new THREE.PlaneGeometry(w, h, 1, 1);
  front.translate(0, y, 0.03);
  acc.add(front, m, new THREE.Color(1, 1, 1));
  const back = new THREE.PlaneGeometry(w, h, 1, 1);
  const buv = back.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < buv.count; i++) buv.setX(i, 1 - buv.getX(i));
  back.rotateY(Math.PI);
  back.translate(0, y, -0.03);
  acc.add(back, m, new THREE.Color(0.86, 0.86, 0.86));
  return acc.build()!;
}

/**
 * A hoarding's STRUCTURE: two posts, two rails and a bevelled frame around the
 * printed face.
 *
 * The frame is the part that matters. A zero-thickness printed plane catches no
 * edge highlight under a low sun and reads as a decal floating in the air
 * rather than as a physical object — and a board that is not a physical object
 * cannot be read as signage at any distance, however crisp the lettering is.
 *
 * @param w,h,y the printed face, matching `hoardingPanelGeo`.
 * @param postH post height, and `postY` where its centre sits.
 * @param bezel width of the frame bar around the face.
 * @param overhang how much wider and taller the frame is than the face. NOT
 *        derived from `bezel`: the bar can sit proud of the print or overlap
 *        it, and which one a board does is the caller's look.
 */
export function hoardingPostGeo(
  w: number, h: number, y: number,
  postH: number, postY: number, bezel: number, overhang: number,
): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const white = new THREE.Color(1, 1, 1);
  const half = w / 2 - 0.25;
  for (const s of [-1, 1]) acc.add(bevelBox(0.11, postH, 0.11, 0.02, 4), trs(s * half, postY, 0, 0), white);
  acc.add(bevelBox(w + 0.05, 0.09, 0.09, 0.02, 3), trs(0, y + h / 2 + 0.03, 0, 0), white);
  acc.add(bevelBox(w + 0.05, 0.09, 0.09, 0.02, 3), trs(0, y - h / 2 - 0.01, 0, 0), white);
  const fw = w + overhang,
    fh = h + overhang;
  const bar = new THREE.Color(0.92, 0.9, 0.88);
  for (const sy of [-1, 1]) acc.add(bevelBox(fw, bezel, 0.09, 0.016, 3), trs(0, y + sy * (fh / 2 - bezel / 2), 0.005, 0), bar);
  for (const sx of [-1, 1]) acc.add(bevelBox(bezel, fh, 0.09, 0.016, 3), trs(sx * (fw / 2 - bezel / 2), y, 0.005, 0), bar);
  return acc.build()!;
}

/**
 * A pennant on a mast. `uv.x` runs from the mast outward so a cloth patch waves
 * the free edge and not the hoist.
 */
export function pennantGeo(mastH: number, flagW: number, flagH: number, flagY: number): THREE.BufferGeometry {
  const acc = new GeoAccum();
  acc.add(bevelBox(0.07, mastH, 0.07, 0.015, 5), trs(0, mastH / 2, 0, 0), new THREE.Color(1, 1, 1));
  const g = new THREE.PlaneGeometry(flagW, flagH, 8, 2);
  g.translate(flagW / 2, 0, 0);
  g.translate(0, flagY, 0.04);
  acc.add(g, trs(0, 0, 0, 0), new THREE.Color(1, 1, 1));
  return acc.build()!;
}

/** One bunting pennant, pivoting from its top edge. */
export function buntingFlagGeo(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const w = 0.26,
    hh = 0.36;
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, 0, 0, w / 2, 0, 0, 0, -hh, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  // uv.x is the cloth patch's root->free coordinate: 0 on the line, 1 at the tip
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0.5], 2));
  return g;
}

/**
 * A spectator. uv.x flags tintable clothing, uv.y > 0.92 flags raised arms.
 * Four silhouettes: a row of identical capsules is the classic placeholder
 * tell, and the fix that costs nothing is a different OUTLINE, not more polys.
 *   0 standing  1 arms up  2 child (short, no cap)  3 adult with a sun hat
 */
export function spectatorGeo(variant = 0): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const skin = new THREE.Color(1, 1, 1);
  const dark = new THREE.Color(0.42, 0.4, 0.44);
  const white = new THREE.Color(1, 1, 1);
  const child = variant === 2;
  const sc = child ? 0.72 : 1;
  const build = 1 + (variant === 3 ? 0.14 : 0) - (child ? 0.06 : 0);
  // Deliberately cheap: there are several hundred of these and they are never
  // closer than a couple of metres behind a barrier. Colour variety, outline
  // variety and the cheer animation carry the read, not the mesh.
  //
  // What DID have to change after the first version: the arms were the same tint as the
  // torso and hung at 0.16 rad against a 0.19 m body, so they welded into the
  // silhouette and every spectator read as a coloured pill. Now the torso necks
  // in at the shoulders, the arms swing out clear of it, and the forearm is
  // untinted skin — the value break is what separates limb from body at 40 m,
  // not the extra 40 triangles.
  const torso = loft(
    (t, o) => o.set(0, (0.62 + t * 0.56) * sc, 0),
    4,
    6,
    // shoulder taper: widest at the chest, necked in at the collar
    (t) => (0.185 + Math.sin(Math.min(t * 1.35, 1) * Math.PI) * 0.045 - Math.pow(t, 3) * 0.07) * build * sc,
    1,
    true,
    true
  );
  setUv(torso, 1, 0.5);
  acc.add(torso, trs(0, 0, 0, 0), white);
  // legs, set wider apart with a visible gap between them
  const legG = loft((t, o) => o.set(0, t * 0.66 * sc, 0), 2, 5, (t) => (0.078 - t * 0.014) * sc, 1, true, true);
  setUv(legG, 0, 0.4);
  const stance = variant === 3 ? 0.125 : 0.105;
  for (const s of [-1, 1]) acc.add(legG, trs(s * stance * sc, 0, 0, 0, 1, 1, 1, 0, s * 0.05), dark);
  const shoulderX = 0.235 * sc * build;
  if (variant === 1) {
    // arms straight up — this is the silhouette that reads "crowd" at 60 m
    const sleeve = loft((t, o) => o.set(0, (1.06 + t * 0.3) * sc, 0), 1, 4, () => 0.054 * sc, 1, true, true);
    setUv(sleeve, 1, 0.96);
    const fore = loft((t, o) => o.set(0, (1.34 + t * 0.4) * sc, 0), 1, 4, (t) => (0.048 - t * 0.008) * sc, 1, true, true);
    setUv(fore, 0, 0.96);
    for (const s of [-1, 1]) {
      acc.add(sleeve, trs(s * shoulderX, 0, 0, 0, 1, 1, 1, 0, s * 0.24), white);
      acc.add(fore, trs(s * (shoulderX + 0.09 * sc), 0, 0, 0, 1, 1, 1, 0, s * 0.12), skin);
    }
  } else {
    // Arms hang OUT from the body: upper arm swung clear, forearm bare.
    const swing = variant === 3 ? 0.34 : 0.26;
    const sleeve = loft((t, o) => o.set(0, (1.12 - t * 0.26) * sc, 0), 1, 4, () => 0.057 * sc, 1, true, true);
    setUv(sleeve, 1, 0.96);
    const fore = loft((t, o) => o.set(0, (0.9 - t * 0.24) * sc, 0), 1, 4, (t) => (0.046 - t * 0.006) * sc, 1, true, true);
    setUv(fore, 0, 0.96);
    for (const s of [-1, 1]) {
      acc.add(sleeve, trs(s * shoulderX, 0, 0, 0, 1, 1, 1, 0, s * swing), white);
      acc.add(fore, trs(s * (shoulderX + 0.075 * sc), 0, 0.02 * sc, 0, 1, 1, 1, -0.22, s * (swing * 0.55)), skin);
    }
  }
  const head = loft((t, o) => o.set(0, (1.2 + t * 0.2) * sc, 0), 2, 6, (t) => Math.sin((0.18 + t * 0.72) * Math.PI) * 0.115 * sc, 1, true, true);
  setUv(head, 0, 0.5);
  acc.add(head, trs(0, 0, 0, 0), skin);
  if (variant === 3) {
    // wide-brimmed sun hat: a completely different head silhouette
    const brim = loft((t, o) => o.set(0, (1.34 + t * 0.05) * sc, 0), 1, 8, (t) => lerp(0.26, 0.2, t) * sc, 1, true, true);
    setUv(brim, 1, 0.5);
    acc.add(brim, trs(0, 0, 0, 0), white);
    const crown = loft((t, o) => o.set(0, (1.37 + t * 0.14) * sc, 0), 2, 6, (t) => 0.108 * (1 - t * 0.35) * sc, 1, false, true);
    setUv(crown, 1, 0.5);
    acc.add(crown, trs(0, 0, 0, 0), white);
  } else if (!child) {
    const cap = loft((t, o) => o.set(0, (1.33 + t * 0.09) * sc, 0), 2, 6, (t) => 0.115 * Math.cos(t * 1.2) * sc, 1, false, true);
    setUv(cap, 1, 0.5);
    acc.add(cap, trs(0, 0, 0, 0), white);
  }
  const g = acc.build()!;
  // ---- uv1: the real texture coordinate ----------------------------------
  // Channel 0 is a flag channel here (see `MatLib.crowd`), so the garment atlas
  // needs its own. Cylindrical: u is the bearing around the figure, v runs 0 at
  // the feet to 1 just above the head, which is the layout `crowdCloth` cards
  // are painted for — trousers low, shirt high. Derived from the built
  // positions rather than threaded through `GeoAccum`, which would mean an
  // extra stream on every prop in the game for the benefit of one of them.
  const pa = g.getAttribute('position') as THREE.BufferAttribute;
  const uv1 = new Float32Array(pa.count * 2);
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i),
      y = pa.getY(i),
      z = pa.getZ(i);
    // MIRRORED bearing, not a raw wrap. A raw atan2 jumps from 1 back to 0 down
    // the figure's back, and that one column of triangles would smear the whole
    // atlas cell across itself. |2a-1| is continuous at the wrap (both ends land
    // on 1), and since every card's pattern is stripes, hoops or blocks, the
    // mirror is invisible.
    const a = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
    uv1[i * 2] = Math.abs(a * 2 - 1);
    // v = 0 at the feet. The canvas is uploaded flipY, so v = 0 is the BOTTOM of
    // the card, which is where `crowdCloth` paints the trousers.
    uv1[i * 2 + 1] = clamp(y / 1.62, 0, 1);
  }
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  return g;
}

function setUv(g: THREE.BufferGeometry, x: number, y: number) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, x, y);
  uv.needsUpdate = true;
}
