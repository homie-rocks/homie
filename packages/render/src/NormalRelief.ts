/**
 * ============================================================================
 *  NormalRelief.ts — a shading relief derived from the height already in the
 *  material, for surfaces whose normal map is too smooth to catch a raking key.
 * ============================================================================
 *
 *  Lifted out of a space racer's `Materials.ts`. Every argument is a
 *  slope limit, a texel resolution or a distance in metres; there is nothing in
 *  it that knows what is being shaded.
 *
 *  It keeps its own WeakSet, and the comment on that set is load-bearing:
 *  `injectBreakup` installs by REPLACING `<normal_fragment_maps>`, so a second
 *  `.replace` aimed at the same anchor finds nothing and quietly does nothing.
 *  That silent no-op has cost this codebase twice. The set is cheaper to reason
 *  about than an ordering argument, and it travels with the function.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';

/**
 * Materials whose `<normal_fragment_maps>` anchor has already been rewritten —
 * either by `injectBreakup` or by `addNormalRelief` itself. A second `.replace`
 * aimed at an include that is no longer there is the silent no-op this file has
 * paid for twice; a set is cheaper to reason about than an ordering argument.
 */
const _reliefed = new WeakSet<THREE.Material>();

export interface NormalReliefOpts {
  /**
   * Largest tangent-space SLOPE the map is allowed to deliver, i.e.
   * `length( mapN.xy ) / mapN.z` after `normalScale`. 0.45 is a 24° facet,
   * which is as far as a sintered deposit, a rolled grain or a ground seam
   * actually tips. Anything steeper than this on a surface that is nominally
   * flat is an authoring overshoot, not relief.
   */
  maxSlope?: number;
  /** Texels across the normal map, so the footprint can be measured in texels. */
  res: number;
  /**
   * Texels per screen pixel at which the relief starts fading to flat, and the
   * count at which it is gone. Past ~2 texels/pixel the sampler is returning a
   * mip average and the tilt it hands back is a fiction with no more information
   * in it than a roughness number.
   */
  fade?: [number, number];
}

/**
 * ===========================================================================
 *  THE BLACK-AND-WHITE CONFETTI ON THE GRIP STRIP AND THE BARRIERS. One
 *  review's most-repeated artefact — four separate findings, one mechanism.
 * ===========================================================================
 *  The reviewers call it "unfiltered noise", "point-sampled at or below one
 *  texel per pixel", "no mip chain". **It is none of those**, and the fix they
 *  ask for would not touch it. Crop the terminator capture at (620,60)+380×260
 *  and look: the pattern is COHERENT and fully RESOLVED — labyrinthine blobs
 *  10–30 px across, with clean anti-aliased boundaries. That is a mipped,
 *  anisotropically filtered texture doing exactly what it was told. What is
 *  binary is not the sampling, it is the LIGHTING RESPONSE:
 *
 *      TexLib.gripStrip writes  o[3] = g * 0.9  as its height field, and
 *      MatLib.grip mounts it at normalScale 3.2.
 *
 *  A unit-amplitude height at that normal scale puts a ±70° facet on a flat
 *  plate. Under the art direction's single 6.5° key at 40:1 with no ambient
 *  anywhere in the frame, a facet that tips 70° toward the star returns the
 *  full key and the facet beside it returns the planet fill and nothing else.
 *  There are no mid-tones available, so there are none in the image. It is a
 *  *diffuse* N·L failure, which is why `addSpecularAA` — correct, present, and
 *  already on those materials via `finishSurfaces` — does not and cannot touch
 *  it: it widens the specular lobe and the confetti is not specular.
 *
 *  So this clamps the SLOPE rather than filtering the lobe, and it does the one
 *  thing a mip chain genuinely cannot do for a normal map: three renormalises
 *  after `tbn * mapN`, which takes the mip's honestly-shortened average vector
 *  and stretches the tilt straight back out again. The averaging happens and is
 *  then undone. Both terms here survive that, because both act on `mapN.xy`
 *  before the normalize:
 *
 *   1. SLOPE CLAMP. `length( mapN.xy )` is the tangent of the facet angle.
 *      Rescale — never clip a component, which would rotate the facet's azimuth
 *      and put a directional bias into a field that has none — anything past
 *      `maxSlope` back to it.
 *   2. FOOTPRINT FADE. Measure texels per pixel from `fwidth( vNormalMapUv )`
 *      and ease the relief to zero across `fade`. This is the term that makes
 *      the standard deviation of a patch fall MONOTONICALLY with distance,
 *      which is the acceptance test the review asked for by name.
 *
 *  Both removals are conserved into roughness (Toksvig): a slope that is no
 *  longer tilting the normal is still sub-pixel structure, and the honest place
 *  for it is a wider lobe. Quadratic in α, the same convention as
 *  `SPEC_AA_GEO`, so the two compose instead of double-counting.
 *
 *  NOT A DISTANCE DARKENING, NOT A HAZE. It removes no energy and adds no
 *  colour; a converged fragment lands on the same albedo it always had, lit by
 *  the same key, with the surface normal it would have had if it were smooth —
 *  which is what it physically is at that range.
 *
 *  ANCHOR. Re-authors `<normal_fragment_maps>` the same way `injectBreakup`
 *  does, so it must never be applied to a material this file built (that one
 *  has already consumed the include and carries `SPEC_AA` doing the same job
 *  with the tile's own numbers). `_reliefed` enforces it from both sides.
 *
 *  COST: one `fwidth`, one `length`, two divides. No texture fetch.
 */
