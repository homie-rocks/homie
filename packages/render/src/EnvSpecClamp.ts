/**
 * ============================================================================
 *  EnvSpecClamp.ts — a shoulder on the specular environment term.
 * ============================================================================
 *
 *  Lifted out of a space racer's material code. It bounds ONE term —
 *  what a mirror-ish surface returns from the prefiltered environment probe —
 *  and it is not a distance fade, not aerial perspective and not an
 *  `envMapIntensity` change; the docblock below argues all three, at length,
 *  because each of them is the wrong fix somebody reaches for first.
 *
 *  IT IS GENERAL. Every input is a radiance, a coverage fraction or a scale.
 *  A prefiltered cube map turning a sub-pixel handrail into a mirror hit is a
 *  fact about prefiltering, not about a racing circuit — a base-building
 *  game's own resolution-profile comments describe the same artefact from the
 *  other side, having never connected it to this cause.
 *  The KNEE is the value a game supplies; the shoulder is the shared thing.
 *
 *  It routes through `patchEnvRadiance` in ./MaterialEnv.ts, which is the
 *  composer that lets several of these stack on one material without any of
 *  them silently eating another's `#include` anchor.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';
import { patchEnvRadiance } from './MaterialEnv.ts';

export interface EnvSpecClampOpts {
  /** radiance at which the shoulder starts, on a resolved surface */
  knee: number;
  /** the knee multiplier at full sub-pixel coverage, 0..1 */
  subPixel: number;
  /** scale applied to the measured screen-space normal swing before it saturates */
  varScale?: number;
}

/**
 * A soft ceiling on what the environment probe may hand a metal, tightened by
 * how sub-pixel the fragment is.
 *
 * ===========================================================================
 *  WHY A CLAMP AND NOT A LOWER `envMapIntensity`.
 * ===========================================================================
 *  The game's art direction forbids setting `envMapIntensity` globally, for
 *  reasons learned the one time somebody did, so the intensity stays per-material
 *  — but on the two surfaces that carry the whole megastructure it is ALSO not
 *  the lever, for two separate reasons.
 *
 *  1. The intensity is not ours to set. `structure`'s `MatLib` pulls
 *     `hull-plate` through `Materials.variant()` and then assigns its own
 *     `envMapIntensity = 1.35` on top, which is a legitimate authoring
 *     decision there (at night the probe IS the lighting) and which
 *     silently overwrites anything decided in this file. A shader-side term
 *     survives that; an authored scalar does not.
 *  2. Lowering the intensity is the wrong shape anyway. The failure is not
 *     "the truss is too bright everywhere", it is "the truss has a handful of
 *     over-threshold pixels per member and they are the ones that bloom".
 *     Scaling the whole reflection down to fix the peak takes the far field
 *     to black and deletes the value-falloff depth cue with it.
 *
 *  The probe is a 256² PMREM containing a 0.18° star at HDR 40.
 *  A cube face texel subtends about 0.35° there, so the disc is smaller than
 *  the sampler's smallest representable feature and PMREM cannot help ringing
 *  it across the top mips. A near-mirror returns that ring wholesale, at the
 *  same value regardless of distance — an env reflection is view-dependent,
 *  not distance-dependent — which is the mechanism behind a thin member that
 *  never gets darker as it recedes.
 *
 *  So: a Reinhard shoulder rather than a hard clip (a hard clip on the peak
 *  channel shifts hue toward the other two and turns a white glint pink), hue
 *  preserved by scaling all three channels by the same ratio, and the knee
 *  pulled down toward `subPixel` as the screen-space normal swing rises. The
 *  ceiling is exactly 2 × knee, so `knee` is chosen as half the value the
 *  surface is allowed to reach.
 *
 *  This composes with `SPEC_AA_GEO` rather than duplicating it: that term
 *  widens the roughness so the FETCH lands higher up the mip chain, this one
 *  bounds what comes back after `envMapIntensity` has multiplied it. The first
 *  fixes the shape of the lobe, the second fixes the magnitude, and neither is
 *  sufficient alone on a probe with a 40.0 point in it.
 */
export function injectEnvSpecClamp(mat: THREE.Material, o: EnvSpecClampOpts): void {
  const vs = o.varScale ?? 5.0;
  patchEnvRadiance(mat, {
    key: `envc${o.knee}_${o.subPixel}_${vs}`,
    decl: 'uniform vec3 uEnvClamp;',
    uniforms: { uEnvClamp: { value: new THREE.Vector3(o.knee, o.subPixel, vs) } },
    glsl: /* glsl */ `
			{
				vec3 kCNd = max( abs( dFdx( normal ) ), abs( dFdy( normal ) ) );
				float kCVar = clamp( max( kCNd.x, max( kCNd.y, kCNd.z ) ) * uEnvClamp.z, 0.0, 1.0 );
				// THE KNEE IS ABSOLUTE AND THE PEAK IS POST-INTENSITY, on purpose.
				// The number that matters is what the surface finally returns —
				// §5.3's 1.35 threshold is a scene-linear value, not a fraction of
				// whatever envMapIntensity the consuming module happened to set.
				// Scaling the knee by the intensity too would make the ceiling
				// follow the very number this exists to be independent of.
				float kCKnee = uEnvClamp.x * mix( 1.0, uEnvClamp.y, kCVar );
				float kCPk = max( envMapColor.r, max( envMapColor.g, envMapColor.b ) ) * envMapIntensity;
				if ( kCPk > kCKnee ) {
					float kCOver = kCPk - kCKnee;
					float kCNew = kCKnee + kCOver / ( 1.0 + kCOver / max( 1e-3, kCKnee ) );
					envMapColor.rgb *= kCNew / kCPk;
				}
			}`,
  });
}
