/**
 * ============================================================================
 *  Vegetation — trunks, fronds, canopies and card clumps.
 * ============================================================================
 *  The shapes a planting layer instances. Every generator here takes numbers
 *  and returns a `THREE.BufferGeometry`; which species goes where, at what
 *  density, in which green, on which slope is the GAME's decision and nothing
 *  in this file can see it.
 *
 *  PUBLISHED, NOT DE-DUPLICATED — the argument in `Village.ts`'s header. The
 *  palm, pine, cypress and grass generators came out of one racing game's
 *  foliage module, whose remaining job is the planting: the species list, the
 *  densities, the greens and the shadow requests. `archedFrondGeo` came from a
 *  forest-floor game, with that game's complete profile passed as required
 *  data. A jungle game contributed its richer pinnate-fern and
 *  broad-heliconia surfaces (without its rosette, stalk, palette or
 *  placement), then its sapling and fallen log once their vertex-colour
 *  palettes became required caller data, then its buttressed emergent trunk
 *  and bowed crown card, with all absolute vertex tint kept as required
 *  caller data. There was no second exact copy of any of these and that is
 *  not the test: the next game that wants a tree, close-view leaf or
 *  forest-floor prop should not have to loft its own.
 *
 *  ------------------------------------------------------------------------
 *  EVERY HEIGHT IS A PARAMETER, AND THAT IS THE POINT OF THE MOVE
 *  ------------------------------------------------------------------------
 *  `PALM_H = 7.2`, `PINE_H = 6.4`, the cypress's `7.0` and the arched frond's
 *  seven profile values were module constants in the games, and a landform's
 *  tree height is exactly the kind of tuned number that turns a shared
 *  generator into one world's look. They are arguments now, the caller binds
 *  them, and the parity probes drive each at a second value and require the
 *  vertices to move — a baseline that hard-codes a value cannot notice an
 *  option being deleted and the game's literal inlined, which once happened
 *  to four of `@homie-rocks/brush`'s options with every check green.
 *
 *  What did NOT become a parameter in the original palm: its buttress / boot /
 *  coconut ratios. Those are neutral per-part shading ratios — 0.86 against
 *  1.0 means "this wedge sits in its own shadow." The emergent trunk was
 *  different: its bole, buttress and branch values carry three distinct brown
 *  hues, so all nine numbers correctly stay in the caller. `frondGeo`'s scalar
 *  junction AO ramp remains mechanism for the same reason.
 *
 *  ------------------------------------------------------------------------
 *  `clumpGeo` AND `tuftGeo` ARE NOT ONE FUNCTION
 *  ------------------------------------------------------------------------
 *  They look like the same crossed-card fan with different constants, and
 *  merging them compiles and renders. They draw from the RNG IN A DIFFERENT
 *  ORDER — the clump rolls its lean before its offsets, the tuft rolls its
 *  tilt after them — so one shared body reseeds every blade of grass in a
 *  world that was authored against the old sequence. Identical output today
 *  is not identical behaviour.
 * ============================================================================
 */
import * as THREE from 'three';
import { bevelBox, plainBox, card } from '@homie-rocks/geom/prim.js';
import { loft } from '@homie-rocks/geom/loft.js';
import { GeoAccum } from '@homie-rocks/geom/accum.js';
import { trs } from '@homie-rocks/geom/trs.js';
import { clamp, hash2, lerp } from '@homie-rocks/noise/Noise.js';
import type { RNG } from './Kit.ts';

const clamp01 = (v: number) => clamp(v, 0, 1);

/**
 * Palm trunk: a real curve (bows away from the prevailing wind), an elliptical
 * cross-section that rotates slightly up the stem, a flared root base and a
 * collar of old frond boots under the crown. `h` is the local trunk height;
 * fronds attach at `(h * bend, h, h * bend * 0.35)`, which `crownAttach`
 * returns so a caller does not have to re-derive it.
 */
