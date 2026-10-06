/**
 * ===========================================================================
 *  @homie-rocks/postfx/Bloom.ts — what a bloom is allowed to do to a mip chain.
 * ===========================================================================
 *
 * THE SAME CATEGORY AS `Resolve.ts`: three capabilities that had exactly ONE
 * copy and were therefore invisible to every duplication census. A space racer
 * wrote an anamorphic stretch, an energy-weighted firefly guard and a per-level
 * upsample decay once each, and no duplication signal called that file anything
 * but clean while it carried them. Ask *"does this belong in a game"*, never
 * *"is there a twin"*.
 *
 * WHAT `ChainSpec` COULD NOT EXPRESS. `PostFXChain.build()` constructs one
 * `ScaledBloomEffect` and hands it a threshold, an intensity and a level cap.
 * There is no vocabulary in it for a SECOND bloom (an isotropic halo beside an
 * anamorphic streak), for tinting one of them, or for reaching into the mip
 * walk at all. So a game that wanted any of those had to own the whole chain.
 * This file is that vocabulary; `Chain.ts` is free to grow a consumer of it
 * later and nothing here requires that it does.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A HOOK INSTALLER AND NOT A SUBCLASS
 * ---------------------------------------------------------------------------
 * `postprocessing`'s `MipmapBlurPass.render` walks the levels itself, calling
 * `setSize(sourceWidth, sourceHeight)` on a SHARED material once per level,
 * immediately before that level's draw. There is nothing static to patch and,
 * better, there is a hook that runs per level. A subclass would have to
 * reimplement the walk; wrapping `setSize` rides it.
 *
 * Every reach into the library is GUARDED and says what a person will see when
 * it fails. If a future `postprocessing` renames the materials, the wrap is
 * skipped, the bloom is isotropic and the guard is off — a look change, loudly
 * logged, rather than a crash or a silent one. That is the shape `Grade.ts`
 * already uses for the bokeh materials and it is deliberate: a catch-all that
 * returns a plausible default is worse than a crash, and a look regression a
 * reviewer can read in the console is neither.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT CLAIM, AND IT IS THE HONEST HALF
 * ---------------------------------------------------------------------------
 * Another game has a SECOND anamorphic stretch and a SECOND secondary bloom,
 * and this file is deliberately NOT wired into it. Its stretch is not this one
 * with different numbers: it RAMPS the widening in over three levels
 * (`t = (level - first + 1) / 3`) where this switches it on at a level
 * boundary, and the two produce different mip chains on the same buffer. That
 * is a POLICY divergence, not a value one — a shared implementation would
 * compile, pass everything, and quietly make one game's lens the other's. The
 * shape here would take it: a `stretchAt(level): number` in place of
 * `firstStretchMip` covers both. But that is a job with both games' frames in
 * front of a person, not a paragraph in this one, so it is written down
 * rather than done.
 *
 * ---------------------------------------------------------------------------
 * EVERY FIELD REQUIRED. NO OPTIONALS, NO DEFAULTS.
 * ---------------------------------------------------------------------------
 * `BloomHooks` is four members and none may be omitted. These are the most
 * art-directed numbers in a post chain — `aspect` is whether a game has an
 * anamorphic lens at all, `seedCeiling` is the brightness above which a
 * specular sliver stops being allowed to spread, and `radiusDecay` decides how
 * much of the bloom is shape and how much is a pedestal. A game that got a
 * default here would inherit another game's identity and it would look
 * completely fine.
 *
 * DO NOT `node --check` THIS FILE — `fireflyFragment()` returns a large
 * template literal. See the same note in `Resolve.ts`.
 */
import * as THREE from 'three';
import { BloomEffect, BlendFunction } from 'postprocessing';

/**
 * The star-disc exemption, in the frame's own coordinates.
 *
 * A GAME MAY HAVE NO SUCH THING, and `null` is how it says so rather than a
 * radius of zero — zero is a value the smoothstep below would still evaluate,
 * and "there is no exempt object in this world" is a different statement from
 * "the exempt object is infinitely small". The chain pushes the live screen
 * position in every frame; this type is only the shape of what it pushes.
 */
export interface BloomGuardExempt {
  /** screen UV of the exempt disc's centre */
  u: number;
  v: number;
  /** guard radius in UV. Fully off inside 0.55 of it, fully on outside. */
  radiusUv: number;
}

