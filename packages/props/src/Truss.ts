/**
 * ============================================================================
 *  Truss — the structural kit a megastructure is actually made of.
 * ============================================================================
 *  One 18 m Warren truss bay, its cladding, a caged ladder, a handrail run,
 *  a stanchion, a footing, a portal frame, a conduit run, and a gantry crane.
 *
 *  THE ARGUMENT FOR THE WHOLE FILE IS `trussBayGeo`'s: one bay instanced four
 *  thousand eight hundred times IS a megastructure. That is a performance claim
 *  and an art claim at once, and it means this geometry has to be right once
 *  and then costs nothing forever — which is exactly the kind of thing a
 *  library should carry rather than each game re-deriving.
 *
 *  THE SECOND RULE IT INHERITS IS "NOTHING FLOATS". In vacuum there is no
 *  ground contact to sell weight, so every generator here that makes a
 *  free-standing object also makes its fixing — the collar, the skirt, the
 *  gusset, the bolt ring. If you could slide the result 20 cm in any direction
 *  and nothing would look wrong, it is not finished. Keep that when you edit.
 *
 *  ------------------------------------------------------------------------
 *  WHICH CONSTANTS CAME AND WHICH DID NOT, AND HOW THAT WAS DECIDED.
 *  ------------------------------------------------------------------------
 *  The game this came from declared twenty-two named dimensions in one block. Eleven of
 *  them are read by the generators that moved and came with them; eleven are
 *  not, and stayed in the game. That was MEASURED, not judged by eye — every
 *  name was counted across the moved code, the code left behind, and every
 *  other file in the game.
 *
 *  What stayed is that game's own ledger and would be wrong in anybody
 *  else's: `RAKE_LEN` and `RAKE_FRAMES` are the length and frame count of
 *  one named fictional colony ship; `DECK_STANCHION`, `STENCIL_CAP`,
 *  `GATE_W/H/LIFT` and the four `DECK_*` plate dimensions belong to that game's
 *  deck and its ordnance gates. Publishing them would have handed the next game
 *  another game's art bible as if it were a standard.
 *
 *  What came is the parameter set of the shapes below — a handrail's height and
 *  tube, a bay module and its chord and diagonal, a crane's span and height, a
 *  ladder's rung pitch. They are DEFAULTS. Pass your own; that is the point of
 *  a library, and the numbers here are one good answer rather than the answer.
 *
 *  PUBLISHED, NOT DE-DUPLICATED: the other racing game imports none of this
 *  and has no structure to hang it on. See `Village.ts`'s header for the full
 *  argument.
 */
import * as THREE from 'three';
import { bevelBox, plainBox } from '@homie-rocks/geom/prim.js';
import { chamferBox } from '@homie-rocks/geom/chamfer.js';
import { xf } from '@homie-rocks/geom/xform.js';
import { GeoAccum } from '@homie-rocks/geom/accum.js';
import { tubeInto, boltRingInto } from '@homie-rocks/geom/tube.js';
import { mulberry32 } from '@homie-rocks/noise/Noise.js';
import { _ta, _tb, _tq, _tup } from './Scratch.ts';

/** Handrail height and tube diameter, metres. */
export const RAIL_H = 1.10;
export const RAIL_TUBE = 0.042;
/** Handrail stanchion pitch, metres. */
export const RAIL_POST = 1.80;
/** Truss bay module, chord and diagonal diameters, metres. */
export const BAY = 18.0;
export const CHORD_D = 0.90;
export const DIAG_D = 0.34;
/** Gantry crane span and height, metres. */
export const GANTRY_SPAN = 96;
export const GANTRY_H = 41;
/** A ladder rung every 0.30 m: the single cheapest unambiguous scale cue. */
export const RUNG = 0.30;

/**
 * ONE 18 m TRUSS BAY — the module the whole megastructure is made of.
 *
 * One 18 m truss bay instanced 4,800 times IS a megastructure, and that is
 * the entire performance argument for building one this way. So this geometry
 * has to be right once and then costs nothing forever.
 *
 * Warren configuration on all four faces: four 0.90 m chords, 0.34 m diagonals
 * alternating direction, and a transverse frame at each end. The end frames
 * carry bolt rings, because a bay that meets its neighbour with no visible
 * joint is the "a gantry meets the truss with no visible joint" failure at
 * 4,800 instances.
 *
 * `w` and `h` are the cross-section; the spine's is 260 m and is built from a
 * grid of these, while a deck under-truss is 12 m.
 */
export function trussBayGeo(w = 12, h = 12, len = BAY, lod = 0): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  const hx = w / 2, hy = h / 2;
  const cs = lod ? 5 : 8, ds = lod ? 4 : 5;
  const corners: [number, number][] = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];

  // --- four longitudinal chords ---
  for (const [x, y] of corners) tubeInto(acc, m, x, y, 0, x, y, len, CHORD_D / 2, cs);

  // --- transverse frames at both ends, plus one at mid-bay ---
  const frames = lod ? [0, len] : [0, len / 2, len];
  for (const z of frames) {
    for (let k = 0; k < 4; k++) {
      const a = corners[k], b = corners[(k + 1) & 3];
      tubeInto(acc, m, a[0], a[1], z, b[0], b[1], z, DIAG_D / 2, ds);
    }
  }
  if (!lod) {
    // bolted splice flanges at the bay joint — this is the attachment, and it
    // is the reason 4,800 instances read as a built structure rather than as
    // one extruded tube
    for (const [x, y] of corners) {
      boltRingInto(acc, m, x, y, 0.06, 0, 0, 1, CHORD_D * 0.62, 8, 0.05);
    }
  }

  // --- Warren diagonals, alternating sense per face so the bay is braced in
  //     both shear directions and the silhouette is not a repeating chevron ---
  const nDiag = lod ? 2 : 3;
  for (let f = 0; f < 4; f++) {
    const a = corners[f], b = corners[(f + 1) & 3];
    for (let d = 0; d < nDiag; d++) {
      const z0 = (d / nDiag) * len, z1 = ((d + 1) / nDiag) * len;
      const up = (d + f) & 1;
      tubeInto(acc, m,
        up ? a[0] : b[0], up ? a[1] : b[1], z0,
        up ? b[0] : a[0], up ? b[1] : a[1], z1,
        DIAG_D / 2, ds);
    }
  }
  const g = acc.build()!;
  g.computeBoundingSphere();
  return g;
}

