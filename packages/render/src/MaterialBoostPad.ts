/**
 * ============================================================================
 *  The boost pad's emissive: one LOD bias and one ceiling.
 * ============================================================================
 *  Lifted byte-for-byte out of a kart racer and a space racer, where it was the
 *  same forty lines twice — the same uniforms, the same three constants, the
 *  same cache key string. Two racing games with a boost pad meet it the same
 *  way and the fix is the same fix, so it is one function now.
 *
 *  THE THREE NUMBERS ARE NOT PARAMETERS AND SHOULD NOT BECOME ONES UNTIL A
 *  SECOND ANSWER EXISTS. `0.35 / 1.6 / 2.2` were tuned independently in two
 *  games and landed identical; inventing an options object for values nobody
 *  has ever wanted to differ is how a shared module acquires a surface it then
 *  has to keep. When a game genuinely needs its own, add the argument then, and
 *  the diff will say which game and why.
 *
 *  It consumes `WORLD_PARS` / `WORLD_VERTEX` from ./MaterialChunks.ts, and
 *  those are preprocessor-guarded — read the note on them before adding a
 *  second injection to a pad material.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';
import { WORLD_PARS, WORLD_VERTEX } from './MaterialChunks.ts';

/**
 * Emissive clamp and LOD bias for the boost pad.
 *
 * A racing camera meets a boost pad at about ten degrees off the surface, which
 * is the worst case a mip chain has: the texel footprint is a long thin sliver
 * and hardware anisotropy holds a *low* mip to serve it. On a hard-edged stripe
 * pattern that is a crawling white smear, and because the stripes are also the
 * brightest thing in frame, the crawl is what the eye goes to first. Forcing a
 * higher mip with range is the only thing that resolves it — the chevrons are
 * meant to read as a flowing band at distance, not as individually sampled
 * edges.
 *
 * The clamp is the other half. The intensity of a boost pad belongs in bloom,
 * not in the base pixel: past ~2.2× white the tone map has nothing left to
 * work with and the emissive stops being a colour at all.
 */
export function injectBoostPad(mat: THREE.Material): void {
  const uBias = { value: new THREE.Vector3(0.35, 1.6, 2.2) };
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uPadBias = uBias;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WORLD_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WORLD_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WORLD_PARS + 'uniform vec3 uPadBias;\n')
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #ifdef USE_EMISSIVEMAP
          float kPadBias = uPadBias.x + smoothstep( 5.0, 45.0, vViewDist ) * uPadBias.y;
          vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv, kPadBias );
          totalEmissiveRadiance *= emissiveColor.rgb;
          totalEmissiveRadiance = min( totalEmissiveRadiance, vec3( uPadBias.z ) );
        #endif`,
      );
  };
  // CHAINED, NOT ASSIGNED.
  //
  // The hook above already chained; this line did not, and it arrived here from
  // the kart racer with the defect intact. That is worse than leaving it in the
  // game, because a defect in a package is a platform default that every future
  // consumer inherits — a survey of the games' materials listed this
  // `'boostpad2'` key among four overwritten keys and said what it costs:
  // **two materially different programs sharing one compiled shader**,
  // presenting as the wrong surface appearing correct.
  //
  // It was harmless in both games today only by ordering luck: the pad is
  // freshly constructed and `injectBoostPad` runs first, so the key it discards
  // is still `THREE.Material.prototype.customProgramCacheKey`. The guard below
  // reproduces that exact string in that exact case, so no key in either game
  // moves — and a pad that one day carries breakup or a rim light before this
  // no longer loses the record of it.
  const key = 'boostpad2';
  mat.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(mat) + key
      : () => key;
}