/**
 * EXACTLY the four values `installBloomHooks` reads, derived by counting the
 * references rather than by handing it a look object it mostly ignores. Every
 * field required.
 *
 * The exempt radius and the streak tint are deliberately NOT in here: they are
 * arguments to `setBloomGuardExempt` and `tintBloom`, which are different
 * functions called at different times, and a struct with a field its own
 * function never reads is how a caller comes to believe it configured
 * something.
 *
 * The values the game these came from ships, for reference when a new game is
 * choosing its own — NOT exported as a preset, because a preset is a default
 * wearing a different hat: `aspect` 5.2 (1.0 for its isotropic halo),
 * `firstStretchMip` 2, `radiusDecay` 0.85, `seedCeiling` 12.0.
 */
export interface BloomHooks {
  /**
   * The anamorphic stretch, as a width ratio. 1.0 is isotropic and switches the
   * stretch off entirely (the hook checks `<= 1.0001` and returns early), which
   * is the honest way for a game with a spherical lens to say so.
   *
   * The stretch is applied by widening `texelSize.x` in the mip downsample, not
   * by a pass of its own: "no extra pass, no extra bandwidth". A separate
   * horizontal blur would be a full-screen read and write at the top of the
   * chain for something the chain is already doing.
   */
  aspect: number;
  /**
   * The first mip the horizontal stretch applies to, ZERO-INDEXED.
   *
   * The clause this implements — "the tight mips stay 1:1, or small bright
   * details lose their shape" — is the difference between an anamorphic lens
   * and a horizontal blur. Stretching the tight mips turns a 3.2 m hexagonal
   * ordnance gate into a dash before the streak has begun.
   */
  firstStretchMip: number;
  /**
   * Per-level decay on the UPSAMPLE lerp weight: `r(k) = radius * decay^k`.
   *
   * THE ARITHMETIC, because it is the whole argument and not a taste call.
   * `UpsamplingMaterial` is `mix(supportBuffer, tent(input), radius)` — a LERP
   * chain, not an additive accumulation — so with one shared radius `r` over
   * `L` levels the final mip 0 is a weighted sum of the downsample mips with
   * weights `w(k) = (1 - r) * r^k` for `k < L-1`, and `w(L-1) = r^(L-1)` for
   * the coarsest level, which has no lerp below it. At r = 0.78 over six levels
   * that is .220 .172 .134 .104 .081 | .289 — the coarsest mip carries 28.9% of
   * the bloom, more than any other level and more than mips 0 and 1 together.
   * That mip is ~17 rows tall and it is one of the levels the stretch widens
   * 5.2:1, so it holds no shape at all: it is the frame's own mean thresholded
   * radiance, smeared flat, added back over everything. A DC PEDESTAL laid over
   * a vacuum frame is indistinguishable from distance haze.
   *
   * MEASURED. Every frame in one review set had a top-band mean between 0.058
   * and 0.21 display; one had 0.464, flat to a standard deviation of 0.011 over
   * 200x300 px, with 9,000 stars sitting crisp and unblurred ON TOP of it.
   * Crisp stars rule out the depth-of-field pass and rule out the planet. A
   * flat, star-transparent, frame-wide lift that appears only in the one
   * vantage whose frame is 90% void is the pedestal.
   *
   * At 0.85 the same six levels come out .220 .265 .227 .150 .082 | .057 — the
   * energy moves out of the frame-wide level and into mips 1-3, which are the
   * ones that carry the streak. TOTAL ENERGY IS UNCHANGED: a lerp chain's
   * weights sum to exactly 1 whatever the radii are, so this is redistribution
   * and not a dimming, and an emitter's core is untouched because mip 0's
   * weight is literally the same number.
   *
   * 1.0 is "no decay", i.e. the library's own flat radius. It is a legitimate
   * value and a game that wants it must say it.
   */
  radiusDecay: number;
  /**
   * The bloom SEED ceiling, in scene-linear units — the half of the firefly
   * guard the coverage weighting structurally cannot do.
   *
   * `1 / (1 + luma)` is a COVERAGE statement: it asks "is this texel isolated?",
   * and over a locally uniform neighbourhood every weight is identical and
   * cancels exactly. That is the property that lets a resolved emitter bloom
   * untouched — and it is also why an isolated texel at 40 is discounted 36x
   * while a 3x3 patch at 40 is discounted by nothing at all. A specular sliver
   * on a 0.34 m truss chord is frequently the second kind: two or three
   * adjacent pixels along the chord all catch the same grazing lobe, so the
   * neighbourhood IS locally uniform and the guard correctly declines to touch
   * it. Six levels of downsample then spread that energy over a third of the
   * frame.
   *
   * IT IS ONLY EVER A BLOOM SEED. The clamp lives inside the mipmap chain's
   * first downsample, downstream of the luminance pass and upstream of nothing
   * but the blur — the composer's own colour buffer never sees it, so a game's
   * white point, its tone shoulder and every histogram gate measured on the
   * scene buffer or the final frame are bit-identical to before. This changes
   * how much a bright sliver SPREADS, not what it reads as where it is.
   *
   * `Infinity` is the honest spelling of "no ceiling". The shader clamps it to
   * half-float max, because the buffer cannot hold more than that anyway.
   */
  seedCeiling: number;
}

