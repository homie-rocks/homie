/**
 * ===========================================================================
 *  @homie-rocks/postfx/Grade.ts — the grade shader, and the numbers that drive it.
 * ===========================================================================
 *
 * MOVED HERE, NOT REWRITTEN. This was lines 1-1033 of the post-processing
 * module in BOTH a first-person shooter and a kart racer, and the two were not
 * "similar": the same checksum, 1,033 lines BYTE-IDENTICAL. The two whole
 * files differed by 41 lines and every one of them was at 1034 or beyond. So
 * there was no flag to invent and nothing to parameterise: this is the same
 * THING rather than the same SHAPE, and it is the rare case where that is a
 * measurement rather than a judgement.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SEAM IS AT 1033 AND NOT AT THE FILE
 * ---------------------------------------------------------------------------
 * Because that is where `Ctx` starts. The whole original file mentions `Ctx`
 * three times — the import, `build(ctx: Ctx, …)` and `sync(ctx: Ctx, …)` — and
 * the two uses are BOTH past 1033. Inside this block the only occurrence was
 * the import line, which is why it is gone: nothing here needed it.
 *
 * `Ctx` carries `race`, `track`, `items`, `match`, `combat` and `colony`. One
 * `import type` would put every one of those inside `packages/`, which is the
 * seam a package must never cross — import type included. The half of the chain
 * that knows what a `ctx.race?.player` is is the ORCHESTRATOR, and the
 * orchestrator stays in each game.
 *
 * The vocabulary scan that decides platform-or-genre, run over this block
 * rather than assumed: `race` 0, `colony` 0, `combat` 0, `match` 0. `lap` 4,
 * `item` 1, `track` 3, `player` 4, `kart` 16 — every single one inside a
 * COMMENT, and `round` only ever as `Math.round`. Not one identifier here
 * names a thing a game owns. The comments are kept VERBATIM and they do say
 * "the player's kart", because the sentence beside a constant is the
 * measurement that produced it: `SUBJECT_HOLD = 2.05` is only readable next to
 * "the kart is 2.1 m long". Provenance, not vocabulary — the same call
 * `@homie-rocks/fx`, `@homie-rocks/audio` and `@homie-rocks/render` each made,
 * and for the same reason: a comment that looks wrong may be load-bearing for
 * a reason you have not found yet.
 *
 * ---------------------------------------------------------------------------
 * WHAT DID *NOT* COME, AND IT IS TWO LINES, MEASURED RATHER THAN GUESSED
 * ---------------------------------------------------------------------------
 * `_viewProj` and `_dofTarget` — the two module-scope scratch objects that sat
 * at 872-873 — are declared inside the byte-identical block and used ZERO
 * times inside it. Every reference is in the orchestrator (1289, 1487-1494,
 * 1647-1648). They stayed in the game, so this package exports no shared
 * mutable buffer that two consumers could stand on. Extraction promotes
 * authority: a scratch matrix in `packages/` is a platform capability the next
 * four games would wire themselves to, and it is four words in a game.
 *
 * ---------------------------------------------------------------------------
 * THE LOOK CONSTANTS ARE SHARED AS VALUES A GAME CAN STILL REACH
 * ---------------------------------------------------------------------------
 * `CA_REST`, `CA_BOOST`, `VIGNETTE_*`, `STREAK_*`, `IGNITE_*`, `SPEED_FLATOUT`,
 * `KICK_*`, `SUBJECT_*` are exported because both games hold the same numbers
 * today. The risk is plain — these are the most art-directed numbers in the
 * chain, and a package that made
 * a per-game vignette hard would be worse than two copies.
 *
 * It does not make it hard, and the mechanism is structural rather than a
 * promise: every one of these is read by the GAME'S OWN orchestrator, never by
 * anything in this file. A game that wants its own number stops importing that
 * name and declares it — one line, in its own `PostFX.ts`, next to the code
 * that reads it. Nothing here has to grow an options struct for that to work,
 * and nothing here can silently pick one game's art direction for the other.
 *
 * The one number this file reads itself is `DOF_INTERNAL_SCALE`, which is a
 * buffer size and not a look.
 *
 * ---------------------------------------------------------------------------
 * THE IMPORTS, MEASURED RATHER THAN PLANNED
 * ---------------------------------------------------------------------------
 * The extraction plan expected the block's imports to be three,
 * postprocessing, n8ao and @homie-rocks/postfx/Clock.js. Measured over lines
 * 53-1033 with the import
 * statements themselves excluded: `n8ao` is used 0 times here and
 * `createFrameClock` / `holdPassClocks` 0 times — all four are the
 * ORCHESTRATOR's, and they went nowhere. What this block actually needs is
 * `three` and four names from `postprocessing`. `wrapAudit`'s single mention
 * at old line 167 is a comment pointing at where the audit is run, which is
 * `build()`, which is past the seam.
 *
 * `three` is a peerDependency and must stay one. Two copies of three.js is two
 * `instanceof` universes and the symptom is an object that renders as nothing,
 * with no error at all.
 *
 * ---------------------------------------------------------------------------
 * DO NOT `node --check` THIS FILE
 * ---------------------------------------------------------------------------
 * `GRADE_FRAGMENT` below is a ~477-line template literal. A backtick inside a
 * comment inside one of those closed the literal and removed a whole runtime
 * module from existence once already, and `node --check` disagreed because it
 * parses ES modules as CommonJS. The thing that proves this module parses is a
 * grade probe booting a real Vite and a real Chrome and watching
 * `window.__gameReady` go true.
 */
import * as THREE from 'three';
import {
  BlendFunction,
  DepthOfFieldEffect,
  Effect,
  EffectAttribute,
} from 'postprocessing';

/**
 * The fraction of the drawing buffer the depth-of-field effect runs its own
 * targets at. See {@link ScaledDepthOfFieldEffect}.
 */
export const DOF_INTERNAL_SCALE = 0.5;

/**
 * WHAT THE DEPTH OF FIELD IS NOT ALLOWED TO TOUCH.
 *
 * A capability this package did not have until 2026-08-21, and the game that
 * did have it (a space racer) could not adopt `PostFXChain` partly because of
 * it. It is `null` for a game that wants the library's own honest
 * lens, and that is a STATEMENT rather than an absence — see `ChainLook`.
 *
 * WHY IT IS THREE NUMBERS AND NOT A BOOLEAN. All three answer different
 * questions and only one of them is "should the sky be sharp":
 *
 *  1. THE BACKGROUND IS EXEMPT ENTIRELY. A sky drawn `depthWrite: false` still
 *     carries the CLEARED depth, so a single compare against `depth` catches
 *     every sky fragment and nothing else. A lens focused at ten metres would
 *     blur an object at infinity; a frame that needs its starfield to carry the
 *     empty half and its planet to be the only compositional anchor cannot
 *     afford the honesty. One compare, one early out.
 *  2. THE FAR HALF IS CAPPED. A far field held at full bokeh from 186 m to the
 *     horizon is a distance-graded loss of contrast applied to a vacuum —
 *     aerial perspective arrived at through the lens instead of through a fog
 *     term. Capping the COMPOSITE blend keeps far-field softening as a depth
 *     cue while leaving 0.90 m truss chords resolvable.
 *  3. THE NEAR HALF IS CAPPED HARDER, because near-field scale detail and the
 *     near-field speed cue both live in the nearest 6-15 m and both are gone if
 *     that band is allowed into a full-strength near CoC on a corner entry
 *     where the focus target swings.
 *
 * THE CAPS ARE EXPRESSED AS BLEND, NOT AS CoC, ON PURPOSE. The composite is
 * `min(coc * bokehScale, 1.0)`, so a CoC ceiling written directly would
 * silently mean something different the moment `bokehScale` moved. The CoC
 * clamp is derived from these and the authored scale, so both numbers keep
 * their meaning.
 */
export interface DofBackgroundCap {
  /**
   * Depth at or above which a fragment is "the background" and gets CoC 0.
   * 0.999999 rather than 1.0: a cleared depth buffer reads 1.0 exactly on every
   * driver this has been run on, and a strict compare against it is one ULP
   * away from being a lens that never exempts anything.
   */
  depth: number;
  /** Ceiling on the FAR composite blend, 0..1. */
  farBlendCap: number;
  /** Ceiling on the NEAR composite blend, 0..1. Tighter than far; see above. */
  nearBlendCap: number;
}

