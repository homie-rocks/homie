/**
 * ============================================================================
 *  translucentskin.ts — glazing that has a silhouette, and a deposit that has
 *  an angle of repose.
 * ============================================================================
 *
 * Two injections on one standard material, installed together because they
 * write the same two outputs — `roughnessFactor` and `diffuseColor.a` — from
 * two different anchors, and a caller that took one without the other would
 * find the second silently winning.
 *
 * ---------------------------------------------------------------------------
 *  1. THE FRESNEL SKIN, AND WHY A FLAT ALPHA IS A BUG RATHER THAN A STYLE
 * ---------------------------------------------------------------------------
 * An unlit dielectric at a constant opacity, composited over a DARK ground,
 * draws almost nothing. Whatever is opaque inside it — ribs, frames, a deck —
 * survives, so the object dissolves and leaves its skeleton: "a row of
 * disconnected black hoops with nothing between them". The reflex diagnosis is
 * backface culling and it is wrong; the material was being drawn, and it was
 * drawing a few code values.
 *
 * Real glazing is not flat. A cylinder or a dome seen from outside is nearly
 * clear face-on and nearly opaque at the grazing silhouette — which is exactly
 * where its outline is. So alpha runs from the authored value face-on up toward
 * opaque at the rim, and the object always has a drawn edge against whatever is
 * behind it while its interior still reads through.
 *
 * The emissive rides the SAME Fresnel term: a pressurised, lit interior seen
 * through its own skin is brightest where the skin is thickest along the view
 * ray, which is the rim. A flat interior glow reads as a light bulb; a
 * Fresnel-weighted one reads as a volume.
 *
 * **The view normal is rotated into world by `vec4( normal, 0.0 ) * viewMatrix`,
 * not dotted against a world vector directly.** three's `normal` at this point
 * is in VIEW space and the view direction assembled from `cameraPosition` is in
 * WORLD space; dotting them is a units mismatch that produces a plausible,
 * wrong, view-dependent rim and never errors.
 *
 * ---------------------------------------------------------------------------
 *  2. THE SETTLED DEPOSIT, AND WHY IT BELONGS ON A TRANSPARENT SURFACE
 * ---------------------------------------------------------------------------
 * The reflex is that transparent things have no surface. They do, and where
 * there is nothing to wash it off, whatever lands on the upward faces STAYS
 * there. The term buys three things at once from one physical cause: a real
 * spatial ROUGHNESS range on a surface that had a constant one, a real ALPHA
 * range — a deposit is opaque, so the crown stops being see-through and the
 * object gains a solid top edge — and an albedo pulled toward the colour of
 * whatever is settling.
 *
 * **It is a BAND, not a gradient, and the band is narrow.** A deposit has an
 * angle of repose: above it the material stays, below it slides. Widening the
 * threshold pair until it starts near the horizontal turns the whole object
 * opaque, because a camera looking DOWN on it sees mostly up-facing pixels.
 * That is the failure mode this pair of thresholds is fitted against, and it is
 * why they are the caller's: the angle is a property of the material settling
 * and the geometry it settles on.
 *
 * **Patchy along the run**, from two incommensurable sinusoids, so it reads as
 * deposit rather than as a painted stripe.
 *
 * ---------------------------------------------------------------------------
 *  ANCHORS — BOTH CHOSEN, NEITHER CONVENIENT
 * ---------------------------------------------------------------------------
 * The deposit is anchored at `<roughnessmap_fragment>`. Roughness is folded
 * into `material` inside `<lights_physical_fragment>`, and a write after that
 * point is a no-op that looks exactly like a working shader.
 *
 * It also reads `vWorldN`, NEVER three's `normal`: `normal` is declared by
 * `<normal_fragment_begin>`, which comes AFTER `<roughnessmap_fragment>`, so
 * naming it here is a hard compile failure — "'normal' : undeclared identifier"
 * — on every program carrying the material, and the object stops drawing
 * entirely. The world geometric normal is a varying and exists everywhere.
 *
 * The Fresnel is anchored at `<opaque_fragment>`, which is where
 * `totalEmissiveRadiance` and `diffuseColor.a` are still writable. three
 * renamed that chunk from `output_fragment` at r152; if a future version
 * renames it again the replace silently does nothing and the object goes back
 * to being invisible against a dark ground — a bug nobody would connect to a
 * dependency bump six months later. So the anchor is CHECKED and a miss is
 * counted and printed, not swallowed.
 *
 * ---------------------------------------------------------------------------
 *  WHAT THE CALLER OWNS
 * ---------------------------------------------------------------------------
 * Every number and the tint. The two thresholds are an angle of repose, the
 * roughness and alpha gains are how dirty the place is, the tint is what is
 * settling, and the Fresnel power is how hard the glazing's edge should be. A
 * default for any of them is how the next game inherits the last one's weather.
 *
 * The two clamp FLOORS are not the caller's and are stated here: roughness
 * bottoms at 0.035 because a perfect mirror is a specular singularity that
 * fireflies under any bright emitter, and alpha bottoms at 0.05 because a
 * surface at exactly zero alpha is skipped by some blend paths and its depth
 * write behaviour stops being predictable.
 */