/**
 * ===========================================================================
 *  THE SAME BAY AS A CLOSED SHELL — LOD2, AND THE FIX FOR THE WHITE SCRIBBLE.
 * ===========================================================================
 *  "The far tiers must be a handful of low-poly shells carrying SDF and POM
 *  detail rather than geometry. That is the specific trick that lets this hold
 *  60." That rule was being applied to the backdrop and not to the truss, and
 *  a review found what that costs: past ~180 m an 18 m bay is forty tubes of
 *  0.34–0.90 m section, every one of them at or under the rasteriser's
 *  Nyquist limit, so the frame gets a moiré of sub-pixel lines at one value —
 *  "a tangle of white sticks with no mass, no silhouette and no read of where
 *  the deck is".
 *
 *  A closed shell of the SAME OUTER SILHOUETTE fixes all three at once: it has
 *  mass because it is solid, it has a silhouette because it has a continuous
 *  edge, and it has internal value structure because it has four faces at four
 *  orientations to a 6.5° key instead of forty facets at random ones. It is
 *  also about a fortieth of the triangles, which is the budget half of the
 *  same argument.
 *
 *  IT IS NOT A BOX. Three things carry the 18 m bay pattern as RELIEF rather
 *  than as a texture, because a grazing camera would lose a texture:
 *
 *   · a proud SPLICE COLLAR at each end, which is the bay pitch made visible
 *     and is the same joint `trussBayGeo`'s bolt rings draw close up;
 *   · a shallow V of two DIAGONAL RIBS on each long face, at the Warren sense
 *     and pitch of the bay it replaces, so a run of shells reads as braced
 *     structure rather than as a pipe;
 *   · the shell is INSET from the chord envelope by one chord radius, so the
 *     silhouette is the line the chords' outer faces actually draw and a shell
 *     never looks fatter than the lattice it took over from.
 *
 *  `seed` breaks the run: a uniform grid is a known failure, and a shell tier
 *  is the easiest place in a scene to accidentally build one.
 */
export function trussShellGeo(w = 11, h = 7.5, len = BAY, seed = 0): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  const rng = mulberry32(0x51e1 + seed * 977);
  // inset by a chord radius: the lattice's silhouette is its chords' OUTER
  // faces, and those sit at ±(w/2 + CHORD_D/2) minus the tube's own curvature.
  const sw = w - CHORD_D * 0.35, sh = h - CHORD_D * 0.35;
  const body = bevelBox(sw, sh, len, 0.10);
  body.translate(0, 0, len / 2);
  acc.add(body, m);
  body.dispose();
  // splice collars: 0.34 m proud, 0.5 m long, at both ends of the bay
  for (const z of [0.25, len - 0.25]) {
    const col = bevelBox(sw + 0.68, sh + 0.68, 0.5, 0.06);
    col.translate(0, 0, z);
    acc.add(col, m);
    col.dispose();
  }
  // Warren relief on the two long faces. 0.26 m proud is under a pixel past
  // 400 m and reads as a value break at 200 — which is the whole band this
  // tier is drawn in, so it is doing work over the whole of its range.
  const rib = (sx: number) => {
    const x = sx * (sw / 2 + 0.10);
    const y = sh * 0.40;
    for (let d = 0; d < 2; d++) {
      const z0 = (d / 2) * len, z1 = ((d + 1) / 2) * len;
      const up = (d & 1) ? 1 : -1;
      tubeInto(acc, m, x, -up * y, z0, x, up * y, z1, 0.26, 4);
    }
  };
  rib(-1); rib(1);
  // one panel of the shell is a different age than its neighbours, as
  // a proud patch on a face chosen by the seed
  if (rng() > 0.45) {
    const patchG = bevelBox(sw * 0.34, 0.18, len * (0.22 + rng() * 0.2), 0.05);
    patchG.translate((rng() - 0.5) * sw * 0.4, sh / 2, len * (0.25 + rng() * 0.45));
    acc.add(patchG, m);
    patchG.dispose();
  }
  const g = acc.build()!;
  g.computeBoundingSphere();
  return g;
}

/**
 * A LADDER — the single most valuable object in this file per triangle spent.
 *
 * The scale test is "a gantry whose 41 m height is unambiguous BECAUSE THERE
 * IS A LADDER ON IT". A ladder is the one object whose size everybody already
 * knows: 0.42 m between stiles, a rung every 0.30 m, and a hooped safety cage
 * from 2.2 m up. Put one on a structure and its height stops being a guess.
 */
export function ladderGeo(height: number, caged = true): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  const W = 0.42;
  tubeInto(acc, m, -W / 2, 0, 0, -W / 2, height, 0, 0.026, 5);
  tubeInto(acc, m, W / 2, 0, 0, W / 2, height, 0, 0.026, 5);
  for (let y = RUNG; y < height; y += RUNG) {
    tubeInto(acc, m, -W / 2, y, 0, W / 2, y, 0, 0.017, 4);
  }
  if (caged) {
    // hoops every 0.9 m from 2.2 m, with three longitudinal straps. The cage
    // is what says "a person climbs this", which is the whole point.
    for (let y = 2.2; y < height - 0.6; y += 0.9) {
      const R = 0.38;
      const seg = 9;
      for (let s = 0; s < seg; s++) {
        const a0 = Math.PI * (0.12 + (s / seg) * 0.76);
        const a1 = Math.PI * (0.12 + ((s + 1) / seg) * 0.76);
        tubeInto(acc, m,
          Math.cos(a0) * R, y, -Math.sin(a0) * R,
          Math.cos(a1) * R, y, -Math.sin(a1) * R, 0.016, 4);
      }
    }
    for (const a of [0.20, 0.5, 0.80]) {
      const th = Math.PI * (0.12 + a * 0.76);
      tubeInto(acc, m, Math.cos(th) * 0.38, 2.2, -Math.sin(th) * 0.38,
        Math.cos(th) * 0.38, height - 0.6, -Math.sin(th) * 0.38, 0.014, 4);
    }
  }
  // wall brackets every 1.8 m: the ladder is BOLTED to whatever it climbs
  for (let y = 0.6; y < height; y += 1.8) {
    tubeInto(acc, m, -W / 2, y, 0, -W / 2 - 0.02, y, 0.22, 0.022, 4);
    tubeInto(acc, m, W / 2, y, 0, W / 2 + 0.02, y, 0.22, 0.022, 4);
  }
  const g = acc.build()!;
  g.computeBoundingSphere();
  return g;
}

/**
 * HANDRAIL — 1.10 m top rail in 42 mm tube, mid rail at 0.55 m, toe board,
 * stanchion every 1.80 m with a bolted baseplate.
 *
 * In the scene this was built for, handrail is present on 100 % of deck edges
 * except two deliberate gaps, and "absence must read as a decision, which it
 * only does if presence is universal". So this runs everywhere, which is a lot
 * of thin geometry — hence `sides = 4` on the tube and hence the whole run for
 * one section being merged into one mesh by the caller.
 *
 * Returns a run of `len` metres along +Z with the deck at y = 0.
 *
 * ===========================================================================
 *  THE LOD LADDER SHEDS THE MID-RAIL AND THE TOE BOARD, NEVER THE BASEPLATE.
 * ===========================================================================
 *  LOD1 used to drop the baseplate and take the post from 5 sides to 3, and
 *  both were wrong for the same reason. The baseplate is the ONLY thing on the
 *  run that says the rail is bolted to the deck rather than resting on it,
 *  it is twelve triangles, and LOD1 begins at 45 m — which is
 *  exactly the band where the rail is still the eye's main scale reference. A
 *  3-sided 28 mm tube is worse than cheap: it has one flat facet, so a full
 *  specular switches on and off as the camera passes it, and 3,600 posts doing
 *  that at once is most of the bead flicker in a truss-heavy frame.
 *
 *  So the ladder is: mid-rail and toe board go first (they are interior detail
 *  and invisible past ~30 m anyway), the post holds 5 sides and keeps its
 *  plate to LOD1, and only LOD2 — a gantry walkway 41 m over your head, or a
 *  catwalk on the far side of a pressure bay — drops to a bare rail on posts
 *  at double pitch.
 */