/**
 * Rewrites `CircleOfConfusionMaterial`'s `main()` so the background is exempt
 * and both halves of the curve are capped.
 *
 * The whole of `main` is replaced rather than one line of it patched, because
 * postprocessing ships that shader minified onto a single line and an anchor
 * inside it is a hostage to whitespace. The helpers it calls (`readDepth`,
 * `getViewPosition`, `getDistance`) are declared above `main` and are what the
 * guard below actually checks for — if a future version renames them the shader
 * is left exactly as the library authored it and says so, which is a look
 * regression a reviewer can read in the console rather than a shader that fails
 * to compile.
 *
 * Exported so a chain that builds its own depth of field can apply the same
 * policy without reconstructing the anchor test, which is the part that rots.
 */
export function clampCircleOfConfusion(
  material: THREE.ShaderMaterial, bokehScale: number, cap: DofBackgroundCap,
): void {
  const src = material.fragmentShader;
  const start = src.indexOf('void main()');
  if (start < 0
    || !src.includes('readDepth') || !src.includes('getViewPosition')
    || !src.includes('focusDistance') || !src.includes('focusRange')) {
    console.warn('[postfx] CircleOfConfusionMaterial does not look like postprocessing 6.3x; '
      + 'the depth-of-field pass will keep blurring the background into a flat grey '
      + 'plane instead of leaving it exempt');
    return;
  }
  const near = Math.min(1, cap.nearBlendCap / Math.max(bokehScale, 1e-3));
  const far = Math.min(1, cap.farBlendCap / Math.max(bokehScale, 1e-3));
  material.fragmentShader = src.slice(0, start) + /* glsl */ `
void main() {
  float depth = readDepth(vUv);
  // Nothing was rasterised here, so this is the background: whatever the sky
  // pass drew with depthWrite off. See DofBackgroundCap for why a lens that is
  // honest about infinity is the wrong lens for a frame whose empty half is
  // carrying the composition. Exempt, at zero cost — one compare, one early out.
  if (depth >= ${cap.depth}) {
    gl_FragColor.rg = vec2(0.0);
    return;
  }
  vec3 viewPosition = getViewPosition(vUv, depth);
  float signedDistance = getDistance(viewPosition) - focusDistance;
  float magnitude = smoothstep(0.0, focusRange, abs(signedDistance));
  gl_FragColor.rg = min(
    magnitude * vec2(step(signedDistance, 0.0), step(0.0, signedDistance)),
    vec2(${near.toFixed(4)}, ${far.toFixed(4)}));
}
`;
  material.needsUpdate = true;
}

/**
 * Apply a background policy to a built depth-of-field effect. `null` is a
 * statement — "the library's own lens, honest about infinity" — and does
 * nothing at all, which is why this is safe to call unconditionally.
 *
 * A FREE FUNCTION AND NOT A CONSTRUCTOR OPTION, and the reason is an
 * instrument rather than a taste. The chain probe drives a PINNED pre-move
 * copy of two games' chains beside the live one, and that pinned source
 * imports `ScaledDepthOfFieldEffect` from THIS FILE — so a new required field
 * on the constructor is a field the pinned side cannot pass, and the probe goes
 * BLOCKED. The probe checksums the pin on every run precisely so nobody
 * "fixes" that by editing the baseline, and a baseline somebody tidied
 * is not a baseline. Adding the capability beside the constructor instead
 * leaves the pin valid and measuring, and costs one line at each call site.
 *
 * The `cocMaterial` is constructed inside `DepthOfFieldEffect`'s own
 * constructor, so it exists the moment `new` returns; calling this any time
 * before the first render is equivalent to doing it inside.
 */
export function applyDofBackground(
  dof: DepthOfFieldEffect, bokehScale: number, cap: DofBackgroundCap | null,
): void {
  if (cap === null) return;
  const coc = (dof as unknown as { cocMaterial?: THREE.ShaderMaterial }).cocMaterial;
  if (coc === undefined) {
    console.warn('[postfx] DepthOfFieldEffect.cocMaterial is gone; the background '
      + 'exemption this game asked for cannot be applied and the sky will be '
      + 'blurred into a flat plane');
    return;
  }
  clampCircleOfConfusion(coc, bokehScale, cap);
}

/**
 * DepthOfFieldEffect with ALL of its internal targets scaled, not just some.
 *
 * `resolutionScale: 0.5` reads like it halves the effect. It does not. Read
 * postprocessing 6.39's `DepthOfFieldEffect.setSize`: `renderTargetFar`,
 * `renderTargetCoC` and `renderTargetMasked` are sized at the FULL base
 * resolution, and only `renderTarget`, `renderTargetNear` and
 * `renderTargetCoCBlurred` get the scale. Probed on this build at 1920x1080,
 * which is how the split was found rather than assumed:
 *
 *   renderTargetMasked  1920x1080 HalfFloat      renderTarget         960x540
 *   renderTargetFar     1920x1080 HalfFloat      renderTargetNear     960x540
 *   renderTargetCoC     1920x1080 RGBA8          renderTargetCoCBlurred 960x540
 *
 * `update()` runs seven full-screen passes over those, four of them full-res,
 * plus a four-iteration Kawase blur — 9.85 Mpx of full-screen writes per frame
 * against a 2.07 Mpx screen. That is 4.75 screens of fill, and it is the single
 * largest item in the post chain after the AO pass, for an effect the comment
 * at its call site correctly describes as "garnish only".
 *
 * Halving the BASE and letting the library's own scale apply on top puts the
 * first tier at 960x540 and the second at 480x270:
 *
 *   full-screen writes per frame   9.85 Mpx -> 2.46 Mpx   (-75%)
 *   render target memory           51.9 MB  -> 12.9 MB
 *   full-res (2.07 Mpx) targets in the whole chain  9 -> 6
 *
 * THE BOKEH RADIUS IS HELD, and that took a second edit rather than one.
 * `BokehMaterial` steps its kernel by `texelSize * scale`, and `texelSize` is
 * `1 / whatever width the material was told about` — so halving the base
 * DOUBLES the screen-space blur, which is a visible change to an authored art
 * parameter smuggled in under a performance change. It showed: on the
 * starting-grid shot a distant landmark and the far grandstand came back
 * distinctly softer.
 *
 * The obvious fix — halve `bokehScale` — is wrong, because that setter also
 * drives the composite's `scale` uniform (`min(coc * scale, 1.0)`) and the
 * mask pass's `strength`. It would remove blur AMOUNT as well as blur WIDTH,
 * i.e. trade one unrequested art change for another. So only the four bokeh
 * materials are compensated, leaving the blend and the mask exactly as
 * authored. 0.625 texels of a 960-wide buffer is the same UV offset as 1.25 of
 * a 1920-wide one, so the kernel is identical, not merely similar.
 *
 * WHAT IS LEFT AS A REAL TRADE, and it is small: the far colour buffer is now
 * bilinearly upsampled from 960x540, which adds roughly a pixel of softening on
 * top of the authored ~1.25 px; and the circle of confusion is computed at half
 * resolution, which only matters at an in-focus/out-of-focus boundary. With
 * focusDistance 9 and focusRange 60 the only such boundary in the game this
 * came from is the headland against the sky.
 *
 * The reentry guard is load-bearing. `Resolution` fires a `change` event from
 * inside `setBaseSize`, and its listener calls `this.setSize(baseWidth,
 * baseHeight)` — dynamic dispatch, so it lands back HERE with an already-halved
 * base and would halve it again, and again, until the buffer rounds to nothing.
 * `super.setSize` finishes sizing every target after `setBaseSize` returns, so
 * swallowing the reentrant call loses nothing.
 */
export class ScaledDepthOfFieldEffect extends DepthOfFieldEffect {
  private sizing = false;