/**
 * THE FIREFLY GUARD — an energy-weighted first downsample.
 *
 * WHAT WAS MEASURED, in the game that wrote it. Three review frames came back
 * with a flat grey wash from edge to edge: a per-8x8-block MINIMUM of one of
 * them — the frame's own floor, the value nothing in the shot is darker than —
 * sat at display 0.44 against 0.09 on a good frame, and a horizontal scan
 * across the top-left corner climbed from 0.06 to 0.46 over 300 px with no edge
 * anywhere in it. A floor that high, lifted smoothly, over geometry as well as
 * over sky, is not fog and it is not a planet's limb. It is bloom.
 *
 * WHERE THE ENERGY COMES FROM, which is the part that matters. A threshold is a
 * statement about a SURFACE — "the deck sits at 0.10-0.30, so a gate at 1.35
 * selects only real emitters". A gate cannot tell a real emitter from a 0.34 m
 * truss diagonal at 400 m that covers a third of a pixel and happens to catch
 * the specular lobe of a 50.4-intensity key, or from one of 1,600 work floods
 * at 2.2 whose fixture has receded to 0.6 px. Both arrive at the threshold as a
 * full pixel at their peak value, so a receding field of them hands the mip
 * chain far more energy than it has any right to.
 *
 * THE FIX IS THE STANDARD ONE AND IT IS ENERGY-CORRECT. Weight each tap of the
 * FIRST downsample by `1 / (1 + luma)` and renormalise. Over a locally uniform
 * neighbourhood every weight is identical and cancels exactly, so a resolved
 * emitter blooms precisely as it did before. Over a neighbourhood where one
 * texel is 60 and twelve are 0, the isolated texel contributes its own
 * footprint instead of sixty times it.
 *
 * A FUNCTION AND NOT A CONSTANT, for the same reason as `resolveFragment`: the
 * seed ceiling is interpolated into the source, so a module-level string would
 * have baked one game's number into the package.
 */