/*
 * `endPost = false` omits the stanchion at z = len, for a run that is built in
 * spliced pieces (a swept pressure bay's equator catwalk): the next piece
 * starts with its own post at that station and two coincident posts is both a
 * wasted draw and a z-fight. Every other caller wants the run capped at both
 * ends, so it defaults on.
 */
export function handrailGeo(len: number, lod = 0, endPost = true): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  const r = RAIL_TUBE / 2;
  // 5 sides at LOD0 and LOD1: see the note above about the 3-sided facet.
  const sides = lod >= 2 ? 4 : 5;
  tubeInto(acc, m, 0, RAIL_H, 0, 0, RAIL_H, len, r, sides);
  if (lod === 0) {
    tubeInto(acc, m, 0, RAIL_H * 0.5, 0, 0, RAIL_H * 0.5, len, r * 0.8, 4);
    // toe board: a 0.10 m upstand at deck level. It is what stops a dropped
    // tool leaving the deck, and it is the detail that makes a handrail read
    // as industrial rather than as a fence.
    const tb = plainBox(0.012, 0.10, len);
    tb.translate(0, 0.05, len / 2);
    acc.add(tb, m);
    tb.dispose();
  }
  const pitch = lod >= 2 ? RAIL_POST * 2 : RAIL_POST;
  const zLast = endPost ? len + 1e-6 : len - 1e-6;
  for (let z = 0; z <= zLast; z += pitch) {
    tubeInto(acc, m, 0, 0.02, z, 0, RAIL_H, z, r * 1.35, sides);
    if (lod < 2) {
      // 0.16 m bolted baseplate — the attachment, one per 1.8 m, everywhere
      const bp = plainBox(0.16, 0.018, 0.16);
      bp.translate(0, 0.009, z);
      acc.add(bp, m);
      bp.dispose();
    }
  }
  const g = acc.build()!;
  g.computeBoundingSphere();
  return g;
}

/**
 * DECK STANCHION — every 24 m where the deck is free-standing.
 *
 * Drilled collar + grout skirt.
 * The collar is the ring of bolts that holds the column to the deck's
 * underside; the skirt is the flared cast fillet where the column meets the
 * truss below. Together they are the reason a 9 m column does not look like a
 * cylinder someone left in the air.
 */
export function stanchionGeo(drop: number): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  const R = 0.34;
  // column, hanging DOWN from y = 0 (the deck underside)
  tubeInto(acc, m, 0, 0, 0, 0, -drop, 0, R, 8);
  // drilled collar at the deck: a proud flange with 10 bolts through it
  tubeInto(acc, m, 0, -0.02, 0, 0, -0.14, 0, R * 1.9, 10);
  boltRingInto(acc, m, 0, -0.145, 0, 0, -1, 0, R * 1.5, 10, 0.055);
  // grout skirt at the foot — a flared fillet, not a flat cap
  tubeInto(acc, m, 0, -drop + 0.55, 0, 0, -drop + 0.16, 0, R * 1.35, 8);
  tubeInto(acc, m, 0, -drop + 0.18, 0, 0, -drop, 0, R * 2.3, 8);
  // two knee braces back up to the deck: a column in pure compression is a
  // pencil, and a pencil at 9 m long reads as a prop rather than as structure
  for (const s of [-1, 1]) {
    tubeInto(acc, m, s * R * 0.7, -drop * 0.42, 0, s * 2.6, -0.10, 0, DIAG_D / 2 * 0.7, 5);
  }
  const g = acc.build()!;
  g.computeBoundingSphere();
  return g;
}

/**
 * ===========================================================================
 *  A FOOTING. UNTIL IT EXISTED, THE ONLY THING THAT HAD ONE WAS THE DECK
 *  STANCHION.
 * ===========================================================================
 *  The scale table says "deck stanchion, every 24 m, DRILLED COLLAR + GROUT
 *  SKIRT". The reviewed set had a 41 m gantry A-frame landing on the plate as
 *  a bare white pad: no bolt circle, no skirt, no weld fillet, in 43 frames. A
 *  search for `grout`, `collar` or `bolt` across the game's prop and scenery
 *  code found the words only inside `stanchionGeo`, which was the truth — the
 *  geometry did not exist.
 *
 *  Four parts, and each one answers a different question the eye asks:
 *   · a 1.2 m OCTAGONAL BASE PLATE — octagonal, not round, because a raking
 *     0.18° key finds eight different values round an octagon and exactly one
 *     round a cylinder;
 *   · an 8-BOLT CIRCLE at 90 mm — the universal "this is bolted" mark and the
 *     cheapest 0.08 m detail available (the third panelisation scale);
 *   · a 0.12 m GROUT SKIRT, flared, and deliberately on a DIFFERENT and dirtier
 *     value than the plate: poured grout is not steel and if it renders as
 *     steel the skirt reads as a chamfer rather than as a separate material
 *     (a scene wants several distinct surface responses and this is a free
 *     one);
 *   · a WELD FILLET where the leg meets the plate, as a short flared tube, so
 *     the junction is a joint rather than an intersection.
 *
 *  `legR` is the radius of the member landing on it. Instanced under every
 *  gantry leg, every free-standing deck stanchion at the 24 m pitch, and every
 *  light-tower base.
 */
export function footingGeo(legR = 0.45): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  const R = 0.60;                       // 1.2 m across the flats
  // grout skirt first, so the plate sits ON it and the silhouette steps twice
  tubeInto(acc, m, 0, 0, 0, 0, 0.12, 0, R * 1.18, 8, new THREE.Color(0.74, 0.73, 0.70));
  // the base plate: an octagonal slab, 60 mm thick, chamfered at both edges by
  // `tubeInto`'s own end taper
  tubeInto(acc, m, 0, 0.11, 0, 0, 0.17, 0, R, 8);
  // 8 bolts at 90 mm dia on a circle inside the plate edge
  boltRingInto(acc, m, 0, 0.172, 0, 0, 1, 0, R * 0.68, 8, 0.045);
  // weld fillet: a flare from the plate up onto the leg
  tubeInto(acc, m, 0, 0.17, 0, 0, 0.17 + legR * 0.9, 0, legR * 1.55, 8);
  const g = acc.build()!;
  g.computeBoundingSphere();
  return g;
}