import * as THREE from 'three';
import { WORLDN_PARS, WORLDN_VERTEX } from './LineLight.js';

/** A number as GLSL source; an integer still emits a float literal. */
function glslNum(v: number): string {
  const s = String(v);
  return s.indexOf('.') < 0 && s.indexOf('e') < 0 ? s + '.0' : s;
}

/** Patchiness along the run: two sinusoids at incommensurable rates. */
export interface DepositPatch {
  /** Floor of the first factor — how much deposit survives in a lean patch. */
  base: number;
  /** Amplitude of the first factor. `base + amp` is a full patch. */
  amp: number;
  /** Plan-space rates of the first sinusoid, cycles-ish per world unit. */
  rateX: number;
  rateZ: number;
  /** Floor and amplitude of the second, vertical factor. */
  base2: number;
  amp2: number;
  /** Rate of the second sinusoid in world Y. Deliberately not a multiple of the first. */
  rateY: number;
}

export interface DepositTune {
  /**
   * The angle of repose, as a pair of thresholds on the world normal's Y.
   * `lo` is where the deposit starts, `hi` where it is full. Squared after the
   * smoothstep so it is a band with a soft top rather than a linear ramp, which
   * is what a settled deposit actually looks like.
   */
  lo: number;
  hi: number;
  patch: DepositPatch;
  /** Roughness added at full deposit. */
  rough: number;
  /** Albedo is mixed toward this, by `tintAmount` at full deposit. */
  tint: readonly [number, number, number];
  tintAmount: number;
  /** Alpha added at full deposit — a deposit is opaque. */
  alpha: number;
}

export interface SkinFresnelTune {
  /** Grazing exponent. Higher is a narrower, harder rim. */
  power: number;
  /** Interior glow face-on, as a fraction of the glow uniform. */
  base: number;
  /** Extra glow at the rim, as a fraction of the glow uniform. */
  gain: number;
  /** Alpha added at the rim. */
  alpha: number;
}

export interface TranslucentSkinInstall {
  /**
   * The interior radiance, working colour space. A uniform rather than a
   * constant because it is usually driven by a day/night or power state.
   */
  glow: { value: THREE.Vector3 };
  /**
   * Shared with every other injector on the same material library. Two
   * patchers writing the same outputs from different anchors is the second one
   * winning silently, so the caller owns one set and hands it to all of them.
   */
  seen: WeakSet<THREE.Material>;
  /** Proof of execution. An anchor miss must be visible in a stats row. */
  counters: { injected: number; compiled: number; anchorMisses: number };
  /**
   * Program-cache discriminator. It carries a VERSION as well as an identity,
   * because a warm cache serving an old build's shader to a new build's
   * material is how a fix looks like it did not land.
   */
  key: string;
  /** Prefix on the two console errors, so a reader knows whose anchor rotted. */
  label: string;
  deposit: DepositTune;
  fresnel: SkinFresnelTune;
}

