/**
 * ============================================================================
 *  starsprite.ts — the point sprite a baked star is DRAWN as.
 * ============================================================================
 *
 * `starfield.ts` decides where the stars are, how bright they are and what
 * colour. This decides what one of them looks like on screen, and it was the
 * same program in a space racer's `Atmosphere.ts` and a base-building game's
 * `Stars.ts` with different numbers in it.
 *
 * ## Why a point sprite and not a hash in the dome shader
 *
 * A sub-pixel star evaluated per fragment is a sampling problem with no
 * solution: it is either missed entirely or it flashes as the camera moves it
 * across the pixel grid, and neither game can afford that — one rolls the
 * camera 360 degrees through an inversion, the other is judged against "no
 * aliasing crawl on thin geometry" and a starfield is the thinnest geometry it
 * has. A resolved sprite carrying a Gaussian whose EFFECTIVE width is about
 * 1.4 px has no crawl, because the star is genuinely wider than a pixel even
 * though its energy is not.
 *
 * ## The one thing worth understanding before changing a number here
 *
 * **EVERY LENGTH IS IN FRAMEBUFFER PIXELS, NOT IN QUAD FRACTIONS.** The
 * fragment stage multiplies `gl_PointCoord` back out by the sprite's own width,
 * so the Gaussian's footprint is set by `gaussianK` ALONE and growing the quad
 * changes nothing but where it is cut off. That invariance is what lets a star
 * grow a diffraction cross without changing its energy, and it is what keeps a
 * luminance-histogram check meaning the same thing across a sprite-size change.
 * The space racer wrote the same Gaussian in quad fractions with a fixed 3.4 px
 * quad; converting is exact and is `26.0 / (3.4 * 3.4)`.
 *
 * ## The occluder
 *
 * Both games kill the stars behind one big round thing — a gas giant in one, a
 * planet in the other — in the VERTEX stage, one dot product per star rather
 * than one per pixel. It is the only occlusion the field needs: the sky dome
 * writes no depth, so draw order alone could never make an opaque body hide a
 * point drawn after it. The uniforms are `uOccluderDir` / `uOccluderCos` here
 * because a package cannot know whose planet it is.
 *
 *  ██ NO BACKTICKS BELOW THIS LINE ██ A backtick inside a GLSL template literal
 *  ends the string and the rest of the file parses as TypeScript, failing a
 *  hundred lines later — under Vite the module 500s and the game does not boot,
 *  which looks exactly like a slow load. This has bitten four separate times
 *  across these games and it is why the shaders live in their own file rather
 *  than in starfield.ts. Do not write an identifier in backticks below here.
 * ============================================================================
 */

/**
 * A GLSL float literal. `String(1)` is `1`, which GLSL reads as an int and
 * refuses to multiply by a float, so every number written into a shader goes
 * through here.
 */
function gf(v: number): string {
  if (!Number.isFinite(v)) throw new Error('starsprite: refusing to write ' + String(v) + ' into GLSL');
  const s = String(v);
  return s.includes('.') || s.includes('e') ? s : s + '.0';
}

/**
 * How a star is drawn. Every field is required; see `StarfieldSpec` for why
 * there are no defaults anywhere in this pair of files.
 */