/**
 * ===========================================================================
 *  A SERVICE PORTAL — THE OBJECT THAT MAKES THE FRAME LOOK FAST, AND THE ONE
 *  THING AN ENTIRE REVIEWED SET DID NOT HAVE.
 * ===========================================================================
 *  Near-field geometry passing INSIDE 6 m is what carries speed, and the
 *  scene this was built for gives its crane section the explicit job of
 *  "cranes pass 6 m off the canopy". Across all 44 reviewed frames nothing
 *  passed within 6 m of the camera at all: the 96 m gantries stand 40–80 m
 *  out on the far side of the barrier and never cross the near field, and the
 *  only world geometry close to the camera was the deck underfoot and a
 *  barrier line running PARALLEL to travel — which is static in screen space
 *  by construction. The consequence is measurable rather than aesthetic: a
 *  perfect velocity buffer has nothing in frame to streak, so removing the
 *  whole post chain would leave those frames looking stationary.
 *
 *  The answer is not more scenery. It is ONE HARD EDGE CROSSING THE FRAME IN
 *  UNDER 0.2 s, which at 130–165 m/s means an object with vertical members
 *  inside the barrier line and a horizontal member over the canopy. That is a
 *  service portal: the thing a working shipyard actually puts across a haul
 *  route to carry power, coolant and a monorail hoist over it.
 *
 *  Composition, and every part earns its place:
 *   · TWO LADDER-FRAME LEGS, chords at the 0.90 m bay section, standing at
 *     lat ±(halfWidth − 1.5) so they are INSIDE the barrier — 4.1 m off the
 *     canopy in the narrowest section, 9 m on the widest straight;
 *   · A BOX GIRDER across the corridor at 8.6 m, high enough to clear a 5.0 m
 *     ordnance gate on its 1.4 m lift and low enough that its soffit sweeps
 *     the top of the frame as you pass under it;
 *   · A CABLE TRAY AND THREE CONDUITS on the soffit, because the portal has to
 *     be carrying something or it is a decorative arch;
 *   · A CAGED LADDER up the left leg — the one object whose size everybody
 *     already knows, which is what makes the 8.6 m unambiguous;
 *   · A FOOTING under each leg (see `footingGeo`).
 *
 *  `half` is the leg's lateral stand-off; `h` the soffit height. Built in the
 *  local deck frame (X lateral, Y deck normal, Z travel) so it rides the roll
 *  through an inverted section without any special case.
 */
export function portalGeo(half: number, h = 8.6, cantilever = 0, seed = 5): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  const rng = mulberry32(seed);
  const legZ = 0.62;                     // chord pair spacing along travel
  const legR = CHORD_D / 2;
  const gH = 1.7;                        // girder depth
  // `cantilever` = 1 builds only the +X leg and lets the girder overhang, so a
  // run of portals is not a comb of identical gates.
  const sides: number[] = cantilever ? [1] : [-1, 1];

  for (const s of sides) {
    const x = s * half;
    for (const dz of [-legZ, legZ]) {
      tubeInto(acc, m, x - s * 0.28, 0, dz, x, h, dz, legR, 7);
    }
    // lacing every 2.1 m, alternating sense — the leg is a frame, not a post
    for (let y = 0.7; y < h - 0.6; y += 2.1) {
      const f0 = y / h, f1 = Math.min(1, (y + 2.1) / h);
      const x0 = x - s * 0.28 * (1 - f0), x1 = x - s * 0.28 * (1 - f1);
      const up = ((y / 2.1) | 0) & 1;
      tubeInto(acc, m, x0, y, up ? -legZ : legZ, x1, y + 2.1, up ? legZ : -legZ, DIAG_D / 2, 5);
      tubeInto(acc, m, x0, y, -legZ, x0, y, legZ, DIAG_D / 2 * 0.8, 4);
    }
    // footing + knee brace back to the deck
    const ft = footingGeo(legR);
    for (const dz of [-legZ, legZ]) {
      ft.translate(x - s * 0.28, 0, dz);
      acc.add(ft, m);
      ft.translate(-(x - s * 0.28), 0, -dz);
    }
    ft.dispose();
    tubeInto(acc, m, x - s * 0.28, 0.1, 0, x - s * 1.55, h * 0.36, 0, DIAG_D / 2, 5);
  }

  // --- the girder across the corridor -------------------------------------
  const xa = cantilever ? -half * 0.15 : -half;
  const xb = half;
  for (const dz of [-legZ, legZ]) for (const dy of [0, gH]) {
    tubeInto(acc, m, xa, h + dy, dz, xb, h + dy, dz, legR * 0.86, 6);
  }
  const panels = Math.max(3, Math.round((xb - xa) / 2.4));
  for (let k = 0; k < panels; k++) {
    const px0 = xa + (k / panels) * (xb - xa), px1 = xa + ((k + 1) / panels) * (xb - xa);
    const up = k & 1;
    for (const dz of [-legZ, legZ]) {
      tubeInto(acc, m, px0, h + (up ? 0 : gH), dz, px1, h + (up ? gH : 0), dz, DIAG_D / 2, 4);
    }
    // transverse frame on the soffit, which is the face the driver sees
    tubeInto(acc, m, px0, h, -legZ, px0, h, legZ, DIAG_D / 2 * 0.85, 4);
  }

  // --- what the portal is carrying: a cable tray and three conduits --------
  const tray = bevelBox(xb - xa, 0.14, 0.72, 0.03);
  tray.translate((xa + xb) / 2, h - 0.34, 0);
  acc.add(tray, m, new THREE.Color(0.86, 0.86, 0.86));
  tray.dispose();
  for (let k = 0; k < 3; k++) {
    tubeInto(acc, m, xa, h - 0.52 - k * 0.02, -0.28 + k * 0.28, xb, h - 0.52 - k * 0.02, -0.28 + k * 0.28,
      0.10 + k * 0.03, 5);
  }
  // hanger straps from the girder down to the tray, every 2.4 m
  for (let x = xa + 1.2; x < xb; x += 2.4) {
    tubeInto(acc, m, x, h, 0, x, h - 0.34, 0, 0.045, 4);
  }

  // --- the ladder that makes 8.6 m a number and not a guess ----------------
  // On roughly half of them, and that is truthful as well as cheap: a yard
  // puts an access ladder at intervals along a service run, not on every
  // frame. A caged ladder is ~2.5 k triangles and this object is instanced ~52
  // times round the lap, so halving it is 65 k triangles back against the budget.
  if (rng() < 0.55) {
    const lad = ladderGeo(h - 0.4);
    lad.translate((cantilever ? half : -half) + (cantilever ? -0.9 : 0.9), 0.2, legZ + 0.24);
    acc.add(lad, m);
    lad.dispose();
  }

  // one stencilled bay number's backing plate, and a junction box: 0.5–2 m
  // detail on the member the camera passes closest to
  const jb = bevelBox(0.62, 0.9, 0.34, 0.03);
  jb.translate((cantilever ? half : -half) - 0.55, 2.3 + rng() * 0.6, 0);
  acc.add(jb, m, new THREE.Color(0.92, 0.92, 0.92));
  jb.dispose();

  const g = acc.build()!;
  g.computeBoundingSphere();
  return g;
}

/**
 * CONDUIT RUN — three parallel pressure conduits with their saddle clamps.
 *
 * In the scene this was built for, three of these run down the length of a
 * 260 m spine, budgeted at 3,400 instances. They are the mid-scale detail
 * between the 18 m bay and the 42 mm handrail, which is the band structures
 * usually have nothing in.
 *
 * The saddle clamp every 3 m is the attachment. A pipe with no clamps is a
 * cylinder floating alongside a truss.
 */