export function installTranslucentSkin(mat: THREE.Material, o: TranslucentSkinInstall): void {
  if (o.seen.has(mat)) return;
  o.seen.add(mat);
  o.counters.injected++;
  const d = o.deposit, p = d.patch, fr = o.fresnel;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSkinGlow = o.glow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WORLDN_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WORLDN_VERTEX);
    let f = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\n' + WORLDN_PARS + 'uniform vec3 uSkinGlow;\n',
    );
    {
      const rAnchor = '#include <roughnessmap_fragment>';
      if (f.indexOf(rAnchor) < 0) {
        o.counters.anchorMisses++;
        console.error('[' + o.label + '] deposit roughness anchor missing; the skin is uniform glass.');
      } else {
        f = f.replace(rAnchor, rAnchor + /* glsl */ `
        // vWorldN, NOT three's normal — see the header. normal is declared by
        // normal_fragment_begin, several chunks BELOW this one.
        vec3 mbDN = normalize( vWorldN );
        float mbDust = smoothstep( ${glslNum(d.lo)}, ${glslNum(d.hi)}, mbDN.y );
        mbDust *= mbDust;
        // Patchy along the run so it reads as deposit rather than as a painted
        // stripe: two sinusoids at rates that are not multiples of each other,
        // so the two never line up and the pattern has no visible period.
        mbDust *= ${glslNum(p.base)} + ${glslNum(p.amp)} * ( sin( vWorldP.x * ${glslNum(p.rateX)} + vWorldP.z * ${glslNum(p.rateZ)} ) * 0.5 + 0.5 )
                       * ( ${glslNum(p.base2)} + ${glslNum(p.amp2)} * ( sin( vWorldP.y * ${glslNum(p.rateY)} ) * 0.5 + 0.5 ) );
        // One physical cause, three outputs: a real spatial roughness range on
        // a surface that had a constant one, an albedo pulled toward whatever
        // is settling, and an alpha rise that gives the crown a solid edge.
        roughnessFactor = clamp( roughnessFactor + mbDust * ${glslNum(d.rough)}, 0.035, 1.0 );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( ${glslNum(d.tint[0])}, ${glslNum(d.tint[1])}, ${glslNum(d.tint[2])} ), mbDust * ${glslNum(d.tintAmount)} );
        diffuseColor.a = clamp( diffuseColor.a + mbDust * ${glslNum(d.alpha)}, 0.05, 1.0 );
        `);
      }
    }
    // MEASURE, DO NOT ASSUME. three renamed this chunk from output_fragment to
    // opaque_fragment at r152; a future rename makes the replace a silent
    // no-op and the object invisible against a dark ground again.
    const anchor = '#include <opaque_fragment>';
    if (f.indexOf(anchor) < 0) {
      o.counters.anchorMisses++;
      console.error('[' + o.label + '] skin fresnel anchor missing; the glazing has no silhouette.');
    } else {
      f = f.replace(anchor, /* glsl */ `
        {
          vec3 mbTV = normalize( cameraPosition - vWorldP );
          // View-space shading normal rotated into world. Dotting a view normal
          // against a world direction is a silent units mismatch.
          vec3 mbTN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
          float mbFres = pow( 1.0 - abs( dot( mbTV, mbTN ) ), ${glslNum(fr.power)} );
          totalEmissiveRadiance += uSkinGlow * ( ${glslNum(fr.base)} + ${glslNum(fr.gain)} * mbFres );
          diffuseColor.a = clamp( diffuseColor.a + mbFres * ${glslNum(fr.alpha)}, 0.05, 1.0 );
        }
      ` + '\n' + anchor);
      o.counters.compiled++;
    }
    shader.fragmentShader = f;
  };
  const key = o.key;
  mat.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(mat) + key
      : () => key;
}
