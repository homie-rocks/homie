/**
 * ============================================================================
 *  Fixtures — the things bolted to a structure once it exists.
 * ============================================================================
 *  Work floods and their masts and brackets, a hazard beacon, radiator fins, a
 *  docking clamp, a berth marker, deck lamps, light battens, thermal panels, a
 *  service cabinet and a cable drum.
 *
 *  These are what makes a built thing read as OPERATED rather than modelled.
 *  A truss with no cable run, no cabinet and no lamp is an architectural
 *  drawing; the same truss with a drum of cable lashed to it is a place where
 *  somebody works. That is why the list is this long and why each one carries
 *  its own fixing — the same "nothing floats" rule `Truss.ts` states.
 *
 *  THE ONES THAT RETURN TWO BUFFERS ARE RETURNING A LADDER OF BRIGHTNESS, NOT
 *  A CONVENIENCE. `workFloodGeo`, `hazardBeaconGeo`, `deckLampGeo` and
 *  `battenGeo` hand back the housing and the lens SEPARATELY so the caller can
 *  put an emissive on one and lit metal on the other, and so a fitting that is
 *  switched OFF is still visibly a fitting. A single mesh forces the choice
 *  between a lamp that glows and a lamp that exists.
 *
 *  PUBLISHED, NOT DE-DUPLICATED. See `Village.ts`'s header.
 */
import * as THREE from 'three';
import { bevelBox, plainBox } from '@homie-rocks/geom/prim.js';
import { GeoAccum } from '@homie-rocks/geom/accum.js';
import { tubeInto, boltRingInto } from '@homie-rocks/geom/tube.js';
import { mulberry32, lerp } from '@homie-rocks/noise/Noise.js';
import { ladderGeo } from './Truss.ts';

/**
 * WORK FLOOD — the main work-light fixture. In the scene it was built for,
 * 1,600 instances, of which ≤26 are ever real lights; the rest are emissive
 * geometry.
 *
 * The housing is a raked rectangular pan on a knuckle bracket. It matters that
 * the pan is RAKED: 1,600 fixtures all pointing the same way is a repeat the
 * eye catches instantly, and a knuckle is what lets the caller aim each one.
 */
export function workFloodGeo(): { body: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  const pan = bevelBox(0.52, 0.34, 0.20, 0.02);
  pan.translate(0, 0, -0.10);
  acc.add(pan, m);
  pan.dispose();
  // knuckle + stem + a bolted saddle: three parts, so it reads as mounted
  tubeInto(acc, m, 0, 0, -0.20, 0, 0, -0.42, 0.045, 6);
  const saddle = plainBox(0.16, 0.16, 0.03);
  saddle.translate(0, 0, -0.44);
  acc.add(saddle, m);
  saddle.dispose();
  boltRingInto(acc, m, 0, 0, -0.455, 0, 0, -1, 0.055, 4, 0.020);
  // wire loom leaving the back — the detail that says it is connected to
  // something, at four triangles
  tubeInto(acc, m, 0.06, -0.06, -0.42, 0.16, -0.22, -0.50, 0.016, 4);
  const body = acc.build()!;
  body.computeBoundingSphere();
  const lens = plainBox(0.46, 0.28, 0.012);
  lens.computeBoundingSphere();
  return { body, lens };
}

/**
 * FLOOD MAST — the load path for a work flood that cannot reach a gantry.
 *
 * ===========================================================================
 *  WORK FLOODS BELONG ON GANTRIES. A FREE-STANDING POLE IS THE FALLBACK, AND
 *  IT HAS TO EARN ITS PLACE IN THE FRAME.
 * ===========================================================================
 *  The previous mast was a `CylinderGeometry(0.11, 0.15, h, 6)` meeting the
 *  deck at a bare point with a lamp cantilevered off the top, which is the
 *  silhouette of a municipal streetlight — the most terrestrial object it is
 *  possible to put on a construction deck in vacuum, and one that carries no
 *  scale information at all: a smooth pole with a box on it could be 4 m or
 *  12 m. Three changes fix both problems at once and they are all structural:
 *
 *   · A THREE-CHORD LATTICE, not a tube. Lacing every 1.10 m is a second
 *     readable scale on an object whose whole job is to be 9 m tall.
 *   · A 0.42 m BOLTED BASEPLATE with a drilled collar and a grout skirt, the
 *     same pattern `stanchionGeo` uses, plus a knee brace. The rule is
 *     explicit: nothing above the deck exists without a member terminating on
 *     it.
 *   · A CONDUIT RUN down one chord into a deck gland box. The cable is what
 *     says somebody installed this, and it is eight triangles.
 */