export function conduitRunGeo(len = BAY, lod = 0): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  const dias = [0.62, 0.44, 0.28];
  const ys = [0, 0.60, 1.06];
  const sides = lod ? 4 : 7;
  for (let k = 0; k < 3; k++) {
    tubeInto(acc, m, 0, ys[k], 0, 0, ys[k], len, dias[k] / 2, sides);
    if (lod) continue;
    // flanged joint every 6 m, offset per pipe so the three do not line up —
    // three coincident flanges read as one moulding, which is wallpaper
    for (let z = 1.5 + k * 1.9; z < len; z += 6) {
      tubeInto(acc, m, 0, ys[k], z - 0.05, 0, ys[k], z + 0.05, dias[k] * 0.72, sides);
      boltRingInto(acc, m, 0, ys[k], z + 0.055, 0, 0, 1, dias[k] * 0.56, 6, 0.030);
    }
  }
  if (!lod) {
  // ========================================================================
  //  A HEAVY BOLTED FLANGE AT THE BAY JOINT, SO THE TWO SCALES CROSS-REFERENCE.
  // ========================================================================
  //  A review: "every conduit run needs flanges at the 18 m truss bay pitch
  //  so the two scales cross-reference". The per-pipe flanges above are at 6 m
  //  and deliberately offset from each other so the three pipes never line up
  //  — which is right, and is also why the run carries no readable 18 m
  //  rhythm of its own. One instance of this geometry IS one bay (`len` is
  //  `BAY`), so a heavier flange on all three pipes at z = 0 lands on the
  //  truss bay joint by construction, and the eye gets to count 18 m twice
  //  from two different objects. That agreement is the whole point — a
  //  megastructure is legible because its scales confirm each other.
    for (let k = 0; k < 3; k++) {
      tubeInto(acc, m, 0, ys[k], 0.04, 0, ys[k], 0.26, dias[k] * 0.95, sides);
      boltRingInto(acc, m, 0, ys[k], 0.27, 0, 0, 1, dias[k] * 0.74, 8, 0.038);
      // the gasket land, a fraction proud of the pipe and a different value —
      // a flange with no visible joint line is a lump on a cylinder
      tubeInto(acc, m, 0, ys[k], 0.14, 0, ys[k], 0.16, dias[k] * 1.02, sides);
    }
    for (let z = 0.9; z < len; z += 3) {
      // one saddle bracket carrying all three, bolted to the structure at y<0
      const web = plainBox(0.05, 1.32, 0.16);
      web.translate(0, 0.53, z);
      acc.add(web, m);
      web.dispose();
      for (let k = 0; k < 3; k++) {
        tubeInto(acc, m, -0.09, ys[k], z, 0.09, ys[k], z, dias[k] * 0.62, 6);
      }
      const foot = plainBox(0.24, 0.03, 0.22);
      foot.translate(0, -0.10, z);
      acc.add(foot, m);
      foot.dispose();
    }
  }
  const g = acc.build()!;
  g.computeBoundingSphere();
  return g;
}

/**
 * GANTRY CRANE — 96 m span, 41 m tall, one every 240–400 m.
 *
 * In the scene this was built for these pass 6 m off the canopy, which makes
 * them the primary speed cue on the whole circuit: near-field geometry going
 * past at 165 m/s is what reads as speed, not the post chain.
 *
 * The height is made unambiguous by a ladder up the left leg and a railed
 * walkway across the whole box girder. `parts.rail` and `parts.ladder` come
 * back separately so the caller can give them their own material and their own
 * LOD distance — the ladder is invisible past 160 m and there is no reason to
 * pay for it out there.
 */