export function fireflyFragment(seedCeiling: number): string {
  // Infinity has no GLSL literal and `1.0/0.0` is a compile error on some
  // drivers. 65504 is half-float max and the buffer cannot hold more, so this
  // is "no ceiling" spelled in a number the shader can actually carry — the
  // same value the un-guarded branch already used.
  const ceiling = Number.isFinite(seedCeiling) ? Math.min(seedCeiling, 65504) : 65504;
  return /* glsl */`
#ifdef FRAMEBUFFER_PRECISION_HIGH
uniform mediump sampler2D inputBuffer;
#else
uniform lowp sampler2D inputBuffer;
#endif

/** 1 on the first downsample, 0 on every level below it. See installBloomHooks. */
uniform float uKaris;
/** xy: the exempt disc's screen UV. z: guard radius in UV, or <= 0 for "none". */
uniform vec3 uStarGuard;

#define WEIGHT_INNER 0.125
#define WEIGHT_OUTER 0.05556

varying vec2 vUv;
varying vec2 vUv00; varying vec2 vUv01; varying vec2 vUv02; varying vec2 vUv03;
varying vec2 vUv04; varying vec2 vUv05; varying vec2 vUv06; varying vec2 vUv07;
varying vec2 vUv08; varying vec2 vUv09; varying vec2 vUv10; varying vec2 vUv11;

float clampToBorder(const in vec2 uv) {
	return float(uv.s >= 0.0 && uv.s <= 1.0 && uv.t >= 0.0 && uv.t <= 1.0);
}

// Both accumulators are built from the SAME thirteen fetches, so the guard
// costs arithmetic and not bandwidth — which is the whole reason it can live
// here rather than in a prefilter pass of its own.
//
// ceilScale is the SEED CEILING, pre-multiplied by the same guard scalar the
// coverage weighting uses so the exempt disc is exempt from both at once: it is
// the authored ceiling where the guard is on, and a number nothing can reach
// where it is off. Applied per-CHANNEL rather than on luma, because a saturated
// amber sliver at (40, 12, 2) has a luminance of only 17 and it is the red
// channel that has to come down; scaling by a luma ratio would leave it at 28.
void tap(const in vec2 uv, const in float weight, const in float ceilScale,
         inout vec4 plain, inout vec4 karis, inout float wsum) {
	vec4 s = texture2D(inputBuffer, uv);
	s.rgb = min(max(s.rgb, vec3(0.0)), vec3(ceilScale));
	float w = weight * clampToBorder(uv);
	plain += w * s;
	// Rec.709 luma, the same measure the threshold pass selected on, so a tap
	// that only just cleared the gate is only just discounted.
	float l = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
	float k = w / (1.0 + l);
	karis += k * s;
	wsum += k;
}

void main() {
	float g = uKaris;
	if (uStarGuard.z > 0.0) {
		// Fully off inside 0.55 of the radius, fully on outside it. Smooth,
		// because a hard disc would put a visible ring in the streak's collar
		// the moment the exempt object crossed a fixture field.
		g *= smoothstep(uStarGuard.z * 0.55, uStarGuard.z, distance(vUv, uStarGuard.xy));
	}
	// 65504 is half-float max: at g = 0 this is "no ceiling" expressed without a
	// branch, and the buffer cannot hold more than that anyway.
	float ceilScale = mix(65504.0, ${ceiling.toFixed(1)}, g);

	vec4 plain = vec4(0.0);
	vec4 karis = vec4(0.0);
	float wsum = 0.0;

	tap(vUv00, WEIGHT_INNER, ceilScale, plain, karis, wsum);
	tap(vUv01, WEIGHT_INNER, ceilScale, plain, karis, wsum);
	tap(vUv02, WEIGHT_INNER, ceilScale, plain, karis, wsum);
	tap(vUv03, WEIGHT_INNER, ceilScale, plain, karis, wsum);
	tap(vUv04, WEIGHT_OUTER, ceilScale, plain, karis, wsum);
	tap(vUv05, WEIGHT_OUTER, ceilScale, plain, karis, wsum);
	tap(vUv06, WEIGHT_OUTER, ceilScale, plain, karis, wsum);
	tap(vUv07, WEIGHT_OUTER, ceilScale, plain, karis, wsum);
	tap(vUv08, WEIGHT_OUTER, ceilScale, plain, karis, wsum);
	tap(vUv09, WEIGHT_OUTER, ceilScale, plain, karis, wsum);
	tap(vUv10, WEIGHT_OUTER, ceilScale, plain, karis, wsum);
	tap(vUv11, WEIGHT_OUTER, ceilScale, plain, karis, wsum);
	tap(vUv,   WEIGHT_OUTER, ceilScale, plain, karis, wsum);

	gl_FragColor = mix(plain, karis / max(wsum, 1e-4), g);

	#include <colorspace_fragment>
}
`;
}

/**
 * Install both hooks on a `BloomEffect`'s mip chain, in place: the anamorphic
 * X-stretch and the firefly guard above.
 *
 * Wrap `setSize`, recover the level index from the width it is handed (level i
 * is sourced from base / 2^i), widen `texelSize.x` from `firstStretchMip`
 * onward, decay the upsample radius per level, and raise `uKaris` on level 0
 * alone.
 *
 * LEVEL 0 ALONE, and that is not a saving. The guard's whole claim is that it
 * knows a tap's SCREEN COVERAGE, which is only true while the buffer is still
 * at screen resolution; one level down a legitimate 4 px emitter is 2 px and
 * would start being discounted as a firefly. Running it once at the top is what
 * makes it a coverage statement rather than a contrast filter.
 *
 * @returns the downsampling material, so the chain can push the exempt object's
 *   live screen position into it every frame — or `null` when the hook could
 *   not be installed, which the caller must treat as "there is no guard" rather
 *   than as an error.
 */
