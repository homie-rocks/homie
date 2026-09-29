/**
 * ============================================================================
 *  SpecularAA.ts — geometric specular antialiasing, and the cache-key trap
 *  that came with it.
 * ============================================================================
 *
 * A curved, smooth, metalness-1 surface aliases: the normal turns faster than
 * one screen pixel can resolve, so the GGX lobe flickers between "mirror" and
 * "nothing" as the camera moves and the highlight crawls. The fix is to widen
 * the lobe by the variance of the normal ACROSS THE PIXEL, which the fragment
 * shader can measure with two derivatives.
 *
 * A kart racer had this on its wheels and its chrome; a space racer on its
 * emitters, its chrome, its steel and every hero hull. **The injected GLSL was
 * byte-identical**, comment for comment, down to the `min( 2.0 * variance, 0.5
 * )` clamp and the `clamp( sqrt( aP ), roughnessFactor, 1.0 )` that stops it
 * ever making a surface SMOOTHER than it was authored.
 *
 * ## The one difference, and it was a defect in one of them
 *
 * The cache key. The kart racer wrote:
 *
 *     m.customProgramCacheKey = () => `specaa${strength.toFixed(3)}`;
 *
 * The space racer chained instead, and its comment says exactly why:
 *
 *     A key that discards its predecessors is a program collision waiting for
 *     the next material that differs by source rather than by uniform, and that
 *     failure renders as one team's shader on another team's ship, which no
 *     test would catch.
 *
 * It was harmless in the kart racer by luck: the two materials it is applied to
 * are freshly constructed and carry no other injection, so their prior key is
 * still `THREE.Material.prototype.customProgramCacheKey` and the chained form
 * produces the identical string. It stopped being harmless in the space racer
 * the moment a hull carried this on top of four other patches, which is when
 * that game fixed it. **The chained form is the one that moved**, so the kart
 * racer gains the guard without gaining a single changed byte of shader text or
 * a single changed key today.
 *
 * ## Why NOT `matpatch.patch()`
 *
 * There is a composer in this package already, and routing this through it
 * would be the obvious tidy. It would also change the key FORMAT — `patch()`
 * joins its keys with `|` and prefixes an incumbent with `base:` — for every
 * material in both games. That is a shared solve quietly retuning both callers,
 * which nothing renders differently and a material-shader probe would report as
 * a wholesale change with no defect behind it. The chaining here is written out
 * because it has to reproduce two games' existing keys exactly.
 *
 * ## Where it must be installed
 *
 * AFTER anything that REPLACES `onBeforeCompile` rather than chaining it. Both
 * games have such a patcher (their rim lights) and both games' material setup
 * carries a comment about the ordering. This function chains, so it is safe to
 * install last and unsafe to install first.
 */
import * as THREE from 'three';

/**
 * Widen the roughness lobe by the screen-space variance of the shaded normal.
 *
 * Injected after `<normal_fragment_maps>`: `roughnessFactor` is assigned four
 * chunks earlier and not consumed until `<lights_physical_fragment>` several
 * chunks later, so the mapped normal and the roughness are both live at that
 * point and it costs no extra texture fetch.
 *
 * Cost: two derivatives and about eight ALU, per material it is applied to.
 *
 * @param strength how much of the measured variance to fold in. Both games run
 *   it between 0.35 and 0.85, higher on the surfaces whose highlights a review
 *   actually caught crawling.
 */
