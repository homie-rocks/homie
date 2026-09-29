/**
 * ============================================================================
 *  Village — a procedural house, and the six fittings that hang off it.
 * ============================================================================
 *  `buildHouse` composes walls, roof and trim into three shared accumulators
 *  so a whole street merges into three meshes, and records the per-instance
 *  transforms for shutters, glass, balconies, flower boxes, awnings, doors and
 *  lamps rather than building them inline. `shutterGeo` … `lampGeo` are those
 *  fittings, each unit-sized so one instance set scales to every opening.
 *
 *  PUBLISHED, NOT DE-DUPLICATED. These came out of one racing game's prop
 *  module, and the other racing game has no houses at all. The two racers'
 *  prop sets are disjoint, and a DSL reproducing them "is either as long as
 *  the code or is a different lawn" — but that argument is about
 *  de-duplication, and this move is not one. It is publication: the engine
 *  packages are a library of good things, and the next game that wants a
 *  village should import this one rather than write a worse one. The source
 *  game imports its own back, so its module surface is unchanged.
 *
 *  ONE PARAMETER IS NEW AND IT IS THE ONLY BEHAVIOURAL SEAM IN THE FILE.
 *  `buildHouse` read `PAL.shutters` — one game's art direction — at two call
 *  sites. It now takes the palette as its last argument, and the source game
 *  passes its own `PAL.shutters`. Same array, same order, so `pick` consumes
 *  the same draw and returns the same colour; a fingerprint test pins that
 *  bit-exactly against the pre-move source. No default is supplied on
 *  purpose: a default here would quietly paint somebody else's village in
 *  one particular game's colours.
 *
 *  `_m` is this module's alone. It stayed behind when `trs()` left for
 *  `@homie-rocks/geom/trs.js` and the two were sharing it; the note on its
 *  declaration below records what that cost. Nothing outside `buildHouse`
 *  touched it in the game, and nothing outside this file can touch it now.
 */
import * as THREE from 'three';
import { bevelBox, plainBox } from '@homie-rocks/geom/prim.js';
import { wallWithOpenings } from '@homie-rocks/geom/wall.js';
import type { Opening } from '@homie-rocks/geom/wall.js';
import { loft } from '@homie-rocks/geom/loft.js';
import { GeoAccum } from '@homie-rocks/geom/accum.js';
import { trs } from '@homie-rocks/geom/trs.js';
import { lerp } from '@homie-rocks/noise/Noise.js';
import { pick, smoothstep } from './Kit.ts';
import type { RNG } from './Kit.ts';

export type { RNG };

/**
 * `buildHouse` composes into this and clones per part, thousands of times per
 * boot. It stayed behind when `trs()` left for `@homie-rocks/geom/trs.js`, and the
 * two were sharing it: `trs` used to compose INTO `_m` and hand back a clone,
 * so every `_m.multiplyMatrices(xform, trs(...))` below worked only because
 * argument evaluation runs `trs` first and because that `.clone()` was there.
 * It held; nothing ever checked it; and it is exactly the coupling a
 * 5,602-line file makes invisible. The package's `trs` has its own private
 * scratch now, so this one belongs to `buildHouse` alone.
 */
const _m = new THREE.Matrix4();

// --- village house ---------------------------------------------------------

export interface HouseParts {
  walls: GeoAccum;
  roof: GeoAccum;
  trim: GeoAccum;
  shutters: { m: THREE.Matrix4; color: THREE.Color; uv: THREE.Vector4 }[];
  glass: THREE.Matrix4[];
  balcony: THREE.Matrix4[];
  flowerbox: { m: THREE.Matrix4; color: THREE.Color }[];
  awning: { m: THREE.Matrix4; uv: THREE.Vector4 }[];
  door: { m: THREE.Matrix4; color: THREE.Color }[];
  lamp: THREE.Matrix4[];
  /** world anchors for laundry lines: (position, height) */
  lineAnchors: THREE.Vector3[];
}

/** Pass the shared accumulators so a whole street merges into three meshes. */
export function newHouseParts(walls?: GeoAccum, roof?: GeoAccum, trim?: GeoAccum): HouseParts {
  return {
    walls: walls ?? new GeoAccum(),
    roof: roof ?? new GeoAccum(),
    trim: trim ?? new GeoAccum(),
    shutters: [],
    glass: [],
    balcony: [],
    flowerbox: [],
    awning: [],
    door: [],
    lamp: [],
    lineAnchors: [],
  };
}

