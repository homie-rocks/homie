/**
 * ============================================================================
 *  Pressure — a habitable cylinder, and the wreck of one.
 * ============================================================================
 *  `pressureBayGeo` is the largest single generator in this package: an 88 m
 *  cylinder with end caps, strakes, flange rings and stand-offs, which can be
 *  SWEPT onto a curved path instead of built straight. `derelictRibGeo` is the
 *  same idea with the skin gone — the frames of a hull you can see through.
 *  `bayInnerR` / `bayOuterR` are how a caller finds out where the thing
 *  actually ends, flange stand-off included, without re-deriving it.
 *
 *  THE BEND IS THE POINT AND IT IS THE PART THAT HAS ALREADY GONE WRONG ONCE.
 *  A shell authored straight and placed from a single sampled frame stands ON
 *  the running surface rather than around it — `@homie-rocks/geom`'s tests
 *  carry that as a named fault (`flat-sweep`) because a player with a
 *  controller drove into the result. `bend` here is optional and, when passed,
 *  is a `SweepFrame` sampled along the real path.
 *
 *  `BaySweep` is an alias for `@homie-rocks/geom`'s `SweepFrame`, declared here
 *  because this file reads better with it. The game this came from declared
 *  its own alias with a docblock explaining that `@homie-rocks/geom` may not
 *  know what a building is — which is still true, and is precisely why the
 *  alias has a home in THIS package instead: a prop package IS allowed to know
 *  what a pressure bay is. The two aliases are the same type structurally, so
 *  a caller can pass either.
 *
 *  PUBLISHED, NOT DE-DUPLICATED. See `Village.ts`'s header.
 */
import * as THREE from 'three';
import { bevelBox, plainBox } from '@homie-rocks/geom/prim.js';
import { GeoAccum } from '@homie-rocks/geom/accum.js';
import { tubeInto, boltRingInto } from '@homie-rocks/geom/tube.js';
import { sweepAlongZ } from '@homie-rocks/geom/sweep.js';
import type { SweepFrame } from '@homie-rocks/geom/sweep.js';
import { mulberry32 } from '@homie-rocks/noise/Noise.js';
import { hash2 } from '@homie-rocks/render/canvastex.js';
import { smoothstep } from './Kit.ts';
import { BAY, RAIL_POST, handrailGeo, ladderGeo } from './Truss.ts';
import { _ta, _tb, _tq } from './Scratch.ts';

/** `@homie-rocks/geom`'s `SweepFrame`, under the name a pressure bay reads with. */
export type BaySweep = SweepFrame;

/** Pressure bay dimensions, metres. */
export const BAY_DIA = 88;
export const BAY_LEN = 210;
/**
 * Depth of the strake step in the bay shell, as a fraction of the radius.
 *
 * The barrel is not a circle: every second strake steps INWARD by up to this
 * much so the key finds a different value on each band (see the note inside
 * `pressureBayGeo`). Anything bolted to the inside of the bay therefore has to
 * be placed against `bayInnerR`, not against `dia / 2`, or it hangs off the
 * deepest strake by the better part of a metre.
 */
const STRAKE_STEP = 0.016;
/** Every second pair of rings steps in by this much again. */
const RING_STEP = 0.004;
/** Radial stand-off of the primary frame flange where it is at full height. */
const FLANGE_STAND = 0.85;

/**
 * The band the barrel of a `pressureBayGeo` shell actually occupies: the
 * deepest strake on the deepest ring, and the shallowest strake carrying a
 * full-height frame flange. **The wall is anywhere in here**, and it is 1.6 m
 * wide on a 76 m bay.
 *
 * Exported because a caller that hangs radiators or brackets off that wall has
 * to know where it actually is. Deriving it here means a retune of the strake
 * depth or the flange moves the fin brackets with it instead of silently
 * detaching them — floating attachments are a failure that has already been
 * "fixed" on this object once, and was still broken after.
 *
 * Anything mounted on the inside has to be sized to SPAN the band, not placed
 * at one edge of it: at `bayInnerR` a bracket floats up to 1.6 m off the plate
 * wherever a strake is shallow, and at `bayOuterR` it is buried and invisible.
 */
export function bayInnerR(dia = BAY_DIA): number {
  return (dia / 2) * (1 - STRAKE_STEP) * (1 - RING_STEP);
}
export function bayOuterR(dia = BAY_DIA): number { return dia / 2 + FLANGE_STAND; }