export function floodMastGeo(h = 9.4): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  const R0 = 0.26, R1 = 0.14;                 // lattice radius, foot → head
  const chord = (k: number): [number, number] => {
    const a = (k / 3) * Math.PI * 2 + 0.4;
    return [Math.cos(a), Math.sin(a)];
  };

  // --- the fixing, built first because it is the point of the object -------
  // baseplate → drilled collar → grout skirt, at 0.42 m across.
  const plate = bevelBox(0.42, 0.028, 0.42, 0.010);
  plate.translate(0, 0.014, 0);
  acc.add(plate, m);
  plate.dispose();
  boltRingInto(acc, m, 0, 0.030, 0, 0, 1, 0, 0.155, 6, 0.030);
  tubeInto(acc, m, 0, 0.028, 0, 0, 0.20, 0, R0 * 1.55, 8);   // collar
  tubeInto(acc, m, 0, 0.028, 0, 0, 0.09, 0, R0 * 2.05, 8);   // grout skirt

  // --- three chords with Warren lacing ------------------------------------
  for (let k = 0; k < 3; k++) {
    const [cx, cz] = chord(k);
    tubeInto(acc, m, cx * R0, 0.10, cz * R0, cx * R1, h, cz * R1, 0.030, 5);
  }
  for (let y = 0.55; y < h - 0.3; y += 1.10) {
    const f0 = y / h, f1 = Math.min(1, (y + 1.10) / h);
    const r0 = lerp(R0, R1, f0), r1 = lerp(R0, R1, f1);
    for (let k = 0; k < 3; k++) {
      const a = chord(k), b = chord((k + 1) % 3);
      // a horizontal at every node and one diagonal, alternating sense, so the
      // mast is braced both ways and the lacing is not a repeating chevron
      tubeInto(acc, m, a[0] * r0, y, a[1] * r0, b[0] * r0, y, b[1] * r0, 0.014, 4);
      if (((y * 10) | 0) & 1) {
        tubeInto(acc, m, a[0] * r0, y, a[1] * r0, b[0] * r1, y + 1.10, b[1] * r1, 0.012, 4);
      }
    }
  }

  // --- knee brace back down to its own bolted foot ------------------------
  // A 9 m column in pure compression is a pencil. The brace is what makes the
  // mast read as engineered against the 2.4 g mag-lock rather than balanced.
  const c0 = chord(0);
  tubeInto(acc, m, c0[0] * R0, h * 0.44, c0[1] * R0, c0[0] * 1.55, 0.14, c0[1] * 1.55, 0.026, 5);
  const foot = plainBox(0.22, 0.024, 0.22);
  foot.translate(c0[0] * 1.55, 0.012, c0[1] * 1.55);
  acc.add(foot, m);
  foot.dispose();
  boltRingInto(acc, m, c0[0] * 1.55, 0.026, c0[1] * 1.55, 0, 1, 0, 0.075, 4, 0.022);

  // --- conduit run: gland box on the deck, up chord 1, into the head ------
  const c1 = chord(1);
  const gland = bevelBox(0.24, 0.30, 0.18, 0.02);
  gland.translate(c1[0] * (R0 + 0.16), 0.15, c1[1] * (R0 + 0.16));
  acc.add(gland, m);
  gland.dispose();
  tubeInto(acc, m, c1[0] * (R0 + 0.16), 0.30, c1[1] * (R0 + 0.16),
    c1[0] * (R1 + 0.06), h - 0.25, c1[1] * (R1 + 0.06), 0.026, 5);
  // saddle clamps up the run, every 1.6 m — a cable with no clips is a hose
  for (let y = 1.0; y < h - 0.5; y += 1.6) {
    const f = y / h, rr = lerp(R0, R1, f);
    tubeInto(acc, m, c1[0] * rr, y, c1[1] * rr, c1[0] * (rr + 0.12), y, c1[1] * (rr + 0.12), 0.020, 4);
  }

  // ========================================================================
  //  A LADDER UP THE THIRD CHORD: THE NAMED SCALE CUE, ON THE OBJECT THAT
  //  HAD NONE.
  // ========================================================================
  //  "A gantry whose 41 m height is unambiguous BECAUSE THERE IS A LADDER ON
  //  IT." The gantry cranes already carried one; the 128 light towers on the
  //  circuit this was built for had not, and a review read the whole set as
  //  scaleless — "every structure in the game could be 20 m or 200 m". A
  //  ladder is the only object in the frame whose absolute dimensions
  //  everybody already knows, and its 0.30 m rung pitch is the ruler doing the
  //  work.
  //
  //  UNCAGED, AND THAT IS A BUDGET DECISION STATED PLAINLY. `ladderGeo`'s
  //  hoops are 8 × 9 segments here and would TRIPLE this geometry, at 128
  //  instances, on a mast whose own lattice is ~450 triangles. The triangle
  //  budget is hard and the rung pitch — not the cage — is what carries the
  //  scale. If the tri budget ever has room, `caged = true` is the one-word
  //  change and the docblock on `ladderGeo` says why the cage is worth it.
  const c2 = chord(2);
  const lad = ladderGeo(h - 0.5, false);
  lad.rotateY(Math.atan2(c2[1], c2[0]) - Math.PI / 2);
  lad.translate(c2[0] * (R0 + 0.30), 0.10, c2[1] * (R0 + 0.30));
  acc.add(lad, m);
  lad.dispose();

  // --- head: a THREE-HEAD CROSS-ARM, which is what fixes the streetlight ---
  // A single lamp cantilevered off a pole is a streetlight; a cross-arm with
  // three heads on it is a shipyard light tower, and that difference is most
  // of the read. It is also what makes the numbers reconcile: the scene wants
  // 1,600 fixtures at 8–11 m, every one of them on a member, and the only
  // thing at 8–11 m out here is a mast — so a mast has to carry more than one
  // lamp or the deck edge becomes a hedgerow of poles.
  //
  // A caller placing flood instances against the head has to mirror these
  // three numbers, and if the head moves here the lamps float. Floating lamps
  // are the failure this whole design is about, so it is worth the coupling
  // being explicit rather than approximate.
  tubeInto(acc, m, 0, h, 0, 0, h + 0.34, 0, 0.05, 6);
  tubeInto(acc, m, -0.78, h + 0.34, 0, 0.78, h + 0.34, 0, 0.045, 5);
  // a stay from each arm end back down to the mast head, so the arm is a
  // triangulated bracket rather than a cantilever balanced on a pole
  for (const sx of [-1, 1]) {
    tubeInto(acc, m, sx * 0.76, h + 0.34, 0, 0, h - 0.55, 0, 0.020, 4);
  }
  for (const hx of [-0.72, 0, 0.72]) {
    tubeInto(acc, m, hx, h + 0.34, 0, hx, h + 0.30, 0.55, 0.038, 5);
    const saddle = plainBox(0.18, 0.028, 0.18);
    saddle.translate(hx, h + 0.28, 0.55);
    acc.add(saddle, m);
    saddle.dispose();
  }
  const g = acc.build()!;
  g.computeBoundingSphere();
  return g;
}