/**
 * Wall AO for a building of known height: contact darkening at the base AND an
 * eave shadow under the roof overhang. Without the second term the roofline is
 * a hard line and the roof reads as pasted onto the wall.
 */
const wallAOFor = (h: number) => (_x: number, y: number, _z: number) =>
  lerp(0.42, 1, smoothstep(0, 1.6, y)) * lerp(0.5, 1, smoothstep(h, h - 1.0, y));

/**
 * Gable end: the triangle between the wall head and the underside of the two
 * roof slopes, extruded `thick` along X. Without this the roof is two floating
 * slabs with an open triangular void at each end, which is precisely what
 * makes a hipped-box village read as flat planes hovering over the walls.
 */
function gableWedge(halfZ: number, rise: number, thick: number): THREE.BufferGeometry {
  const hx = thick / 2;
  const P: number[] = [];
  const N: number[] = [];
  const U: number[] = [];
  const idx: number[] = [];
  const tri = (a: number[], b: number[], c: number[], n: number[]) => {
    const base = P.length / 3;
    for (const v of [a, b, c]) {
      P.push(v[0], v[1], v[2]);
      N.push(n[0], n[1], n[2]);
      // planar UV off the ZY plane so the plaster does not stretch
      U.push(v[2] * 0.42, v[1] * 0.42);
    }
    idx.push(base, base + 1, base + 2);
  };
  for (const s of [-1, 1]) {
    const x = s * hx;
    const a = [x, 0, -halfZ];
    const b = [x, 0, halfZ];
    const c = [x, rise, 0];
    if (s > 0) tri(a, b, c, [1, 0, 0]);
    else tri(b, a, c, [-1, 0, 0]);
  }
  // two sloping faces closing the wedge sides, and the flat bottom
  const q = (a: number[], b: number[], c: number[], dd: number[], n: number[]) => {
    tri(a, b, c, n);
    tri(a, c, dd, n);
  };
  const sl = Math.hypot(halfZ, rise);
  q([-hx, 0, halfZ], [hx, 0, halfZ], [hx, rise, 0], [-hx, rise, 0], [0, halfZ / sl, rise / sl]);
  q([hx, 0, -halfZ], [-hx, 0, -halfZ], [-hx, rise, 0], [hx, rise, 0], [0, halfZ / sl, -rise / sl]);
  q([-hx, 0, -halfZ], [hx, 0, -halfZ], [hx, 0, halfZ], [-hx, 0, halfZ], [0, -1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(idx);
  return g;
}

/** Warm terracotta multipliers for the roof map — never the wall pastel. */
/**
 * Roof tint multipliers over the barrel-tile map.
 *
 * These used to spread lightness 0.66–0.94 per house, which sounds like variety
 * and is actually the opposite: it put roofs across the same value range as the
 * pastel walls, so wall and roof stopped separating and the whole hillside
 * collapsed into one brown mass. A Mediterranean hill town is legible because
 * the roofs are ONE constant band — #b5643f — and the walls carry all the
 * variety underneath it. So the spread here is now ±7% of a single terracotta,
 * which is weathering, not colour.
 */
const ROOF_MULT: [number, number, number][] = [
  [0.038, 0.20, 0.70],
  [0.034, 0.22, 0.66],
  [0.042, 0.18, 0.73],
  [0.036, 0.24, 0.68],
  [0.040, 0.20, 0.71],
];

/**
 * Terraced Mediterranean house. Emits merged wall/roof/trim geometry into the
 * shared accumulators and pushes its fittings into shared instance lists, so a
 * street of thirty houses is still a dozen draw calls.
 *
 * `xform` places the house: +Z is the street-facing facade.
 */
export function buildHouse(out: HouseParts, rng: RNG, xform: THREE.Matrix4, w: number, d: number, floors: number, tint: THREE.Color, shutters: number[]) {
  const floorH = 3.05 + rng() * 0.35;
  const h = floorH * floors + 0.45;
  const wAO = wallAOFor(h);
  const openings: Opening[] = [];
  const winW = 0.95 + rng() * 0.25;
  const winH = 1.55 + rng() * 0.3;
  const cols = Math.max(2, Math.round((w - 1.0) / 2.3));
  const doorCol = (rng() * cols) | 0;
  const winPos: { x: number; y: number; f: number; c: number }[] = [];
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      const x = ((c + 0.5) / cols) * w - w / 2;
      if (f === 0 && c === doorCol) {
        // a door instead of a window
        openings.push({ x: x - 0.55, y: 0.02, w: 1.1, h: 2.3 });
        continue;
      }
      const y = f * floorH + 1.05;
      openings.push({ x: x - winW / 2, y, w: winW, h: winH });
      winPos.push({ x, y, f, c });
    }
  }
  // Facade with real reveals + three plain sides.
  const facade = wallWithOpenings(w, h, openings.map((o) => ({ x: o.x + w / 2, y: o.y, w: o.w, h: o.h })), 0.22, 0.42);
  facade.translate(-w / 2, 0, d / 2);
  const rearAndSides = new GeoAccum();
  const back = bevelBox(w, h, 0.3, 0.05, 0.42);
  rearAndSides.add(back, trs(0, h / 2, -d / 2 + 0.15, 0), undefined, wAO);
  // Side elevations get real openings too.
  //
  // The first version punched only the street facade and left the other three
  // faces as plain boxes, which is fine looking down a street and catastrophic
  // looking ALONG one — a foreground building seen side-on read as a
  // 500x400 px slab of flat red because there was genuinely nothing on it. A
  // Mediterranean gable end is sparser than the facade, never blank: one or two
  // small windows a floor, no balconies, no shutters.
  const side = bevelBox(0.3, h, d - 0.3, 0.05, 0.42);
  const sideCols = Math.max(1, Math.round((d - 1.4) / 3.1));
  for (const sx of [-1, 1]) {
    const ops: Opening[] = [];
    const glassAt: { z: number; y: number; w: number; h: number }[] = [];
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < sideCols; c++) {
        if (rng() < 0.4) continue;
        const zc = ((c + 0.5) / sideCols) * d;
        const ow = 0.72 + rng() * 0.22;
        const oh = 1.1 + rng() * 0.3;
        const oy = f * floorH + 1.15;
        ops.push({ x: zc - ow / 2, y: oy, w: ow, h: oh });
        // yaw sx*PI/2 maps the wall's local x onto world z = sx * (d/2 - x)
        glassAt.push({ z: sx * (d / 2 - zc), y: oy, w: ow, h: oh });
      }
    }
    if (!ops.length) {
      rearAndSides.add(side, trs(sx * (w / 2 - 0.15), h / 2, 0, 0), undefined, wAO);
      continue;
    }
    // The punched wall is authored facing +Z spanning x in [0, d]; a ±90° yaw
    // turns it into the ±X elevation with its local x running along the depth.
    const sw = wallWithOpenings(d, h, ops, 0.19, 0.42);
    const rot = new THREE.Matrix4().makeRotationY((sx * Math.PI) / 2);
    const mv = new THREE.Matrix4().makeTranslation(sx * (w / 2), 0, (sx * d) / 2);
    rearAndSides.add(sw, mv.multiply(rot), undefined, wAO);
    // a thin backing pier so the punched face still has a wall behind it
    rearAndSides.add(bevelBox(0.16, h, d - 0.3, 0.04, 0.42), trs(sx * (w / 2 - 0.27), h / 2, 0, 0), undefined, wAO);
    for (const gq of glassAt) {
      out.glass.push(
        _m
          .multiplyMatrices(
            xform,
            new THREE.Matrix4().compose(
              new THREE.Vector3(sx * (w / 2 - 0.18), gq.y + gq.h / 2, gq.z),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (sx * Math.PI) / 2, 0)),
              new THREE.Vector3(gq.w * 0.94, gq.h * 0.94, 1)
            )
          )
          .clone()
      );
    }
  }
  // interior floor slab so you never see through an opening into nothing
  rearAndSides.add(bevelBox(w - 0.4, 0.2, d - 0.4, 0.02, 0.42), trs(0, h - 0.4, 0, 0), undefined, () => 0.32);

  // Corner arrises. `wallWithOpenings` produces flat faces meeting at a hard
  // 90°, and an unchamfered edge is one of the biggest amateur tells for
  // a reason: at a 14° sun a true 90° corner catches no specular at all, so two
  // adjacent walls at different angles to the key meet on a hairline instead of
  // on a lit edge. A 6 cm post turned 45° gives every corner a 4 cm facet that
  // takes a highlight and separates the two elevations.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      rearAndSides.add(bevelBox(0.06, h, 0.06, 0.014, 0.42), trs(sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02), Math.PI / 4), undefined, wAO);

  out.walls.add(facade, xform, tint, wAO);
  const rs = rearAndSides.build();
  if (rs) out.walls.add(rs, xform, tint, undefined);

  // --- roof: two real slabs with thickness, closed gables and capped eaves.
  // The eave overhang runs front/back only; the gable overhang is deliberately
  // tiny so a terrace of houses at 0.5 m centres never has one roof punching
  // through its neighbour's wall.
  const pitch = 0.38 + rng() * 0.14;
  const overZ = 0.46;
  const overX = 0.13;
  const halfZ = d / 2 + overZ;
  const rise = halfZ * pitch;
  const slopeLen = Math.hypot(halfZ, rise);
  const thick = 0.3;
  const rm = ROOF_MULT[(rng() * ROOF_MULT.length) | 0];
  const roofCol = new THREE.Color().setHSL(rm[0], rm[1] * (0.9 + rng() * 0.2), rm[2] * (0.95 + rng() * 0.1));
  // Gable ends first: they close the triangular void the two slopes leave.
  const gab = gableWedge(halfZ - 0.04, rise, 0.26);
  for (const s of [-1, 1]) out.walls.add(gab, _m.multiplyMatrices(xform, trs((s * w) / 2, h, 0, 0)).clone(), tint, () => 0.62);
  // Slopes. Sitting the slab so its UNDERSIDE meets the wall head means the
  // fascia thickness reads at the eave instead of a zero-thickness edge.
  //
  // SIGN MATTERS. Rx(+t) sends local +Z to (0, -sin t, cos t), so the slab on
  // the +Z side needs Rx(+ang) to fall AWAY from the ridge. With the sign
  // inverted the pair slopes up toward the eaves instead of down: a butterfly
  // roof, with the ridge cap and the gable wedge both two metres out of place —
  // which is exactly the "flat planes hovering over the wall tops" read.
  const slab = bevelBox(w + overX * 2, thick, slopeLen, 0.04, 0.9);
  const ang = Math.atan2(rise, halfZ);
  for (const s of [-1, 1]) {
    const mm = new THREE.Matrix4().compose(
      new THREE.Vector3(0, h + rise / 2 + (thick / 2) * Math.cos(ang), (s * halfZ) / 2),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(s * ang, 0, 0)),
      new THREE.Vector3(1, 1, 1)
    );
    // darken toward the eave: the underside of the overhang is in shadow and
    // the ridge catches the low sun
    out.roof.add(slab, _m.multiplyMatrices(xform, mm).clone(), roofCol, (_x, y) => lerp(0.68, 1.0, smoothstep(-thick * 0.5, thick * 0.5, y)));
  }
  // Ridge cap, straddling the seam where the two slab TOP faces meet. A slab of
  // perpendicular thickness `thick` laid at `ang` puts its top surface
  // thick/cos(ang) above the underside plane at the ridge, so a cap parked at
  // rise + thick/2 is buried inside the roof and the seam shows through.
  const halfWr = w / 2 + overX;
  const ridgeY = h + rise + thick / Math.cos(ang) + 0.03;
  const ridge = loft((t, o) => o.set(-halfWr + t * halfWr * 2, 0, 0), 3, 8, () => 0.17, 1.4, true, true);
  out.roof.add(ridge, _m.multiplyMatrices(xform, trs(0, ridgeY, 0, 0)).clone(), roofCol.clone().multiplyScalar(1.08));
  // Stone eave band at the wall head. It is narrower than the roof and warm,
  // not white — a white slab wider than the roof is what read as a floating
  // plate in the first version.
  const corn = bevelBox(w + 0.18, 0.15, d + 0.18, 0.035, 0.7);
  out.trim.add(corn, _m.multiplyMatrices(xform, trs(0, h - 0.075, 0, 0)).clone(), new THREE.Color(0xd7c9b0), (_x, y) => lerp(0.55, 1.0, smoothstep(-0.075, 0.02, y)));

  // --- chimney, standing on the ridge so it reads against the sky
  if (rng() < 0.75) {
    const cw = 0.5 + rng() * 0.22;
    const cx = (rng() - 0.5) * (w - 1.6);
    const ch = 1.1 + rng() * 1.0;
    const cy = h + rise * 0.86;
    out.walls.add(bevelBox(cw, ch, cw, 0.04, 0.9), _m.multiplyMatrices(xform, trs(cx, cy + ch / 2 - 0.25, 0.12, 0)).clone(), tint, () => 0.85);
    out.trim.add(bevelBox(cw + 0.2, 0.14, cw + 0.2, 0.03, 1.2), _m.multiplyMatrices(xform, trs(cx, cy + ch - 0.28, 0.12, 0)).clone(), new THREE.Color(0xd9c9b2));
  }

  // --- window fittings
  const shutterCol = new THREE.Color(pick(rng, shutters));
  // Stains and cast shadows keep the wall's own hue — a neutral grey smear on
  // a pink wall reads as a decal, not as weathering.
  const DRIP = tint.clone().multiplyScalar(0.8).lerp(new THREE.Color(0x9a8b76), 0.42);
  const HEADSHADE = tint.clone().multiplyScalar(0.55).lerp(new THREE.Color(0x5f6070), 0.34);
  for (const wp of winPos) {
    const z = d / 2 + 0.01;
    // Head shadow: a 22 cm strip immediately under the lintel. A 22 cm reveal
    // cannot self-shadow at 60 m, so the shadow it WOULD cast is painted.
    const hs = new THREE.PlaneGeometry(winW + 0.08, 0.24, 1, 1);
    out.walls.add(hs, _m.multiplyMatrices(xform, trs(wp.x, wp.y + winH + 0.12, z + 0.004, 0)).clone(), HEADSHADE, (_x, y) => lerp(1.0, 0.42, smoothstep(-0.12, 0.12, y)));
    // Sill drip stain: runoff tracks off the two sill ends, never a rectangle.
    for (const s of [-1, 1]) {
      const dg = new THREE.PlaneGeometry(0.2, 1.05, 1, 1);
      out.walls.add(dg, _m.multiplyMatrices(xform, trs(wp.x + s * (winW / 2 + 0.11), wp.y - 0.62, z + 0.004, 0)).clone(), DRIP, (_x, y) => lerp(0.66, 1.0, smoothstep(-0.52, 0.5, -y)) * 0.96);
    }
    // stone sill, with a 8 cm drip lip the low sun catches
    out.trim.add(bevelBox(winW + 0.34, 0.1, 0.3, 0.02, 1.4), _m.multiplyMatrices(xform, trs(wp.x, wp.y - 0.06, z + 0.06, 0)).clone(), new THREE.Color(0xe8dfce));
    out.trim.add(bevelBox(winW + 0.4, 0.06, 0.08, 0.015, 2.2), _m.multiplyMatrices(xform, trs(wp.x, wp.y - 0.13, z + 0.19, 0)).clone(), new THREE.Color(0xdccfba));
    // Recessed glass, sitting at the back of the reveal — with a 1–3° tilt.
    //
    // The material is already a proper physical glass (roughness 0.08,
    // envMapIntensity 2.2), and yet not one pane in a wide shot reflected anything.
    // The reason is that every pane in the village was exactly coplanar with its
    // wall, so a whole terrace shares one reflection vector: either they ALL
    // catch the sun disc or, as here, none of them does, and a specular lobe
    // that narrow will almost never be the lucky one. Real glazing is never
    // that true — old timber sashes sit a degree or two out and no two the
    // same. A couple of degrees of scatter is all it takes for a handful of
    // panes on any given hillside to line up on the sun and flare, and that
    // scatter of bright hits is most of what sells a Mediterranean village at
    // golden hour. The pitch is biased UP so a miss samples sky rather than
    // ground.
    out.glass.push(
      _m
        .multiplyMatrices(
          xform,
          trs(wp.x, wp.y + winH / 2, z - 0.20, (rng() - 0.5) * 0.055, winW * 0.94, winH * 0.94, 1, -0.012 - rng() * 0.045, (rng() - 0.5) * 0.03)
        )
        .clone()
    );
    // shutters, one per side, occasionally swung open
    const openA = rng() < 0.4 ? 0.6 + rng() * 0.7 : 0.02;
    for (const s of [-1, 1]) {
      const hingeX = wp.x + s * (winW / 2 + 0.02);
      const mm = new THREE.Matrix4()
        .compose(new THREE.Vector3(hingeX, wp.y + winH / 2, z + 0.03), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -s * openA, 0)), new THREE.Vector3(1, 1, 1))
        .multiply(new THREE.Matrix4().makeTranslation((-s * winW) / 4, 0, 0))
        .multiply(new THREE.Matrix4().makeScale(winW / 2, winH, 1));
      out.shutters.push({ m: _m.multiplyMatrices(xform, mm).clone(), color: shutterCol, uv: new THREE.Vector4(0.5, 1, 0, 0) });
    }
    // flower box on the ground and first floors
    if (wp.f < 2 && rng() < 0.62) {
      out.flowerbox.push({ m: _m.multiplyMatrices(xform, trs(wp.x, wp.y - 0.02, z + 0.16, 0, winW / 1.0, 1, 1)).clone(), color: new THREE.Color(pick(rng, [0x8a5a3a, 0x6d6f57, 0xa8927a])) });
    }
    // balcony on upper floors
    if (wp.f >= 1 && rng() < 0.45) {
      out.balcony.push(_m.multiplyMatrices(xform, trs(wp.x, wp.y - 0.06, z + 0.05, 0, Math.max(1, winW + 0.6), 1, 1)).clone());
      if (rng() < 0.6) out.lineAnchors.push(new THREE.Vector3().setFromMatrixPosition(_m.multiplyMatrices(xform, trs(wp.x, wp.y + winH, z + 0.6, 0)).clone()));
    }
  }
  // doors + awning + lamp
  const dx = ((doorCol + 0.5) / cols) * w - w / 2;
  out.door.push({ m: _m.multiplyMatrices(xform, trs(dx, 0.02, d / 2 - 0.06, 0, 1.06, 2.24, 1)).clone(), color: new THREE.Color(pick(rng, shutters)) });
  out.trim.add(bevelBox(1.5, 0.16, 0.34, 0.03, 1.3), _m.multiplyMatrices(xform, trs(dx, 2.36, d / 2 + 0.1, 0)).clone(), new THREE.Color(0xe8dfce));
  if (rng() < 0.45) {
    const cell = (rng() * 4) | 0;
    out.awning.push({ m: _m.multiplyMatrices(xform, trs(dx, 2.6, d / 2 + 0.02, 0, 1.9 + rng() * 0.8, 1, 1)).clone(), uv: new THREE.Vector4(0.25, 0.25, cell * 0.25, ((rng() * 4) | 0) * 0.25) });
  }
  if (rng() < 0.5) out.lamp.push(_m.multiplyMatrices(xform, trs(dx + 0.95, 2.9, d / 2 + 0.06, 0)).clone());
  // front steps where the door sits above grade
  out.trim.add(bevelBox(1.7, 0.16, 0.4, 0.02, 1.1), _m.multiplyMatrices(xform, trs(dx, -0.06, d / 2 + 0.2, 0)).clone(), new THREE.Color(0xd6cbb6));
  out.trim.add(bevelBox(2.0, 0.16, 0.6, 0.02, 1.1), _m.multiplyMatrices(xform, trs(dx, -0.2, d / 2 + 0.42, 0)).clone(), new THREE.Color(0xd6cbb6));

  if (rng() < 0.5) out.lineAnchors.push(new THREE.Vector3().setFromMatrixPosition(_m.multiplyMatrices(xform, trs((rng() - 0.5) * w * 0.7, h - 1.2, d / 2 + 0.25, 0)).clone()));
}