  constructor(camera: THREE.Camera, opts: {
    focusDistance: number; focusRange: number; bokehScale: number; resolutionScale: number;
  }) {
    super(camera, opts);
    // The four bokeh passes are public fields on the effect but are not in
    // postprocessing's shipped .d.ts, hence the cast. Guarded rather than
    // assumed: if a future version renames them the compensation is skipped and
    // the blur widens, which is a look change — not a crash — and the assert
    // below is what a reviewer would want to see fire.
    const dof = this as unknown as Record<string, { fullscreenMaterial?: { scale?: number } }>;
    const names = ['bokehNearBasePass', 'bokehNearFillPass',
      'bokehFarBasePass', 'bokehFarFillPass'];
    for (const n of names) {
      const mat = dof[n]?.fullscreenMaterial;
      if (mat === undefined || typeof mat.scale !== 'number') {
        console.warn(`[postfx] ${n} has no bokeh material; DoF kernel not compensated ` +
          `for the ${DOF_INTERNAL_SCALE}x internal buffer and will be wider than authored`);
        continue;
      }
      mat.scale = opts.bokehScale * DOF_INTERNAL_SCALE;
    }
  }

  override setSize(width: number, height: number): void {
    if (this.sizing) return;
    this.sizing = true;
    try {
      super.setSize(
        Math.max(1, Math.round(width * DOF_INTERNAL_SCALE)),
        Math.max(1, Math.round(height * DOF_INTERNAL_SCALE)),
      );
    } finally {
      this.sizing = false;
    }
  }
}

// ---------------------------------------------------------------------------
/**
 * ── EVERY TERM IN THIS GRADE THAT SPENDS A CLOCK ────────────────────────────
 *
 * This table is the ONLY place the frequencies are written. The fragment below
 * interpolates them, so the shader and the audit cannot drift apart — which
 * matters because until this commit these six numbers were literals buried in
 * six lines of GLSL, and the only thing in the file that knew a clock existed
 * at all was a line that set it back to zero when it passed 600.
 *
 * `fract` is the field that decides whether the wrap is visible. See
 * `@homie-rocks/postfx/Clock.js`'s `wrapAudit`.
 */
export const CLOCK_TERMS = {
  /** The motion-blur tap dither. Breaks the tap pattern into noise. */
  dither: { hz: 1.0, fract: true },
  /** The two rest speed-line octaves. Raw inside a value-noise lookup. */
  streakLow: { hz: 1.6, fract: false },
  streakHigh: { hz: 2.4, fract: false },
  /** The two boost speed-line octaves. Same shape, faster. */
  boostLow: { hz: 7.5, fract: false },
  boostHigh: { hz: 11.0, fract: false },
  /** The film grain. */
  grain: { hz: 0.37, fract: true },
} as const;

/** Spatial stride the grain's phase is spent on — one wrap moves it 977 texels. */
export const GRAIN_STRIDE = 977.0;

/**
 * The clock reading every HELD frame is pinned to.
 *
 * Not "wherever the clock happened to stop". A stopped clock still holds a
 * different value in every run, so a capture set from this tree could not be
 * subtracted from a capture set from another one — see `@homie-rocks/postfx`'s
 * `stillSeconds`, which carries the measurement.
 */
export const CLOCK_STILL_SECONDS = 0.0;

/**
 * ── THE WRAP, WHICH WAS ALREADY HERE AND WAS NOT DECLARED ───────────────────
 *
 * 600 is not a new number. This file already reached into
 * `pass.fullscreenMaterial.time` and set it to 0 the moment it passed 600, one
 * line, with a comment about `fract()` having bits left — and another copy of
 * this grade does the identical thing. What was missing is that a wrap is a
 * SEAM: at the instant it happens, every term that spends the clock jumps.
 *
 * Keeping 600 keeps the live picture exactly as it shipped. What changes is
 * that the seam is now named, audited at build time, and its casualties are
 * written down below instead of being discovered at minute ten.
 */
export const CLOCK_WRAP_SECONDS = 600.0;

/**
 * ── THE FOUR TERMS THIS WRAP IS KNOWN TO POP, AND WHY THEY ARE NOT FIXED ────
 *
 * A wrap is invisible for `fract(clock * f)` when `wrapSeconds * f` is a whole
 * number: 600 x 1.0 = 600 and 600 x 0.37 = 222, so the dither and the grain
 * both survive it. The four speed-line octaves spend the clock RAW inside
 * `krValueNoise`, which has no period at all, so no wrap is invisible for them
 * and at minute ten the comb pattern changes shape in one frame.
 *
 * THEY ARE DECLARED RATHER THAN FIXED, deliberately, and the distinction is the
 * known-red rule: a defect that is already shipped must not make the check
 * that would catch a NEW one useless. `build()` asserts the
 * audit's answer equals THIS LIST — so a seventh term added tomorrow, or a
 * frequency edited, throws — while the four that ship today do not take the
 * picture away.
 *
 * Fixing them is a look change: the speed lines only exist above a speed gate,
 * so the pop is only visible if somebody is flat out at exactly minute ten,
 * which nobody has ever measured. That is UNREVIEWED and its own commit.
 */
export const CLOCK_KNOWN_POPS: readonly number[] = [1.6, 2.4, 7.5, 11];

