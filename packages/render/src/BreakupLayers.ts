/**
 * ============================================================================
 *  BreakupLayers.ts — the three optional layers `applyBreakup` takes as slots,
 *  emitted here instead of in a game.
 * ============================================================================
 *  `./MaterialBreakup.ts` holds the assembly and the chunks both racers derive
 *  identically. Its header lists four things it deliberately left in the games
 *  because they were "a FORMULA rather than a feature", and three of the four
 *  had exactly one caller between them:
 *
 *    · the world-space cell layer (`BreakupOpts.worldCells`)
 *    · analytic panelisation (`BreakupOpts.joints`)
 *    · the tunable settle (`BreakupOpts.settleMip` / `settleVary`)
 *
 *  All three OPTIONS were already declared over there; only the GLSL that reads
 *  them was elsewhere. That is not a seam, it is half a move — an option in a
 *  package whose emitter is in a game is an option no second game can reach,
 *  and the measure of it is that `worldCells` was documented in `BreakupOpts`
 *  while no other game could have switched it on.
 *
 *  Not one line below names a deck, a bay, a circuit or a moon. The running
 *  bond is a fabrication convention, the screen-space line width is Nyquist,
 *  and the settle's mip is a number of mip levels. Every literal that IS about
 *  a particular world — the course height, the cut strength, the plate counts,
 *  the seam and bay weights, the mip and the mix — arrives in `BreakupOpts`
 *  from the call site, which is where this file's tuning has always lived.
 *
 *  THE FOURTH DIVERGENCE IS STILL A SEAM AND STILL STAYS ONE. `SPEC_AA_GEO` is
 *  a different picture in each racer — the kart racer adds a capped linear
 *  term, the space racer filters variance into α² — so `varianceSpecAAGeo()`
 *  below is a NAMED SECOND FORM a caller opts into, never a default and never a
 *  flag inside the assembly. Two things that genuinely differ: two names, one
 *  file, no merge.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';

import type { BreakupOpts, BreakupParts, BreakupSplice } from './MaterialBreakup.js';
import { applyBreakup, breakupParts } from './MaterialBreakup.js';
import { normalReliefClaim } from './NormalRelief.js';
import { varianceSpecAAClaim } from './VarianceSpecAA.js';

/**
 * The world-space cell layer. See `BreakupOpts.worldCells` for what it is for.
 *
 * NO TEXTURE FETCH. Twelve ALU and two derivatives, because this lands on
 * structure — which is 30–50 % of the pixels in most frames — and a fill budget
 * does not have a spare tap on that many of them. A baked field would also have
 * been WORSE, not just dearer: a 128² map magnified over 80 m makes every cell
 * boundary a bilinear ramp about a metre wide, so the cut arrives as a soft band
 * near and a smeared one far, which is the opposite of a fabricated joint.
 *
 * RUNNING BOND, NOT A GRID. A square lattice is the same tiling fail one scale
 * up, so each COURSE gets its own X phase and its own cell WIDTH (0.7–1.6×) from
 * a hash of the course index. That is also what a plate wall physically is: a
 * fabricator works to a standard course height and cuts the lengths to suit.
 * Course height stays constant on purpose — at a 20–30 m period there are three
 * courses on a 76 m wall, which is not a frequency the eye can lock onto.
 *
 * The cut width is `max( 96 mm of world, one pixel )`: a real reveal when you
 * are on top of it and a one-pixel line at the horizon, so it never fattens and
 * never aliases. It fades to NOTHING rather than to its own average once the
 * cells stop being resolvable, for the same reason the joints below do — a cut
 * line that smears out to a flat darkening at distance is indistinguishable
 * from aerial perspective, which is banned in vacuum.
 */