export function palmTrunkGeo(h: number, bend: number): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const trunk = loft(
    (t, o) => {
      const s = Math.pow(t, 1.55);
      o.set(s * h * bend, t * h, s * h * bend * 0.35);
    },
    18,
    // 14 radial segments: at 8 the silhouette of a hero palm two metres from
    // the lens is visibly faceted against a bright sky.
    14,
    (t, a) => {
      // root flare, mid-stem taper, slight swelling under the crown
      const flare = 1 + Math.pow(1 - Math.min(t * 7, 1), 2.4) * 0.85;
      const taper = lerp(0.28, 0.15, Math.pow(t, 0.7)) + Math.pow(t, 5) * 0.03;
      // ellipse that slowly rotates so the silhouette is never a tube
      const ell = 1 + Math.cos(a * 2 + t * 3.1) * 0.055 + Math.cos(a * 3 - t * 1.7) * 0.03;
      return taper * flare * ell;
    },
    // uvRepeat 6 over a 7.2 m stem put the bark's 22 leaf-scar rings at 5 cm
    // spacing — a moiré band, not bark. 2.2 puts them at ~15 cm, which is
    // what a real palm's scar pitch looks like, and kills the stretch.
    2.2,
    false,
    false
  );
  // loft() drives both UV axes off one repeat; a 7.2 m stem with a ~1.2 m
  // girth needs them decoupled or the scar columns are squashed to a smear.
  // 0.5 across puts one texture tile around the whole trunk: eleven scar
  // columns per circumference, which is what a real palm has.
  {
    const tu = trunk.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < tu.count; i++) tu.setX(i, tu.getX(i) * 0.5);
    tu.needsUpdate = true;
  }
  acc.add(trunk, trs(0, 0, 0, 0), new THREE.Color(1, 1, 1));
  // root buttress wedges — the tell that it is planted, not stuck in
  const buttress = bevelBox(0.18, 0.5, 0.34, 0.04, 3);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    acc.add(buttress, trs(Math.cos(a) * 0.3, 0.16, Math.sin(a) * 0.3, -a, 1, 1, 1, 0.22), new THREE.Color(0.86, 0.84, 0.8));
  }
  // frond boots: a rough collar of cut stubs at the crown
  const cx = h * bend;
  const boot = plainBox(0.15, 0.22, 0.24, 4);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const y = h - 0.35 - (i % 3) * 0.22;
    acc.add(boot, trs(cx + Math.cos(a) * 0.2, y, Math.sin(a) * 0.2, -a, 1, 1, 1, -0.5), new THREE.Color(0.72, 0.66, 0.56));
  }
  // coconut cluster
  const nut = loft((t, o) => o.set(0, t * 0.2, 0), 2, 5, (t) => Math.sin((0.15 + t * 0.7) * Math.PI) * 0.115, 1, true, true);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.7;
    acc.add(nut, trs(cx + Math.cos(a) * 0.24, h - 0.05, Math.sin(a) * 0.24, 0), new THREE.Color(0.62, 0.56, 0.42));
  }
  return acc.build()!;
}

/**
 * One frond: a ribbon that arches, droops under its own weight and folds into
 * a shallow V along the rachis so it catches a rim from the low sun rather
 * than reading as a flat card. `L` is the rachis length, `W` the widest span.
 */
