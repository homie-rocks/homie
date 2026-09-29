/**
 * ============================================================================
 *  Aberration — lateral chromatic aberration, as a snippet AND as a pass.
 * ============================================================================
 *
 *  ONE IMPLEMENTATION, TWO POSSIBLE SLOTS, and that is the whole point of the
 *  file. A game that wants to compare running the fringe BEFORE its edge
 *  resolve against running it AFTER has to be comparing two ORDERINGS; two
 *  hand-kept copies of the maths would be comparing two implementations. So
 *  `CA_SNIPPET` is interpolated into the game's own grade shader (the pre-
 *  resolve slot, where it costs no pass at all because the grade is already
 *  fetching the input buffer) and into `AberrationEffect` below (the post-
 *  resolve slot, which costs one extra fullscreen pass — the honest price).
 *
 *  ── WHERE IT CAME FROM, AND WHY IT IS PLATFORM ──────────────────────────────
 *
 *  One game's post-processing module, where it had exactly ONE COPY. The
 *  criterion applied: ask whether it belongs in a game, never whether there is
 *  a twin. Three fetches at a radius-shaped offset is not a fact about any one
 *  game, and the three guards below were each paid for on another project
 *  rather than in that game.
 *
 *  `@homie-rocks/postfx/Grade.ts` already carries a chromatic aberration inside its
 *  own merged grade shader and that is NOT this. That one is a term in a
 *  program; this is the term on its own, usable by a game whose grade is a
 *  second shader (see `ChainGrade` in `./Chain.ts`) and usable AFTER an edge
 *  resolve, which a term inside the grade structurally cannot be.
 *
 *  ── THE THREE GUARDS ────────────────────────────────────────────────────────
 *
 *   1. A genuine smoothstep from a third of the way out, so the middle third of
 *      the frame — where the subject always is — is bit-exact clean and takes
 *      the single-fetch branch.
 *   2. The offset is capped in PIXELS, not in UV, so it is safe at any render
 *      scale. Below about a pixel the bilinear fetch is its own low-pass and
 *      the channels stay correlated; above two the fringe turns the scene's own
 *      specular aliasing into coloured confetti.
 *   3. A DEAD ZONE IN PIXELS. Every thin mast, truss and mullion in a frame can
 *      read as alternating red / white / blue one-pixel dashes, and while the
 *      fringe is not the ORIGIN of that it is a multiplier on it: three fetches
 *      at a sub-texel offset land inside one bilinear footprint, so they add
 *      nothing a viewer can see as a fringe and yet they DECORRELATE the
 *      channels of any edge whose signal is already sub-pixel. Below the floor
 *      the single-fetch branch is taken and the strut keeps whatever coherence
 *      the rasteriser gave it.
 *
 *  ── THE TWO LIMITS ARE THE GAME'S, IN DISPLAY PIXELS, AND REQUIRED ──────────
 *
 *  `caLimits` is a UNIFORM and not a define, and that is load-bearing: the pair
 *  are DISPLAY-pixel limits and a drawing buffer's texel is only a display
 *  pixel at ratio 1.0. A chain is not rebuilt on a resolution change, so a
 *  define would freeze the conversion at whatever ratio the page booted with.
 *  The constructor takes the display-pixel pair and the CALLER converts on every
 *  resolution change through `limits`.
 * ============================================================================
 */
import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

/*
 * ===========================================================================
 *  NO BACKTICKS BELOW THIS LINE (until the end of the last template literal).
 *  See the identical banner in ./Contact.ts for what one costs.
 * ===========================================================================
 */

/**
 * THE MATHS, for interpolation into a game's own grade shader.
 *
 * It declares `uniform vec2 caLimits` itself, so a grade that interpolates this
 * must not declare one too, and must push the SAME converted pair the
 * standalone pass gets — or the two orderings are no longer comparable, which
 * is the one thing this file exists to make possible.
 *
 * Reads `inputBuffer` and `texelSize`, both of which postprocessing supplies to
 * every effect.
 */
export const CA_SNIPPET = /* glsl */ `
// x = dead zone, y = ceiling, BOTH in buffer texels, converted on the CPU from
// the game's display-pixel constants by the effective pixel ratio.
uniform vec2 caLimits;

vec3 mbAberrate(const in vec2 uv, const in vec2 fromCentre, const in float rad,
                const in float amount, const in vec3 centreSample) {
  float caShape = smoothstep(0.34, 1.0, rad);
  vec2 fringe = fromCentre * (amount * caShape * caShape);
  float fringePx = length(fringe / texelSize);
  if (fringePx < caLimits.x) return centreSample;
  fringe *= min(fringePx, caLimits.y) / fringePx;
  vec2 lo = texelSize;
  vec2 hi = vec2(1.0) - texelSize;
  return vec3(
    texture2D(inputBuffer, clamp(uv + fringe, lo, hi)).r,
    centreSample.g,
    texture2D(inputBuffer, clamp(uv - fringe, lo, hi)).b);
}
`;

const ABERRATION_FRAGMENT = /* glsl */ `
uniform float caAmount;
` + CA_SNIPPET + /* glsl */ `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 fromCentre = uv - 0.5;
  // Normalised so 1.0 is the frame corner at any aspect ratio — identical to
  // the grade's own radius, so the two slots ramp over the same region.
  vec2 aspectVec = vec2(aspect, 1.0);
  float rad = length(fromCentre * aspectVec) / (0.5 * length(aspectVec));
  outputColor = vec4(mbAberrate(uv, fromCentre, rad, caAmount, inputColor.rgb), inputColor.a);
}
`;

/** The composed source. Exported so a probe can read what ships. */
export { ABERRATION_FRAGMENT };

/**
 * The standalone slot. Built only when a game routes its fringe AFTER the edge
 * resolve.
 *
 * `materialName` is REQUIRED for the reason `./Resolve.ts` requires one: two
 * games' aberration passes both calling themselves `Aberration` are two rows in
 * a WebGL frame capture nobody can tell apart.
 */
export class AberrationEffect extends Effect {
  constructor(opts: { materialName: string; minPixels: number; maxPixels: number }) {
    super(opts.materialName, ABERRATION_FRAGMENT, {
      // CONVOLUTION: it samples the input buffer at offsets, so it may not
      // share a pass with anything.
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['caAmount', new THREE.Uniform(0)],
        ['caLimits', new THREE.Uniform(new THREE.Vector2(opts.minPixels, opts.maxPixels))],
      ]),
    });
  }

  set amount(v: number) { (this.uniforms.get('caAmount') as THREE.Uniform).value = v; }
  get amount(): number { return (this.uniforms.get('caAmount') as THREE.Uniform).value as number; }
  get limits(): THREE.Vector2 { return this.uniforms.get('caLimits')!.value as THREE.Vector2; }
}