// --- reusable prop geometries ---------------------------------------------

/** Louvred shutter, unit sized (1 x 1) so instances can scale it to any window. */
export function shutterGeo(): THREE.BufferGeometry {
  const acc = new GeoAccum();
  // The panel is the only part big enough for a chamfer to read; the louvres
  // are 7 cm deep and there are nearly a thousand of these in the village.
  acc.add(bevelBox(1, 1, 0.06, 0.012, 1.6), trs(0, 0, 0, 0), new THREE.Color(1, 1, 1));
  const slat = plainBox(0.88, 0.08, 0.05, 3);
  for (let i = 0; i < 5; i++) {
    const y = -0.4 + (i / 4) * 0.8;
    acc.add(slat, trs(0, y, 0.045, 0, 1, 1, 1, -0.34), new THREE.Color(0.88, 0.88, 0.88));
  }
  const rail = plainBox(0.94, 0.07, 0.075, 3);
  acc.add(rail, trs(0, 0.46, 0.02, 0), new THREE.Color(1, 1, 1));
  acc.add(rail, trs(0, -0.46, 0.02, 0), new THREE.Color(1, 1, 1));
  return acc.build()!;
}

export function doorGeo(): THREE.BufferGeometry {
  const acc = new GeoAccum();
  acc.add(bevelBox(1, 1, 0.08, 0.014, 1.4).translate(0, 0.5, 0), trs(0, 0, 0, 0), new THREE.Color(1, 1, 1));
  for (const y of [0.28, 0.68]) {
    acc.add(bevelBox(0.66, 0.28, 0.045, 0.012, 3), trs(0, y, 0.05, 0), new THREE.Color(0.82, 0.82, 0.82));
  }
  return acc.build()!;
}