export function frondGeo(L: number, W: number): THREE.BufferGeometry {
  const nx = 9,
    nz = 3;
  // The frond starts INSIDE the trunk. The crown attach point sits on the
  // trunk's axis and the stem is ~0.16 m in radius up there, so a rachis
  // beginning at x = 0 emerges exactly on the silhouette edge and every frond
  // showed a visible plane/cylinder intersection with a hard seam — the
  // review note "frond planes visibly interpenetrate the trunk cylinder with
  // no blend". Backing the root out by 0.18 m buries the first span in solid
  // geometry, so what you see leaving the trunk is the second span, already
  // clear of the surface.
  const ROOT = -0.18;
  const pos: number[] = [],
    uv: number[] = [],
    col: number[] = [],
    idx: number[] = [];
  for (let j = 0; j <= nz; j++) {
    const vz = j / nz;
    const zn = (vz - 0.5) * 2;
    for (let i = 0; i <= nx; i++) {
      const t = i / nx;
      const x = ROOT + t * (L - ROOT);
      const arch = Math.sin(Math.min(t * 1.35, 1) * Math.PI * 0.62) * 0.52;
      const droop = Math.pow(t, 2.5) * 1.55;
      const fold = -Math.pow(Math.abs(zn), 1.6) * 0.16 * (0.35 + t * 0.9);
      const narrow = 0.42 + Math.sin(Math.pow(t, 0.6) * Math.PI) * 0.72;
      pos.push(x, arch - droop + fold, zn * W * 0.5 * narrow);
      uv.push(t, vz);
      // Junction AO. The inside of a palm crown is the densest shade in the
      // whole tree — a dozen frond bases packed round a stem — and without it
      // the fronds read as separate cards stuck onto a pole. A vertex-colour
      // ramp over the first 22% of the rachis costs nothing and is what makes
      // the crown look like it grew out of the trunk.
      const ao = lerp(0.4, 1.0, clamp01(t / 0.22));
      col.push(ao, ao, ao);
    }
  }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Volumetric canopy shading. A frond's true normal is the ribbon's, which
  // means every frond in a crown shades almost identically and the whole
  // canopy resolves to one flat plate — a "solid silhouette blob". Bend
  // each frond's normal outward and upward from the crown centre (the frond
  // runs along +X from the attach point) and the crown shades like a sphere
  // instead: lit on the sun side, transmitting on the far side, with real
  // internal value structure between the two.
  {
    const nAttr = g.getAttribute('normal') as THREE.BufferAttribute;
    const pAttr = g.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const out = new THREE.Vector3();
    for (let i = 0; i < nAttr.count; i++) {
      v.set(pAttr.getX(i), pAttr.getY(i), pAttr.getZ(i));
      // outward along the rachis, lifted: the crown's own surface normal
      out.set(v.x / L, 0.55 + v.y * 0.12, v.z * 1.4).normalize();
      v.set(nAttr.getX(i), nAttr.getY(i), nAttr.getZ(i));
      // 45% toward the crown normal keeps the frond's own form readable
      v.lerp(out, 0.45).normalize();
      nAttr.setXYZ(i, v.x, v.y, v.z);
    }
    nAttr.needsUpdate = true;
  }
  return g;
}

/**
 * The lightest useful frond: two tapered edges joined into a segmented ribbon.
 * Unlike {@link frondGeo}, this does not prescribe a palm crown, a transverse
 * fold, vertex AO or generated normals. It is the small silhouette-first blade
 * used by a ground plant whose material is double-sided.
 *
 * Every number that determines the profile is required. In particular there
 * is no default fern hidden here: the game owns how long, broad and bent its
 * plant is; this package owns emitting the vertices and triangles.
 */
export interface ArchedFrondSpec {
  segments: number;
  length: number;
  halfWidth: number;
  tipHalfWidth: number;
  bendAngle: number;
  bendReach: number;
  normal: readonly [x: number, y: number, z: number];
}