/**
 * FLOOD BRACKET — the low fixture, bolted to the outboard barrier.
 *
 * 1,600 work floods, every one of them attached, are only compatible if most
 * fixtures are NOT on their own mast: a forest of 800 poles would be its own
 * failure ("a field of similar-sized greebles") and would also cost more than
 * the light is worth. So the common case is this — a back plate
 * through-bolted to the barrier, a cranked arm, and a conduit dropping into a
 * gland below it — and the mast is the exception used where there is no
 * barrier to bolt to.
 *
 * Modelled with the back plate at the origin facing +Z, arm reaching +Z.
 */
export function floodBracketGeo(): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  const back = plainBox(0.24, 0.32, 0.026);
  back.translate(0, 0, -0.013);
  acc.add(back, m);
  back.dispose();
  boltRingInto(acc, m, 0, 0, -0.028, 0, 0, -1, 0.085, 4, 0.024);
  // cranked arm: out, then up, so the lamp clears its own bracket
  tubeInto(acc, m, 0, -0.02, 0, 0, -0.02, 0.30, 0.032, 5);
  tubeInto(acc, m, 0, -0.02, 0.30, 0, 0.16, 0.34, 0.030, 5);
  const saddle = plainBox(0.16, 0.024, 0.16);
  saddle.translate(0, 0.17, 0.34);
  acc.add(saddle, m);
  saddle.dispose();
  // conduit leaving the back plate downward into a gland — the cable run
  tubeInto(acc, m, 0.07, -0.14, -0.04, 0.07, -0.62, -0.06, 0.018, 4);
  const gland = plainBox(0.12, 0.14, 0.10);
  gland.translate(0.07, -0.68, -0.06);
  acc.add(gland, m);
  gland.dispose();
  const g = acc.build()!;
  g.computeBoundingSphere();
  return g;
}

/**
 * HAZARD BEACON — `#ff9b3d`, rotating at 48 rpm. In the scene it was built
 * for these are the only animated lights, and they live on every crane and
 * every moving element.
 *
 * The dome is a real half-sphere over a machined base with a cage over it,
 * because a beacon is the one fixture on an industrial site that always has a
 * cage, and the cage is what makes it read as a beacon at 60 m.
 */
export function hazardBeaconGeo(): { base: THREE.BufferGeometry; dome: THREE.BufferGeometry } {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  tubeInto(acc, m, 0, 0, 0, 0, 0.10, 0, 0.13, 8);
  boltRingInto(acc, m, 0, 0.005, 0, 0, -1, 0, 0.10, 4, 0.022);
  // four cage uprights + a top hoop
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    tubeInto(acc, m, Math.cos(a) * 0.115, 0.10, Math.sin(a) * 0.115,
      Math.cos(a) * 0.085, 0.30, Math.sin(a) * 0.085, 0.012, 4);
  }
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2;
    tubeInto(acc, m, Math.cos(a0) * 0.085, 0.30, Math.sin(a0) * 0.085,
      Math.cos(a1) * 0.085, 0.30, Math.sin(a1) * 0.085, 0.011, 4);
  }
  const base = acc.build()!;
  base.computeBoundingSphere();
  const dome = new THREE.SphereGeometry(0.095, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(0, 0.11, 0);
  dome.computeBoundingSphere();
  return { base, dome };
}

/**
 * RADIATOR FIN — a deployable panel array, used on the pressure bays and the
 * foundry's condenser run.
 *
 * White ceramic on the face, bare steel on the spine, on a real pivot with a
 * ram. The pivot is what makes it a deployable rather than a wing.
 */
export function radiatorFinGeo(w: number, h: number, panels = 5):
{ face: THREE.BufferGeometry; spine: THREE.BufferGeometry } {
  const fAcc = new GeoAccum(), sAcc = new GeoAccum();
  const m = new THREE.Matrix4();
  const pw = w / panels;
  for (let k = 0; k < panels; k++) {
    // 12 mm gap between panels — the gap is the whole read at distance
    const p = bevelBox(pw - 0.06, h, 0.05, 0.012);
    p.translate(-w / 2 + pw * (k + 0.5), h / 2, 0);
    fAcc.add(p, m);
    p.dispose();
  }
  // root spar, two hinge lugs and a ram
  tubeInto(sAcc, m, -w / 2, 0, 0, w / 2, 0, 0, 0.09, 6);
  for (const s of [-0.32, 0.32]) {
    tubeInto(sAcc, m, w * s, 0, -0.12, w * s, 0, 0.12, 0.13, 6);
    tubeInto(sAcc, m, w * s, 0, 0.12, w * s, -0.9, 0.55, 0.055, 5);
  }
  const face = fAcc.build()!, spine = sAcc.build()!;
  face.computeBoundingSphere(); spine.computeBoundingSphere();
  return { face, spine };
}