export function balconyGeo(): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const white = new THREE.Color(1, 1, 1);
  acc.add(bevelBox(1, 0.09, 0.72, 0.02, 1.6), trs(0, 0, 0.3, 0), white); // slab
  acc.add(bevelBox(1, 0.055, 0.055, 0.014, 4), trs(0, 0.92, 0.64, 0), white); // handrail
  const lowRail = plainBox(1, 0.04, 0.04, 4);
  acc.add(lowRail, trs(0, 0.3, 0.64, 0), white);
  const post = plainBox(0.045, 0.94, 0.045, 4);
  const baluster = plainBox(0.03, 0.9, 0.03, 6);
  for (const s of [-1, 1]) {
    acc.add(post, trs(s * 0.47, 0.47, 0.64, 0), white);
    acc.add(post, trs(s * 0.47, 0.46, 0.02, 0), white);
    acc.add(plainBox(0.045, 0.05, 0.66, 4), trs(s * 0.47, 0.92, 0.32, 0), white);
    acc.add(plainBox(0.1, 0.22, 0.3, 3), trs(s * 0.4, -0.14, 0.14, 0), white); // corbel
  }
  for (let i = 0; i < 7; i++) acc.add(baluster, trs(-0.42 + (i / 6) * 0.84, 0.46, 0.64, 0), white);
  return acc.build()!;
}

