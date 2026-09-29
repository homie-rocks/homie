/**
 * ============================================================================
 *  bipedDepthMaterial — THE SHADOW OF A GPU-POSED FIGURE.
 * ============================================================================
 *
 *  `gpubiped.ts` solves a skeleton in the vertex shader. This is the half that
 *  is forgotten every single time, in every engine, and the symptom is loud:
 *
 *      the shadow pass runs its own material.
 *
 *  three's shadow map does not use your `MeshStandardMaterial`. It renders the
 *  mesh again through a `MeshDepthMaterial`, and that material knows nothing
 *  about a rig. So a crowd whose colour pass is skinned in GLSL and whose depth
 *  pass is not casts REST-POSE shadows: a field of legs-together statues beside
 *  a field of walking figures. With a hard key it is the loudest artefact a
 *  posed crowd can produce, and it is invisible in any screenshot taken from
 *  the sun's own direction.
 *
 *  It is not a bug you find by reading the material. It is a bug you find by
 *  turning the camera around.
 *
 *  ── `normal: false` IS THE WHOLE REASON THIS IS A FUNCTION ─────────────────
 *
 *  `patchBipedVertex` defaults to skinning the normal, which is right for a
 *  lit pass and WRONG here: three's depth vertex shader carries
 *  `#include <beginnormal_vertex>` for a displacement map it might have, and
 *  replacing it declares an `objectNormal` the depth chunks then re-declare.
 *  On a strict driver the shader fails to compile; on a tolerant one the
 *  shadow silhouette is skinned by a second, different chain from the colour
 *  pass and swims a frame behind it. A caller writing this by hand gets it
 *  wrong roughly half the time, and only one of the two failure modes is loud.
 *
 *  ── THE CACHE KEY IS REQUIRED AND HAS NO DEFAULT ───────────────────────────
 *
 *  three caches compiled programs by a key derived from the material's own
 *  parameters, and two depth materials patched with two DIFFERENT rigs are
 *  identical by that measure. Without a distinct key the second creature in a
 *  scene silently gets the first one's skeleton — which is a rig-swap bug that
 *  renders perfectly, once, in whichever order the scene happened to build. So
 *  the key is a parameter with no default, and a caller that forgets it fails
 *  to compile rather than shipping a jaguar shaped like a robot.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS THE CALLER'S ─────────────────────────────
 *
 *  Mechanism: the depth packing, the patch, `normal: false`, the three uniform
 *  declarations the rig's non-instanced path reads, and the cache key being
 *  mandatory. The caller's: the solve, the prefix, the key itself, and the rest
 *  cycle. Nothing here knows what is being posed.
 * ============================================================================
 */
import * as THREE from 'three';
import { patchBipedVertex } from './gpubiped.ts';

export interface BipedDepthSpec {
  /** The `bipedPoseGLSL` output — declarations, the caller's solve, and skin. */
  common: string;
  /** Identifier prefix. MUST be the one `common` was built with. */
  prefix?: string;
  /**
   * A program cache key unique to this rig. No default: see the header. Bump
   * it when `common` changes shape, or a hot reload keeps the old program.
   */
  cacheKey: string;
  /**
   * Cycle period, seconds, for the UNIFORM path — a single figure posed from
   * uniforms rather than a crowd posed from instance attributes. It must not
   * be zero: the solve divides by it. An instanced caller never reads it and
   * should still pass something sane, because "instanced" is a property of the
   * draw and not of the material.
   */
  restCycle: number;
}

export function bipedDepthMaterial(s: BipedDepthSpec): THREE.MeshDepthMaterial {
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  d.onBeforeCompile = (shader) => {
    shader.uniforms.uAnim = { value: new THREE.Vector4(0, 0, s.restCycle, 0) };
    shader.uniforms.uPoseW = { value: new THREE.Vector4() };
    shader.uniforms.uVar = { value: new THREE.Vector4() };
    shader.vertexShader = patchBipedVertex(shader.vertexShader, s.common,
      { prefix: s.prefix, normal: false });
  };
  d.customProgramCacheKey = () => s.cacheKey;
  return d;
}