export function addNormalRelief(mat: THREE.Material, o: NormalReliefOpts): void {
  if (_reliefed.has(mat)) return;
  /*
   * SPLICE THE LIBRARY'S OWN CHUNK, DO NOT RE-AUTHOR IT. This injection lands
   * on materials from another module, so it must not quietly delete the
   * object-space, packed and bump branches of the stock chunk on the way past —
   * and `#include` is not expanded yet at `onBeforeCompile` time, so the only
   * way to keep them is to bring the text in and edit one line of it. Same
   * technique, and the same reason, as the `<aomap_fragment>` splice in
   * `injectBreakup`.
   *
   * If three ever renames that line the edit is a no-op, and a no-op HERE is
   * not benign — it would leave the material claimed and unfiltered. So the
   * match is asserted and the injection declines rather than lying about it.
   */
  const CHUNK = THREE.ShaderChunk.normal_fragment_maps;
  const ANCHOR = 'mapN.xy *= normalScale;';
  if (!CHUNK.includes(ANCHOR)) {
    console.warn('[materials] normal-relief anchor missing from three chunk; skipped');
    return;
  }
  _reliefed.add(mat);
  const fade = o.fade ?? [1.4, 5.0];
  const u = {
    value: new THREE.Vector4(o.maxSlope ?? 0.45, Math.max(1, o.res), fade[0], Math.max(fade[0] + 0.1, fade[1])),
  };
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uNRelief = u;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uNRelief;\n')
      .replace(
        '#include <normal_fragment_maps>',
        CHUNK.replace(
          ANCHOR,
          /* glsl */ `${ANCHOR}
	{
		// Texels of the normal map per screen pixel. vNormalMapUv already
		// carries the texture's own repeat, so this is a true footprint in
		// texels rather than a UV-space guess that would converge at the
		// wrong distance on every material with a different tile size.
		vec2 kRFw = fwidth( vNormalMapUv ) * uNRelief.y;
		float kRTex = max( kRFw.x, kRFw.y );
		float kRFade = 1.0 - smoothstep( uNRelief.z, uNRelief.w, kRTex );
		// Slope = tan( facet angle ). Rescale, never clip a component:
		// clipping rotates the facet's azimuth and gives an isotropic grain
		// a direction it never had.
		float kRSlope = length( mapN.xy ) / max( abs( mapN.z ), 1e-4 );
		float kRKeep = min( 1.0, uNRelief.x / max( kRSlope, 1e-4 ) ) * kRFade;
		mapN.xy *= kRKeep;
		// What the two terms just took off the normal is still surface, and
		// the honest place for sub-pixel surface is the width of the lobe.
		// Quadratic in alpha, the same variance convention as SPEC_AA_GEO, so
		// the two compose instead of double-counting.
		float kRLost = kRSlope * ( 1.0 - kRKeep );
		roughnessFactor = sqrt( min( 1.0,
			roughnessFactor * roughnessFactor + 2.0 * kRLost * kRLost ) );
	}`,
        ),
      );
  };
  const key = `nrel${o.maxSlope ?? 0.45}_${o.res}_${fade.join(',')}`;
  mat.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(mat) + key
      : () => key;
}

/**
 * ===========================================================================
 *  THE IDEMPOTENCE REGISTER, EXPORTED BY IDENTITY. Same contract as
 *  `geoWearClaim` in ./GeoWear.ts.
 * ===========================================================================
 * This one guards an ANCHOR rather than a term: `addNormalRelief` re-authors
 * `<normal_fragment_maps>`, and so does `applyBreakup`'s tangent-space block.
 * Whichever runs second finds the include already gone and is a silent no-op —
 * the failure class this codebase has paid for twice. A caller that has already
 * consumed the anchor adds the material here, synchronously, rather than
 * relying on an ordering argument.
 *
 * `MatLibShape.claims` compares by identity, so a variant cloner needs THIS set
 * and not an equivalent one.
 */
export { _reliefed as normalReliefClaim };