export function installBloomHooks(
  bloom: BloomEffect, radius: number, hooks: BloomHooks,
): THREE.ShaderMaterial | null {
  const pass = (bloom as unknown as { mipmapBlurPass?: any }).mipmapBlurPass;
  const down = pass?.downsamplingMaterial;
  const up = pass?.upsamplingMaterial;
  if (!down || !up || typeof down.setSize !== 'function' || typeof up.setSize !== 'function') {
    console.warn('[postfx] mipmap blur materials not found; bloom will be isotropic, '
      + 'the anamorphic streak will be missing, and the firefly guard that keeps a '
      + 'receding field of small emitters out of the top mip will be off');
    return null;
  }

  // The guard replaces the stock downsample shader outright. Same varyings,
  // same thirteen taps, same weights — so with `uKaris` at 0 it is the stock
  // pass to the bit, which is what makes the level test below meaningful.
  down.fragmentShader = fireflyFragment(hooks.seedCeiling);
  down.uniforms.uKaris = new THREE.Uniform(0);
  down.uniforms.uStarGuard = new THREE.Uniform(new THREE.Vector3(0.5, 0.5, -1));
  down.needsUpdate = true;

  // `MipmapBlurPass.render` hands the material the SOURCE buffer's size, so
  // the level index falls out of how many halvings that is from the pass's own
  // resolution. On the way DOWN, source level i produces mip i. On the way UP,
  // source level i produces mip i-1 — so the offset differs, and getting it
  // wrong stretches the finest upsample step, which is precisely the step that
  // must stay 1:1.
  for (const [mat, offset] of [[down, 0], [up, -1]] as [any, number][]) {
    const original = mat.setSize.bind(mat);
    mat.setSize = (width: number, height: number) => {
      original(width, height);
      // Rounded rather than floored: the chain rounds odd sizes on the way
      // down, so log2 of 959/1920 is not quite 1.
      const base = pass.resolution?.x ?? width;
      const level =
        Math.max(0, Math.round(Math.log2(Math.max(base, 1) / Math.max(width, 1)))) + offset;
      const karis = mat.uniforms?.uKaris;
      if (karis !== undefined) karis.value = level === 0 ? 1 : 0;
      // THE PER-LEVEL LERP WEIGHT. See `radiusDecay` for the arithmetic and for
      // what a flat radius does to a vacuum frame. `level` here is the
      // DESTINATION mip (the offset above is what makes that true), which is the
      // index the weight product is written against, so `radius * decay^level`
      // hands mip 0 exactly the radius the effect was constructed with and
      // tapers only the levels that have no shape left to carry.
      //
      // Written on every setSize rather than once, because the material is
      // SHARED across the whole upsample walk — postprocessing sets it per level
      // immediately before that level's draw, so a value assigned once would be
      // whatever the last level left behind.
      const rad = mat.uniforms?.radius;
      if (rad !== undefined && offset < 0) {
        rad.value = radius * Math.pow(hooks.radiusDecay, Math.max(level, 0));
      }
      const texel = mat.uniforms?.texelSize?.value;
      if (!texel || hooks.aspect <= 1.0001) return;
      if (level >= hooks.firstStretchMip) texel.x *= hooks.aspect;
    };
  }
  return down as THREE.ShaderMaterial;
}

/**
 * Push the exempt object's live screen position into a downsampling material
 * `installBloomHooks` returned. `null` means "there is nothing exempt this
 * frame", which is a different statement from a radius of zero — see
 * {@link BloomGuardExempt}.
 *
 * Tolerant of a null material, because that is what `installBloomHooks`
 * returns when the library moved underneath it and the caller should not have
 * to branch twice for one condition.
 */
export function setBloomGuardExempt(
  material: THREE.ShaderMaterial | null, exempt: BloomGuardExempt | null,
): void {
  const u = material?.uniforms?.uStarGuard?.value as THREE.Vector3 | undefined;
  if (u === undefined) return;
  if (exempt === null) u.set(0.5, 0.5, -1);
  else u.set(exempt.u, exempt.v, exempt.radiusUv);
}