/**
 * PRESSURE BAY — 88 m diameter, 210 m long. The completed sections of a ring
 * structure that a deck climbs over.
 *
 * A cylinder that big with a texture on it has no readable scale, so it
 * carries four scales of relief in geometry: 12 m ring frames with bolted
 * splice bands, a 2.4 m plate break in the profile, port bays, and a railed
 * catwalk at the equator with a ladder up to it.
 *
 * `caps` = 0 open both ends (an unfinished bay, ribs to vacuum), 1 = one
 * domed cap, 2 = both. An unfinished ring is 40 % clad; most of these are 0.
 *
 * `bend` sweeps the whole assembly through a path instead of leaving it a
 * straight tube at the origin — see `sweepAlongZ`, and use it for any bay a
 * deck runs THROUGH. Without it the geometry comes back in local space along
 * +Z exactly as before, for the bays that are only ever looked at.
 */
export function pressureBayGeo(dia = BAY_DIA, len = BAY_LEN, caps = 1, seed = 1, bend?: BaySweep):
{ shell: THREE.BufferGeometry; frames: THREE.BufferGeometry; catwalk: THREE.BufferGeometry } {
  const rng = mulberry32(seed);
  const R = dia / 2;
  const SEG = 40;

  // --- shell: a faceted cylinder whose radius steps 1.5 % on a 2.4 m plate
  //     break, so the silhouette is not a perfect circle and the key finds a
  //     different value on every strake ---
  const P: number[] = [], N: number[] = [], UV: number[] = [], I: number[] = [], C: number[] = [];
  // ==========================================================================
  //  THE RING PITCH IS 3 m, AND THE REASON IS THE "SMOOTH GREY BALLOON".
  // ==========================================================================
  //  A review named this object twice — as "a sphere tank" and as "a pressure
  //  dome" — and both times as one of "the least finished surfaces in the
  //  frame". It is neither of those things; it is this 76 m bay seen from
  //  300–600 m away. All four of its detail scales are correct and ALL FOUR ARE
  //  SUB-PIXEL AT THAT RANGE: the 0.32 m ring tubes, the 0.13 m stringers, the
  //  0.16–0.38 m conduit and the 1.2 m catwalk are between a third of a pixel
  //  and one pixel wide, so what actually reaches the frame is a bare 40-sided
  //  cylinder with a texture on it. That is not a material problem and no map
  //  fixes it: the object has no relief AT THE SCALE IT IS BEING VIEWED FROM.
  //
  //  So the primary frames now live in the SHELL, as a metre of radius rather
  //  than as a tube on top of it — `flangeAt` below. A 0.85 m step at 400 m is
  //  a couple of pixels of silhouette wobble and, far more importantly, a hard
  //  value break many pixels wide down every 18 m of a 44 m radius, because the
  //  ramp faces the key at a completely different angle from the barrel. The
  //  ring pitch drops 12 m → 3 m purely so the 18 m frame stations land
  //  exactly on ring boundaries and the ramp either side of one has stations to
  //  be built out of; the tube frames stay where they are, as the doubler on
  //  top of the flange, and are what the object reads as from the deck.
  const RING_PITCH = 3;
  const rings = Math.max(2, Math.round(len / RING_PITCH));
  /**
   * Radial stand-off of the primary frame flange at axial station `z`.
   *
   * A tapered doubler over ±6 m of a bulkhead frame, which is what a ring this
   * size is actually built with — the plate steps out to the frame, runs across
   * it and steps back. Derived from `BAY` so it cannot drift away from the 18 m
   * module every other object on the circuit is built on.
   */
  const flangeAt = (z: number): number => {
    const f = Math.abs(z / BAY - Math.round(z / BAY)) * BAY;   // metres to nearest frame
    return FLANGE_STAND * Math.max(0, 1 - (f / 6) * (f / 6));
  };
  // ==========================================================================
  //  THE UV IS NON-UNIFORM ON BOTH AXES, AND THAT IS THE WHOLE FIX FOR THE
  //  "BRICK WALL" LOOK.
  // ==========================================================================
  //  This shell used to carry uv = (arc/4, z/4): a perfectly regular 4 m grid
  //  over an 88 m × 240 m volume. A visible UV tiling repeat is a classic tell,
  //  and so is "a perfectly regular panel grid, identical everywhere, with the
  //  same seam width and the same fastener spacing across the whole frame —
  //  wallpaper". The reviewed frame was both at once: an unbroken brick grid of
  //  identical cells running to the vanishing point. Because EVERY CELL IS THE
  //  SAME SIZE the bay also had no readable dimension — it could be 20 m
  //  across or 200.
  //
  //  So the plate size varies per strake and per ring: `su`/`sv` scale each
  //  band's UV by 0.72–1.42, ACCUMULATED rather than indexed, so the pattern
  //  never re-phases with itself and there is no cell size the eye can lock
  //  onto. It is a scale variation and not a phase jump on purpose — a phase
  //  jump needs the vertex column duplicated or the texture shears across one
  //  quad, and a plate that is 6.1 m wide beside one that is 3.4 m wide is
  //  what a real strake run looks like anyway.
  const uAt: number[] = [], rAt: number[] = [], aAt: number[] = [];
  {
    let u = 0, a = 0;
    for (let s = 0; s <= SEG; s++) {
      const su = 0.72 + hash2(s, 0, 71) * 0.70;
      // strake radius step: 2.4 m plate breaks, deeper than the old 1.5 % so
      // the key finds a different value on every band of a 44 m radius
      rAt.push(R * (1 - hash2(s >> 1, 3, 23) * STRAKE_STEP));
      aAt.push(a);
      uAt.push(u);
      const da = (Math.PI * 2) / SEG;
      u += (da * R) / (4 * su);
      a += da;
    }
  }
  const vAt: number[] = [], zAt: number[] = [];
  {
    let v = 0, z = 0;
    for (let j = 0; j <= rings; j++) {
      const sv = 0.72 + hash2(0, j, 131) * 0.70;
      vAt.push(v); zAt.push(z);
      const dz = len / rings;
      v += dz / (4 * sv);
      z += dz;
    }
  }
  for (let j = 0; j <= rings; j++) {
    const z = zAt[j];
    // VALUE FALLOFF ALONG THE BAY. In the scene this was built for, the main
    // light source sits near the entry end, and things far from every
    // practical light are genuinely unlit — that is the first honest depth
    // cue. Baking it into the vertex colour costs nothing and is what gives a
    // 240 m bay a foreground, a midground and a background instead of one hue
    // at one value.
    // 0.62 → 0.78. A review still read the bay as "a single hue at a single
    // value — everything from the near deck to the far bay end is the same
    // orange, so there is no foreground/midground/background read whatsoever
    // and the ships thrown into hot backlit silhouette are instead white blobs
    // on orange". The mechanism here was right and the amount was not: at 0.62
    // the far end sits at 0.38 of the near end, which ACES then compresses back
    // toward it. 0.22 is a factor of 4.5 in albedo before the light, which is
    // what a backlit silhouette needs to have something to be a silhouette
    // AGAINST. It is a multiply toward darker and never a mix toward grey:
    // this is a pressurised volume and its haze is real, but the haze belongs
    // to the atmosphere pass and it is not this.
    const depthV = 1.0 - 0.78 * smoothstep(0.10, 0.96, z / Math.max(1, len));
    // The flange's own slope, from its neighbours rather than from calculus:
    // the outward normal of a surface of revolution r(z) is (cos a, sin a,
    // -dr/dz), and leaving it radial across a 0.85 m step over 3 m would light
    // a 16° ramp as if it were parallel to the axis. That error is exactly the
    // value break this change exists to create, so getting it wrong would
    // cancel the fix.
    const zPrev = zAt[Math.max(0, j - 1)], zNext = zAt[Math.min(rings, j + 1)];
    const slope = zNext > zPrev ? -(flangeAt(zNext) - flangeAt(zPrev)) / (zNext - zPrev) : 0;
    const inv = 1 / Math.sqrt(1 + slope * slope);
    const fl = flangeAt(z);
    for (let s = 0; s <= SEG; s++) {
      const a = aAt[s];
      const r = rAt[s] * (1 - (Math.floor(j / 2) % 2) * RING_STEP) + fl;
      P.push(Math.cos(a) * r, Math.sin(a) * r, z);
      N.push(Math.cos(a) * inv, Math.sin(a) * inv, slope * inv);
      UV.push(uAt[s], vAt[j]);
      // Per-strake albedo jitter, ±6 %, so no two adjacent plates match — and
      // the flange band carries its own step on top of that, because a doubler
      // is a different plate from the strake under it and shows it.
      const t = (0.94 + hash2(s >> 1, j >> 1, 17) * 0.12 + fl * 0.10) * depthV;
      C.push(t, t, t);
    }
  }
  const w = SEG + 1;
  // ==========================================================================
  //  THE WINDING FACES OUTWARD, AND IT USED TO FACE INWARD. THAT IS THE WHOLE
  //  OF THE "ORANGE LATTICE" FINDING.
  // ==========================================================================
  //  A review: "a large pressure conduit at frame left glows as an orange
  //  lattice grid across the whole sequence — in one shot it fills a quarter
  //  of the frame ... it is structure, so it is a reserved colour used
  //  decoratively", with the alternative hypothesis offered in the same note:
  //  "If the orange is the interior seen through the shell, the shell is not
  //  occluding."
  //
  //  It is the second one, and it is a two-character bug. `I.push(a, c, b, ...)`
  //  winds each quad so its face normal is the NEGATIVE of the outward vertex
  //  normal beside it: take the ring at (r, 0, z0) and the quad's cross product
  //  comes out along −x while the vertex there points along +x. Under the
  //  default `FrontSide` that culls the entire near half of the cylinder when
  //  the camera is OUTSIDE it, so from outside you look straight through the
  //  76 m hull at the interior light and at 240 m of ring frames lit by it.
  //  The reserved amber was never used decoratively; there was simply no hull
  //  in front of it.
  //
  //  Flipping to `(a, b, c)` puts the face normal where the vertex normal
  //  already is. The interior — which is the surface this bay was authored for,
  //  because the deck runs THROUGH it — is recovered by drawing the mesh
  //  `DoubleSide`, and that is strictly better than the old state: three flips
  //  the shading normal on a back face, so from inside the wall is now lit by a
  //  normal pointing AT the viewer instead of away from them. The bay's
  //  interior walls had been shaded inside-out for as long as this geometry
  //  had existed.
  for (let j = 0; j < rings; j++) {
    for (let s = 0; s < SEG; s++) {
      const a = j * w + s, b = a + 1, c = a + w, d = c + 1;
      I.push(a, b, c, b, d, c);
    }
  }
  if (caps > 0) {
    // domed cap at z = len: a real dome, not a disc — a flat end cap on an
    // 88 m cylinder reads as a cardboard tube
    const base = P.length / 3;
    const capRings = 5;
    for (let j = 1; j <= capRings; j++) {
      const f = j / capRings;
      // starts at the barrel's radius INCLUDING any flange standing at z = len,
      // or the dome springs from a smaller circle than the shell it caps and
      // leaves a hairline the key finds instantly
      const rr = (R + flangeAt(len)) * Math.cos(f * Math.PI / 2);
      const zz = len + R * 0.42 * Math.sin(f * Math.PI / 2);
      for (let s = 0; s <= SEG; s++) {
        const a = (s / SEG) * Math.PI * 2;
        P.push(Math.cos(a) * rr, Math.sin(a) * rr, zz);
        N.push(Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0.7);
        UV.push((a * R) / 4, (len + f * R * 0.42) / 4);
        C.push(0.97, 0.97, 0.97);
      }
    }
    for (let j = 0; j < capRings; j++) {
      const r0 = j === 0 ? rings * w : base + (j - 1) * w;
      const r1 = base + j * w;
      // Same flip as the barrel above, for the same reason — a dome wound the
      // other way is invisible from outside and shaded inside-out from within.
      for (let s = 0; s < SEG; s++) {
        I.push(r0 + s, r0 + s + 1, r1 + s, r0 + s + 1, r1 + s + 1, r1 + s);
      }
    }
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  shell.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  shell.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  shell.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  shell.setIndex(I);
  shell.computeBoundingSphere();

  // ==========================================================================
  //  RING FRAMES AT THE 18 m TRUSS BAY PITCH, AND THEY ARE THE FIRST OF THREE
  //  SCALES — NOT THE ONLY ONE.
  // ==========================================================================
  //  18.0 m is the truss bay module of the structure this was built for, and
  //  every dimension in it is a contract: "if you build a truss bay at 30 m
  //  instead of 18 m the megastructure shrinks". A 12 m frame pitch here
  //  disagrees with the 18 m pitch everything else on the circuit is built on,
  //  so the eye gets two incompatible rulers and integrates against neither.
  //
  //  Three scales on this shell now, which is what a structure this size needs
  //  to read at its size:
  //   · 18 m PRIMARY RING FRAMES, 0.62 m section, with an intermediate at 9 m
  //     on a lighter 0.30 m section so the rhythm is strong-weak-strong;
  //   · 4–6 m PLATE STRAKES from the seeded UV split above;
  //   · 0.5–2 m of catwalk, ladder and conduit crossing the wall (below).
  const fAcc = new GeoAccum();
  const m = new THREE.Matrix4();
  for (let z = 0; z <= len + 1e-6; z += 9) {
    const primary = Math.abs(z / BAY - Math.round(z / BAY)) < 0.01;
    // Stand off the SHELL, not off R. The primary stations now carry an 0.85 m
    // flange in the shell itself (see `flangeAt`), so a tube at R + 0.32 would
    // be buried inside the plate it is supposed to be the doubler on.
    const rr = primary ? 0.32 : 0.17;
    const rBase = R + flangeAt(z);
    for (let s = 0; s < SEG; s++) {
      const a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2;
      tubeInto(fAcc, m,
        Math.cos(a0) * (rBase + rr), Math.sin(a0) * (rBase + rr), z,
        Math.cos(a1) * (rBase + rr), Math.sin(a1) * (rBase + rr), z, rr * 0.86, 5);
    }
    if (!primary) continue;
    // four splice plates round the frame, each bolted — the joints in a ring
    // this size are visible from 400 m and their absence is what makes a big
    // cylinder look small
    for (let k = 0; k < 4; k++) {
      const a = (k / 4 + 0.125) * Math.PI * 2;
      const px = Math.cos(a) * (R + 0.42), py = Math.sin(a) * (R + 0.42);
      const sp = bevelBox(0.10, 1.5, 1.5, 0.03);
      sp.translate(px, py, z);
      fAcc.add(sp, m);
      sp.dispose();
      boltRingInto(fAcc, m, px, py, z, Math.cos(a), Math.sin(a), 0, 0.5, 8, 0.05);
    }
  }
  // longitudinal stringers every 30° — the second scale.
  //
  // SPLICED AT EVERY FRAME STATION, and that is a sweep requirement before it
  // is a detail: one tube from 0 to `len` has vertices only at its two ends,
  // so `sweepAlongZ` would leave it a straight chord across the arc. It stands
  // 0.16 m off the barrel and a 288 m chord's sagitta is 24 m, so it would
  // spend the middle of the bay strung across the interior. At the 9 m frame
  // pitch the sagitta is 0.04 m — a quarter of the stand-off, so the stringer
  // stays proud of the plate the whole way — and a 288 m stringer is spliced
  // at its bulkheads in real steel anyway.
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const sx = Math.cos(a) * (R + 0.16), sy = Math.sin(a) * (R + 0.16);
    for (let z = 0; z < len - 1e-6; z += 9) {
      tubeInto(fAcc, m, sx, sy, z, sx, sy, Math.min(len, z + 9), 0.13, 4);
    }
  }
  // --- 0.5–2 m: conduit and cable-tray runs crossing the wall --------------
  // The third scale, and the one the reviewed bay had nothing in. Four
  // runs at irregular angles, each stepping round the shell as it goes so it
  // crosses the strake pattern instead of lying along it, with a saddle every
  // 6 m. A bay whose walls carry nothing is a shape; a bay with services on it
  // is a place, and services are also what the 88 m diameter is legible
  // against.
  for (let k = 0; k < 4; k++) {
    const a0 = (0.13 + k * 0.24) * Math.PI * 2;
    const dia = 0.16 + hash2(k, 5, 311) * 0.22;
    let a = a0;
    for (let z = 0; z < len - 6; z += 6) {
      const a1 = a + (hash2(k, (z / 6) | 0, 97) - 0.5) * 0.10;
      const rr = R - 0.55 - dia;
      tubeInto(fAcc, m, Math.cos(a) * rr, Math.sin(a) * rr, z,
        Math.cos(a1) * rr, Math.sin(a1) * rr, z + 6, dia, 5);
      // the saddle that holds it off the plate — no floating attachments, at 0.4 m
      const sd = bevelBox(0.12, 0.62, 0.16, 0.02);
      sd.translate(Math.cos(a) * (R - 0.28), Math.sin(a) * (R - 0.28), z);
      fAcc.add(sd, m);
      sd.dispose();
      a = a1;
    }
  }
  const frames = fAcc.build()!;
  frames.computeBoundingSphere();

  // --- equator catwalk + its access ladder: the human-scale layer ---------
  const cAcc = new GeoAccum();
  const deckW = 1.2;
  // 1.35 m off the barrel rather than 0.9: the primary flange now stands 0.85 m
  // proud of the shell, and a catwalk laid at 0.9 would pass through every
  // frame it crosses.
  const CW = 1.35;
  for (let z = 0; z < len; z += 4) {
    const pl = bevelBox(deckW, 0.05, 4.0, 0.012);
    pl.translate(R + CW, 0, z + 2);
    cAcc.add(pl, m);
    pl.dispose();
    // outrigger bracket back to the shell, every 4 m
    tubeInto(cAcc, m, R + 0.05, -0.5, z + 2, R + CW + 0.55, -0.02, z + 2, 0.05, 4);
  }
  // The rail is spliced for the same reason the stringers are: its top rail,
  // mid rail and toe board are single runs the full length of the bay, and a
  // chord across a swept bay is a rail hanging in the middle of the room. The
  // splice is four stanchion bays, so every joint lands ON a post and the
  // 1.80 m pitch never breaks; `endPost = false` keeps the piece that follows
  // from stacking a second post on top of it.
  const RAIL_SEG = RAIL_POST * 4;
  for (let z = 0; z < len - 1e-6; z += RAIL_SEG) {
    const segLen = Math.min(RAIL_SEG, len - z);
    const hr = handrailGeo(segLen, 0, z + RAIL_SEG >= len - 1e-6);
    cAcc.add(hr, new THREE.Matrix4().makeTranslation(R + CW + 0.6, 0.03, z));
    hr.dispose();
  }
  const lad = ladderGeo(R * 0.9);
  cAcc.add(lad, new THREE.Matrix4().compose(
    _ta.set(R + 0.35, -R * 0.9, len * (0.2 + rng() * 0.5)),
    _tq.identity(), _tb.set(1, 1, 1)));
  lad.dispose();
  const catwalk = cAcc.build()!;
  catwalk.computeBoundingSphere();

  // Bend the three finished pieces onto the path, if there is one. One total
  // pass per geometry, after everything is emitted — see `sweepAlongZ` for why
  // it is done here rather than at each of the forty emit sites above.
  if (bend) { sweepAlongZ(shell, bend); sweepAlongZ(frames, bend); sweepAlongZ(catwalk, bend); }

  return { shell, frames, catwalk };
}