export function flowerBoxGeo(): THREE.BufferGeometry {
  const acc = new GeoAccum();
  acc.add(bevelBox(1, 0.26, 0.28, 0.02, 2.4), trs(0, 0.13, 0, 0), new THREE.Color(1, 1, 1));
  return acc.build()!;
}

export function awningGeo(): THREE.BufferGeometry {
  // Slightly scalloped, sagging canvas — never a flat plane.
  const segs = 10;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const rows = 4;
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const scallop = j === rows ? Math.sin(u * Math.PI * 5) * 0.05 : 0;
      const sag = Math.sin(u * Math.PI) * 0.06 * v;
      pos.push((u - 0.5) * 1.0, -v * 0.62 - sag + scallop * 0.3, v * 0.95);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < rows; j++)
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

export function lampGeo(): { arm: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const acc = new GeoAccum();
  const w = new THREE.Color(1, 1, 1);
  acc.add(bevelBox(0.06, 0.06, 0.5, 0.015, 6), trs(0, 0, 0.24, 0), w);
  acc.add(bevelBox(0.05, 0.3, 0.05, 0.012, 6), trs(0, -0.16, 0.46, 0), w);
  acc.add(bevelBox(0.26, 0.06, 0.26, 0.015, 5), trs(0, -0.02, 0.46, 0), w);
  return { arm: acc.build()!, glow: bevelBox(0.17, 0.24, 0.17, 0.05, 4).translate(0, -0.44, 0.46) };
}

// --- harbour ---------------------------------------------------------------