export function gantryCraneGeo(span = GANTRY_SPAN, height = GANTRY_H):
{ struct: THREE.BufferGeometry; rail: THREE.BufferGeometry; ladder: THREE.BufferGeometry; trolley: THREE.BufferGeometry } {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  const hs = span / 2;
  const legW = 3.4;

  // --- two A-frame legs, each a four-chord tower with its own bracing ------
  for (const s of [-1, 1]) {
    const x0 = s * hs, x1 = s * (hs - 2.2);   // legs rake inward toward the top
    for (const dz of [-legW / 2, legW / 2]) {
      for (const dxs of [-1, 1]) {
        const bx = x0 + dxs * legW / 2 * 0.5;
        const tx = x1 + dxs * legW / 2 * 0.5;
        tubeInto(acc, m, bx, 0, dz, tx, height, dz, CHORD_D / 2 * 0.8, 7);
      }
    }
    // lacing every 3.2 m, alternating sense
    for (let y = 0; y < height - 1; y += 3.2) {
      const f = y / height, f2 = Math.min(1, (y + 3.2) / height);
      const xa = x0 + (x1 - x0) * f, xb = x0 + (x1 - x0) * f2;
      const up = ((y / 3.2) | 0) & 1;
      for (const dz of [-legW / 2, legW / 2]) {
        tubeInto(acc, m, xa - legW * 0.25, y, dz, xb + legW * 0.25, y + 3.2, dz, DIAG_D / 2, 4);
        if (up) tubeInto(acc, m, xa + legW * 0.25, y, dz, xb - legW * 0.25, y + 3.2, dz, DIAG_D / 2, 4);
      }
      tubeInto(acc, m, xa - legW * 0.25, y, -legW / 2, xa + legW * 0.25, y, legW / 2, DIAG_D / 2 * 0.8, 4);
    }
    // FOOT: a 5.0 m grouted base plate with sixteen holding-down bolts, a
    // DRILLED COLLAR round each chord and a flared GROUT SKIRT under the
    // plate, plus a pair of shear keys. This is a 41 m tower in zero gravity —
    // if its attachment is not obvious the whole frame fails, and the collar
    // and the skirt are what make it obvious.
    const base = bevelBox(5.0, 0.42, 5.0, 0.08);
    base.translate(s * hs, 0.21, 0);
    acc.add(base, m);
    base.dispose();
    boltRingInto(acc, m, s * hs, 0.45, 0, 0, 1, 0, 2.0, 16, 0.09);
    // grout skirt: a flared fillet where the plate meets the deck, NOT a flat
    // cap. The flare is what stops a 5 m plate reading as a sticker.
    tubeInto(acc, m, s * hs, 0.06, 0, s * hs, 0.001, 0, 3.4, 10);
    // drilled collar round each chord where it lands on the plate
    for (const dz of [-legW / 2, legW / 2]) {
      for (const dxs of [-1, 1]) {
        const bx = s * hs + dxs * legW / 2 * 0.5;
        tubeInto(acc, m, bx, 0.42, dz, bx, 0.98, dz, CHORD_D * 0.78, 9);
        boltRingInto(acc, m, bx, 1.00, dz, 0, 1, 0, CHORD_D * 0.62, 8, 0.055);
      }
    }
    // CHAMFERED. A hard 90° edge is an amateur tell, and the shear
    // key sits on a lit plate under a 0.18° key at 40–80 m, which is exactly the
    // distance band where an unchamfered box has no edge highlight at all and
    // reads as a flat white card.
    const key = bevelBox(0.5, 0.9, 4.0, 0.03);
    key.translate(s * (hs - 1.0), -0.35, 0);
    acc.add(key, m);
    key.dispose();
  }

  // --- power + control conduit up the port leg and along the girder -------
  // A 96 m crane with no services on it is a model of a crane. The run also
  // gives the leg a second scale between the 0.9 m chord and the 42 mm rail.
  {
    const lx = -hs + legW * 0.35;
    tubeInto(acc, m, lx, 0.30, -legW / 2 - 0.30, lx, height + 1.2, -legW / 2 - 0.30, 0.09, 6);
    for (let y = 1.4; y < height; y += 3.2) {
      tubeInto(acc, m, lx, y, -legW / 2 - 0.16, lx, y, -legW / 2 - 0.42, 0.055, 4);
    }
    tubeInto(acc, m, lx, height + 1.2, -legW / 2 - 0.30, hs * 0.55, height + 1.2, -1.9, 0.075, 6);
  }

  // --- the box girder: two chords a side plus a Warren web ----------------
  const gy = height;
  for (const dz of [-1.6, 1.6]) {
    for (const dy of [0, 2.8]) {
      tubeInto(acc, m, -hs - 6, gy + dy, dz, hs + 6, gy + dy, dz, CHORD_D / 2 * 0.85, 7);
    }
  }
  for (let x = -hs - 6; x < hs + 6; x += 4.5) {
    const up = (((x + hs) / 4.5) | 0) & 1;
    for (const dz of [-1.6, 1.6]) {
      tubeInto(acc, m, x, gy + (up ? 0 : 2.8), dz, x + 4.5, gy + (up ? 2.8 : 0), dz, DIAG_D / 2, 4);
    }
    tubeInto(acc, m, x, gy, -1.6, x, gy, 1.6, DIAG_D / 2 * 0.8, 4);
  }
  // PANEL POINTS EVERY 18 m — the truss bay module, made visible on
  // the girder as a heavier vertical post and a bolted splice. Without them a
  // 96 m span is one undifferentiated Warren web and there is nothing in it to
  // count, which is exactly how a 96 m object ends up reading as 20 m.
  for (let x = -hs; x <= hs + 1e-6; x += BAY) {
    for (const dz of [-1.6, 1.6]) {
      tubeInto(acc, m, x, gy - 0.2, dz, x, gy + 3.0, dz, DIAG_D / 2 * 1.5, 6);
      boltRingInto(acc, m, x, gy + 3.02, dz, 0, 1, 0, DIAG_D * 0.75, 6, 0.05);
    }
    tubeInto(acc, m, x, gy + 2.8, -1.6, x, gy + 2.8, 1.6, DIAG_D / 2, 4);
  }
  // ==========================================================================
  //  THE OPERATOR CAB, THE REST PLATFORM AND THE SPAN PLATE. THE THREE OBJECTS
  //  THAT MAKE 41 m UNAMBIGUOUS, AND NONE OF THEM COST A DRAW CALL.
  // ==========================================================================
  //  The scale test is "a gantry whose 41 m height is unambiguous BECAUSE
  //  THERE IS A LADDER ON IT", and a review stated the counter-example against
  //  this exact object: "a bare rectangular portal with a plain truss beam
  //  across it — no ladder, no access walkway, no operator cab, no hook block,
  //  no cable drum, no lights, no stencilled span rating. It could be 4 m tall
  //  or 41 m tall and the image cannot tell you."
  //
  //  Half of that is a placement problem rather than a missing-geometry one —
  //  the ladder, the walkway and the hook block are all built below and all
  //  three are on the PORT leg or the girder centre, so a crane framed from the
  //  starboard side shows none of them. The answer is not to move them (a
  //  ladder belongs on one leg, not two); it is to add the marks that read from
  //  ANY azimuth:
  //
  //   · A 2.6 × 2.4 × 2.9 m OPERATOR CAB slung under the girder at quarter
  //     span, with a glazed front and a floor grating. A cab is a
  //     person-shaped box and that is the entire point — nothing else on a
  //     crane says "a human sits here" and therefore says how big the crane is.
  //   · A REST PLATFORM at 22 m on the starboard leg, because the ladder is a
  //     41 m climb and every real one is broken by a landing. It also puts a
  //     horizontal at mid height, which is what stops the leg reading as a
  //     single undifferentiated post.
  //   · A SPAN PLATE — a 2.6 × 1.1 m rating board bolted flat to the girder
  //     web at mid span, where a crane carries its capacity. It is geometry
  //     rather than a stencil quad on purpose: it has to be legible as a
  //     rectangle at 200 m, where a 40 mm cap height is not.
  {
    const cabX = -hs * 0.5;
    const cab = bevelBox(2.6, 2.4, 2.9, 0.06);
    cab.translate(cabX, gy - 1.5, 2.9);
    acc.add(cab, m);
    cab.dispose();
    // the hanger: two rods from the girder chord, so the cab is HUNG and not
    // stuck on (the attachment has to be findable on every prop)
    for (const dz of [1.9, 3.9]) {
      tubeInto(acc, m, cabX, gy, dz, cabX, gy - 0.35, dz, 0.06, 4);
    }
    // brow over the glazing, and the access step under the door
    const brow = bevelBox(2.7, 0.10, 0.30, 0.03);
    brow.translate(cabX, gy - 0.42, 4.3);
    acc.add(brow, m);
    brow.dispose();
    const step = bevelBox(1.0, 0.06, 0.5, 0.02);
    step.translate(cabX - 1.6, gy - 2.75, 2.9);
    acc.add(step, m);
    step.dispose();

    // rest platform at 22 m on the starboard leg
    const py = 22;
    // the leg rakes inward by 2.2 m over its full height, so the platform has
    // to follow it rather than sit at the foot's lateral position
    const px = hs - 2.2 * (py / height);
    const plat = bevelBox(4.4, 0.10, 3.0, 0.03);
    plat.translate(px, py, 0);
    acc.add(plat, m);
    plat.dispose();
    for (const dx of [-2.0, 2.0]) {
      tubeInto(acc, m, px + dx, py, -1.4, px + dx, py + 1.10, -1.4, 0.021, 4);
      tubeInto(acc, m, px + dx, py, 1.4, px + dx, py + 1.10, 1.4, 0.021, 4);
    }
    for (const dz of [-1.4, 1.4]) {
      tubeInto(acc, m, px - 2.0, py + 1.10, dz, px + 2.0, py + 1.10, dz, 0.021, 4);
    }
    // and the knee braces that carry it back into the leg
    for (const dz of [-1.4, 1.4]) {
      tubeInto(acc, m, px + 2.0, py - 0.05, dz, px + 0.2, py - 1.6, dz, 0.05, 4);
    }

    // span plate on the girder web at mid span
    const plate = bevelBox(2.6, 1.1, 0.08, 0.02);
    plate.translate(hs * 0.18, gy + 1.4, -1.68);
    acc.add(plate, m);
    plate.dispose();
    boltRingInto(acc, m, hs * 0.18, gy + 1.4, -1.74, 0, 0, -1, 1.05, 6, 0.04);
  }

  const struct = acc.build()!;
  struct.computeBoundingSphere();

  // ==========================================================================
  //  THE ACCESS WALKWAY. IT WAS A HANDRAIL 108 m OFF THE END OF THE CRANE.
  // ==========================================================================
  //  THE YAW SIGN WAS WRONG, AND IT PUT THE RUN IN VACUUM. `handrailGeo` is
  //  authored along +Z. Rotating it onto the girder's +X axis takes +PI/2:
  //  three's `makeRotationY(θ)` sends +Z to (sin θ, 0, cos θ), so −PI/2 sends
  //  it to −X. The run therefore started at the girder's PORT end (−hs−6) and
  //  travelled 108 m FURTHER PORT, finishing at x = −162 on a crane that ends
  //  at −54. Both sides of every gantry on the circuit — and the echoed far
  //  gantries as well — were trailing a 108 m run of handrail and 60 posts
  //  through empty space with nothing under it, at the rail's 700 m LOD.
  //  That is the floating-object failure in its purest form ("unattached
  //  objects sitting in the void beside the deck ... every one of these passes
  //  the slide-20-cm test"), and it was also a share of the sub-pixel white
  //  confetti in the wide shots, since 120 posts per crane were being drawn
  //  out where nothing explains them. It is the same class of error
  //  `frame()`'s own docblock warns about: a sign that produces geometry
  //  rather than an exception.
  //
  //  THE SECOND HALF IS THAT A HANDRAIL NEEDS A FLOOR. Even placed correctly
  //  the run was a rail at 1.90 m out from the girder axis with nothing to
  //  stand on, which fails the same rule the other way round — the eye can
  //  see what the rail is bolted to only if there is a walkway between them.
  //  So the catwalk is built here, to the same recipe `pressureBayGeo`'s
  //  equator walk already uses and for the same reason: plate, outrigger,
  //  rail.
  //
  //  It also happens to be the cheapest scale cue available on this object. A
  //  review: "no walkway grating on the gantries ... the 41 m gantry legs are
  //  flat featureless slabs". An 0.80 m catwalk with a bracket every 4.5 m is
  //  a known human width repeated 24 times across a 96 m span, which is
  //  exactly the ruler a megastructure needs to carry.
  const railAcc = new GeoAccum();
  /** clear of the lower chord: centre 1.6, radius 0.85·CHORD_D/2 → face 1.98 */
  const WALK_IN = 2.00, WALK_W = 0.80;
  const runLen = span + 12;
  for (const sz of [-1, 1]) {
    const dz = sz * (WALK_IN + WALK_W * 0.5);
    // the deck plate itself, one run per side
    const plate = bevelBox(runLen, 0.05, WALK_W, 0.012);
    plate.translate(0, gy + 0.05, dz);
    railAcc.add(plate, m);
    plate.dispose();
    // outriggers off the lower chord every 4.5 m — the same pitch as the
    // Warren web's panel points above, so the two rhythms agree
    for (let x = -hs - 6; x <= hs + 6 + 1e-6; x += 4.5) {
      // The operator cab is slung under the girder on the +Z side at quarter
      // span and its roof reaches gy − 0.30, which is inside the knee brace's
      // sweep. A bracket passing through the cab is the same failure as
      // a bracket passing through nothing, so the two brackets over the cab
      // are omitted — a real crane frames its walkway round the cab too.
      if (sz > 0 && Math.abs(x + hs * 0.5) < 2.4) continue;
      tubeInto(railAcc, m, x, gy - 0.06, sz * 1.55, x, gy + 0.03, sz * (WALK_IN + WALK_W), 0.045, 4);
      // and a knee back up under the plate, so the bracket is triangulated
      tubeInto(railAcc, m, x, gy - 0.62, sz * 1.50, x, gy + 0.01, sz * (WALK_IN + WALK_W * 0.72), 0.035, 4);
    }
    // LOD2 on the rail: this run is 41 m over the driver's head, so the
    // mid-rail, the toe board and the per-post baseplates are triangles
    // nobody can resolve — and at 1.80 m pitch across 108 m they are also 120
    // sub-pixel bright chips per side, which reads as confetti.
    // Half pitch, bare rail. The plate below it is what carries the read now.
    const run = handrailGeo(runLen, 2);
    // `handrailGeo` runs along +Z; the girder runs along +X, so spin it — and
    // see the note above for which way.
    railAcc.add(run, new THREE.Matrix4().compose(
      _ta.set(-hs - 6, gy + 0.08, sz * (WALK_IN + WALK_W - 0.06)),
      _tq.setFromAxisAngle(_tup, Math.PI / 2),
      _tb.set(1, 1, 1)));
    run.dispose();
  }
  const rail = railAcc.build()!;
  rail.computeBoundingSphere();

  // --- ladder up the port leg, full height, plus a rest platform ----------
  const ladAcc = new GeoAccum();
  const lad = ladderGeo(height + 2.8);
  ladAcc.add(lad, new THREE.Matrix4().makeTranslation(-hs + legW * 0.6, 0, legW / 2 + 0.4));
  lad.dispose();
  const ladder = ladAcc.build()!;
  ladder.computeBoundingSphere();

  // --- trolley + hook block, parked off-centre so no two gantries match ---
  const trAcc = new GeoAccum();
  const body = bevelBox(4.6, 2.2, 3.6, 0.10);
  body.translate(0, gy - 1.6, 0);
  trAcc.add(body, m);
  body.dispose();
  tubeInto(trAcc, m, 0, gy - 2.7, 0, 0, gy - 9.5, 0, 0.05, 4);   // the fall
  const hook = bevelBox(1.5, 1.1, 1.2, 0.08);
  hook.translate(0, gy - 10.1, 0);
  trAcc.add(hook, m);
  hook.dispose();
  const trolley = trAcc.build()!;
  trolley.computeBoundingSphere();

  return { struct, rail, ladder, trolley };
}