/**
 * DERELICT RIB — one structural frame of a wrecked colony ship.
 *
 * Designed for a 906 m hull of 62 frames open to vacuum, with a 6.5° key
 * light raking through them and throwing a picket fence of hard-edged shadow
 * bars across the deck that strobes at 11 Hz. THE SHADOW IS THE POINT. So the
 * rib is authored as a solid-enough shape to cast a clean bar — an open
 * lattice would throw a mush — while still being a frame you can see space
 * through.
 *
 * `f` is 0..1 along the hull so the frames can taper toward bow and stern.
 */
export function derelictRibGeo(radius: number, thickness = 1.6, depth = 3.4): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  // 20 segments over 292° is a 15° facet, which on a 26 m frame is a 6.8 m
  // chord — the derelict's closest approach is 46 m, so that is under 9° of
  // arc on screen and the flange still reads as a curve. The flange tubes are
  // the whole triangle cost of this object (91 % of it), so the two numbers
  // here and `sides = 5` below are what keep 62 frames affordable.
  const SEG = 20;
  // a horseshoe, not a ring: the ship is opened along its dorsal line, which
  // is what "open to vacuum" means and what lets the star through
  const span = Math.PI * 1.62;
  const a0 = -span / 2 - Math.PI / 2;
  // =========================================================================
  //  THE FRAME IS AN I-SECTION WITH A WEB, NOT A LOOP OF TUBE.
  // =========================================================================
  //  A 906 m ship built from 62 loops of 1.6 m tube has no mass: it reads as
  //  a paper-thin lattice fence, it does not occlude the starfield, and — the
  //  part that actually matters — a 1.6 m round bar throws a soft-shouldered
  //  smear rather than the HARD-EDGED shadow bar this exists for. Two flanges
  //  `depth` apart with a web plate between them give the frame a 3.4 m
  //  section: a genuine dark volume with square shoulders, which is what the
  //  6.5° key needs to cut a 40:1 picket fence across the deck.
  for (const dz of [-depth / 2, depth / 2]) {
    for (let s = 0; s < SEG; s++) {
      const p0 = a0 + (s / SEG) * span, p1 = a0 + ((s + 1) / SEG) * span;
      tubeInto(acc, m,
        Math.cos(p0) * radius, Math.sin(p0) * radius, dz,
        Math.cos(p1) * radius, Math.sin(p1) * radius, dz, thickness / 2, 5);
    }
  }
  // the web: a continuous plate between the flanges, at 0.72 of the flange
  // thickness so the flanges still read as flanges in silhouette
  {
    const P: number[] = [], N: number[] = [], UV: number[] = [], I: number[] = [];
    for (let s = 0; s <= SEG; s++) {
      const p = a0 + (s / SEG) * span;
      const cx = Math.cos(p), cy = Math.sin(p);
      for (const dz of [-depth / 2, depth / 2]) {
        P.push(cx * (radius - thickness * 0.18), cy * (radius - thickness * 0.18), dz);
        N.push(cx, cy, 0);
        UV.push(p * radius, dz);
      }
    }
    for (let s = 0; s < SEG; s++) {
      const a = s * 2;
      I.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const web = new THREE.BufferGeometry();
    web.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    web.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    web.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    web.setIndex(I);
    acc.add(web, m);
    web.dispose();
  }
  // deck beams inside the frame: three levels, which is what makes the shadow
  // bar a BAR with structure in it rather than a plain stripe. Each one is a
  // box girder rather than a rod, for the same shoulder reason as the frame.
  for (const fy of [-0.55, -0.15, 0.30]) {
    const y = radius * fy;
    const hx = Math.sqrt(Math.max(0, radius * radius - y * y)) * 0.94;
    // A BEVELLED BOX, NOT A PLAIN ONE. These are the derelict's own deck
    // beams and they are what the 6.5° key rakes across to make the picket
    // fence; an unchamfered box presents two flat faces and a value step with
    // nothing catching light on the transition, which is why the derelict reads
    // as a smooth pale wedge from the angles that hit it broadside.
    const beam = bevelBox(hx * 2, thickness * 0.62, depth * 0.72, 0.025);
    beam.translate(0, y, 0);
    acc.add(beam, m);
    beam.dispose();
    // frame flanges at the beam ends — 0.5–2 m detail on the near ribs, which
    // is what makes 906 m integrable rather than asserted
    for (const s of [-1, 1]) {
      const gus = bevelBox(thickness * 0.9, thickness * 1.5, depth * 0.8, 0.025);
      gus.translate(s * (hx - thickness * 0.5), y, 0);
      acc.add(gus, m);
      gus.dispose();
    }
  }
  // torn plating still hanging off one side, seeded by radius so no two ribs
  // are identical — 62 identical frames is wallpaper
  const rip = ((radius * 37) % 1);
  if (rip > 0.45) {
    const pl = plainBox(radius * 0.5 * rip, thickness * 0.2, radius * 0.28);
    pl.translate(-radius * 0.62, -radius * 0.30, radius * 0.1);
    acc.add(pl, m);
    pl.dispose();
    // the cut edge it tore along, with teeth — a straight tear reads as a
    // designed panel line and the whole story here is catastrophic failure
    const teeth = 5;
    for (let t = 0; t < teeth; t++) {
      const bite = thickness * (0.3 + ((radius * (13 + t)) % 1) * 0.9);
      const tt = plainBox(radius * 0.5 * rip / teeth * 0.9, bite, thickness * 0.25);
      tt.translate(-radius * 0.62 + (t - teeth / 2 + 0.5) * (radius * 0.5 * rip / teeth),
        -radius * 0.30 + bite * 0.5, radius * 0.1 + radius * 0.14);
      acc.add(tt, m);
      tt.dispose();
    }
  }
  const g = acc.build()!;
  g.computeBoundingSphere();
  return g;
}