function cellChunks(celled: boolean): { SETUP: string; ALBEDO: string; ROUGH: string } {
  if (!celled) return { SETUP: '', ALBEDO: '', ROUGH: '' };
  return {
    SETUP: /* glsl */ `
          {
            vec2 kCp = kWorldPlane( vWorldP, uCells.x );
            float kRow = floor( kCp.y );
            vec3 kRh = kHash3( vec3( kRow, 5.1, 0.7 ) );
            kCp.x = ( kCp.x + kRh.x * 3.0 ) * ( 0.7 + kRh.y * 0.9 );
            gCell = kHash3( vec3( floor( kCp.x ), kRow, 3.3 ) ).z;
            vec2 kCf = min( fract( kCp ), 1.0 - fract( kCp ) );
            float kCw = max( fwidth( kCp.x ), fwidth( kCp.y ) ) * 1.2;
            // ...and it fades to NOTHING rather than to its own average once
            // the cells stop being resolvable, for the same reason the analytic
            // joints below do: a cut line that smears out to a flat darkening
            // at distance is indistinguishable from the aerial perspective
            // §5.6 bans outright.
            gCellCut = ( 1.0 - smoothstep( 0.0, max( 0.004, kCw ), min( kCf.x, kCf.y ) ) )
                     * ( 1.0 - smoothstep( 0.14, 0.34, kCw ) ) * uCells.y;
          }`,
    ALBEDO: /* glsl */ `
            sampledDiffuseColor.rgb *= ( 1.0 + ( gCell - 0.5 ) * 2.0 * uCells.z ) * ( 1.0 - gCellCut * 0.80 );`,
    ROUGH: '\n          roughnessFactor *= 1.0 + ( gCell - 0.5 ) * 2.0 * uCells.w + gCellCut * 0.35;',
  };
}

/**
 * Analytic panelisation. See `BreakupOpts.joints`.
 *
 * `kJD` is the distance to the nearest cell boundary in cell units, `kJW` the
 * screen-space size of one cell unit — so `kJD / kJW` is a distance in PIXELS
 * and `smoothstep` over it is a one-pixel antialiased line at every range.
 *
 * `kFade` is the part that is not optional: once the pitch falls below about
 * two pixels the line has to fade to NOTHING rather than to its own average, or
 * every distant surface acquires a uniform darkening that looks exactly like
 * aerial perspective. It fires at roughly 2.5 plates per pixel, which on a
 * 2.4 m plate is past 1.5 km.
 *
 * The SECOND period — `uJoint.w` against `vMapUv.y` alone — is the tile seam
 * itself, one per tile in V, and it is the one scale that must never settle: it
 * is the only ruler in frame that tells the eye how big one cell is. Both terms
 * are weighted toward the far field, because a baked joint has real relief and
 * a real lip and must keep the near field to itself.
 */
function jointChunks(jointed: boolean): { MAP_PRE: string; ALBEDO: string; ROUGH: string } {
  if (!jointed) return { MAP_PRE: '', ALBEDO: '', ROUGH: '' };
  return {
    MAP_PRE: /* glsl */ `
          {
            vec2 kJU = vMapUv * uJoint.xy;
            vec2 kJW = fwidth( kJU ) + 1e-5;
            vec2 kJD = 0.5 - abs( fract( kJU ) - 0.5 );
            float kFade = 1.0 - smoothstep( 0.18, 0.42, max( kJW.x, kJW.y ) );
            float kSeam = ( 1.0 - smoothstep( 0.0, 1.1, min( kJD.x / kJW.x, kJD.y / kJW.y ) ) ) * kFade;
            // The 9.60 m expansion bay is the tile seam itself — one per tile in
            // V — and it is the one scale §12/C7 says must never settle, because
            // it is the only ruler in frame that tells the eye whether a cell is
            // 2.4 m or 12 m.
            float kBW = fwidth( vMapUv.y ) + 1e-5;
            float kBD = 0.5 - abs( fract( vMapUv.y ) - 0.5 );
            float kBay = ( 1.0 - smoothstep( 0.0, 2.4, kBD / kBW ) )
                       * ( 1.0 - smoothstep( 0.10, 0.30, kBW ) );
            // Weighted toward the far field: the baked joint has real relief and
            // a real lip and must keep the near field to itself.
            gJoint = ( kSeam * uJoint.z + kBay * uJoint.w ) * ( 0.26 + 0.74 * gSettle );
          }`,
    ALBEDO: '\n            sampledDiffuseColor.rgb *= 1.0 - gJoint * 0.55;',
    ROUGH: '\n          roughnessFactor *= 1.0 + gJoint * 0.42;',
  };
}