export function archedFrondGeo(spec: ArchedFrondSpec): THREE.BufferGeometry {
  const { segments, length, halfWidth, tipHalfWidth, bendAngle, bendReach, normal } = spec;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const w = halfWidth * (1 - t * t) + tipHalfWidth;
    const y = t * length;
    const z = (1 - Math.cos(t * bendAngle)) * bendReach;
    pos.push(-w, y, z, w, y, z);
    nrm.push(normal[0], normal[1], normal[2], normal[0], normal[1], normal[2]);
    uv.push(0, t, 1, t);
    if (i < segments) {
      const b = i * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * A close-view fern surface: a subdivided ribbon with a V-fold, droop,
 * scalloped pinnate edges, base AO and a hemispherical normal blend. `length`
 * and `width` are species/shot decisions supplied by the caller. This remains
 * separate from the palm crown and the two-edge arched frond because neither
 * has its transverse topology or shading contract.
 */
export function pinnateFrondGeo(length: number, width: number): THREE.BufferGeometry {
  const nx = 12, nz = 5;
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  for (let j = 0; j <= nz; j++) {
    const vz = j / nz;
    const zn = (vz - 0.5) * 2;
    for (let i = 0; i <= nx; i++) {
      const t = i / nx;
      const x = t * length;
      const arch = Math.sin(Math.min(t * 1.4, 1) * Math.PI * 0.62) * 0.42;
      const droop = Math.pow(t, 2.4) * 1.2;
      const fold = -Math.pow(Math.abs(zn), 1.4) * 0.11 * (0.35 + t * 0.9);
      const scallop = 1 + Math.cos(t * 30) * 0.08 * Math.abs(zn);
      const narrow = 0.4 + Math.sin(Math.pow(t, 0.6) * Math.PI) * 0.75;
      pos.push(x, arch - droop + fold, zn * width * 0.5 * narrow * scallop);
      uv.push(t, vz);
      const ao = lerp(0.5, 1.0, clamp01(t / 0.3));
      col.push(ao, ao, ao);
    }
  }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  {
    const nAttr = g.getAttribute('normal') as THREE.BufferAttribute;
    const pAttr = g.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const out = new THREE.Vector3();
    for (let i = 0; i < nAttr.count; i++) {
      v.set(pAttr.getX(i), pAttr.getY(i), pAttr.getZ(i));
      out.set(v.x / length, 0.6 + v.y * 0.1, v.z * 1.5).normalize();
      v.set(nAttr.getX(i), nAttr.getY(i), nAttr.getZ(i));
      v.lerp(out, 0.5).normalize();
      nAttr.setXYZ(i, v.x, v.y, v.z);
    }
    nAttr.needsUpdate = true;
  }
  return g;
}

/**
 * One broad heliconia leaf: a longitudinal arch, shallow midrib fold, rounded
 * two-point profile and a vertex-colour vein ramp. The stalk, leaf fan,
 * palette and hero placement remain composition owned by the caller.
 */
export function heliconiaLeafGeo(length: number, width: number): THREE.BufferGeometry {
  const nx = 14, nz = 3;
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  for (let j = 0; j <= nz; j++) {
    const vz = j / nz;
    const zn = (vz - 0.5) * 2;
    for (let i = 0; i <= nx; i++) {
      const t = i / nx;
      const x = t * length;
      const arch = Math.sin(t * Math.PI) * 0.14;
      const fold = -Math.pow(Math.abs(zn), 1.7) * 0.05;
      const wprof = Math.sin(Math.pow(t, 0.65) * Math.PI);
      pos.push(x, arch + fold, zn * width * 0.5 * wprof);
      uv.push(t, vz);
      const rib = 1 - Math.exp(-Math.abs(zn) * 4);
      col.push(0.65 + rib * 0.35, 0.85 + rib * 0.15, 0.55 + rib * 0.35);
    }
  }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export type VegetationRGB = readonly [r: number, g: number, b: number];

export interface ButtressedTrunkStyle {
  boleTint: VegetationRGB;
  buttressTint: VegetationRGB;
  branchTint: VegetationRGB;
}

/**
 * A straight emergent bole with six root buttresses and three high limbs.
 * Height, diameter, lean and all vertex tint are caller-owned; this function
 * owns the lofts, fin transforms and the twelve-draw morphology stream.
 */
export function buttressedTrunkGeo(
  height: number, diameter: number, lean: number,
  style: ButtressedTrunkStyle, rng: RNG,
): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const bole = loft(
    (t, o) => o.set(Math.pow(t, 1.6) * lean, t * height, 0),
    18,
    12,
    (t, a) => {
      const groove = 1 + Math.cos(a * 5 + t * 3.4) * 0.045 + Math.cos(a * 3 - t * 2.1) * 0.03;
      return lerp(diameter, diameter * 0.55, Math.pow(t, 0.8)) * groove;
    },
    3.0,
    false,
    false,
  );
  acc.add(bole, trs(0, 0, 0, 0), new THREE.Color(...style.boleTint));

  const finGeo = bevelBox(0.14, 3.0, 1.4, 0.05, 3);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng() * 0.2;
    const r = diameter * 1.05;
    acc.add(
      finGeo,
      trs(Math.cos(a) * r, 1.5, Math.sin(a) * r, -a, 1, 1, 1, 0, 0.42),
      new THREE.Color(...style.buttressTint),
    );
  }

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rng() * 0.5;
    const y0 = height * 0.78;
    const length = 8 + rng() * 3;
    const dropX = Math.cos(a) * length;
    const dropZ = Math.sin(a) * length;
    const limb = loft(
      (t, o) => o.set(
        dropX * t + Math.pow(t, 1.6) * lean * 0.5,
        y0 + t * 3.5 - t * t * 4.5,
        dropZ * t,
      ),
      12,
      8,
      (t) => lerp(diameter * 0.35, diameter * 0.06, Math.pow(t, 0.6)),
      1.5,
      false,
      true,
    );
    acc.add(limb, trs(0, 0, 0, 0), new THREE.Color(...style.branchTint));
  }

  return acc.build()!;
}