/**
 * ===========================================================================
 *  LATTICE MAST SECTIONS — a triangular one and a square one.
 * ===========================================================================
 *  A run of vertical legs on a regular polygon, a bracing pattern repeated per
 *  level, and a horizontal collar every other level. There is nothing in that
 *  sentence about any game: it is the shape a guyed comms mast, a launch
 *  gantry, a floodlight tower, a pylon and a crane leg all are, and the only
 *  things that change between them are the leg count, the bracing pattern and
 *  the member sections.
 *
 *  TWO SHAPES, NOT ONE PARAMETERISED SHAPE, and the reason is the same one
 *  the base-building game wrote down before these moved: the bracing PATTERNS differ. The
 *  triangular section runs a single zigzag per face per level (a real guyed
 *  mast, which carries no side load); the square one runs a true X per face
 *  per level (a tower that carries a service arm's side load). Collapsing them
 *  into `sides: 3 | 4` would compile, and would quietly make one silhouette
 *  the other at the 300 m distance where a triangle reads as a stick and a box
 *  reads as a building. Two functions, side by side, with the difference
 *  written on them.
 *
 *  THEY RETURN PIECES, NOT A MESH AND NOT A GEOMETRY. Each part is one shared
 *  geometry plus the transforms it is stamped at, so a caller can feed them
 *  straight into whatever accumulator or InstancedMesh it already has, and —
 *  the point — decide the MATERIAL and its grime and roughness itself. Nothing
 *  in here knows what a member is made of. A package that picked the roughness
 *  would hand the next game the last game's steel.
 *
 *  ORDER IS LOAD-BEARING, exactly as `faceBrace`'s comment in @homie-rocks/brush
 *  says: an accumulator concatenates in push order, so the sequence the
 *  transform arrays come back in rewrites every float after it in the merged
 *  buffer if it changes. `triLatticeSection` therefore returns collars
 *  INTERLEAVED into `brace.xf` at the level they belong to (which is where its
 *  caller built them), and `boxLatticeSection` returns them in their own array
 *  (which is where its caller built them). That asymmetry is not tidiness lost;
 *  it is the two orders preserved.
 */