// The merged grade / lens shader.
// ---------------------------------------------------------------------------
// Five separate passes (blur, CA, tone map, grade, vignette+grain) would cost
// five full-screen bandwidth round trips and quantise the image four extra
// times. Merged, it is one pass and the whole grade happens in float.
const GRADE_FRAGMENT = /* glsl */ `
uniform mat4 prevViewProj;
uniform mat4 invViewProj;
uniform vec4 grade;   // x exposure, y S-curve amount, z saturation, w vignette (authored base)
uniform vec4 lens;    // x aberration, y grain, z speed-line gain, w shutter
/*
 * THE CHAIN'S OWN CLOCK, IN SECONDS, AND NOT the built-in time uniform.
 *
 * NO BACKTICKS ANYWHERE IN THIS COMMENT, and that is not a style choice. This
 * whole fragment is a JS template literal, and it is on record what one
 * backtick in a comment inside one cost: it closed the literal mid-document,
 * the module stopped existing, and no phone in any game could render a card.
 * The first draft of this very comment did it again and tsc caught it here.
 *
 * postprocessing drives its built-in time uniform with material.time +=
 * deltaTime * timeScale, and deltaTime is a performance.now() difference. It is
 * a real-time clock and no freeze in this game ever touched it, so two captures
 * of one frozen frame differed by a measured mean of 3.28 counts and never
 * converged — 92% of what an ENTIRE simulated frame of change produces. clock
 * is pushed from sync() and is PINNED to a constant while the world is held.
 * See CLOCK_STILL_SECONDS above, and @homie-rocks/postfx/Clock.js for the numbers.
 */
uniform float clock;
uniform vec3 rush;    // x radial blur amount, y gated speed intensity, z boost kick (0..1)
uniform vec2 vig;     // x vignette amount (speed-driven), y inner edge (closes in with speed)
uniform vec3 subject; // world-space centre of the player's kart
uniform vec2 hold;    // hold-out radii about the subject: x fully sharp, y fully blurred (metres)
uniform vec3 coolTint;
uniform vec3 warmTint;
uniform vec3 shadowLift;
uniform vec4 rolloff; // x knee (scene-linear), y exponent, z highlight desat, w desat span

const vec3 KR_LUMA = vec3(0.2126, 0.7152, 0.0722);

float krHash12(vec2 p) {
  vec3 q = fract(vec3(p.x, p.y, p.x) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float krValueNoise(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(krHash12(vec2(i, 17.3)), krHash12(vec2(i + 1.0, 17.3)), f);
}

// Scene-linear highlight shoulder, applied BEFORE the display transform.
//
// ACES on its own maps everything past roughly 3x mid-grey into the last few
// hundredths of display range, so a roof at 4x and a roof at 20x land on the
// same #ffffff and the highlight reads as a flat paper cut-out with no gradient
// inside it. Compressing the top end first is what gives those two values room
// to separate again.
//
// The curve is a power law above the knee, not a saturating exponential. An
// asymptote would buy separation at the cost of never reaching white, and the
// art bible is explicit that chrome and water must clip to white and bloom.
//
// THE EXPONENT IS THE CLAMP THE REVIEW FOUND, and the old comment here was
// wrong about it. "x^0.30 keeps climbing forever, so a specular two orders of
// magnitude up still gets there" is true only in the limit and false in every
// frame we actually ship. Work it through: the ACES RRT/ODT rational fit reaches
// 1.0 at v = 25.67, and v = mc * (exposure / 0.6) = mc * 1.75, so the shoulder
// has to hand ACES mc = 14.67. With knee 0.75 and p = 0.30 that needs
//
//     m = knee * (mc / knee)^(1/p) = 0.75 * (19.56)^3.333 ~= 15100 scene-linear
//
// i.e. NOTHING in this game reaches display white — the brightest thing in
// a reviewed boost frame measures ~32 scene-linear, which the old curve delivered at 232.
// Every shot ceilinged in the 232-250 band, 0.00% of pixels above 252, no sun
// disc, and the bloom that WAS firing (threshold 2.0 linear sits around display
// 202 on the old curve, so plenty cleared it) got squashed back into the same
// five percent of range as the thing it was blooming off. That is the "milky
// diffuse smear with no disc" and the "identical ~249 ceiling" in one bug: 249.6
// is simply where this curve puts 1000 scene-linear.
//
// Fixed by making the shoulder reach white at a level the scene can produce.
// Knee 0.90, p = 0.72 puts display white at m ~= 43 scene-linear:
//
//     m     0.7    0.9    1.0    2.0    4.0    8.0   20.0   43+
//     old   174    183    185    205    218    228    237    <=249  (asymptote)
//     new   174    191    196    220    236    245    252    255    (clips)
//
// Below the knee nothing moves at all, so the shadows, the tarmac and the key's
// own falloff are untouched and the golden-hour mood is unchanged; the exposure
// stays at the bible's 1.05. What changes is that the top two stops stop being
// a single value: sun-on-chrome, water sparkle, the sun disc and boost flame now
// clip and bloom, and a roof at 4x still separates cleanly from one at 20x.
//
// It is gated on the brightest channel rather than on luminance: a saturated red
// at 1.2 linear has a luminance of only 0.49, so a luminance gate would let it
// past and the red channel would clip on its own — which is exactly how a warm
// highlight breaks to a flat primary. max(rgb) compresses the channel that is
// actually about to clip.
//
// rolloff.z is the highlight desaturation. At 0.55 over a span of 12x the knee,
// EVERY bright coloured thing in the game arrived at white well before it
// arrived at 255: a tier-3 drift plume at scene-linear (12, 4, 20) came out
// rgb(243, 225, 238) — chroma 0.07, i.e. grey. It sits at 0.16 over a span of
// 30x now: highlights that roll off INTO colour, as the bible asks, while the
// sun disc and sun-on-chrome still bleach to white on the way out. The span came
// down from 40x with the knee moving up, so the desat still lands in the same
// place in absolute scene-linear terms (0.9 * 30 = 27, was 0.75 * 40 = 30).
vec3 krHighlightRolloff(vec3 c) {
  float m = max(max(c.r, c.g), c.b);
  float knee = rolloff.x;
  if (m <= knee) return c;
  float mc = knee * pow(m / knee, rolloff.y);
  vec3 scaled = c * (mc / max(m, 1e-5));
  float desat = smoothstep(knee, knee * rolloff.w, m) * rolloff.z;
  return mix(scaled, vec3(dot(scaled, KR_LUMA)), desat);
}

vec3 krRRTODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

// Bit-for-bit the same operator three uses for ACESFilmicToneMapping, so a
// no-post preview and the composed frame agree on exposure and hue shift.
vec3 krToneMap(vec3 c) {
  c *= grade.x / 0.6;
  c = mat3(0.59719, 0.07600, 0.02840,
           0.35458, 0.90834, 0.13383,
           0.04823, 0.01566, 0.83777) * c;
  c = krRRTODTFit(c);
  c = mat3( 1.60475, -0.10208, -0.00327,
           -0.53108,  1.10813, -0.07276,
           -0.07367, -0.00605,  1.07602) * c;
  return clamp(c, 0.0, 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec2 fromCentre = uv - 0.5;

  // Normalised so 1.0 is the frame corner at any aspect ratio — otherwise the
  // vignette, the aberration ramp and the streak band all drift as the window
  // is resized. Needed up here now because the aberration is gated on it.
  vec2 aspectVec = vec2(aspect, 1.0);
  float rad = length(fromCentre * aspectVec) / (0.5 * length(aspectVec));

  // --- screen-space velocity -----------------------------------------------
  // Unproject this pixel to world space with the current inverse view-proj,
  // then reproject it through last frame's view-proj. Camera-only (no skinned
  // or rigid per-object velocity buffer exists in this project) but it is the
  // camera that swings on a drift exit, which is where blur reads as speed.
  vec4 world = invViewProj * vec4(fromCentre * 2.0, depth * 2.0 - 1.0, 1.0);
  world /= world.w;
  vec4 prevClip = prevViewProj * world;
  vec2 prevUv = prevClip.xy / max(prevClip.w, 1e-4) * 0.5 + 0.5;
  vec2 velocity = (uv - prevUv) * lens.w;

#if MB_SAMPLES < 2
  // ONE reprojection tap cannot integrate a streak: the loop below jitters its
  // single tap along the velocity vector, which is not a blur but a per-pixel
  // random displacement of up to half the streak length (~15 px at 1080p at
  // speed). That is what dissolved the tunnel rock, the village roofs and the
  // kerb stripes into directional mush in every headless capture. So the
  // CAMERA term is dropped on a one-tap build.
  //
  // The radial rush below is NOT dropped with it, and that is the fix this
  // change is really about. The capture path builds with one tap by design, so
  // the old blanket zeroing of velocity meant the reviewed boost frame had no
  // smear of any kind — the loudest complaint in the set. The rush term gets
  // its own guaranteed tap budget (SMEAR_SAMPLES, never below six) and is
  // gated on speed, so it costs nothing except on the frames that are supposed
  // to be violent.
  velocity = vec2(0.0);
#endif

  // The camera term keeps its own old ceiling. Only the radial rush is allowed
  // past it, because only the radial rush is zero in the middle of the frame:
  // a long camera streak is mush, a long radial streak is speed.
  float camTravel = length(velocity);
  velocity *= min(camTravel, 0.016) / max(camTravel, 1e-5);

  // --- arcade zoom-blur -----------------------------------------------------
  // The world streak, and the only motion cue the capture path has (the camera
  // reprojection term above is dropped on a one-tap build, and the hero kart is
  // masked out of everything below).
  //
  // WEIGHTED TOWARD THE FRAME EDGE, on top of the |fromCentre| the term already
  // carries. A plain radial blur is linear in radius, so at rad 0.5 it is
  // already half as long as at the corner — which puts real smear on the road
  // surface and the vanishing point while the corners, where trackside geometry
  // rushes past, are still not moving enough to read. The extra (0.30 + 0.70*r)
  // makes the profile quadratic: 15% of the corner length at mid-radius, full
  // length only in the outer quarter. That is what lets the magnitude go up by
  // 2x without any of it landing where the reviewers said it was mush.
  velocity += fromCentre * (rush.x * (0.30 + 0.70 * rad));

  // --- hero hold-out --------------------------------------------------------
  // The player's kart is rigidly bolted to the camera, so a camera-only
  // reprojection sees its pixels as *static world geometry rushing backwards*
  // and smears the hero subject harder than anything else in frame — at speed
  // the model, its livery and the driver dissolve completely. There is no
  // per-object velocity buffer to solve it properly, so the subject is masked
  // out of the velocity here instead.
  //
  // The mask is a sphere in WORLD space, centred on the kart, and that is the
  // whole point. The previous attempt was a *depth band* driven off the
  // camera-to-kart distance (hold out everything nearer than 1.3x the arm), and
  // it fails for a reason that is easy to miss on a straight and impossible to
  // miss under boost: the chase rig's surge pulls the eye in to about 4.5 m on a
  // boost, so 1.3x the arm is only 1.4 m of clearance — while the kart is 2.1 m
  // long and the camera is looking *down* the length of it. The band therefore
  // cut straight through the model, and because screen-vertical maps to depth
  // under a rig that looks down, it cut horizontally: the helmet, the roll bar
  // and the spoiler (nearest the eye) stayed sharp and the fenders, the nose and
  // the number plate (furthest) took the full streak. That is precisely the
  // half-sharp, half-dissolved kart in the reviewed boost and scenery frames, and
  // no amount of widening fixes it, because the failure is that a scalar depth
  // band cannot describe a 2 m object viewed end-on from 4 m away.
  //
  // Measuring distance from the kart's own centre has none of that geometry in
  // it. The world position is already reconstructed for the reprojection above,
  // so the test costs one subtract and one length. It holds at any arm length, any
  // pitch and any camera mode, and — unlike a depth band — it holds ONLY the
  // kart: a rival two metres to the side sits outside the sphere and keeps its
  // streak, where the depth band was wrongly freezing every kart in the same
  // slice of the frame.
  //
  // The radii are sized off the model. The worst corner of the bodywork is about
  // 1.7 m from the chassis centre of mass (0.87 lateral, 1.05 longitudinal, 1.05
  // to the top of the helmet), so hold.x adds a third of a metre on top of that:
  // a gather needs its *neighbours* masked too, or the road pixels just outside
  // the silhouette pick the kart up along their own streak and drag it outward —
  // the translucent wings hanging off both fenders in the reviewed frames. hold.y then
  // releases over another 1.3 m so the tarmac eases back into the streak instead
  // of stepping into it.
  velocity *= smoothstep(hold.x, hold.y, distance(world.xyz, subject));

  float travel = length(velocity);
  // Capped so the fixed tap budget always covers the streak — an unbounded
  // travel with SMEAR_SAMPLES taps turns the dither jitter into visible noise
  // rather than into a smooth blur. The ceiling opens up under boost because
  // the rush term is RADIAL: it is exactly zero in the middle of the frame and
  // only reaches full length out at the corners, so a long streak there costs
  // the subject and the racing line nothing.
  float travelCap = 0.0125 + 0.0105 * rush.z;
  velocity *= min(travel, travelCap) / max(travel, 1e-5);
  travel = min(travel, travelCap);

  // --- lateral chromatic aberration ----------------------------------------
  // Two things were wrong here and both of them printed as per-pixel magenta /
  // green speckle over the tarmac, which four reviewers independently read as a
  // compression fault or as coloured grain.
  //
  // 1. It was never actually zero in the middle of frame. 0.35 + r^2 * 3.4
  //    still fringes dead centre at 35% of full strength, and the art bible
  //    asks for aberration "at the frame edge only". It is a genuine
  //    smoothstep from a third of the way out now, so the middle third — where
  //    the kart and the vanishing point live — is bit-exact clean, and that
  //    branch also drops the pass from three fetches per tap to one there.
  //
  // 2. The magnitude was allowed past a texel. Cross-correlating the R and B
  //    high-frequency content of a reviewed frame over the foreground gravel:
  //    corr(R,B) is 0.16 at zero lag and 0.61 once R is shifted back by one
  //    pixel — i.e. the aberration was displacing R and B across each other by
  //    ~1-2 px over a surface whose per-pixel luma sigma is 20-34, so it turned
  //    that surface's own specular aliasing into decorrelated chroma. Below
  //    about a texel the bilinear fetch IS the low-pass: R lands as a lerp of
  //    the same two texels G sampled, the channels stay correlated, and the
  //    fringe reads as a fringe instead of as confetti. So the offset is capped
  //    in PIXELS, which also makes it safe at any render scale.
  //
  // Strength tracks the eased speed signal on the CPU side (lens.x), NOT the
  // length of the motion smear. The old 1 - 0.75 * smoothstep(0, 0.010,
  // length(velocity)) rolloff was dead code on the capture path — that path
  // builds with one tap and zeroes the velocity above, so the rolloff measured
  // zero and never engaged, leaving full boost-strength fringing on exactly the
  // frames the reviewers were sent. Gating on speed is what was meant.
  float caShape = smoothstep(0.34, 1.0, rad);
  vec2 fringe = fromCentre * (lens.x * caShape * caShape);
  float fringePx = length(fringe / texelSize);
  // Under a twentieth of a texel there is no fringe, only two redundant texture
  // fetches per tap. Snap it off so the whole middle of the frame takes the
  // cheap branch below.
  if (fringePx < 0.05) {
    fringe = vec2(0.0);
    fringePx = 0.0;
  } else {
    fringe *= min(fringePx, CA_MAX_TEXELS) / fringePx;
  }

  vec2 lo = texelSize;
  vec2 hi = vec2(1.0) - texelSize;
  // Jitter breaks the tap pattern into noise instead of ghost steps. Safe to
  // run unconditionally now: the smear loop is never entered with fewer than
  // SMEAR_SAMPLES taps, and SMEAR_SAMPLES is never below six.
  float jitter = krHash12(uv * resolution + fract(clock * ${CLOCK_TERMS.dither.hz.toFixed(2)}) * 311.0) - 0.5;

  vec3 c;
  // Under ~0.4 px of travel there is nothing to integrate, so the whole frame
  // takes a single tap — which is every frame that is not fast or boosting,
  // including all of the still, low-speed captures.
  if (travel > 0.0002) {
    // The tap budget follows the length of the streak rather than being fixed.
    //
    // This matters now that the radial rush is driven by sustained speed and
    // not only by a boost: the smear loop is entered on every frame above ~70%
    // of top speed, which is most of a lap, where it used to be entered for two
    // seconds at a time. A full budget is only needed once the streak is long
    // enough for the gaps between taps to show — under ~8 px at 1080p, half the
    // taps plus the per-pixel jitter already resolve into a smooth gradient, and
    // half the taps is half the bandwidth over ~90% of the frame. Boost streaks
    // (17-24 px at the corner) still get everything.
    int taps = travel > 0.0040 ? SMEAR_SAMPLES : (SMEAR_SAMPLES / 2);
    float fTaps = float(taps);
    c = vec3(0.0);
    if (fringePx > 0.0) {
      for (int i = 0; i < SMEAR_SAMPLES; ++i) {
        if (i >= taps) break;
        float k = (float(i) + 0.5 + jitter) / fTaps - 0.5;
        vec2 p = uv + velocity * k;
        c.r += texture2D(inputBuffer, clamp(p + fringe, lo, hi)).r;
        c.g += texture2D(inputBuffer, clamp(p, lo, hi)).g;
        c.b += texture2D(inputBuffer, clamp(p - fringe, lo, hi)).b;
      }
    } else {
      for (int i = 0; i < SMEAR_SAMPLES; ++i) {
        if (i >= taps) break;
        float k = (float(i) + 0.5 + jitter) / fTaps - 0.5;
        c += texture2D(inputBuffer, clamp(uv + velocity * k, lo, hi)).rgb;
      }
    }
    c /= fTaps;
  } else if (fringePx > 0.0) {
    c.r = texture2D(inputBuffer, clamp(uv + fringe, lo, hi)).r;
    c.g = texture2D(inputBuffer, clamp(uv, lo, hi)).g;
    c.b = texture2D(inputBuffer, clamp(uv - fringe, lo, hi)).b;
  } else {
    c = texture2D(inputBuffer, uv).rgb;
  }

  // --- display transform ---------------------------------------------------
  // Shoulder first, while there is still headroom to shape: once ACES has run
  // the information is already gone.
  c = krHighlightRolloff(c);
  c = krToneMap(c);

  // Filmic S. smoothstep-toward keeps 0 and 1 pinned, so it adds midtone snap
  // without crushing the shadow detail the AO pass just paid for.
  c = mix(c, c * c * (3.0 - 2.0 * c), grade.y);

  // --- split tone ----------------------------------------------------------
  // Gain alone cannot separate a shadow from the lit surface next to it: a
  // multiply scales toward zero, so the darkest pixels stay exactly the hue
  // they already were and every shadow ends up a darker copy of the key. The
  // lift is what actually moves them — an additive teal offset weighted to the
  // bottom of the curve, which is the ASC-CDL 'offset' term and the reason a
  // graded frame has a cool side at all. Kept small so the blacks tint rather
  // than milk.
  float lum = dot(c, KR_LUMA);
  float shadowW = 1.0 - smoothstep(0.0, 0.55, lum);
  float highW = smoothstep(0.40, 1.0, lum);
  c += shadowLift * shadowW;
  c *= mix(vec3(1.0), coolTint, shadowW * 0.70);
  c *= mix(vec3(1.0), warmTint, highW * 0.55);
  c = max(c, 0.0);

  lum = dot(c, KR_LUMA);
  // Saturation lift, rolled off in the highlights so bloomed chrome and the
  // sun on water go white rather than neon.
  c = max(mix(vec3(lum), c, grade.z * (1.0 - 0.40 * smoothstep(0.70, 1.0, lum))), 0.0);

  // --- radial speed lines --------------------------------------------------
  // lens.z is the gain and it is DRIVEN now. It used to be initialised to 0.15
  // and never written, and rush.y — the gate — only opened above a speed
  // signal that the game itself capped below the gate's own knee. Worked
  // through on the reviewed boost frame: speedIntensity topped out at 0.22,
  // rush.y = smoothstep(0.22, 0.42, 1.0) = 0.0, so the term was multiplied by
  // exactly zero. "A 120 km/h boost frame with no speed lines" was literal.
  //
  // Two populations now, and the second is the whole point of the effect:
  //   - a sparse warm set that rides the plain speed ramp and only frames;
  //   - a denser, whiter, faster set that fades in with the boost kick
  //     (rush.z), reaches further toward the centre and streaks harder.
  float streakGain = lens.z * rush.y;
  if (streakGain > 0.001) {
    float ang = atan(fromCentre.y, fromCentre.x);
    float kick = rush.z;
    float n = krValueNoise(ang * 26.0 + clock * ${CLOCK_TERMS.streakLow.hz.toFixed(2)}) * 0.62
            + krValueNoise(ang * 63.0 - clock * ${CLOCK_TERMS.streakHigh.hz.toFixed(2)}) * 0.38;
    // Threshold widened from (0.60, 0.97). 'n' is the sum of two value-noise
    // octaves, so it is roughly normal about 0.5 with sd ~0.18: a 0.97 upper
    // edge means the comb only ever reached full strength on ~0.5% of angles
    // and sat under a third of it on almost all of the rest. Whatever gain was
    // dialled in on top of that, the frame got a handful of faint hairs. At
    // (0.55, 0.93) about a third of the angular domain carries a ray and the
    // brightest decile actually reaches the authored gain — which is the
    // difference between "there are speed lines if you look for them" and a
    // comb you read at a glance.
    float streak = smoothstep(0.55, 0.93, n);
    // Banded so they live in the outer third: they frame, they don't obscure.
    // Under boost the band reaches a little further in and the outer rolloff
    // moves out, so the lines read as converging on the kart rather than as a
    // ring around it.
    //
    // The inner edge used to sit at 0.42 (0.30 under boost), which is not the
    // outer third — at rad 0.30 the band is already inside the middle of the
    // frame, and a full-length ray then runs from there to the corner. Over the
    // tunnel that drew a starburst across the entire image and the shot came
    // back unreadable. 0.55 / 0.44 is the outer third the comment always
    // claimed.
    float band = smoothstep(mix(0.55, 0.44, kick), 0.98, rad)
               * (1.0 - smoothstep(1.05, 1.50, rad));
    float lines = streak * band * streakGain;

    // The boost set: higher angular frequency, moving several times faster,
    // and near-white. Additive on top of the first set, so at rest it does not
    // exist at all and on a boost the frame gains a second, tighter comb.
    if (kick > 0.004) {
      float n2 = krValueNoise(ang * 47.0 - clock * ${CLOCK_TERMS.boostLow.hz.toFixed(2)}) * 0.58
               + krValueNoise(ang * 111.0 + clock * ${CLOCK_TERMS.boostHigh.hz.toFixed(2)}) * 0.42;
      float streak2 = smoothstep(0.66, 0.99, n2);
      float band2 = smoothstep(0.42, 0.90, rad) * (1.0 - smoothstep(1.10, 1.55, rad));
      lines += streak2 * band2 * kick * lens.z * 0.42;
    }

    // Speed lines STREAK THE LIGHT THAT IS THERE; they are not a light source
    // of their own. Without this they are a constant additive wash, so the
    // darker the scene the more completely they take it over — which is exactly
    // how a lit tunnel at 89 km/h came back as white rays on black. Floored at
    // 0.42 so a boost still reads in the dark, where it has to.
    float sceneLit = 0.42 + 0.58 * smoothstep(0.04, 0.42, lum);
    lines *= sceneLit;

    // Shoulder on the SUM, so the rare pixel where both combs peak at once over
    // an already-bright sky compresses instead of punching a hole of pure white
    // in the corner of the frame. The art bible: three stacked effects must not
    // white the frame out.
    //
    // Plus a HEADROOM term, which is what makes the gain safe to double. The
    // shoulder alone is scene-independent: it caps what the comb ADDS, not what
    // the sum arrives at, so the same ray that reads as a bright hair over the
    // road at display 0.45 lands at 1.0+ over the golden-hour sky at 0.85 and
    // punches a white notch out of the corner. Rolling the comb off through the
    // top third of the range costs nothing where there is room (the tunnel, the
    // tarmac, the cliff face) and keeps the brightest content — which is where
    // a clipped ray is most obvious and least useful — under the ceiling.
    float head = 1.0 - 0.50 * smoothstep(0.60, 1.00, lum);
    c += (lines / (1.0 + lines * 1.2)) * head * vec3(1.0, 0.972, 0.918);
  }

  // Vignette AFTER the display transform, deliberately. Applied in linear it
  // would be a light-loss term that the shoulder then has to re-expand, which
  // is a second way to lose the top end; here it is what it is supposed to be,
  // a print-down of the finished image.
  //
  // It CLOSES IN with speed now ('vig', driven on the CPU side): the amount
  // rises from the authored 0.22 to 0.36 and the inner edge walks from rad 0.30
  // to rad 0.16, so flat out the frame is being squeezed from a third of the
  // way out instead of only at the corners. This is the cheapest of all the
  // speed cues and the one that survives at thumbnail size.
  c *= 1.0 - vig.x * smoothstep(vig.y, 1.02, rad);

  // Grain last, and monochrome — the same scalar is added to all three
  // channels, so it can only ever be luma noise. (The coloured speckle in the
  // review frames is not this; it is surface specular aliasing fringed by the
  // aberration above, plus the tarmac/sand normal maps aliasing on their own.)
  //
  // Weighted toward the midtones, but now rolled OFF again below ~0.14 display
  // luma. Full-amplitude grain in the bottom eighth of the range is where 8-bit
  // dither, the teal shadow lift and the AO all live, and adding +/-2 counts of
  // white noise on top of them is what makes a shadow read as sensor noise
  // rather than as shadow.
  float g = krHash12(uv * resolution * 1.37 + fract(clock * ${CLOCK_TERMS.grain.hz.toFixed(2)}) * ${GRAIN_STRIDE.toFixed(1)}) - 0.5;
  c += g * lens.y * (1.15 - 0.75 * lum) * smoothstep(0.015, 0.14, lum);

  outputColor = vec4(max(c, 0.0), inputColor.a);
}
`;