export function addSpecularAA(m: THREE.MeshStandardMaterial, strength: number): void {
  const uSpecAA = { value: strength };
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    shader.uniforms.uSpecAA = uSpecAA;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uSpecAA;\nvoid main() {')
      .replace(
        '#include <normal_fragment_maps>',
        [
          '#include <normal_fragment_maps>',
          '{',
          '  vec3 dnx = dFdx( normal );',
          '  vec3 dny = dFdy( normal );',
          '  float variance = uSpecAA * ( dot( dnx, dnx ) + dot( dny, dny ) );',
          // GGX alpha = roughness^2; alpha'^2 = alpha^2 + 2 * variance
          '  float alpha = roughnessFactor * roughnessFactor;',
          '  float aP = sqrt( alpha * alpha + min( 2.0 * variance, 0.5 ) );',
          '  roughnessFactor = clamp( sqrt( aP ), roughnessFactor, 1.0 );',
          '}',
        ].join('\n'),
      );
  };
  // CHAINED, not assigned. See this file's header: a key that discards its
  // predecessors is a program collision waiting for the next material that
  // differs by source rather than by uniform, and that failure renders as one
  // team's shader on another team's ship.
  //
  // The `!== THREE.Material.prototype.customProgramCacheKey` test is what makes
  // this produce the IDENTICAL string on a material that carries nothing else,
  // which is every material the kart racer applies it to. Without it a fresh
  // material would get the prototype's empty string prepended and every key in
  // that game would change for no reason.
  const key = `specaa${strength.toFixed(3)}`;
  m.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(m) + key
      : () => key;
  m.needsUpdate = true;
}

/**
 * ===========================================================================
 *  A THIRD ESTIMATOR. READ ./VarianceSpecAA.ts's HEADER BEFORE MERGING ANY OF
 *  THE THREE — IT ALREADY ARGUES THIS CASE AND IT IS RIGHT.
 * ===========================================================================
 *  `addSpecularAA` above folds the variance into α² and takes `sqrt(sqrt(...))`
 *  back to roughness, with the variance capped at a fixed 0.5 inside the
 *  formula. `VarianceSpecAA` takes a componentwise max at a different anchor.
 *  This one folds the variance into ROUGHNESS SQUARED directly —
 *  `sqrt(r² + v)` — with the cap an ARGUMENT and applied to the variance before
 *  it is folded.
 *
 *  Those are three different curves. On a surface whose highlights actually
 *  crawl the difference between them is visible, which is exactly why a shared
 *  `addSpecularAA(mat, strength)` would be the wrong answer: it compiles, it
 *  passes everything, and it quietly gives one surface another's filtering.
 *
 *  WHY THE CAP IS AN ARGUMENT HERE AND A CONSTANT THERE. The variance is
 *  UNBOUNDED at a silhouette — the normal swings through 90° inside one pixel —
 *  so without a ceiling every object gets a fully rough rim. How much rim is
 *  acceptable depends on what the surface is: a field of ~7,500 hexagonal
 *  prisms at around a pixel each wants a very different ceiling from a smooth
 *  barrel, and both wanted a different one from the two racing hulls that
 *  `addSpecularAA` was tuned against.
 *
 *  Same anchor and the same reason as `addSpecularAA`: three's meshphysical
 *  runs `<roughnessmap_fragment>` BEFORE `<normal_fragment_begin>`, so at the
 *  roughness include the shaded `normal` does not exist and `dFdx` of it would
 *  not compile; `<lights_physical_fragment>` reads `roughnessFactor` and runs
 *  after both, so writing it here still lands.
 * ===========================================================================
 */
export function addClampedSpecularAA(mat: THREE.Material, scale: number, max: number): void {
  const uScale = { value: scale };
  const uMax = { value: max };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(mat, shader, renderer);
    shader.uniforms.uSaaScale = uScale;
    shader.uniforms.uSaaMax = uMax;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSaaScale;\nuniform float uSaaMax;')
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\n'
        + 'vec3 mbNdx = dFdx( normal );\n'
        + 'vec3 mbNdy = dFdy( normal );\n'
        + 'float mbVar = min( ( dot( mbNdx, mbNdx ) + dot( mbNdy, mbNdy ) ) * uSaaScale, uSaaMax );\n'
        + 'roughnessFactor = min( 1.0, sqrt( roughnessFactor * roughnessFactor + mbVar ) );'
      );
  };
  const inner = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => 'csaa' + scale + '_' + max + (inner ? inner() : '');
  mat.needsUpdate = true;
}