/**
 * The settled roughness, read from the map at `settleMip` rather than collapsed
 * to the `settleRough` scalar. NEVER A SCALAR — see `BreakupOpts.settleVary`.
 *
 * Two things about the shape of this block are deliberate. It is emitted only
 * for materials that actually asked for a settle, because it costs a second
 * fetch of the roughness map and the majority of the frame's pixels are on
 * materials whose ramp starts at 120–140 m. And the fetch sits inside a
 * `gSettle > 0` branch, which is coherent across whole screen regions (the ramp
 * is a function of view distance alone), so the near field skips it for the
 * entire wave rather than per thread. `textureLod` is safe in non-uniform control
 * flow — the LOD is explicit, so no derivative is required.
 */
function settleRoughChunk(settles: boolean): string {
  if (!settles) return '';
  return /* glsl */ `
          if ( gSettle > 0.003 ) {
            float kSettleR = mix(
              uSettle.z,
              roughness * textureLod( roughnessMap, vRoughnessMapUv + gUvJit, uSettleB.x ).g,
              uSettleB.y );
            roughnessFactor = mix( roughnessFactor, kSettleR, gSettle );
          }`;
}

/**
 * Kaplanyan variance filtering as an `applyBreakup` SPEC_AA_GEO slot.
 *
 * ===========================================================================
 *  THIS IS THE SECOND OF TWO GEOMETRIC SPEC-AA FORMS AND THEY DO NOT MERGE.
 *  The kart racer's is `roughness += min( 1.6σ, 0.42 )`. Handing either game
 *  the other's compiles, passes, and quietly renders one game like the other.
 *  Callers name the one they want.
 * ===========================================================================
 *
 * Runs OUTSIDE the tangent-space block, on the final shading normal, so it fires
 * on geometry with no normal map at all — a thin painted rail read across two
 * pixels aliases on its own curvature.
 *
 * WHY QUADRATIC AND WHY NO CAP. The linear-and-capped form is wrong at both
 * ends that matter:
 *
 *   · A 0.34 m truss diagonal at 200 m is a tenth of a pixel wide, so the
 *     shading normal swings the better part of 180° INSIDE one pixel and σ
 *     measures ~2. The honest answer there is that the pixel is not looking at
 *     a mirror at all, it is looking at the whole lobe of a cylinder, and its
 *     average is near-Lambertian. A cap at +0.42 lands a 0.24 floor at 0.66,
 *     where D_GGX still peaks near 0.72 — under a strong key at the grazing
 *     incidence a racing camera meets a vertical chord at, comfortably over a
 *     bloom threshold. That is the saturated white ribbon with the halo.
 *   · A resolved, gently curved 0.9 m chord at 30 m measures σ ≈ 0.1, and a
 *     LINEAR term hands it +0.16 of roughness it has not earned — softening the
 *     chamfer specular on the geometry that was rendering correctly.
 *
 * Kaplanyan's filtering is the standard answer and it is quadratic: normal
 * variance adds to the roughness SQUARED, i.e. to the GGX α, not to roughness.
 * α'² = α² + 2σ². That is invisible at σ = 0.1 (+0.05 roughness on a 0.42 base)
 * and total at σ = 2 (α' saturates, roughness → 1, D peaks at 0.32). No
 * arbitrary cap is needed because α ≤ 1 is the natural one, and it is the
 * physically correct ceiling rather than a taste value.
 *
 * `gSpecVar` keeps its meaning — roughness ADDED — because the clearcoat patch
 * and `injectEnvSpecClamp` both read it as a "how sub-pixel is this fragment"
 * signal rather than as a variance.
 */
export function varianceSpecAAGeo(specAA: boolean): string {
  if (!specAA) return '';
  return /* glsl */ `
          {
            vec3 kNDxy = max( abs( dFdx( normal ) ), abs( dFdy( normal ) ) );
            float kSig = max( max( kNDxy.x, kNDxy.y ), kNDxy.z ) * uSpecAA;
            float kAlpha = roughnessFactor * roughnessFactor;
            float kFiltered = sqrt( min( 1.0, kAlpha + 2.0 * kSig * kSig ) );
            gSpecVar = kFiltered - roughnessFactor;
            roughnessFactor = kFiltered;
          }`;
}

/**
 * The three layers assembled into one `BreakupSplice`, ready for `applyBreakup`.
 *
 * Exported separately from `applyLayeredBreakup` so a caller that wants these
 * layers AND a fifth chunk of its own can spread this and add to it. Every
 * emitted byte is a function of `o` alone, which is what makes a parity probe
 * able to prove an option is live: change `worldCells.period` and the cache key
 * changes, change `settleVary` and the shader text changes.
 */
