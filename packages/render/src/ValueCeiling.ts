/**
 * ============================================================================
 *  ValueCeiling.ts — a soft ceiling on what a NON-EMISSIVE surface may present.
 * ============================================================================
 *
 *  Lifted out of a space racer's `Materials.ts`. The rule it enforces — a
 *  surface that is not a light must not present like one — is written into all
 *  four games' art direction and implemented in exactly one of them.
 *  Both arguments are scene-linear radiances the game supplies.
 *
 *  Soft, not a clamp: a hard `min()` flattens a highlight into a plateau, which
 *  reads as a blown-out patch rather than as a bright surface. The shoulder
 *  below keeps the ordering of values above the knee, which is what lets the
 *  eye still see shape up there.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';

/** Materials already carrying an output ceiling — see `addValueCeiling`. */
const _ceiled = new WeakSet<THREE.Material>();

/**
 * A soft ceiling on what a NON-EMISSIVE surface may present, in scene-linear.
 *
 * The art direction picks 1.35 as the bloom threshold precisely so that only
 * real emitters bloom, and also says in as many words that **the deck never
 * blooms** — it sits at 0.10–0.30 lit and 0.03–0.09 in eclipse. A grazing key
 * on a plate arris, an expansion joint or a kerb lip will reach several times
 * that on its own, and the result is the "field of identical white dashes" the
 * raceway has read as in every reviewed set.
 *
 * The game's `Props.ts` has carried its own version of this
 * (`patchSpecCeiling`) on the raceway since an early version, and it is right.
 * This is the same shoulder living on THIS side of the hand-off, so that a deck
 * material generated here arrives with its own ceiling rather than depending on
 * the consuming module to add one — `adoptDeck` swaps the material object, and
 * anything the old object was carrying goes with it.
 *
 * A Reinhard shoulder rather than a clip, and all three channels scaled by one
 * ratio: clipping the peak channel alone shifts hue toward the other two and
 * turns a white glint pink. `<opaque_fragment>` is the anchor because that is
 * where `gl_FragColor` first exists and before `<tonemapping_fragment>` reads
 * it, so the number being bounded is the scene-linear one the art direction
 * legislates.
 */
export function addValueCeiling(mat: THREE.Material, knee: number, ceil: number): void {
  if (_ceiled.has(mat)) return;
  _ceiled.add(mat);
  const k = Math.max(0.01, knee);
  const u = { value: new THREE.Vector2(k, Math.max(k + 0.02, ceil) - k) };
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uValCeil = u;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uValCeil;\n')
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `#include <opaque_fragment>
        {
          float kVCMx = max( max( gl_FragColor.r, gl_FragColor.g ), gl_FragColor.b );
          if ( kVCMx > uValCeil.x ) {
            float kVCOut = uValCeil.x + uValCeil.y * ( 1.0 - exp( -( kVCMx - uValCeil.x ) / uValCeil.y ) );
            gl_FragColor.rgb *= kVCOut / kVCMx;
          }
        }`,
      );
  };
  const key = `vceil${k.toFixed(3)}_${ceil.toFixed(3)}`;
  mat.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(mat) + key
      : () => key;
}

/**
 * The idempotence register, exported by identity — same contract as
 * `geoWearClaim` in ./GeoWear.ts. A variant clone that re-enters the ceiling
 * gets two shoulders stacked on one surface, which is a surface that cannot
 * reach the value its neighbour reaches.
 */
export { _ceiled as valueCeilingClaim };