/**
 * DOCKING CLAMP — the mechanism that holds a derelict alongside, and the
 * generic "this large thing is attached to that large thing" part.
 *
 * A pair of hydraulic jaws on a swivel head with a visible ram, plus the
 * tension cable eye. It exists because a 906 m hull moored beside a deck
 * needs one: if the eye cannot find what is holding it there, it is not
 * moored, it is floating.
 */
export function dockingClampGeo(reach = 6): { body: THREE.BufferGeometry; jaw: THREE.BufferGeometry } {
  const bAcc = new GeoAccum(), jAcc = new GeoAccum();
  const m = new THREE.Matrix4();
  const base = bevelBox(2.4, 0.6, 2.4, 0.06);
  base.translate(0, 0.3, 0);
  bAcc.add(base, m);
  base.dispose();
  boltRingInto(bAcc, m, 0, 0.02, 0, 0, -1, 0, 1.0, 12, 0.07);
  tubeInto(bAcc, m, 0, 0.6, 0, 0, 1.5, 0, 0.55, 8);
  tubeInto(bAcc, m, 0, 1.5, 0, 0, 1.5, reach * 0.62, 0.34, 7);
  // the ram, offset so it reads as a separate mechanism
  tubeInto(bAcc, m, 0.45, 1.1, 0.2, 0.45, 1.35, reach * 0.5, 0.16, 6);
  tubeInto(bAcc, m, 0.45, 1.35, reach * 0.5, 0.45, 1.45, reach * 0.62, 0.09, 5);
  for (const s of [-1, 1]) {
    const j = bevelBox(0.42, 1.1, reach * 0.42, 0.05);
    j.translate(s * 0.7, 1.5, reach * 0.62 + reach * 0.21);
    jAcc.add(j, m);
    j.dispose();
  }
  const body = bAcc.build()!, jaw = jAcc.build()!;
  body.computeBoundingSphere(); jaw.computeBoundingSphere();
  return { body, jaw };
}

/**
 * BERTH MARKER — a temporary numbered post bolted onto a working site:
 * "temporary numbered berth markers ... obviously bolted onto a working
 * industrial site by somebody in a hurry".
 *
 * In the racing game it was built for, this is one of only three concessions
 * to the race existing at all. It is NOT signage, NOT a grandstand and NOT an
 * arch — it is a numbered plate zip-tied to a stanchion, which is exactly what
 * a construction crew would actually do.
 */
export function berthMarkerGeo(): { post: THREE.BufferGeometry; plate: THREE.BufferGeometry } {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  tubeInto(acc, m, 0, 0, 0, 0, 1.35, 0, 0.035, 5);
  const foot = plainBox(0.26, 0.025, 0.26);
  foot.translate(0, 0.012, 0);
  acc.add(foot, m);
  foot.dispose();
  boltRingInto(acc, m, 0, 0.026, 0, 0, 1, 0, 0.09, 4, 0.022);
  // two cable ties holding the plate on. Four triangles, and they are the
  // difference between "bolted on in a hurry" and "manufactured signage".
  for (const y of [0.86, 1.20]) tubeInto(acc, m, -0.02, y, -0.03, -0.02, y, 0.03, 0.008, 4);
  const post = acc.build()!;
  post.computeBoundingSphere();
  const plate = plainBox(0.34, 0.42, 0.010);
  plate.translate(0, 1.05, 0.02);
  plate.computeBoundingSphere();
  return { post, plate };
}

// ---------------------------------------------------------------------------
//  THE ECLIPSE KIT — the four objects the dark half of a lap is made of.
// ---------------------------------------------------------------------------
//  A frame where the only legible thing at thumbnail size is the UI is an
//  automatic failure, and a third of one captured set was there: with the HUD
//  removed, every section of the circuit inside the shadow was a black
//  rectangle and a cyan dashed line.
//
//  THE ECLIPSE BEING DARK IS CORRECT. THE ECLIPSE BEING EMPTY IS NOT. The lit
//  half of that circuit is dressed with objects that are read BY THE KEY —
//  gantries at ±48 m, a 906 m hull at 62 m, portals at 8.6 m clear — and when
//  the key goes away those objects do not become dark, they become absent,
//  because nothing else in the frame was ever lighting them. Darkness has to
//  reveal a DIFFERENT set of things, not fewer things; that is the difference
//  between an art direction and an absence.
//
//  So there are exactly two radiance sources in the shadow cone: the track's
//  edge strip, through an analytic line-light, and the practicals. Both have
//  a hard falloff. Everything below is therefore designed against ONE rule —
//  **it is small, it is LOW, and it stands within a few metres of a lit line**
//  — which is the opposite of how the lit half is dressed and is why the two
//  halves now look like different places instead of the same place with the
//  lamp switched off.
//
//  What is deliberately NOT here: anything that would answer the finding with
//  light. No fixture below carries a `THREE.Light` (the scene's cap of 26 real
//  lights belongs elsewhere), nothing raises an ambient, and nothing is
//  fogged. Each of those three is an automatic failure of its own.
// ---------------------------------------------------------------------------