/**
 * Tint a `BloomEffect`'s output. postprocessing's bloom shader is
 * `texture2D(map, uv) * intensity` with no colour channel, so a tinted streak
 * needs one added.
 *
 * `setFragmentShader` is the library's own protected setter and it calls
 * `setChanged()`, so the pass rebuilds correctly; adding the uniform before the
 * effect joins an `EffectPass` is what gets it collected. Tinted at UNIT
 * LUMINANCE so this can only ever rotate the streak's hue — see `tintHex`.
 */
export function tintBloom(bloom: BloomEffect, hex: number): void {
  const c = new THREE.Color(hex);
  const lum = Math.max(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, 1e-5);
  c.setRGB(c.r / lum, c.g / lum, c.b / lum, THREE.LinearSRGBColorSpace);
  const eff = bloom as unknown as {
    uniforms: Map<string, THREE.Uniform>;
    setFragmentShader?: (s: string) => void;
  };
  if (typeof eff.setFragmentShader !== 'function') {
    console.warn('[postfx] BloomEffect.setFragmentShader is gone; the anamorphic '
      + 'streak will carry its source colour instead of its authored tint');
    return;
  }
  eff.uniforms.set('bloomTint', new THREE.Uniform(c));
  eff.setFragmentShader(/* glsl */`
#ifdef FRAMEBUFFER_PRECISION_HIGH
uniform mediump sampler2D map;
#else
uniform lowp sampler2D map;
#endif
uniform float intensity;
uniform vec3 bloomTint;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
	outputColor = texture2D(map, uv) * intensity;
	outputColor.rgb *= bloomTint;
}
`);
}

/**
 * WIDEN A BLOOM'S MIP CHAIN HORIZONTALLY, BY A MULTIPLIER THE CALLER CHOOSES
 * PER LEVEL.
 *
 * This is the second half of `installBloomHooks`'s stretch, published on its
 * own and taking a FUNCTION where that one takes `aspect` and
 * `firstStretchMip`. The header of this file gives the reason: one game
 * switches the widening on at a level boundary and another RAMPS
 * it in over three levels, and those two produce different mip chains on the
 * same buffer. That is a POLICY divergence, not a value one — a shared
 * implementation would compile, pass everything, and quietly give one game the
 * other's streak. `stretchAt(level)` is the shape that takes both, so the
 * policy stays at the call site where it can be read beside the frame it was
 * fitted against.
 *
 * `level` is the DESTINATION mip on the way up and the source's own level on
 * the way down, which is the same index in both walks for this purpose: it is
 * the level whose texel size is about to be written. Return 1 for no stretch.
 *
 * ## How, and why it is a wrap and not a subclass
 *
 * `MipmapBlurPass.render` walks the levels itself, calling
 * `setSize(sourceWidth, sourceHeight)` on a SHARED material once per level,
 * immediately before that level's draw, and `setSize` does nothing but write
 * `texelSize = (1/w, 1/h)`. Scaling only X widens the kernel's horizontal reach
 * and leaves the vertical alone — an anamorphic blur for zero extra passes and
 * zero extra bandwidth. There is nothing static to patch and there is a hook
 * that runs per level; a subclass would have to reimplement the walk.
 *
 * The level is recovered from the WIDTH RATIO and not from a counter, because
 * the library gives no level index and a counter desynchronises the moment the
 * pass renders twice in a frame. Rounded rather than floored: the chain rounds
 * odd sizes on the way down, so log2 of 959/1920 is not quite 1.
 *
 * ## Guarded, and it says what a person will see
 *
 * If a future `postprocessing` renames the materials, the wrap is skipped, the
 * bloom is isotropic, and that is logged — a look change a reviewer can read in
 * the console, rather than a crash or a silent one. Returns whether it armed,
 * so a caller that wants to assert its own streak exists can.
 */
export function stretchMipChain(
  bloom: BloomEffect, stretchAt: (level: number) => number,
): boolean {
  const pass = (bloom as unknown as { mipmapBlurPass?: any }).mipmapBlurPass;
  const ds = pass?.downsamplingMaterial;
  const us = pass?.upsamplingMaterial;
  if (ds?.uniforms?.texelSize === undefined || us?.uniforms?.texelSize === undefined) {
    console.warn('[postfx] MipmapBlurPass internals not found; bloom stays isotropic');
    return false;
  }
  const patch = (mat: any) => {
    mat.setSize = (w: number, h: number) => {
      const baseW = Math.max(1, pass.resolution.x || w);
      const level = Math.max(0, Math.round(Math.log2(Math.max(1, baseW / Math.max(1, w)))));
      mat.uniforms.texelSize.value.set(stretchAt(level) / w, 1 / h);
    };
  };
  patch(ds);
  patch(us);
  return true;
}

