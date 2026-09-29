/**
 * ============================================================================
 *  Spine — a long structural hull, and the torn edge where one ends.
 * ============================================================================
 *  `spineShellGeo` builds a segmented shell along a run: bays, bands and
 *  plating that stay legible from a kilometre away and still have something to
 *  look at up close. `cutEdgeGeo` is the other half of the same idea — the
 *  ragged, peeled edge where a hull has been cut or torn, so a structure can
 *  END rather than simply stopping at a flat cap.
 *
 *  A FLAT CAP IS THE TELL. Anything long enough to need this file is long
 *  enough that the eye will find its ends, and a clean rectangular termination
 *  reads as "the model stopped here" instantly. That is the whole reason
 *  `cutEdgeGeo` is a generator with a seed rather than a plane.
 *
 *  PUBLISHED, NOT DE-DUPLICATED. See `Village.ts`'s header.
 */
import * as THREE from 'three';
import { bevelBox } from '@homie-rocks/geom/prim.js';
import { GeoAccum } from '@homie-rocks/geom/accum.js';
import { tubeInto } from '@homie-rocks/geom/tube.js';
import { mulberry32 } from '@homie-rocks/noise/Noise.js';
import { BAY } from './Truss.ts';

/**
 * A cut scaffold edge — the lip of a removed hull section, and every place a
 * plate was torched through rather than finished.
 *
 * The teeth are what says CUT. A straight edge on a 165 m gap reads as
 * designed, and the point of the edge is that a hull section was removed and
 * never replaced.
 */