export interface StarSpriteSpec {
  /**
   * Sub-pixel temporal jitter amplitude, in framebuffer pixels, applied in CLIP
   * space so it is exactly a fraction of a pixel however far away the star is.
   *
   * IT HAS A FAILURE MODE ON EACH SIDE. Too little and the residual sampling
   * pattern is coherent across frames, which is crawl. Too much, or too fast,
   * and each star's brightest pixel is modulated every frame, which reads as
   * SCINTILLATION — and neither of these games has an atmosphere, so a twinkle
   * is an Earth-sky tell of the same family as a warm low sun.
   */
  jitterPx: number;
  /**
   * The Gaussian's exponent, `1 / (2 sigma^2)`, with the radius in FRAMEBUFFER
   * PIXELS. 1.35 is sigma 0.609 px, i.e. a 1.43 px FWHM; 2.249 is sigma
   * 0.472 px and a 1.11 px FWHM.
   *
   * THE TRADE IS SCINTILLATION AGAINST ENERGY, and both halves are measurable.
   * A star lands at an arbitrary sub-pixel position, so its brightest pixel is
   * the Gaussian sampled somewhere between 0 and 0.71 px off centre: at sigma
   * 0.472 that range is 1.00 down to 0.32, a factor of three re-rolled every
   * time the camera turns half a pixel. At sigma 0.609 it is 1.00 down to 0.51.
   * But the energy a star deposits is `2 pi sigma^2`, so the wider core is also
   * 1.67x the light — which is a real change to any luminance-histogram budget
   * and is why this is a per-game number and not a constant.
   */
  gaussianK: number;
  /** Below this alpha the sprite is discarded. Real fill saving on 9,000+. */
  discardBelow: number;
  /**
   * Exponential falloff along a diffraction arm, per framebuffer pixel.
   * Irrelevant when `spriteCrossPx` is 0 and no star has any cross strength.
   */
  crossArmFalloff: number;
  /**
   * Peak alpha an arm adds at full cross strength. This is an APERTURE artefact
   * on a point source, not a lens flare: deliberately neither streaked nor
   * coloured, and it is what separates "a star" from "a white pixel" at
   * thumbnail size.
   */
  crossArmGain: number;
}

/**
 * Build the pair. Both are plain strings; the game owns the `ShaderMaterial`,
 * its blending, its render order and its four uniforms.
 *
 * The attributes are `aColor`, `aPhase`, `aSize` and `aCross`, which are
 * exactly the four buffers `bakeStarfield` returns beside `position`.
 */
export function starSpriteShaders(spec: StarSpriteSpec): { vertex: string; fragment: string } {
  const vertex = /* glsl */ `
attribute vec3 aColor;
attribute float aPhase;
attribute float aSize;
attribute float aCross;

uniform float uPixelScale;
uniform float uJitter;
uniform vec3 uOccluderDir;
uniform float uOccluderCos;

varying vec3 vColor;
varying float vSize;
varying float vCross;

void main() {
  vColor = aColor;
  vSize = aSize;
  vCross = aCross;

  // Kill anything the occluding body is in front of. 'position' is already a
  // unit direction, so this is a cosine test against its angular radius.
  // Pushed outside the clip volume rather than discarded, so it costs nothing
  // downstream.
  if (dot(position, uOccluderDir) > uOccluderCos) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vec4 clip = projectionMatrix * vec4(mat3(modelViewMatrix) * position, 1.0);
  // Sub-pixel temporal jitter, in clip space. See jitterPx.
  clip.xy += vec2(sin(aPhase + uJitter), cos(aPhase * 1.7 + uJitter))
    * (clip.w * uPixelScale * ${gf(spec.jitterPx)});
  // z forced to w: the field sits exactly on the far plane, so real geometry
  // occludes it through the ordinary depth test and nothing else has to know.
  gl_Position = clip.xyww;
  gl_PointSize = aSize;
}
`;

  const fragment = /* glsl */ `
varying vec3 vColor;
varying float vSize;
varying float vCross;

void main() {
  // Offset from the sprite centre, converted to FRAMEBUFFER PIXELS. Everything
  // below is in pixels so that growing the quad for a diffraction cross cannot
  // change the core's width or the star's energy.
  vec2 dpx = (gl_PointCoord - 0.5) * vSize;
  float r2 = dot(dpx, dpx);

  float a = exp(-r2 * ${gf(spec.gaussianK)});

  // The four-point cross, on whichever stars the bake gave a strength to. Each
  // arm is an exponential along its own axis and the core Gaussian across it;
  // the two arms are the same expression transposed. Skipped entirely when a
  // game sets spriteCrossPx to 0, because then no star carries any strength.
  if (vCross > 0.0) {
    vec2 ad = abs(dpx);
    float arm = exp(-ad.x * ${gf(spec.crossArmFalloff)}) * exp(-ad.y * ad.y * ${gf(spec.gaussianK)})
              + exp(-ad.y * ${gf(spec.crossArmFalloff)}) * exp(-ad.x * ad.x * ${gf(spec.gaussianK)});
    a += arm * vCross * ${gf(spec.crossArmGain)};
  }

  if (a < ${gf(spec.discardBelow)}) discard;

  gl_FragColor = vec4(vColor * a, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

  return { vertex, fragment };
}