export interface BowedLeafCardStyle {
  centreTint: VegetationRGB;
  edgeLoss: VegetationRGB;
}

/** A subdivided leaf-cluster card with a bowed surface and caller-owned tint ramp. */
export function bowedLeafCardGeo(
  width: number, height: number, bow: number, style: BowedLeafCardStyle,
): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height, 6, 4);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const cols: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const u = x / (width * 0.5);
    const v = y / (height * 0.5);
    const dome = -Math.cos(u * Math.PI * 0.5) * bow * (1 - Math.abs(v) * 0.35);
    p.setZ(i, dome);
    const edge = Math.max(Math.abs(u), Math.abs(v));
    cols.push(
      style.centreTint[0] - edge * style.edgeLoss[0],
      style.centreTint[1] - edge * style.edgeLoss[1],
      style.centreTint[2] - edge * style.edgeLoss[2],
    );
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

export interface SaplingStyle {
  trunkTint: VegetationRGB;
  leafSize: readonly [width: number, height: number];
  leafCount: number;
  leafTint: VegetationRGB;
}

/** A bowed young trunk with a card crown. Height and every palette value are caller-owned. */
export function saplingGeo(height: number, style: SaplingStyle, rng: RNG): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const trunk = loft(
    (t, o) => o.set(Math.sin(t * 2) * 0.08 * t, t * height, Math.cos(t * 1.6) * 0.06 * t),
    10, 6,
    (t) => 0.06 * (1 - t * 0.7),
    2, false, false,
  );
  acc.add(trunk, trs(0, 0, 0, 0), new THREE.Color(...style.trunkTint));
  const leaf = card(style.leafSize[0], style.leafSize[1]);
  for (let i = 0; i < style.leafCount; i++) {
    const a = (i / style.leafCount) * Math.PI * 2;
    const s = 0.7 + rng() * 0.4;
    acc.add(
      leaf,
      trs(Math.cos(a) * 0.1, height * 0.85, Math.sin(a) * 0.1, a, s, s, s, 0.2, 0),
      new THREE.Color(...style.leafTint),
    );
  }
  return acc.build()!;
}

export interface FallenLogStyle {
  barkBase: VegetationRGB;
  barkVariation: readonly [r: number, g: number];
  mossBase: VegetationRGB;
  mossGreenVariation: number;
  mossNormalBias: number;
  mossNormalGain: number;
}

/** A tapered, knotted fallen trunk with caller-owned bark/moss vertex colour. */
export function fallenLogGeo(length: number, radius: number, style: FallenLogStyle): THREE.BufferGeometry {
  const g = loft(
    (t, o) => o.set((t - 0.5) * length + Math.sin(t * 5) * 0.05, 0, Math.cos(t * 3) * 0.04),
    18, 10,
    (t, a) => radius * (0.9 + 0.1 * Math.sin(a * 4)) * (1 - Math.abs(t - 0.5) * 0.3),
    length * 0.7, true, true,
  );
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const moss = clamp01((nrm.getY(i) + style.mossNormalBias) * style.mossNormalGain);
    const barkR = style.barkBase[0] + hash2(i, 3, 0) * style.barkVariation[0];
    const barkG = style.barkBase[1] + hash2(i, 5, 0) * style.barkVariation[1];
    const barkB = style.barkBase[2];
    const mossR = style.mossBase[0];
    const mossG = style.mossBase[1] + hash2(i, 7, 0) * style.mossGreenVariation;
    const mossB = style.mossBase[2];
    colors[i * 3] = lerp(barkR, mossR, moss);
    colors[i * 3 + 1] = lerp(barkG, mossG, moss);
    colors[i * 3 + 2] = lerp(barkB, mossB, moss);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/**
 * A clump of grass: crossed alpha cards, each leaning a different way, with
 * the fan splayed so the clump has a silhouette from every azimuth rather
 * than reading as a card edge-on. `n` cards per clump; 3 is the honest
 * minimum for a clump that never disappears as you drive past it.
 *
 * See the header on why this is not `tuftGeo` with different constants.
 */
export function clumpGeo(w: number, h: number, n: number, rng: RNG): THREE.BufferGeometry {
  const acc = new GeoAccum();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI + rng() * 0.5;
    const s = 0.72 + rng() * 0.6;
    // a slight outward lean per card turns a flat cross into a fountain
    const lean = (rng() - 0.5) * 0.34;
    acc.add(
      card(w * s, h * s),
      trs((rng() - 0.5) * w * 0.45, 0, (rng() - 0.5) * w * 0.45, a, 1, 1, 1, lean * Math.cos(a), lean * Math.sin(a)),
      new THREE.Color(1, 1, 1)
    );
  }
  return acc.build()!;
}