/**
 * DECK LAMP — the work flood, brought down to 2.4 m, and the single
 * highest-value object in the eclipse.
 *
 * Work floods mount at 8–11 m on gantries, which is right for lighting a haul
 * route and wrong for being SEEN from one. At 9.4 m a mast head is above the
 * camera in a cockpit view, its housing is 9 m from the nearest lit line so
 * the line-light's `1/(1+(d/2.4)²)` returns 0.07 of a clamp, and the only part
 * of it that reaches the frame in the dark is a 0.46 m lens quad — a bright
 * dot with nothing attached to it, which reads as floating whether the mount
 * exists or not.
 *
 * At 2.4 m the same fixture is a legible OBJECT: the shroud is a 0.5 m
 * cylinder that occupies real pixels, it stands 1.5–3 m from the edge line so
 * the line-light returns 0.4–0.7 rather than 0.07, and the post, the collar and
 * the gland are all inside that radius too. So the housing is lit by the strip,
 * the lens is lit by itself, and the pair reads as a lamp rather than as a
 * pixel. It is also low enough that a run of forty never becomes a hedgerow
 * across the horizon, which is what killed the first draft of the light masts.
 *
 * `body` goes on structural steel and `lens` on `MatLib.flood`.
 */
export function deckLampGeo(h = 2.4): { body: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();

  // --- the fixing first, as everywhere else in this file -------------------
  const plate = bevelBox(0.30, 0.024, 0.30, 0.008);
  plate.translate(0, 0.012, 0);
  acc.add(plate, m);
  plate.dispose();
  boltRingInto(acc, m, 0, 0.026, 0, 0, 1, 0, 0.105, 4, 0.024);
  tubeInto(acc, m, 0, 0.024, 0, 0, 0.16, 0, 0.105, 8);        // drilled collar
  tubeInto(acc, m, 0, 0.024, 0, 0, 0.07, 0, 0.145, 8);        // grout skirt

  // --- the post: a 90 mm tube with a splice sleeve at mid-height ----------
  // The sleeve is there to give the post a second scale. A smooth 2.4 m tube
  // carries no dimension at all and would put the same "could be 4 m or 12 m"
  // problem on the deck that the old flood mast had in the sky.
  tubeInto(acc, m, 0, 0.14, 0, 0, h, 0, 0.045, 7);
  tubeInto(acc, m, 0, h * 0.46, 0, 0, h * 0.46 + 0.16, 0, 0.062, 8);

  // --- the head: a cranked arm reaching inboard over the deck edge --------
  // It reaches +Z so the caller yaws it toward the corridor exactly the way
  // it yaws a mast, by `side * PI/2`.
  tubeInto(acc, m, 0, h, 0, 0, h + 0.14, 0.30, 0.040, 6);

  // ========================================================================
  //  THE SHROUD IS RAKED 42° OFF VERTICAL AND THAT IS A BUG FIX, NOT A LOOK.
  // ========================================================================
  //  The first cut of this object hung the shroud straight down with the lens
  //  recessed inside it. That is what a real bulkhead downlight does and it is
  //  useless here: the chase camera sits ABOVE a 2.4 m fixture at every station
  //  on the circuit, so the only face of the luminaire it can ever see is the
  //  closed top, and the one part of the object that emits is occluded by the
  //  object itself. Captured and confirmed — the lamps were in the frame and
  //  the frame had no lamps in it.
  //
  //  Raking the head throws the beam DOWN-TRACK at the deck ahead, which is
  //  how a work light over a haul route is actually aimed, and it presents the
  //  lit aperture to anything behind and above it. The aiming rule is
  //  satisfied either way; only one of the two is visible.
  const RAKE = 0.73;                              // 42°, from vertical toward +Z
  const sr = Math.sin(RAKE), cr = Math.cos(RAKE);
  const hx = 0, hy = h + 0.16, hz = 0.30;         // the knuckle
  // shroud axis: from the knuckle, out along the rake
  const mx = hx, my = hy - cr * 0.34, mz = hz + sr * 0.34;     // mouth centre
  tubeInto(acc, m, hx, hy, hz, mx, my, mz, 0.25, 10);
  // four cooling fins round the barrel — the mid-scale that says "cast
  // housing, machined" rather than "bucket"
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.6;
    const fin = plainBox(0.03, 0.26, 0.10);
    fin.translate(Math.cos(a) * 0.27, hy - cr * 0.17, hz + sr * 0.17 + Math.sin(a) * 0.20);
    fin.rotateY(-a);
    acc.add(fin, m);
    fin.dispose();
  }
  // a proud rim at the mouth: the lens sits behind it, so the aperture has an
  // edge and reads as a fitting rather than as a glowing rectangle
  boltRingInto(acc, m, mx, my, mz, 0, -cr, sr, 0.255, 6, 0.030);

  // --- the junction box and the run into a deck gland ---------------------
  // The cable is what says somebody installed this rather than that it grew
  // here, and it is eight triangles.
  const jb = bevelBox(0.16, 0.22, 0.12, 0.02);
  jb.translate(0.10, h * 0.30, 0);
  acc.add(jb, m);
  jb.dispose();
  tubeInto(acc, m, 0.10, h * 0.30 - 0.11, 0, 0.10, 0.22, -0.10, 0.022, 5);
  const gland = plainBox(0.14, 0.10, 0.16);
  gland.translate(0.10, 0.05, -0.10);
  acc.add(gland, m);
  gland.dispose();

  const body = acc.build()!;
  body.computeBoundingSphere();
  // The lens fills the raked mouth, so what the camera sees is a 0.46 m lit
  // disc set inside a rim — an aperture, which is a shape — rather than the
  // 0.36 m rectangle the first cut hid inside the barrel. `CircleGeometry`
  // rather than a box because the housing is round and a square lens in a round
  // shroud is the sort of thing that reads as an amateur tell.
  const lens = new THREE.CircleGeometry(0.23, 14);
  lens.rotateX(-Math.PI / 2 + RAKE);
  lens.translate(mx, my + cr * 0.02, mz - sr * 0.02);
  lens.computeBoundingSphere();
  return { body, lens };
}