export function cutEdgeGeo(len: number, depth = 1.4, seed = 7): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const P: number[] = [], N: number[] = [], UV: number[] = [], I: number[] = [];
  const n = Math.max(8, Math.round(len / 0.8));
  for (let i = 0; i <= n; i++) {
    const z = (i / n) * len;
    const bite = (0.35 + rng() * 0.65) * depth;
    P.push(0, 0, z, 0, -bite, z);
    N.push(0, 0, -1, 0, 0, -1);
    UV.push(z / 2, 0, z / 2, bite / 2);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    I.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

/**
 * ===========================================================================
 *  A FAR-FIELD TIER OF AN UNFINISHED RING. NO BLOCK IN HERE IS A PLAIN
 *  VERTICAL RECTANGLE, AND THAT IS THE POINT OF THE WHOLE GENERATOR.
 * ===========================================================================
 *  A review of the earlier version of this object found not that it was too
 *  bright — that is fixed in the material, by `patchValueCeiling` — but that
 *  at THAT value and THIS silhouette it read unmistakably as a night city
 *  skyline of office blocks: a neon-arcology look the art direction had
 *  explicitly rejected, arriving as GEOMETRY rather than as lighting. That is
 *  the worst way for a rejected look to come back, because nobody looking at
 *  the light budget would ever find it.
 *
 *  The previous generator emitted, per block, one flat-topped rectangular
 *  prism of full height standing on the datum, at a jittered but roughly
 *  constant pitch, with a vertical tie down its face. Sixteen of those in a
 *  receding row IS a skyline; the jitter only changed which skyline.
 *
 *  So the block is now one of THREE ARCHETYPES chosen from the seed, and none
 *  of the three has a vertical rectangle in its profile:
 *
 *   · OPEN BAY (`0`) — a bare box-truss run: four chords, end frames, Warren
 *     diagonals, and a cantilevered outrigger reaching out over nothing with
 *     the sky visible straight through the whole assembly. This is the one
 *     that does the most work, because a block that is 80 % sky cannot read as
 *     a building at any value.
 *   · HALF-CLAD (`1`) — plate over the lower part of a frame, open bays above
 *     it, a top chord across the opening and a ribbed stiffener rhythm at the
 *     18 m truss-bay pitch so the silhouette has internal rhythm rather than
 *     being one value with a stripe. The clad band never reaches the top, so
 *     the profile terminates in an open frame, never in a flat roof.
 *   · SKY BRACE (`2`) — a raking diagonal that crosses the gap to the next
 *     block entirely above the datum, plus a battered stub tower. This is the
 *     archetype that makes the run read as ONE STRUCTURE under construction
 *     rather than as a row of separate objects, and a diagonal crossing the
 *     sky gap is the single most un-architectural mark available.
 *
 *  Run-length structure on top of that: heights hold for 2–4 blocks and then
 *  STEP, and every third run is dropped below the datum, so the tier has a
 *  silhouette instead of a period. A regular period is a comb, and a comb at
 *  architectural scale is worse than one at texture scale because the eye
 *  reads it as intent.
 *
 *  The budget is still "low-poly shells carrying SDF and POM detail": members
 *  are 3- and 4-sided, there are no bolt rings out here, and the whole tier is
 *  one merged draw. What the budget does not license is a shape that is
 *  wrong, and a solid prism is the wrong shape for a ring that is 40 % clad
 *  and under construction.
 */
export function spineShellGeo(len: number, w: number, h: number, seed = 3): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const acc = new GeoAccum();
  const m = new THREE.Matrix4();
  // 60 m blocks on the near tier; the far ones are bigger and fewer, because
  // at 2.9 km a 60 m block is under a degree of arc and 100 of them is a comb
  // again by a different route.
  const pitchNom = Math.max(60, w * 0.55);
  const bays = Math.max(4, Math.round(len / pitchNom));
  const uvOff = new THREE.Vector2();
  const tint = new THREE.Color();

  // Member sections, scaled off the tier's cross-section. A 150 m block whose
  // chords are 0.9 m has no chords at 520 m; these are the ring's own primary
  // structure, not a deck truss, so they are metres across.
  const chordR = Math.max(1.6, w * 0.030);
  const diagR = chordR * 0.55;

  /** Four chords, end frames and Warren diagonals over one bay of the run. */
  const trussInto = (x0: number, y0: number, z0: number, ww: number, hh: number, ln: number,
    col: THREE.Color, uv: THREE.Vector2) => {
    const hx = ww / 2, hy = hh / 2;
    const cor: [number, number][] = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
    const sub = acc;
    for (const [cx, cy] of cor) {
      tubeInto(sub, m, x0 + cx, y0 + cy, z0, x0 + cx, y0 + cy, z0 + ln, chordR, 4, col);
    }
    for (const z of [z0, z0 + ln]) {
      for (let k = 0; k < 4; k++) {
        const a = cor[k], b = cor[(k + 1) & 3];
        tubeInto(sub, m, x0 + a[0], y0 + a[1], z, x0 + b[0], y0 + b[1], z, diagR, 3, col);
      }
    }
    // Warren bracing on the two faces the camera can see, alternating sense so
    // the run never presents a repeating chevron
    const nd = 2;
    for (const f of [0, 2]) {
      const a = cor[f], b = cor[(f + 1) & 3];
      for (let d = 0; d < nd; d++) {
        const za = z0 + (d / nd) * ln, zb = z0 + ((d + 1) / nd) * ln;
        const up = (d + f) & 1;
        tubeInto(sub, m,
          x0 + (up ? a[0] : b[0]), y0 + (up ? a[1] : b[1]), za,
          x0 + (up ? b[0] : a[0]), y0 + (up ? b[1] : a[1]), zb, diagR, 3, col);
      }
    }
    void uv;
  };

  let z = 0;
  // run-length height structure: hold a height for 2–4 blocks, then step
  let runLeft = 0, runH = h, runDrop = 0, runIdx = 0;
  let prevTopY = 0, prevTopX = 0, prevZ = 0, hasPrev = false;

  for (let k = 0; k < bays && z < len; k++) {
    if (runLeft <= 0) {
      runLeft = 2 + ((rng() * 3) | 0);
      // the step is a real step, not a jitter: 0.42–1.0 of the tier height
      runH = h * (0.42 + rng() * 0.58);
      // every third run hangs BELOW the datum, so the tier's baseline is not a
      // ruled line either — an unfinished ring has runs that were never lifted
      runDrop = (runIdx % 3 === 2) ? -h * (0.20 + rng() * 0.34) : 0;
      runIdx++;
    }
    runLeft--;

    const pitch = pitchNom * (0.84 + rng() * 0.34);
    const bl = pitch * (0.60 + rng() * 0.26);
    const hh = runH * (0.90 + rng() * 0.20);
    const ww = w * (0.70 + rng() * 0.34);
    const xoff = (rng() - 0.5) * w * 0.34;
    const yBase = runDrop;
    tint.setScalar(0.93 + rng() * 0.14);
    uvOff.set(rng() * 37.0, rng() * 41.0);

    const kind = (rng() * 3) | 0;

    if (kind === 0) {
      // ---- OPEN BAY: bare box truss, plus a cantilevered outrigger ---------
      // Split vertically into 2–3 stacked truss runs rather than one tall box,
      // so the profile has internal joints and the sky shows between them.
      const decks = 2 + ((rng() * 2) | 0);
      for (let d = 0; d < decks; d++) {
        const dh = hh / decks * (0.44 + rng() * 0.24);
        const dy = yBase + (d + 0.5) * (hh / decks);
        trussInto(xoff, dy, z, ww * (0.72 + rng() * 0.3), dh, bl, tint, uvOff);
      }
      // the cantilever: an outrigger reaching sideways over nothing, tied back
      // by a raking hanger. It is the mark that says "crane road", and it is
      // the one thing a building never has.
      const cy = yBase + hh * (0.55 + rng() * 0.3);
      const reach = ww * (0.55 + rng() * 0.5) * (rng() < 0.5 ? -1 : 1);
      tubeInto(acc, m, xoff, cy, z + bl * 0.5, xoff + reach, cy - hh * 0.06, z + bl * 0.5, chordR * 0.8, 4, tint);
      tubeInto(acc, m, xoff + reach, cy - hh * 0.06, z + bl * 0.5,
        xoff, cy + hh * 0.30, z + bl * 0.5, diagR, 3, tint);
      // and one clad panel hung off it, so the run is not uniformly open
      const hung = bevelBox(Math.abs(reach) * 0.42, hh * 0.16, bl * 0.34, 0.9);
      hung.translate(xoff + reach * 0.66, cy - hh * 0.16, z + bl * 0.5);
      acc.add(hung, m, tint.clone().multiplyScalar(0.88), undefined, uvOff);
      hung.dispose();
    } else if (kind === 1) {
      // ---- HALF-CLAD: plate low, open frame above, never a flat roof -------
      const cladH = hh * (0.34 + rng() * 0.26);
      const skin = bevelBox(ww, cladH, bl, Math.min(ww, cladH) * 0.035);
      skin.translate(xoff, yBase + cladH / 2, z + bl / 2);
      acc.add(skin, m, tint, undefined, uvOff);
      skin.dispose();
      // LONGITUDINAL RIBBED STIFFENERS at the 18 m truss-bay pitch.
      // This is the internal rhythm that makes an 88 m pressure bay read as
      // 88 m instead of as a smooth extrusion, and it is the detail band
      // a megastructure usually has nothing in.
      const ribN = Math.max(2, Math.round(bl / BAY));
      for (let r = 0; r < ribN; r++) {
        const rz = z + (r + 0.5) * (bl / ribN);
        const rib = bevelBox(ww * 1.03, cladH * 0.10, 1.1, 0.3);
        rib.translate(xoff, yBase + cladH * (0.22 + (r % 2) * 0.44), rz);
        acc.add(rib, m, tint.clone().multiplyScalar(1.06), undefined,
          new THREE.Vector2(uvOff.x + 7.0, uvOff.y + 3.0));
        rib.dispose();
      }
      // open bays above the clad band: two columns and a top chord, with the
      // sky straight through the middle
      const openH = hh - cladH;
      for (const sx of [-1, 1]) {
        tubeInto(acc, m, xoff + sx * ww * 0.44, yBase + cladH, z + bl * 0.18,
          xoff + sx * ww * 0.44, yBase + hh, z + bl * 0.18, chordR, 4, tint);
        tubeInto(acc, m, xoff + sx * ww * 0.44, yBase + cladH, z + bl * 0.82,
          xoff + sx * ww * 0.44, yBase + hh, z + bl * 0.82, chordR, 4, tint);
      }
      tubeInto(acc, m, xoff - ww * 0.5, yBase + hh, z + bl * 0.18,
        xoff + ww * 0.5, yBase + hh, z + bl * 0.18, chordR, 4, tint);
      tubeInto(acc, m, xoff - ww * 0.5, yBase + hh, z + bl * 0.82,
        xoff + ww * 0.5, yBase + hh, z + bl * 0.82, chordR, 4, tint);
      // an X across the open bay, which is what stops the opening reading as a
      // window and therefore stops the block reading as a facade
      tubeInto(acc, m, xoff - ww * 0.44, yBase + cladH, z + bl * 0.18,
        xoff + ww * 0.44, yBase + hh, z + bl * 0.82, diagR, 3, tint);
      tubeInto(acc, m, xoff + ww * 0.44, yBase + cladH, z + bl * 0.82,
        xoff - ww * 0.44, yBase + hh, z + bl * 0.18, diagR, 3, tint);
      // TORCH-CUT TOP on the clad band itself: this bay was cut back and never
      // finished. The ring is 40 % clad, so an unfinished edge is the
      // honest variant rather than a decoration.
      if (rng() < 0.55) {
        const teeth = Math.max(3, Math.round(bl / 11));
        for (let t = 0; t < teeth; t++) {
          const bite = cladH * (0.06 + rng() * 0.14);
          const seg = bevelBox(ww * 0.99, bite, (bl / teeth) * 0.9, Math.min(bite, 3) * 0.2);
          seg.translate(xoff, yBase + cladH + bite / 2, z + (t + 0.5) * (bl / teeth));
          acc.add(seg, m, tint.clone().multiplyScalar(0.80), undefined, uvOff);
          seg.dispose();
        }
      }
    } else {
      // ---- SKY BRACE: a battered stub, and a diagonal across the gap -------
      // Battered = the tower leans, so its two vertical edges are not parallel
      // and it cannot be read as a rectangle from any angle.
      const batter = ww * (0.16 + rng() * 0.22);
      const stubH = hh * (0.45 + rng() * 0.35);
      for (const sx of [-1, 1]) for (const sz of [0.2, 0.8]) {
        tubeInto(acc, m,
          xoff + sx * ww * 0.5, yBase, z + bl * sz,
          xoff + sx * (ww * 0.5 - batter), yBase + stubH, z + bl * sz,
          chordR, 4, tint);
      }
      for (let d = 0; d < 3; d++) {
        const f0 = d / 3, f1 = (d + 1) / 3;
        tubeInto(acc, m,
          xoff - ww * 0.5 + batter * f0, yBase + stubH * f0, z + bl * 0.2,
          xoff + ww * 0.5 - batter * f1, yBase + stubH * f1, z + bl * 0.8,
          diagR, 3, tint);
      }
      // a platform slung between the legs — 0.5–2 m detail on a 150 m object
      const plat = bevelBox(ww * 0.86, stubH * 0.05, bl * 0.5, 0.6);
      plat.translate(xoff, yBase + stubH * 0.58, z + bl * 0.5);
      acc.add(plat, m, tint.clone().multiplyScalar(1.04), undefined, uvOff);
      plat.dispose();
      // THE BRACE ITSELF, crossing the sky gap to the previous block's top.
      // This is what welds the run into one structure and it is the mark that
      // is impossible to read as architecture.
      if (hasPrev) {
        tubeInto(acc, m, prevTopX, prevTopY, prevZ,
          xoff + ww * 0.3, yBase + stubH * 0.92, z + bl * 0.25, chordR * 0.9, 4,
          tint.clone().multiplyScalar(0.9));
        tubeInto(acc, m, prevTopX, prevTopY - h * 0.10, prevZ,
          xoff - ww * 0.3, yBase + stubH * 0.55, z + bl * 0.25, diagR, 3,
          tint.clone().multiplyScalar(0.9));
      }
      prevTopY = yBase + stubH * 0.92; prevTopX = xoff; prevZ = z + bl * 0.75;
      hasPrev = true;
      z += pitch;
      continue;
    }

    // A SPLICE BAND at every block joint. Two shells butting with no joint is
    // one extruded tube; the band is proud of the face so it catches the key
    // as its own value.
    const band = bevelBox(ww * 1.03, Math.max(1.4, hh * 0.05), 1.2, 0.35);
    band.translate(xoff, yBase + hh * (0.30 + rng() * 0.45), z + bl);
    acc.add(band, m, tint.clone().multiplyScalar(1.05), undefined, uvOff);
    band.dispose();

    prevTopX = xoff; prevTopY = yBase + hh * 0.9; prevZ = z + bl * 0.75;
    hasPrev = true;
    z += pitch;
  }
  const g = acc.build()!;
  g.computeBoundingSphere();
  return g;
}