// ---------------------------------------------------------------------------
// TintedBloomEffect — a tinted composite, a non-finite scrub, and the stretch
// ---------------------------------------------------------------------------

/**
 * Every number a tinted bloom runs on. NO DEFAULTS, for `BloomHooks`' reason:
 * a threshold, an intensity and a tint ARE a game's identity, and a default
 * here would hand the next one this one's lens while looking completely fine.
 */
export interface TintedBloomSpec {
  /** Scene-linear luminance above which a texel contributes. */
  threshold: number;
  /** Width of the soft knee under `threshold`. */
  smoothing: number;
  intensity: number;
  radius: number;
  levels: number;
  /**
   * Multiplied into the composite, in the RENDERER'S WORKING SPACE.
   *
   * It is a `Color` and not a hex on purpose: a hex would make this function
   * decide a colour space, and that decision is the single most common silent
   * bug in these games (see `workingColor` in @homie-rocks/render/databake).
   * The caller has already decided; it hands the answer.
   */
  tint: THREE.Color;
  /**
   * |channel| at or above this is dropped to zero before the tint. See
   * `tintedBloomFragment` for what it is defending against and why it cannot
   * live upstream. A game that genuinely wants no scrub passes Infinity, and
   * then pays for that decision by name.
   */
  finiteBound: number;
  /**
   * null = isotropic. Otherwise the per-level horizontal multiplier handed to
   * `stretchMipChain` — the RAMP is the caller's, because a ramp and a step are
   * two different lenses and neither is arithmetic.
   */
  stretchAt: ((level: number) => number) | null;
}

/*
 * ===========================================================================
 *  NO BACKTICKS BELOW THIS LINE (until the end of the last template literal).
 *
 *  A backtick inside a GLSL template literal ends the string and the rest of
 *  the file parses as TypeScript, failing 100-200 lines later. Under Vite the
 *  module 500s and the game does not boot, which looks exactly like a slow
 *  load. Do not write identifiers in backticks in any comment below.
 * ===========================================================================
 */

/**
 * postprocessing's bloom composite is one line:
 *     outputColor = texture2D(map, uv) * intensity;
 * This adds a tint multiply and a non-finite scrub.
 *
 * TINTING ANYWHERE ELSE IN THE CHAIN IS WRONG. Tinting the mip materials
 * applies once per level and compounds; tinting after the grade is impossible,
 * because bloom has already been added by then.
 *
 * THE SCRUB IS A MEASURED FIX AND NOT A BELT AND BRACES. Arrived from a
 * base-building game, where at one close framing this bloom turned roughly a
 * third of the frame into flat near-black in rectangular blocks with hard
 * axis-aligned edges. Bisecting the chain pass by pass put it on this effect
 * alone, and it reproduced on real hardware (ANGLE Metal, Apple M5) as well as
 * on SwiftShader. One non-finite texel in the scene-linear HDR buffer enters
 * the mipmap blur; the downsample carries it into a level-5 or level-6 texel,
 * which covers 32-64 SCREEN pixels; the upsample spreads that block back out;
 * and this pass ADDs the result, so NaN wins the whole block. That mechanism
 * explains every symptom that made it look like a mystery occluder: the edges
 * are axis-aligned because they are mip texel boundaries, the shape moves with
 * the resolution and with unrelated hidden objects because different texels
 * catch it, no per-object visibility ablation removes it, and a raycast finds
 * ordinary geometry behind it.
 *
 * Scrubbing HERE fixes the picture for any upstream source, and the failure
 * mode of the guard is benign: a block that would have been NaN contributes no
 * bloom instead of destroying the frame.
 */