/** Tuning knobs for {@link GradeEffect}. All in final display-referred terms. */
export interface GradeOptions {
  /** motion-blur taps; 1 disables the blur and leaves plain aberration */
  samples: number;
  exposure: number;
  contrast: number;
  saturation: number;
  vignette: number;
  grain: number;
}

export class GradeEffect extends Effect {
  constructor(opts: GradeOptions) {
    super('KartGrade', GRADE_FRAGMENT, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      defines: new Map([
        ['MB_SAMPLES', String(Math.max(1, Math.round(opts.samples)))],
        // Hard ceiling on the aberration offset, in pixels. See the aberration
        // block in GRADE_FRAGMENT: past about a texel the fringe stops being a
        // fringe and starts decorrelating the channels of whatever specular
        // aliasing is already on screen.
        // Raised from 1.25. The reasoning below (under about a texel the
        // bilinear fetch is its own low-pass, so the channels stay correlated
        // and the fringe reads as a fringe) is what sets the FLOOR, not the
        // ceiling — and at 1.25 the cap was biting at 78% of top speed, so the
        // aberration was pinned from three-quarter pace all the way to a boost
        // and carried none of the ramp the art direction asks for. 2.0 texels
        // is where the authored corner offset (CA_BOOST at |fromCentre| = 0.707,
        // i.e. 0.00134 uv, against the art bible's 0.0012) actually lands at
        // 1080p, so
        // the cap is now a safety net for small render scales rather than the
        // thing that decides the look.
        ['CA_MAX_TEXELS', '2.0'],
        // Tap budget for the SMEAR loop, which is entered only when there is
        // more than ~0.4 px of travel. Never below six, whatever the
        // reprojection budget is: the radial boost rush has to integrate
        // properly even on the one-tap software/capture build, and that build
        // is what every reviewed frame is rendered with.
        // Nine, up from six, because the streak it has to integrate got longer:
        // the boost corner now travels ~0.0175 uv (27 px at 1080p) against
        // ~0.011 (17 px) before. Six taps over that is 4.5 px between samples,
        // which the per-pixel jitter turns into visible noise rather than into a
        // gradient; nine keeps the spacing at 3.4 px, i.e. the same sample
        // density the old boost frame had. It is only ever paid on frames with
        // more than ~0.4 px of travel, and the half-budget branch below still
        // covers most of the screen area because the rush is edge-weighted.
        // Eleven, up from nine, because the ignition pulse lengthened the
        // streak again: `travelCap` is 0.0125 + 0.0105 * rush.z and rush.z now
        // reaches 1.25 during a release, so the corner travels ~0.026 uv (50 px
        // at 1080p). Nine taps over that is 5.5 px between samples, which the
        // per-pixel jitter renders as noise rather than as a gradient; eleven
        // holds it at 4.5 px. Paid only on frames with more than ~0.4 px of
        // travel, and the half-budget branch still covers most of the screen
        // because the rush is edge-weighted.
        ['SMEAR_SAMPLES', String(Math.max(11, Math.round(opts.samples)))],
      ]),
      uniforms: new Map<string, THREE.Uniform>([
        ['prevViewProj', new THREE.Uniform(new THREE.Matrix4())],
        ['invViewProj', new THREE.Uniform(new THREE.Matrix4())],
        ['grade', new THREE.Uniform(
          new THREE.Vector4(opts.exposure, opts.contrast, opts.saturation, opts.vignette))],
        ['lens', new THREE.Uniform(new THREE.Vector4(CA_REST, opts.grain, STREAK_REST, 0.0))],
        ['rush', new THREE.Uniform(new THREE.Vector3(0, 0, 0))],
        // Seeded at the pinned value, so a chain that is built and
        // photographed before `sync` ever runs is still reproducible.
        ['clock', new THREE.Uniform(CLOCK_STILL_SECONDS)],
        // Seeded with the authored vignette so a frame rendered before the
        // first `sync` looks exactly like the old constant-vignette build.
        ['vig', new THREE.Uniform(new THREE.Vector2(opts.vignette, VIGNETTE_INNER_REST))],
        ['subject', new THREE.Uniform(new THREE.Vector3())],
        // Released until `sync` finds a player kart: with a negative outer
        // radius the smoothstep returns 1 everywhere and nothing is held.
        ['hold', new THREE.Uniform(new THREE.Vector2(-2, -1))],
        // Teal-leaning shadows / warm highlights, both near-luminance-neutral.
        // The cool side leans on green as well as blue: a purely blue shadow
        // against a #ffd9a8 key reads as violet, which is the exact hue the
        // frame already has too much of. Teal is what separates it.
        //
        // Pulled to 45% of the authored chroma (was 0.815/0.985/1.155), and
        // this is where the "the tarmac reads wet, not dry" note actually
        // lives. It was chased through the tarmac material for an iteration on
        // the theory that the road was a blue hemispherical mirror; it is not.
        // Measured on the real frame: zeroing `envMapIntensity` on all three
        // road materials moves the road band from 46% saturation to 51% — i.e.
        // the IBL is not the source and removing it makes it marginally worse.
        // Neutralising THIS pair takes the same band to 22%. The split-tone is
        // what was painting every dark surface teal-blue, the road is simply
        // the largest dark surface in frame, and the saturation lift below then
        // multiplies the chroma the split-tone just created.
        //
        // Swept 1.0 / 0.75 / 0.6 / 0.5 / 0.4 / 0.3 / 0 against three regions of
        // the same frame: the road falls 0.448 -> 0.221 across the sweep, the
        // SKY does not move at all (0.483 -> 0.500 — this term only ever
        // touched the shadows), and the warm midtones *gain* chroma as it comes
        // off, because the teal was desaturating them. 0.45 lands the road near
        // 0.32 and still delivers the art bible's sky-fill in the shadows.
        //
        // ROTATED TOWARD TEAL LATER, at constant chroma. Measured off the
        // banked tarmac in a corner capture (600x300 px, 180 000 samples): the
        // shaded road comes out mean rgb(24.0, 26.6, 37.7), i.e. B/G = 1.42 and
        // an HSV saturation of 0.48 — that is a blue-violet shadow, not the
        // teal the art bible asks for, and 0.48 is also well over the 0.32 the
        // previous change set out to land. This pair was the last
        // multiplicative thing in the chain still leaning on blue alone:
        // 0.917/0.993/1.070 lifts B without lifting G at all, which is a *blue*
        // axis by definition however small it is. 0.900/1.010/1.045 moves G
        // above unity with B, which is what makes the axis teal, and it does it
        // with slightly LESS total chroma (spread 0.145 against 0.153) and
        // slightly less luminance loss (0.9892 against 0.9825) — so the road
        // desaturates a little rather than gaining more colour, and the art
        // bible's "no pure-black shadows" gains a hair of headroom at the same
        // time.
        ['coolTint', new THREE.Uniform(new THREE.Vector3(0.900, 1.010, 1.045))],
        ['warmTint', new THREE.Uniform(new THREE.Vector3(1.115, 1.005, 0.878))],
        // Additive teal lift on the bottom of the curve — the art bible asks
        // for a #a8c8ff sky fill in the shadows, and nothing multiplicative can
        // produce it. Sized to sit just above the noise floor of an 8-bit
        // write. Scaled with `coolTint` to 45% of the authored value (was
        // -0.0015/0.0035/0.0092) — see the note there; the two are one effect
        // and retuning either alone just moves the blue between them. Rotated
        // with `coolTint` — the two are one effect. B/G was 2.62, which is a
        // violet offset with a token amount of green in it; it is 1.20 now,
        // which is teal. Total chroma comes DOWN (0.0039 against 0.0048) and
        // the luminance lift goes UP (0.0018 against 0.0013), which is the
        // right direction on both counts: the measured shaded road is
        // oversaturated at 0.48 and 1-2% of every frame sits below display 8.
        //
        // It is deliberately still small. Raising this far enough to put the
        // shaded tarmac at the 0.04-0.06 floor the art bible wants would need
        // ~+0.018, which is 4.6 counts of flat teal poured over every dark
        // pixel in the frame — that milks the blacks instead of tinting them,
        // and it is the regression an earlier change spent itself undoing. The
        // floor has to come from the game's sky-fill ambient, not from the
        // grade.
        ['shadowLift', new THREE.Uniform(new THREE.Vector3(-0.00090, 0.00250, 0.00300))],
        // Highlight shoulder: knee just above sunlit diffuse white, then
        // x^0.72 above it, with only a light pull toward luminance so a hot
        // colour stays a colour until it is genuinely an order of magnitude
        // over. The exponent is sized so display white lands at ~43x
        // scene-linear — reachable by the sun disc, sun-on-chrome, water
        // sparkle and boost flame, and by nothing else. See krHighlightRolloff.
        ['rolloff', new THREE.Uniform(new THREE.Vector4(0.90, 0.72, 0.16, 30.0))],
      ]),
    });
  }

  get grade(): THREE.Vector4 { return this.uniforms.get('grade')!.value; }
  get lens(): THREE.Vector4 { return this.uniforms.get('lens')!.value; }
  set clock(v: number) { this.uniforms.get('clock')!.value = v; }
  get rush(): THREE.Vector3 { return this.uniforms.get('rush')!.value; }
  get vig(): THREE.Vector2 { return this.uniforms.get('vig')!.value; }
  get subject(): THREE.Vector3 { return this.uniforms.get('subject')!.value; }
  get hold(): THREE.Vector2 { return this.uniforms.get('hold')!.value; }
  get prevViewProj(): THREE.Matrix4 { return this.uniforms.get('prevViewProj')!.value; }
  get invViewProj(): THREE.Matrix4 { return this.uniforms.get('invViewProj')!.value; }
}