/** One shared geometry and the transforms it is stamped at. */
export interface LatticePart {
  geo: THREE.BufferGeometry;
  xf: THREE.Matrix4[];
}

/** Member sections, as multiples of the leg radius. Defaults are one answer. */
export interface LatticeSectionOpts {
  /** Total height of the section, metres. */
  height: number;
  /** Leg half-section, metres. Every other member is a multiple of it. */
  legR: number;
  /** Distance from the axis to a leg centre, metres. */
  side: number;
  /** Bracing levels over `height`. */
  levels: number;
  /** Leg chamfer, x legR. */
  legChamfer?: number;
  /** Brace half-section, x legR. */
  braceSection?: number;
  /** Brace chamfer, x legR. */
  braceChamfer?: number;
  /** Collar half-section, x legR. Square section only. */
  collarSection?: number;
  /** Collar chamfer, x legR. Square section only. */
  collarChamfer?: number;
}

// This block's own scratch, for the reason @homie-rocks/geom/xform.ts states: three
// vectors set-then-consumed inside one synchronous call, never shared across a
// package boundary. `_lup` is only ever read.
const _la = new THREE.Vector3();
const _lb = new THREE.Vector3();
const _lc = new THREE.Vector3();
const _lup = new THREE.Vector3(0, 1, 0);

function _composeBetween(
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, sy: number,
): THREE.Matrix4 {
  const p0 = _la.set(ax, ay, az);
  const p1 = _lb.set(bx, by, bz);
  const mid = _lc.addVectors(p0, p1).multiplyScalar(0.5);
  const dir = new THREE.Vector3().subVectors(p1, p0).normalize();
  return new THREE.Matrix4().compose(
    mid.clone(),
    new THREE.Quaternion().setFromUnitVectors(_lup, dir),
    new THREE.Vector3(1, sy, 1),
  );
}

/**
 * Triangular guyed-mast section: three legs on a 120-degree ring, one zigzag
 * brace per face per level, and a horizontal collar every other level.
 *
 * The ring is rotated 30 degrees (`PI / 6`) so a leg faces the +X quadrant
 * rather than lying on the axis — which is what stops a row of masts all
 * presenting the same flat pair of legs to one camera.
 *
 * Collars ride in `brace.xf`, interleaved after the three braces of each odd
 * level, and carry a 0.999 Y scale so the collar and the brace that shares a
 * transform can never be culled as one duplicate.
 */
export function triLatticeSection(o: LatticeSectionOpts): { leg: LatticePart; brace: LatticePart } {
  const { height: h, legR, side, levels } = o;
  const leg = chamferBox(legR * 2, h, legR * 2, legR * (o.legChamfer ?? 0.5));
  const legXf: THREE.Matrix4[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    legXf.push(xf(Math.cos(a) * side, h / 2, Math.sin(a) * side));
  }

  const lvlH = h / levels;
  // The chord between two vertices 120 degrees apart on a circle of radius
  // `side` is side * sqrt(3); the brace spans that chord and one level's rise.
  const braceLen = Math.hypot(lvlH, side * 1.732);
  const bs = legR * (o.braceSection ?? 1.4);
  const brace = chamferBox(bs, braceLen, bs, legR * (o.braceChamfer ?? 0.4));
  const xfs: THREE.Matrix4[] = [];
  for (let l = 0; l < levels; l++) {
    for (let i = 0; i < 3; i++) {
      const a0 = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const a1 = ((i + 1) / 3) * Math.PI * 2 + Math.PI / 6;
      const up = l % 2 === 0;
      xfs.push(_composeBetween(
        Math.cos(a0) * side, l * lvlH + (up ? 0 : lvlH), Math.sin(a0) * side,
        Math.cos(a1) * side, l * lvlH + (up ? lvlH : 0), Math.sin(a1) * side, 1,
      ));
    }
    if (l % 2 === 1) {
      for (let i = 0; i < 3; i++) {
        const a0 = (i / 3) * Math.PI * 2 + Math.PI / 6;
        const a1 = ((i + 1) / 3) * Math.PI * 2 + Math.PI / 6;
        xfs.push(_composeBetween(
          Math.cos(a0) * side, l * lvlH, Math.sin(a0) * side,
          Math.cos(a1) * side, l * lvlH, Math.sin(a1) * side, 0.999,
        ));
      }
    }
  }
  return { leg: { geo: leg, xf: legXf }, brace: { geo: brace, xf: xfs } };
}

/**
 * Square tower section: four legs on the corners of a square, a true X per
 * face per level, and a full-width collar every other level.
 *
 * Unlike the triangular section the collars come back in their own array,
 * because a square tower's collar is a different member (it spans the whole
 * face rather than a chord) and its caller merges it as its own group.
 */
export function boxLatticeSection(
  o: LatticeSectionOpts,
): { leg: LatticePart; brace: LatticePart; collar: LatticePart } {
  const { height: h, legR, side, levels } = o;
  const leg = chamferBox(legR * 2, h, legR * 2, legR * (o.legChamfer ?? 0.4));
  const legXf: THREE.Matrix4[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    legXf.push(xf(sx * side, h / 2, sz * side));
  }

  const lvlH = h / levels;
  const braceLen = Math.hypot(lvlH, side * 2);
  const bs = legR * (o.braceSection ?? 1.1);
  const brace = chamferBox(bs, braceLen, bs, legR * (o.braceChamfer ?? 0.35));
  const cs = legR * (o.collarSection ?? 1.5);
  const collar = chamferBox(cs, side * 2, cs, legR * (o.collarChamfer ?? 0.4));
  const xfs: THREE.Matrix4[] = [];
  const collars: THREE.Matrix4[] = [];
  // The four faces, as the corner pair that spans each one.
  const faces: [number, number, number, number][] = [
    [-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1],
  ];
  for (let l = 0; l < levels; l++) {
    for (const [ax, az, bx, bz] of faces) {
      for (const up of [true, false]) {
        xfs.push(_composeBetween(
          ax * side, l * lvlH + (up ? 0 : lvlH), az * side,
          bx * side, l * lvlH + (up ? lvlH : 0), bz * side, 1,
        ));
      }
      if (l % 2 === 1) {
        collars.push(_composeBetween(
          ax * side, l * lvlH, az * side,
          bx * side, l * lvlH, bz * side, 1,
        ));
      }
    }
  }
  return {
    leg: { geo: leg, xf: legXf },
    brace: { geo: brace, xf: xfs },
    collar: { geo: collar, xf: collars },
  };
}