/**
 * BATTEN LUMINAIRE — the work flood in its linear housing, and the object
 * that makes the eclipse's STRUCTURE legible rather than only its fixtures.
 *
 * ==========================================================================
 *  A SCATTER OF POINTS IS NOT A COMPOSITION. A LINE ALONG A MEMBER IS.
 * ==========================================================================
 *  `deckLampGeo` puts a lit aperture at the deck edge, which answers "there
 *  are fixtures here". It does not answer whether the frame READS at 128 px —
 *  whether a viewer can find the track, the biggest object and the depth
 *  order — and forty bright dots at forty distances tell you nothing about
 *  any of the three. What does is a lit line lying ALONG a member: it
 *  describes the member's length, its angle and its distance in one mark, so
 *  a batten under a portal girder draws the girder, and eight of them
 *  receding draw the corridor.
 *
 *  This is not a new emissive tier and not a new colour. It is the work
 *  flood — `#cfe4ff` mercury-vapour cold — in the housing a working site uses
 *  when the thing being lit is 12 m long instead of 12 m² : a gasketed batten
 *  in a bolted channel with end caps.
 *
 *  It is deliberately NOT `MatLib.trim`, which is cyan. The scene it was built
 *  for reserves cyan for track, racing line, edge strip and the armed gate; a
 *  cyan line lying along every structural member in the dark would be a
 *  fifth meaning for a reserved colour AND it would put a glowing-lattice
 *  motif in the frame. Cold white is a work light. Cyan would be a livery.
 *
 *  `tube` goes on `MatLib.flood`; `housing` on structural steel. The tube is
 *  0.07 m so a run of them costs almost no screen coverage against a 4.5 %
 *  emissive-coverage budget.
 */
export function battenGeo(len = 2.4): { housing: THREE.BufferGeometry; tube: THREE.BufferGeometry } {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  // channel: an inverted U over the tube, open downward, so the emitter is
  // shielded from directly above and reads as a fitting from below and beside
  const back = plainBox(0.15, 0.045, len);
  back.translate(0, 0.075, 0);
  acc.add(back, m);
  back.dispose();
  for (const sx of [-1, 1]) {
    const cheek = plainBox(0.020, 0.085, len);
    cheek.translate(sx * 0.065, 0.020, 0);
    acc.add(cheek, m);
    cheek.dispose();
  }
  // end caps and the two mounting straps that hold it to the member above
  for (const sz of [-1, 1]) {
    const cap = bevelBox(0.16, 0.11, 0.03, 0.012);
    cap.translate(0, 0.045, sz * len * 0.5);
    acc.add(cap, m);
    cap.dispose();
    const strap = plainBox(0.05, 0.13, 0.028);
    strap.translate(0, 0.14, sz * len * 0.32);
    acc.add(strap, m);
    strap.dispose();
    boltRingInto(acc, m, 0, 0.20, sz * len * 0.32, 0, 1, 0, 0.035, 2, 0.020);
  }
  // the supply loop leaving one end — eight triangles, and it is the whole
  // difference between a fitting and a glowing stick
  tubeInto(acc, m, 0.05, 0.10, len * 0.5, 0.05, 0.24, len * 0.5 + 0.12, 0.016, 4);
  const housing = acc.build()!;
  housing.computeBoundingSphere();
  const tube = new THREE.CylinderGeometry(0.035, 0.035, len - 0.10, 6);
  tube.rotateX(Math.PI / 2);
  tube.translate(0, 0.012, 0);
  tube.computeBoundingSphere();
  return { housing, tube };
}

/**
 * THERMAL BLANKET PANEL — the authored white, as an object.
 *
 * A quilted MLI square laced to a bolted perimeter frame. It is what a
 * construction crew wraps a cryogenic run, a bulkhead or an exposed tie beam in
 * on the shadow side of a ring, so it belongs in this setting on its own terms
 * — but the reason it is built is an art-direction note that a white-on-black
 * read "is partly accidental, arising from over-exposure clipping the truss".
 * This object is the deliberate version of that read: `MatLib.thermal` is 2.5×
 * the albedo of the steel frame holding it, so the panel is lighter than its
 * own frame at every exposure, and the pair is a value STRUCTURE — a light
 * plane inside a dark line — rather than a clipped highlight.
 *
 * `face` and `frame` come back separately because that contrast is the object.
 * One merged geometry on one material could not express it.
 *
 * The face is CROWNED, not flat. A blanket over a frame is never flat, and a
 * flat quad is the one shape that cannot carry a gradient under a 0.18° source:
 * it returns exactly one value across its whole area, which is the classic
 * counter-example ("a large flat surface whose highlight is perfectly even from
 * edge to edge").
 */