export function breakupLayers(o: BreakupOpts, p: BreakupParts): BreakupSplice {
  const settleMip = o.settleMip ?? 5.5;
  const uSettleB = { value: new THREE.Vector2(settleMip, o.settleVary ?? 0.6) };
  const cells = o.worldCells;
  const uCells = {
    value: new THREE.Vector4(
      cells?.period ?? 24,
      cells?.cut ?? 0.55,
      cells?.tint ?? 0.10,
      cells?.rough ?? 0.16,
    ),
  };
  const joints = o.joints;
  const uJoint = {
    value: new THREE.Vector4(
      joints?.[0] ?? 0, joints?.[1] ?? 0, joints?.[2] ?? 0, joints?.[3] ?? 0,
    ),
  };
  const celled = !!cells;
  const jointed = !!joints && (joints[2] !== 0 || joints[3] !== 0);

  const cell = cellChunks(celled);
  const joint = jointChunks(jointed);

  return {
    uniforms: { uSettleB, uCells, uJoint },
    COMMON:
      'uniform vec2 uSettleB;\nuniform vec4 uCells;\nuniform vec4 uJoint;\n'
      + 'float gCell = 0.5;\nfloat gCellCut = 0.0;\nfloat gJoint = 0.0;\n',
    SETUP: cell.SETUP,
    MAP_PRE: joint.MAP_PRE,
    // A 906 m hull was measured resolving to one flat colour past the ramp, so
    // both halves of the settle became tunable here and stayed a literal in the
    // kart racer. The note travels with the number it explains.
    SETTLE_NOTE:
      '\n            // settle: past the ramp the fine octave is replaced by a LOW mip of'
      + '\n            // itself, so the far field resolves cleanly instead of crawling —'
      + '\n            // three levels, not five and a half. See BreakupOpts.settleMip.',
    SETTLE_LOD: 'uSettleB.x',
    ALBEDO_A: cell.ALBEDO,
    ALBEDO_B: joint.ALBEDO,
    SETTLE_ROUGH: settleRoughChunk(p.settles),
    ROUGH_A: cell.ROUGH,
    ROUGH_B: joint.ROUGH,
    SPEC_AA_GEO: varianceSpecAAGeo(p.specAA),
    // The two layers the kart racer has never had, plus the settle mip: all
    // three change the emitted text, so all three have to reach the program
    // cache key — see the note on `customProgramCacheKey` in
    // ./MaterialBreakup.ts.
    key: `_${celled ? 1 : 0}${jointed ? 1 : 0}_${settleMip}`,
  };
}

/**
 * `applyBreakup` plus the three layers above and the two anchor claims they
 * make necessary.
 *
 * THE CLAIMS ARE SYNCHRONOUS AND THAT IS THE WHOLE POINT. Both registers are
 * WeakSets held by identity in `./VarianceSpecAA.ts` and `./NormalRelief.ts`,
 * and both guard an ANCHOR this splice consumes:
 *
 *   · `SPEC_AA_GEO` above filters variance into roughness, so a later
 *     `addVarianceSpecAA` on the same material would install a second,
 *     competing filter.
 *   · the tangent-space block re-authors `<normal_fragment_maps>`, so a later
 *     `addNormalRelief` aimed at that anchor finds the include already gone and
 *     is a silent no-op — the exact failure class this repo has paid for twice.
 *
 * They are claimed the moment the OPTION is seen rather than when the hook
 * compiles, because a material sweep runs long before any of these shaders is
 * built and a set populated at compile time would let it double up. Relief is
 * also not NEEDED here: this splice's own spec-AA eases relief with the tile's
 * authored numbers, which is strictly better information than a generic slope
 * clamp has.
 */
export function applyLayeredBreakup(mat: THREE.Material, o: BreakupOpts): void {
  const p = breakupParts(o);
  if (p.specAA) varianceSpecAAClaim.add(mat);
  if (p.jitters || p.settles || p.specAA || (o.macroNormal ?? 0) > 0) normalReliefClaim.add(mat);
  applyBreakup(mat, o, p, breakupLayers(o, p));
}