/**
 * A tuft of blades: the same crossed-card idea with the tilt rolled AFTER the
 * offsets rather than before, which is why it is its own function. Used for
 * marram and verge grass, where the blades lean along one axis rather than
 * fountaining outward.
 */
export function tuftGeo(w: number, h: number, blades: number, rng: RNG): THREE.BufferGeometry {
  const acc = new GeoAccum();
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI + rng() * 0.4;
    const s = 0.75 + rng() * 0.5;
    acc.add(card(w * s, h * s), trs((rng() - 0.5) * w * 0.3, 0, (rng() - 0.5) * w * 0.3, a, 1, 1, 1, 0, (rng() - 0.5) * 0.22), new THREE.Color(1, 1, 1));
  }
  return acc.build()!;
}

/**
 * Umbrella-pine trunk: a leaning stem, three main limbs branching into the
 * canopy, and root wedges. `h` is the local trunk height.
 */
export function pineTrunkGeo(h: number): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const trunk = loft(
    (t, o) => o.set(Math.sin(t * 2.1) * 0.42 * t, t * h, Math.cos(t * 1.4) * 0.2 * t),
    14,
    8,
    (t) => lerp(0.4, 0.17, Math.pow(t, 0.8)) * (1 + Math.pow(1 - Math.min(t * 6, 1), 2.2) * 0.7),
    5,
    false,
    false
  );
  acc.add(trunk, trs(0, 0, 0, 0), new THREE.Color(1, 1, 1));
  // three main limbs branching into the umbrella
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.9;
    const limb = loft(
      (t, o) => o.set(Math.sin(2.1) * 0.42 + Math.cos(a) * t * 1.5, h - 0.4 + t * 1.25 - t * t * 0.35, Math.cos(1.4) * 0.2 + Math.sin(a) * t * 1.5),
      6,
      6,
      (t) => 0.13 * (1 - t * 0.6),
      3
    );
    acc.add(limb, trs(0, 0, 0, 0), new THREE.Color(0.94, 0.92, 0.9));
  }
  const root = bevelBox(0.2, 0.55, 0.34, 0.045, 3);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    acc.add(root, trs(Math.cos(a) * 0.35, 0.18, Math.sin(a) * 0.35, -a, 1, 1, 1, 0.24), new THREE.Color(0.9, 0.88, 0.84));
  }
  return acc.build()!;
}

/** Slightly domed card for a pine umbrella or a shrub mass. */
export function canopyCard(w: number, h: number, bow: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 3, 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / w;
    p.setZ(i, -Math.cos(u * Math.PI) * bow + bow);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A cypress spindle: tall, with a bumpy irregular profile, because for this
 * tree the silhouette IS the tree. `h` is the full height.
 */
export function cypressGeo(h: number): THREE.BufferGeometry {
  return loft(
    (t, o) => o.set(Math.sin(t * 3.0) * 0.14, t * h, Math.cos(t * 2.2) * 0.1),
    20,
    10,
    (t, a) => {
      const prof = Math.pow(Math.sin(Math.pow(t, 0.62) * Math.PI * 0.96), 0.72);
      const bump = 1 + Math.sin(a * 5 + t * 19) * 0.09 + Math.sin(a * 3 - t * 31) * 0.06;
      return Math.max(0.02, prof * 0.72 * bump * (t > 0.97 ? 0.3 : 1));
    },
    6,
    true,
    true
  );
}