export function thermalPanelGeo(w: number, h: number, seed = 3):
{ face: THREE.BufferGeometry; frame: THREE.BufferGeometry } {
  const rng = mulberry32(seed);
  const face = new THREE.PlaneGeometry(w, h, 6, 5);
  const pos = face.getAttribute('position') as THREE.BufferAttribute;
  const uv = face.getAttribute('uv') as THREE.BufferAttribute;
  const crown = Math.min(w, h) * 0.055;
  for (let i = 0; i < pos.count; i++) {
    const fx = pos.getX(i) / w + 0.5, fy = pos.getY(i) / h + 0.5;
    // one crown over the whole panel plus a per-vertex slack, so the surface is
    // not a cylinder either
    pos.setZ(i, Math.sin(Math.PI * fx) * Math.sin(Math.PI * fy) * crown - rng() * 0.02);
    // UV in world metres against `mliBlanket`'s 2.4 m repeat, so the quilt cell
    // is 0.60 m on a 3 m panel and on a 14 m one alike. A 0..1 UV would scale
    // the quilt with the panel and destroy the scale cue the texture carries.
    uv.setXY(i, (fx * w) / 2.4, (fy * h) / 2.4);
  }
  face.translate(0, h / 2, 0);
  face.computeVertexNormals();
  face.computeBoundingSphere();

  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  const hx = w / 2;
  // perimeter angle, four runs, with the corners lapped rather than mitred
  for (const [a, b] of [
    [[-hx, 0], [hx, 0]], [[-hx, h], [hx, h]],
    [[-hx, 0], [-hx, h]], [[hx, 0], [hx, h]],
  ] as [number, number][][]) {
    tubeInto(acc, m, a[0], a[1], -0.03, b[0], b[1], -0.03, 0.055, 5);
  }
  // lacing grommets down both long edges at 1.10 m — the same pitch the flood
  // mast laces at, because it is the same crew with the same stock
  for (let y = 0.55; y < h; y += 1.10) {
    for (const sx of [-1, 1]) {
      boltRingInto(acc, m, sx * hx, y, -0.03, sx, 0, 0, 0.075, 3, 0.028);
    }
  }
  // two back stays to a bolted foot at the origin: the attachment, which the
  // eye has to be able to find without hunting
  for (const sx of [-1, 1]) {
    tubeInto(acc, m, sx * hx * 0.72, h * 0.86, -0.05, sx * 0.20, 0.10, -0.42, 0.042, 5);
  }
  const foot = bevelBox(0.62, 0.05, 0.34, 0.012);
  foot.translate(0, 0.025, -0.42);
  acc.add(foot, m);
  foot.dispose();
  boltRingInto(acc, m, 0, 0.055, -0.42, 0, 1, 0, 0.20, 4, 0.028);

  const frame = acc.build()!;
  frame.computeBoundingSphere();
  return { face, frame };
}

/**
 * SERVICE CABINET — the finished version of a bare `bevelBox(3.0, 2.2, 3.0)`
 * that a corner of the circuit had been dressed with.
 *
 * A review flagged "a parapet" among "the least finished surfaces in the
 * frame", and it was right: a run of identical un-plinthed grey cubes at
 * 120 m pitch along the inside of a corner reads as a low wall, and a low wall
 * on a construction deck in vacuum is nothing at all. It is also the one
 * object in that shot the eye has time to look at, because the composition
 * keeps the outside of the corner deliberately empty.
 *
 * A cabinet is what would actually be standing there — switchgear for the
 * induction run — and it has the four things the cube had none of: a plinth it
 * is bolted to, a door with a frame and a handle, a louvre bank that is a
 * different material from the shell, and a service loop of conduit leaving it.
 * Proportions are seeded so a run of them is a run of cabinets and not one
 * cabinet drawn six times.
 */
