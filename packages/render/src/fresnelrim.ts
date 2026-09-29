/**
 * ============================================================================
 *  fresnelrim.ts — the key's kicker, as a material patch on the subject rather
 *  than as a fourth light.
 * ============================================================================
 *
 * A mid-value body on a dark ground under one hard key has no edge, and the fix
 * is the one a lighting cameraman reaches for: a kicker on the key side that
 * traces the silhouette. Doing it properly would need the key's direction in
 * view space, i.e. a per-frame uniform push from a system that owns the scene.
 * It does not need to — the surface's own answer to the DIRECT lights is
 * already the key's footprint, so gating a Fresnel term on that puts the rim
 * exactly where the key is and NOWHERE in shadow. Self-contained, and it can
 * never light the dark side of a body, which is the failure mode of a naive
 * Fresnel emissive.
 *
 * `keyrim.ts` next door is the same idea for a GROUND shader, where the key
 * direction IS available as a uniform because the sky rig owns it. This one is
 * for a moving subject with eight instances and no such uniform.
 *
 * ---------------------------------------------------------------------------
 * THREE THINGS THAT ARE NOT KNOBS, BECAUSE EACH OF THEM SHIPPED AS A DEFECT
 * ---------------------------------------------------------------------------
 * Only the TINT, the STRENGTH and the grazing POWER are the game's. The three
 * decisions below are correctness and the package makes them for everybody:
 *
 * 1. `nonPerturbedNormal`, NEVER `normal`. A Fresnel rim answers "is this
 *    fragment where the SHAPE ends", and only the geometric normal knows that.
 *    Read off the MAPPED normal it answers "is this fragment where the
 *    tangent-space map turns hard" — and a panelled hull's relief turns as hard
 *    as it is possible to turn, ~82° off the surface at every plate joint. The
 *    term then paints a full-strength rim along the ENTIRE panel grid, on the
 *    crown, on the belly and on faces square to the camera. One shipped build
 *    read as a self-lit lattice crate for exactly this reason. The mapped
 *    normal stays in charge of the SHADING; what it may not do is manufacture
 *    silhouettes.
 * 2. GATE ON `reflectedLight.direct*`, NEVER ON `outgoingLight`. Outgoing is
 *    direct + INDIRECT + EMISSIVE. Indirect means the environment map, so the
 *    rim ends up partly gated on the sky rather than on the key; emissive means
 *    that a body carrying any glow of its own starts firing a key rim in total
 *    darkness off its own radiators.
 * 3. THE GATE IS LINEAR, NEVER SQUARED. `lit * lit` on an already-clamped
 *    luminance is a quadratic that only reaches full strength on a surface
 *    returning >0.42 linear — i.e. on bodies that are ALREADY bright and least
 *    need an edge. A shadowed flank at 0.010–0.024 got a rim of 0.0025, which
 *    is nothing, and three reviews in a row saying "the subject is the
 *    lowest-contrast object in the frame" were that curve. A kicker is
 *    PROPORTIONAL to the key, not a threshold on it: a dim lit flank gets a dim
 *    rim, an unlit one gets exactly zero.
 *
 * A game still running the mapped normal, the outgoing gate or the squared
 * curve is not served by an option here. Adopting this file changes that game's
 * picture, which is a commit with a before-and-after of its own.
 *
 * It CHAINS, so it is safe to install after a patcher that replaces
 * `onBeforeCompile` and unsafe to install before one.
 *
 * Cost: ~8 ALU in the fragment shader of one mesh.
 */
import * as THREE from 'three';
import { chainPatch } from './chainpatch.js';

export interface FresnelRimTune {
  /** the key's own colour; the rim is the key seen edge-on and no other hue */
  tint: THREE.Color;
  /** peak rim radiance where the surface turns away from the eye */
  strength: number;
  /**
   * grazing exponent. Higher is a harder, narrower edge; a wide one reads as a
   * glow around the object rather than as a line on it, and how hard the edge
   * should be is a property of how small the key's disc is.
   */
  power: number;
  /**
   * how fast the gate saturates on the key's own luminance. The knee, not a
   * threshold: at 3.4 a surface returning 0.29 linear is already fully rimmed.
   */
  gateGain: number;
}

/**
 * @param key a program-cache discriminator. Two strengths share one source, so
 *            they must not share a program; and the SOURCE changes when this
 *            file does, so the key carries a version too. A warm cache serving
 *            the last build's shader to this build's material is how a fix
 *            looks like it did not land.
 */
export function addFresnelRim(m: THREE.Material, t: FresnelRimTune, key: string) {
  const uRimStrength = { value: t.strength };
  const uRimColor = { value: t.tint };
  chainPatch(m, `${key}_${t.strength.toFixed(3)}`, (shader) => {
    shader.uniforms.uRimStrength = uRimStrength;
    shader.uniforms.uRimColor = uRimColor;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform float uRimStrength;\nuniform vec3 uRimColor;\nvoid main() {',
      )
      .replace(
        '#include <opaque_fragment>',
        [
          '{',
          // `nonPerturbedNormal` is declared by <normal_fragment_begin>, several
          // chunks above, and is the interpolated vertex normal in view space
          // with the double-sided flip already applied. See the header, note 1.
          // vViewPosition points fragment -> eye, so this is N.V
          '  float ndv = abs(dot(normalize(vViewPosition), nonPerturbedNormal));',
          `  float fres = pow(1.0 - clamp(ndv, 0.0, 1.0), ${t.power.toFixed(1)});`,
          // The DIRECT terms only — the key's own footprint, with the
          // environment and this surface's own emissive excluded. Header, 2.
          '  vec3 keyLit = reflectedLight.directDiffuse + reflectedLight.directSpecular;',
          `  float lit = clamp(dot(keyLit, vec3(0.2126, 0.7152, 0.0722)) * ${t.gateGain.toFixed(2)}, 0.0, 1.0);`,
          '  outgoingLight += uRimColor * (fres * lit * uRimStrength);',
          '}',
          '#include <opaque_fragment>',
        ].join('\n'),
      );
  });
}