export function tintedBloomFragment(finiteBound: number): string {
  const bound = Number.isFinite(finiteBound) ? finiteBound : 65504;
  return /* glsl */ `
#ifdef FRAMEBUFFER_PRECISION_HIGH
uniform mediump sampler2D map;
#else
uniform lowp sampler2D map;
#endif
uniform float intensity;
uniform vec3 bloomTint;

// Written as a relational test against a finite bound, NOT the idiomatic
// self-compare (x != x) — that is the one NaN test a compiler may fold to a
// constant, and ANGLE does exactly that.
vec3 pfxFiniteBloom(vec3 v) {
  bvec3 ok = lessThan(abs(v), vec3(${bound.toFixed(1)}));
  return vec3(ok.x ? v.x : 0.0, ok.y ? v.y : 0.0, ok.z ? v.z : 0.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec4 b = texture2D(map, uv);
  // Alpha is scaled by intensity exactly as the original whole-vec4 multiply
  // did. Leaving it unscaled looks harmless and is not: this effect blends with
  // ADD, the blend reads the alpha, and dropping the factor moved the measured
  // luma of one game's intimate shot by 20 code values.
  // max() against zero as well: a negative here SUBTRACTS light from the frame,
  // the same class of silent failure one shade less severe.
  outputColor = vec4(max(pfxFiniteBloom(b.rgb), vec3(0.0)) * intensity, b.a * intensity);
  outputColor.rgb *= bloomTint;
}
`;
}

/**
 * BloomEffect with a tint, a non-finite scrub and an optional stretch.
 *
 * ADD, NOT SCREEN, and that is not a preference: the buffer is scene-linear
 * HDR, screen blending values above 1 actually DARKENS them, and bloom is
 * light being added.
 *
 * Both the uniform and the shader are set before the effect is ever handed to
 * an EffectPass, which is when the pass reads them. `setFragmentShader` is
 * protected on `Effect`, i.e. exactly this use.
 *
 * Arrived from one game's post-processing module, which was its only
 * implementation. Nothing in it is about that game: it is a composite, a NaN
 * test and a texel size.
 */
export class TintedBloomEffect extends BloomEffect {
  constructor(spec: TintedBloomSpec) {
    super({
      blendFunction: BlendFunction.ADD,
      luminanceThreshold: spec.threshold,
      luminanceSmoothing: spec.smoothing,
      mipmapBlur: true,
      intensity: spec.intensity,
      radius: spec.radius,
      levels: spec.levels,
    });
    this.uniforms.set('bloomTint', new THREE.Uniform(spec.tint));
    (this as unknown as { setFragmentShader(s: string): void })
      .setFragmentShader(tintedBloomFragment(spec.finiteBound));
    if (spec.stretchAt !== null) stretchMipChain(this, spec.stretchAt);
  }
}

// ---------------------------------------------------------------------------
//  BLOOM REACH, IN SCREEN TERMS RATHER THAN IN LEVELS
// ---------------------------------------------------------------------------

/**
 * The rows the TOP mip is held at, which is the invariant a level count is only
 * a proxy for. Adopted from a space racer's post-processing module, the only
 * one of the five post chains that had worked this out.
 *
 * The art bible states the clause as a REACH IN PIXELS: "a seventh level
 * reaches ~128 px at the top mip and smears the star and the gantry floods into
 * a formless veil across the vanishing point", and it states it AT 1080p. A
 * level count is not that number. `renderScale`, the adaptive ladder and every
 * handheld rung move the buffer under a fixed count, and a chain of N levels
 * over a buffer at 0.62 reaches the same ABSOLUTE fraction of the buffer as a
 * chain of N levels at 1.0 — but the FRAME is what a person sees, so the veil
 * arrives a level early in screen terms and nothing in the tier check notices.
 *
 * Six levels over 1080 rows puts the top mip at 1080 / 2^6 = 17 rows. Holding
 * that as the invariant reproduces 6 at 1080p EXACTLY, which is why this
 * changes nothing about the frame anybody has ever reviewed.
 */
export const BLOOM_TOP_MIP_ROWS = 17;

/**
 * The level count for a buffer this tall, never above the tier's own cap.
 *
 * Exported because it is a good thing and the next chain to want it should
 * import it rather than write it again. The space racer still carries its own
 * copy: its post chain is a different file and has not adopted this package,
 * and reaching into a game whose chain was deliberately left alone (its
 * overlap with the kart racer is 141 lines in 48 fragments, longest 12) to save
 * five lines is how an extraction acquires a merge conflict it did not need.
 */
export function bloomLevels(bufferHeight: number, tierMax: number): number {
  const rows = Math.max(1, bufferHeight);
  const fit = Math.round(Math.log2(rows / BLOOM_TOP_MIP_ROWS));
  return Math.max(1, Math.min(tierMax, fit));
}