export function serviceCabinetGeo(seed = 1): { body: THREE.BufferGeometry; louvre: THREE.BufferGeometry } {
  const rng = mulberry32(seed);
  const acc = new GeoAccum(), lAcc = new GeoAccum();
  const m = new THREE.Matrix4();
  const w = 2.1 + rng() * 1.4, d = 1.1 + rng() * 0.7, hh = 1.9 + rng() * 0.9;

  // --- plinth: 0.22 m, wider than the shell, bolted through --------------
  const plinth = bevelBox(w + 0.22, 0.22, d + 0.22, 0.03);
  plinth.translate(0, 0.11, 0);
  acc.add(plinth, m);
  plinth.dispose();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    boltRingInto(acc, m, sx * (w * 0.5 - 0.10), 0.23, sz * (d * 0.5 - 0.10), 0, 1, 0, 0.075, 3, 0.030);
  }

  // --- shell, with a proud roof lip so the top is not a bare arris -------
  const box = bevelBox(w, hh, d, 0.04);
  box.translate(0, 0.22 + hh / 2, 0);
  acc.add(box, m);
  box.dispose();
  const lip = bevelBox(w + 0.14, 0.09, d + 0.14, 0.02);
  lip.translate(0, 0.22 + hh + 0.045, 0);
  acc.add(lip, m);
  lip.dispose();

  // --- the door: a recessed frame, two hinges and a lever handle ---------
  const dw = w * 0.62, dh = hh * 0.78;
  for (const [a, b] of [
    [[-dw / 2, 0.30], [dw / 2, 0.30]], [[-dw / 2, 0.30 + dh], [dw / 2, 0.30 + dh]],
    [[-dw / 2, 0.30], [-dw / 2, 0.30 + dh]], [[dw / 2, 0.30], [dw / 2, 0.30 + dh]],
  ] as [number, number][][]) {
    tubeInto(acc, m, a[0], a[1], d / 2 + 0.012, b[0], b[1], d / 2 + 0.012, 0.030, 4);
  }
  for (const y of [0.30 + dh * 0.20, 0.30 + dh * 0.80]) {
    const hinge = plainBox(0.08, 0.14, 0.09);
    hinge.translate(-dw / 2, y, d / 2 + 0.045);
    acc.add(hinge, m);
    hinge.dispose();
  }
  tubeInto(acc, m, dw / 2 - 0.12, 0.30 + dh * 0.5, d / 2 + 0.04,
    dw / 2 - 0.12, 0.30 + dh * 0.5 - 0.22, d / 2 + 0.04, 0.022, 5);

  // --- service loop: conduit up the flank into a gland on the roof -------
  // A cabinet with nothing entering it is a box. This is the eight triangles
  // that make it equipment.
  tubeInto(acc, m, w / 2 + 0.05, 0.24, -d * 0.28, w / 2 + 0.05, 0.22 + hh * 0.88, -d * 0.28, 0.035, 5);
  tubeInto(acc, m, w / 2 + 0.05, 0.22 + hh * 0.88, -d * 0.28, w * 0.22, 0.22 + hh + 0.12, -d * 0.28, 0.035, 5);
  const stack = plainBox(0.16, 0.26, 0.16);
  stack.translate(w * 0.22, 0.22 + hh + 0.20, -d * 0.28);
  acc.add(stack, m);
  stack.dispose();

  // --- the louvre bank: SEVEN SLATS, AND IT IS ON ITS OWN MATERIAL -------
  // The value break is the object. A cabinet whose vent is painted on is the
  // same untextured cube with a decal; a raked slat stack catches the key on
  // seven separate edges and goes to full black between them, which is a
  // legible mark at 80 m and the only part of this that survives thumbnail.
  const bw = w * 0.30;
  for (let k = 0; k < 7; k++) {
    const sl = plainBox(bw, 0.055, 0.10);
    sl.translate(-w * 0.28, 0.42 + k * 0.13, d / 2 + 0.03);
    sl.rotateX(-0.42);
    lAcc.add(sl, m);
    sl.dispose();
  }
  const body = acc.build()!;
  const louvre = lAcc.build()!;
  body.computeBoundingSphere();
  louvre.computeBoundingSphere();
  return { body, louvre };
}

/**
 * CABLE DRUM — 4 m of wound mag-conduit on a bolted cradle.
 *
 * The eclipse's near field is otherwise entirely rectilinear: portal legs,
 * truss bays, cabinets, deck plate. One curved silhouette per section is what
 * stops a run of frames reading as a single extruded corridor, and a drum is
 * the cheapest curve on an industrial site that nobody has to be told the
 * purpose of. It stands 2.4 m tall, which puts the whole object inside the
 * edge line-light's useful radius when it is parked at the deck edge — so in the dark it is a
 * lit disc against a black field, which is a shape, where the same mass at
 * gantry height would be nothing.
 */
export function cableDrumGeo(r = 1.2, w = 1.6): THREE.BufferGeometry {
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  // two flanges and the wound spool between them, axis along local X so the
  // caller parks it broadside to the corridor
  for (const sx of [-1, 1]) {
    const fl = new THREE.CylinderGeometry(r, r, 0.09, 18);
    fl.rotateZ(Math.PI / 2);
    fl.translate(sx * w * 0.5, r, 0);
    acc.add(fl, m);
    fl.dispose();
    // six spokes cut into each flange face — the mark that says "drum" at 40 m
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      tubeInto(acc, m, sx * (w * 0.5 + 0.05), r, 0,
        sx * (w * 0.5 + 0.05), r + Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, 0.045, 4);
    }
  }
  const spool = new THREE.CylinderGeometry(r * 0.66, r * 0.66, w - 0.14, 16);
  spool.rotateZ(Math.PI / 2);
  spool.translate(0, r, 0);
  acc.add(spool, m);
  spool.dispose();
  // the cable itself, four visible turns proud of the spool
  for (let k = 0; k < 4; k++) {
    const t = new THREE.TorusGeometry(r * 0.70 + k * 0.008, 0.05, 5, 20);
    t.rotateY(Math.PI / 2);
    t.translate((k - 1.5) * 0.14, r, 0);
    acc.add(t, m);
    t.dispose();
  }
  // --- the cradle. A 4 m drum standing on nothing is a wheel. -------------
  for (const sx of [-1, 1]) {
    const saddle = bevelBox(0.20, r * 0.55, r * 1.5, 0.03);
    saddle.translate(sx * (w * 0.5 + 0.16), r * 0.275, 0);
    acc.add(saddle, m);
    saddle.dispose();
    const foot = bevelBox(0.40, 0.06, r * 1.7, 0.015);
    foot.translate(sx * (w * 0.5 + 0.16), 0.03, 0);
    acc.add(foot, m);
    foot.dispose();
    boltRingInto(acc, m, sx * (w * 0.5 + 0.16), 0.065, 0, 0, 1, 0, r * 0.62, 4, 0.030);
  }
  // the axle, through both saddles, because a drum with no axle is two discs
  tubeInto(acc, m, -(w * 0.5 + 0.30), r, 0, w * 0.5 + 0.30, r, 0, 0.075, 6);
  const g = acc.build()!;
  g.computeBoundingSphere();
  return g;
}