/**
 * How aggressively speedIntensity is allowed to move the lens, per tier.
 *
 * These are the per-channel offset at |fromCentre| = 1, so the actual offset at
 * the frame CORNER (|fromCentre| = 0.707, radial shape = 1) is 0.707x them:
 * 0.00032 uv at rest and 0.00113 uv flat out, against the art bible's 0.0012 at
 * the frame edge scaling with speed. In pixels at 1080p that is 0.5 px and
 * 1.8 px, and the shader caps the offset at CA_MAX_TEXELS on top of that.
 *
 * They were 0.0007 / 0.0032, which put the corner at 0.0046 uv — nearly 4x what
 * the art bible asks for, ~9 px of separation, and the direct cause of the
 * coloured speckle over the boost road.
 */
export const CA_REST = 0.00045;
export const CA_BOOST = 0.0019;

/**
 * Vignette, at rest and flat out, plus where the print-down starts.
 *
 * The art bible authors 0.22 and that is what a still frame gets. The extra
 * 0.14 and the inner edge walking from 0.30 to 0.16 is the speed term: at
 * 101 km/h the frame is being closed in on from a third of the way out, which
 * is a cue that survives being looked at for a tenth of a second.
 */
export const VIGNETTE_SPEED = 0.14;
export const VIGNETTE_INNER_REST = 0.30;
export const VIGNETTE_INNER_FAST = 0.16;

