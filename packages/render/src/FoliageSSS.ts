/**
 * ============================================================================
 *  FoliageSSS.ts — wrap diffuse, back-lobe transmission and a leaf-edge rim.
 * ============================================================================
 *
 *  This function is the argument for the whole package: it existed in a kart
 *  racer and nowhere else, and the space racer forked from it deleted it —
 *  which was right for a game with no foliage and wrong for a library. **The
 *  next outdoor game will want it, and sixty-odd lines of correctly-tuned
 *  foliage transmission is not something a generated game rediscovers.** So
 *  it moves here whole, with its tuning history, rather than being deleted
 *  with the fork that had no palms in it.
 *
 *  The comments are the value. `pow 3 was a pinhole` and the leaf-edge rim's
 *  paragraph are two sessions of looking at a backlit canopy; they travel with
 *  the constants they explain.
 *
 *  It was already the one injector in either game's material code that chained
 *  `customProgramCacheKey` correctly instead of assigning it, and says why.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';

/**
 * Wrap/transmission lighting for leaf cards. At 14° sun elevation the palms and
 * hedges are almost all backlit; without this they read as black cutouts, which
 * throws away the single best lighting moment on the course.
 */
export function injectFoliageSSS(mat: THREE.Material, color: THREE.Color, strength: number): void {
  const uCol = { value: color };
  const uStr = { value: strength };
  // Chained, not assigned. This used to overwrite `onBeforeCompile` outright,
  // so a leaf card that also wanted tiling breakup or a wind patch silently
  // lost whichever injection ran first — the same class of bug the note above
  // `injectBreakup`'s cache key describes, and it is worth fixing even while
  // this library's own leaf cards are the only consumers.
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uSSSColor = uCol;
    shader.uniforms.uSSSStrength = uStr;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSSSColor;\nuniform float uSSSStrength;')
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `
        #include <lights_fragment_end>
        #if ( NUM_DIR_LIGHTS > 0 )
          vec3 sssV = normalize( vViewPosition );
          vec3 sssL = directionalLights[ 0 ].direction;
          // pow 3 was a pinhole: it only fired when the camera was looking almost
          // exactly down the sun vector, so in practice the fronds were never
          // caught doing it and read as opaque cardboard. 1.6 turns it into a
          // broad lobe covering most of the beach section's viewing angles.
          float sssBack = pow( max( 0.0, dot( sssV, -sssL ) ), 1.6 );
          // Wrap diffuse: NdotL remapped to (NdotL + w)/(1 + w). A leaf is one
          // cell thick and the light does not stop at its terminator.
          float sssND = dot( normal, sssL );
          float sssWrap = max( 0.0, ( sssND + 0.5 ) / 1.5 );
          // Transmission is a back-face event — the light has come through the
          // blade, so it is strongest where the surface faces away from the sun.
          float sssThru = sssBack * max( 0.0, 0.25 - sssND * 0.75 ) * 2.4;
          reflectedLight.indirectDiffuse += directionalLights[ 0 ].color * uSSSColor * diffuseColor.rgb *
            ( sssThru + sssBack * 0.55 + sssWrap * 0.30 ) * uSSSStrength;
          // Leaf-edge glow. The transmitted term above lights the BODY of the
          // blade; what separates a backlit canopy from a dark blob against a
          // bright sky is the rim — the millimetre of blade at the silhouette
          // where the path length through the leaf goes to nothing and the sun
          // comes through almost unattenuated. On a card that edge is exactly
          // where the geometric normal turns perpendicular to the eye, so a
          // Fresnel-shaped term keyed on the same back-lobe puts light precisely
          // there and nowhere else. Without it the palm is a flat opaque
          // dark-green shape against a bright sky, which is what the first review said.
          float sssRim = pow( 1.0 - max( 0.0, dot( normal, sssV ) ), 3.0 );
          reflectedLight.indirectDiffuse += directionalLights[ 0 ].color * uSSSColor *
            sssRim * sssBack * 1.1 * uSSSStrength;
        #endif`,
      );
  };
  const key = `foliagesss3_${strength}`;
  mat.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(mat) + key
      : () => key;
}