/**
 * Speed-line gain, at rest and flat out on a boost. This is `lens.z`, and the
 * value it is multiplied into is display-referred (the streak term is added
 * after the tone map), so 0.42 is roughly +107 counts on the brightest tenth of
 * the angular comb, before the vignette prints it back down to ~+84 at the
 * corner. Below about 0.2 the effect is not visible at all on a golden-hour
 * sky, which is where it has been sitting.
 */
// 0.20 / 0.44 was measured against a bright golden-hour sky and nothing else.
// On the tunnel frame — the darkest place on the circuit, and one the AI takes
// on a mini-turbo, so the boost set is lit too — the same numbers put ~0.46 of
// display white over a scene sitting at ~0.08, and the capture came back as a
// starburst with no track in it. Halved, and the comb is now scaled by what is
// actually under it (see `sceneLit`).
//
// STREAK_BOOST is now the ceiling for *either* driver — a flat-out lap reaches
// it too. What still separates a boost is the second, whiter, faster comb the
// shader adds on top of it (gated on `rush.z`), not the gain of the first one.
//
// STREAK_REST IS ZERO NOW, and that is a correctness fix, not a taste call. The
// art bible says speed lines exist "only above ~70% top speed"; a non-zero rest
// gain meant the term was always armed and the *gate* had to do all the work,
// so the two were multiplying each other down (0.095 of gain behind a part-open
// gate is nothing, however the gate is tuned) and the ramp between "calm" and
// "flat out" was a factor of 2.6 instead of a switch. With the rest at zero the
// gain IS the ramp: exactly zero below the bible's gate, and everything above
// it.
//
// The ceiling is up from 0.25 to 0.38, which is where 0.20/0.44 was aiming
// before the tunnel starburst forced it down. Three things make it safe now that
// were not all present then: the band lives in the outer third (0.55, 0.44 under
// boost), the comb is scaled by what is actually under it (`sceneLit`), and the
// sum is rolled off against the remaining display headroom (`head`). Worked
// through on the two ends — a boost under the tunnel exit (scene ~0.08 display)
// peaks at +43 counts, a boost against the golden sky (~0.85) at +51, and
// neither reaches the ceiling.
//
// 0.46, up from 0.38, and the extra is bought with measured headroom rather
// than borrowed against it. A probe set captured the two ends this
// constant has to survive: a boost against the golden sky (mean display luma
// 119, 99.9th percentile 246, 0.000% of pixels with all three channels at 250+)
// and the tunnel stack (mean 74, 99.9th 245, again 0.000%). Neither end was
// anywhere near the ceiling an earlier change backed away from, because the two
// terms that made it safe — `sceneLit` and `head` — do their work regardless of
// the gain, and the second of them is explicitly a function of how much room is
// left. There is no configuration in which raising this constant clips a pixel
// that `head` was not already rolling off.
export const STREAK_REST = 0.0;
export const STREAK_BOOST = 0.46;

/**
 * IGNITION ONSET — a leading-edge detector on the boost kick.
 *
 * PostFX is handed two scalars and no boost flag, and originally it could only
 * tell "boosting" from "fast" — not "a boost STARTED". Everything the lens
 * does under boost was therefore a step: it rose over the kick's own 0.05 s
 * attack and then held a constant value for two seconds. A step is a state. The
 * eye reads the onset of a cue and then stops attending to it, which is exactly
 * why five separate lens effects can all be present in a 131 km/h frame and the
 * frame can still be reported as feeling identical to a cruise.
 *
 * `punch` is the kick as it already was (0.05 s attack); `punchSlow` follows it
 * with a much longer constant. Their difference is a pulse that exists only
 * while the kick is RISING — one subtract and one lerp, no new contract with
 * the game, and it cannot fire on a sustained boost, on a flat-out lap or on a
 * drift, because none of those move the kick.
 */
export const IGNITE_TAU = 0.42;
export const IGNITE_GAIN = 2.1;

/**
 * The value `ctx.speedIntensity` takes at 100% of top speed with no boost.
 *
 * THIS IS THE NUMBER A "no screen-space speed cue" REVIEW FINDING TURNED ON, so
 * it is worth writing down what the signal actually is. `speedIntensity` is NOT
 * a fraction of top speed: the game's signal update already applies the art
 * bible's "only above ~70% top speed" gate —
 * `want = clamp((ratio - 0.70) / 0.42)` — and then publishes
 * `want * 0.42 + boost * 0.52`. So the number arriving here is zero at 70% of
 * top speed, 0.30 flat out, and 0.42 only with a slipstream or a star on top; a
 * boost adds a floor of 0.52 on top of all of that.
 *
 * Everything downstream was reading it as if it were a 0..1 speed fraction, and
 * that is the whole bug. Worked through on two reviewed frames: a HUD frame at
 * 101 km/h is ratio 0.935, so `want` = 0.56 and speedIntensity = 0.235. The
 * streak gain was `STREAK_REST + (STREAK_BOOST - STREAK_REST) * kick` with kick
 * = 0 (no boost), i.e. 0.095, times a gate of smoothstep(0.235, 0.08, 0.50) =
 * 0.31 — a final gain of 0.029, which is under three counts of display white on
 * the brightest tenth of the comb. The radial rush was 0.0065 * 0.235^2 =
 * 0.00036, which is 0.4 px of travel at the frame corner at 1080p. Both are
 * "nothing", exactly as reviewed, and a close-up at 55 km/h (ratio 0.51, below
 * the 70% gate) is a true zero — so the two frames are identical by
 * construction.
 *
 * The review's suggested fix, `smoothstep(0.70, 1.0, speed)`, would have made
 * that permanent: `speed` cannot exceed 0.42, so that expression is identically
 * zero at every speed the game can produce. The 70% gate is upstream. What the
 * lens needs is that gated ramp renormalised, which is what this constant is
 * for: `fast = min(speed / SPEED_FLATOUT, 1)` is 0 at ~70% of top speed, 0.44
 * at 90 km/h, 0.78 at 101 km/h and 1.0 flat out.
 */
export const SPEED_FLATOUT = 0.30;

/**
 * The boost kick, 0..1, recovered from `ctx.fovPunch`.
 *
 * PostFX gets two numbers from the game and no direct knowledge of boost state,
 * and this is the one that carries it: the game publishes ~8.5 deg of punch for
 * a boost against at most 3.3 for a tier-3 drift and 3.2 for a flat-out lap, so
 * a threshold between them separates "boosting" from "merely fast" cleanly and
 * arrives already eased.
 */
// Moved up with the game's sustained-speed FOV term, which
// went from 3.2 to 4.2 degrees flat out so the lens itself carries some of the
// speed read. The separation contract is unchanged: the most a NON-boost frame
// can publish is 4.2 (flat out, or flat out on a tier-3 drift — the drift branch
// takes a max, not a sum), and a boost publishes 8.5 before any speed term is
// added on top, so KICK_LO sits in the 0.7-degree gap and a boost taken from a
// standstill still reaches a full kick of 1.0 at KICK_HI.
export const KICK_LO = 4.9;
export const KICK_HI = 8.5;

/**
 * Radius around the player kart's centre of mass, in metres, inside which the
 * reprojection blur is switched off completely, and the radius at which it is
 * fully back. See the hero hold-out block in GRADE_FRAGMENT for the sizing.
 *
 * These are world units, so they do not care how long the chase arm is, which
 * is the entire reason this replaced a depth band.
 */
export const SUBJECT_HOLD = 2.05;
export const SUBJECT_FADE = 3.40;
