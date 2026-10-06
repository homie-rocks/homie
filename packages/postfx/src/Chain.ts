/**
 * ============================================================================
 *  Chain — the post-processing chain itself, for every game that wants one.
 * ============================================================================
 *  Ownership split with `@homie-rocks/render/pipeline.ts`: the pipeline owns the
 *  WebGLRenderer, the EffectComposer and its buffers; this owns everything
 *  that goes *into* the composer (passes + effects) and the per-frame uniform
 *  sync. That seam was settled before either side was written — the render
 *  pipeline declares the interface and this file implements it — and
 *  `PostChain<W>` over there is the interface this satisfies.
 *
 *  Chain, in the DEFAULT order — see `stages()`, which is the list a consumer
 *  overrides to reorder these or to insert one of its own:
 *    RenderPass            scene -> HDR (half-float) buffer
 *    N8AOPostPass          ground-truth-ish AO, multiplied into the lit colour.
 *                          NB: this pass renders the scene AGAIN into its own
 *                          buffer and composites onto that, so when AO is on it
 *                          — not the composer — owns the multisampling. See
 *                          build().
 *    EffectPass[DoF,Bloom] shallow bokeh focused on the game's subject, then a
 *                          high-threshold mipmap bloom, wide + soft. ONE pass:
 *                          see the note on `merged` for why these two and no
 *                          others.
 *    EffectPass[Grade]     ONE shader: reprojection motion blur + chromatic
 *                          aberration + highlight shoulder + ACES + S-curve +
 *                          split tone (teal lift / warm gain) + sat rolloff +
 *                          speed lines + vignette + grain
 *    EffectPass[SMAA]      final edge resolve on top of MSAA, dithered on the
 *                          way to the screen
 *
 *  Everything downstream of the RenderPass works in scene-linear HDR until the
 *  grade shader tone maps; postprocessing re-linearises between passes and
 *  encodes to sRGB exactly once, on the final write to the default framebuffer.
 *
 *  --------------------------------------------------------------------------
 *  WHY THIS FILE EXISTS — 131 OF 133 LINES, IN THREE RUNS
 *  --------------------------------------------------------------------------
 *  The first extraction took the grade out of a first-person shooter and a kart
 *  racer and left the orchestrator behind in both, on the argument that the
 *  orchestrator "knows what a `Ctx` is". It does not, quite: it knows what
 *  SEVEN FIELDS of one are, and the two remaining copies were measured at 131
 *  of the kart racer's 133 substantive lines shared, in THREE runs of 61, 46
 *  and 24. Not fragmented agreement — one file living in two places, which is
 *  a shape that must not survive.
 *
 *  The whole-file diff between the two was 86 lines and, once the prose is
 *  removed, caller-owned AO and grade look values plus one subject policy.
 *  Every one of those is a VALUE the game supplies. There is no `mode`
 *  flag in this file and no branch anywhere in it that asks which game is
 *  running — `if (mode === 'kart')` is the smell, and a `mode` parameter is
 *  that same smell wearing a suit.
 *
 *  --------------------------------------------------------------------------
 *  GENERIC OVER A STRUCTURAL WORLD, NEVER OVER `Ctx`
 *  --------------------------------------------------------------------------
 *  `Ctx` carries race, track, items, match, combat and colony. One `import
 *  type` would put every one of those inside packages/, and worse, would make
 *  this package depend on every field any game ever adds to one. So `W` is
 *  constrained by `ChainWorld` below, which lists EXACTLY the five things the
 *  code in this file reads and nothing else. Both games' `Ctx` satisfies it
 *  structurally, `W` is inferred at the `new PostFXChain(...)` call, and no
 *  call site changes: `RenderPipeline` still calls `build(ctx, composer, opts)`
 *  and `sync(ctx, dt)` exactly as it did.
 *
 *  --------------------------------------------------------------------------
 *  THIS PACKAGE MAY NOT READ `window`, AND TWO THINGS HERE NEED TO
 *  --------------------------------------------------------------------------
 *  That is this package's boundary rule. `__freeze` (is the world being held?)
 *  and `__probeFault` (which fault did the harness ask for?) are both window
 *  reads,
 *  so they arrive as PREDICATES the game supplies in `ChainSpec`: the game
 *  asks, the package is told. That is also what lets a Node harness drive this
 *  identical protocol with no DOM at all — which is precisely what the chain
 *  probe does, and why it can compare thousands of numbers exactly instead of
 *  photographing two frames.
 *
 *  The one piece of the fault protocol that DID move is `readProbeFault()`:
 *  validating the name, and throwing loudly on one nobody implements, is not a
 *  window read and there is no reason for two copies of that error text. The
 *  two window TOUCHES stay in the game, and `faultApplied` is still called from
 *  the branch that actually took the fault — which is the property the grade
 *  probe checks and the reason a refactor that moves the grade pass out from
 *  under the bypass branch makes that probe BLOCK instead of reporting a green
 *  story.
 *
 *  --------------------------------------------------------------------------
 *  WHICH LOOK CONSTANTS ARE IN THE SPEC AND WHICH ARE STILL IN Grade.ts
 *  --------------------------------------------------------------------------
 *  In the spec: the nine that MEASURABLY DIVERGE between the two games today.
 *  Every one of them is REQUIRED — no optionals, no defaults — so a game that
 *  forgets one fails to compile. A game that got a default would get the other
 *  game's art direction silently, and it would look and sound completely fine.
 *
 *  AND THE LENS RESPONSE IS IN THE SPEC TOO NOW, WHICH IT WAS NOT UNTIL
 *  2026-08-21 AND WHICH THIS PARAGRAPH USED TO ARGUE AGAINST. It said that
 *  `CA_REST`, `CA_BOOST`, `VIGNETTE_SPEED`, `STREAK_*`, `IGNITE_*`,
 *  `SPEED_FLATOUT` and `KICK_*` should stay in `Grade.ts` because "they are the
 *  same number in both games, so putting them in the spec would make both games
 *  declare an identical list". That reasoning was sound about the two games it
 *  had and wrong about the package, and the thing that proved it wrong is the
 *  strongest evidence there is: TWO GAMES BUILT IN PARALLEL, NEITHER ABLE TO
 *  SEE THE OTHER'S CODE, reported the same defect — that two of
 *  `ChainWorld`'s seven fields were a racer's, and that every one of those
 *  constants was load-bearing inside `sync` behind them. "Both games agree" is
 *  a fact about a sample of two racers.
 *
 *  It is `ChainSpec.lens` now: a required accessor plus a required `LensLook`,
 *  and `./Lens.ts` ships `RACER_LENS` and `STILL_LENS` as NAMED presets that
 *  nothing defaults to. The prediction in the old paragraph — "the day a game
 *  wants a different vignette speed it becomes a field" — was right about the
 *  mechanism and late about the day.
 * ============================================================================
 */
import * as THREE from 'three';
import { ViewHistory } from './ViewHistory.js';
import {
  BloomEffect,
  BlendFunction,
  DepthOfFieldEffect,
  Effect,
  EffectComposer,
  EffectPass,
  EdgeDetectionMode,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  type Pass,
} from 'postprocessing';
// @ts-expect-error — n8ao ships no type declarations, and we may not add a .d.ts here.
import { N8AOPostPass } from 'n8ao';
// ONE Quality, and it lives in @homie-rocks/render/caps.ts. The games' types.ts
// re-exports it from there today, so this is not a new dependency for any
// consumer — it is the removal of the third private copy of { Low: 0 …
// Ultra: 3 }, which is exactly the duplication this package exists to remove.
import { Quality } from '@homie-rocks/render/caps.js';
// The capture protocol. Until 2026-08-20 this chain had NEITHER half of it, so
// two screenshots of one frozen frame were never the same file and no A/B taken
// on either game could be trusted.
import { BLOOM_TOP_MIP_ROWS, bloomLevels } from './Bloom.ts';
import { createFrameClock, holdPassClocks, wrapAudit, type ClockTerm } from './Clock.ts';
// The lens response, which used to be forty lines of this file reading eleven
// constants off two racer-shaped fields of `ChainWorld`. See ./Lens.ts.
import { LensFollower, type LensInput, type LensLook } from './Lens.ts';
import {
  ScaledDepthOfFieldEffect,
  applyDofBackground,
  GradeEffect,
  CLOCK_TERMS,
  GRAIN_STRIDE,
  CLOCK_STILL_SECONDS,
  CLOCK_WRAP_SECONDS,
  CLOCK_KNOWN_POPS,
  type DofBackgroundCap,
} from './Grade.ts';

// Re-exported so a game states its DoF policy without a second import line from
// a file it otherwise never touches. `Chain.ts` is the door for a consumer.
export type { DofBackgroundCap };

// ---------------------------------------------------------------------------
//  BLOOM REACH, IN SCREEN TERMS RATHER THAN IN LEVELS
// ---------------------------------------------------------------------------

// `BLOOM_TOP_MIP_ROWS` and `bloomLevels` live in Bloom.ts, beside the effect
// they size, so a chain that is not this one can import them without loading
// this file's ambient-occlusion and depth-of-field imports. They are still
// exported from here, under the same names, for every existing importer.
export { BLOOM_TOP_MIP_ROWS, bloomLevels };

/**
 * A `BloomEffect` whose mip count follows the drawing buffer.
 *
 * `levels` in the constructor options becomes the TIER CAP rather than a fixed
 * count: it is the most levels this tier will ever spend, and the buffer
 * decides how many of them are actually bought.
 *
 * WHY `setSize` IS THE RIGHT HOOK AND `build()` IS NOT. The chain is built once
 * and then the buffer moves underneath it for the rest of the session —
 * `EffectComposer.setSize` hands every pass the DRAWING-BUFFER dimensions,
 * which already fold in the device pixel ratio, `renderScale` and the adaptive
 * ladder's current rung. Deriving the count at build time would fix the panel
 * and miss the ladder, which is most of the row.
 *
 * THE REALLOCATION IS GUARDED, and that guard is load-bearing rather than
 * tidiness. Moving `levels` reallocates the whole mip chain, and
 * `@homie-rocks/render/pipeline.ts` has a long note about iOS Safari firing `resize`
 * continuously while the URL bar collapses — dozens of events for one gesture.
 * Its own no-op guard stops most of them reaching here at all; this one stops
 * the rest from reallocating a chain that is already the right length.
 */
export class ScaledBloomEffect extends BloomEffect {
  private readonly tierMax: number;

  constructor(opts: ConstructorParameters<typeof BloomEffect>[0] & { levels: number }) {
    super(opts);
    this.tierMax = opts.levels;
  }

  override setSize(width: number, height: number): void {
    const want = bloomLevels(height, this.tierMax);
    const mips = this.mipmapBlurPass;
    if (mips.levels !== want) mips.levels = want;
    super.setSize(width, height);
  }
}

// ---------------------------------------------------------------------------
//  THE WORLD, AS SEVEN FIELDS
// ---------------------------------------------------------------------------

/**
 * The five settings this chain reads. A game's `Settings` has a dozen more —
 * shadows, renderScale, maxPixelRatio — and this package has no business
 * naming them, so it does not.
 */
export interface ChainSettings {
  quality: Quality;
  ssao: boolean;
  bloom: boolean;
  motionBlur: boolean;
  dof: boolean;
}

/**
 * EXACTLY what `build()` and `sync()` read off the game's world, derived by
 * counting the references rather than by copying a `Ctx`. A game's `Ctx`
 * satisfies this structurally and is never named here.
 *
 * FIVE FIELDS, AND IT WAS SEVEN UNTIL 2026-08-21. The two that left were
 * `speedIntensity` and `fovPunch`, and they left because TWO GAMES THAT COULD
 * NOT SEE EACH OTHER'S CODE reported the same thing: two of a seven-field
 * "platform" interface were racer vocabulary. A walking game found that
 * neither means anything at walking pace — there are no speed lines and no
 * boost to punch the lens with — and the other named the cost, that
 * `CA_BOOST` and `SPEED_FLATOUT` were load-bearing inside `sync`. Both passed
 * zeroes and both were right to; being right about the value did not make the
 * interface right. They are `ChainSpec.lens` now. See `./Lens.ts`, which is
 * where this seam is written up.
 *
 * Every one of the five that remain is a fact about ANY three.js world.
 */
export interface ChainWorld {
  scene: THREE.Scene;
  camera: THREE.Camera;
  width: number;
  height: number;
  settings: ChainSettings;
}

// ---------------------------------------------------------------------------
//  THE SPEC — the look values and the one policy that actually diverge
// ---------------------------------------------------------------------------

/**
 * The ambient-occlusion knobs that differ between games.
 *
 * EVERY FIELD REQUIRED. `samplesBase`, `samplesHigh` and `samplesUltra` are
 * three fields rather than one ternary because the two games do not gate on the
 * same tier: the first-person shooter steps up at Ultra (8/8/16) and the kart
 * racer at High (8/16/16). A single `samplesHigh` with a shared gate would have
 * quietly given one of them the other's budget at Quality.High, which costs
 * frame time and changes no pixel a screenshot reviewer would look at.
 */
export interface ChainAOLook {
  /** N8AO sampling radius in world units; scene scale is caller-owned */
  radius: number;
  /** N8AO `intensity` below Quality.Ultra — the exponent on the visibility term */
  intensityBase: number;
  /** N8AO `intensity` at Quality.Ultra and above */
  intensityUltra: number;
  /** `aoSamples` below Quality.High */
  samplesBase: number;
  /** `aoSamples` at Quality.High */
  samplesHigh: number;
  /** `aoSamples` at Quality.Ultra and above */
  samplesUltra: number;
}

/** The four grade values that diverge. `grain` and `samples` do not; see the header. */
export interface ChainGradeLook {
  exposure: number;
  contrast: number;
  saturation: number;
  vignette: number;
  grain: number;
}

/** A game's art direction, in full. No optionals, no defaults. */
export interface ChainLook {
  ao: ChainAOLook;
  grade: ChainGradeLook;
  /**
   * WHAT THE DEPTH OF FIELD IS NOT ALLOWED TO TOUCH, or `null` for the
   * library's own lens, honest about infinity.
   *
   * REQUIRED, AND `null` IS A STATEMENT RATHER THAN AN ABSENCE. This field
   * exists because a space racer could not be a consumer of this chain without
   * it and nobody had noticed the chain was holding an opinion: with no
   * exemption the depth of field blurs the sky, which is correct for a bay and
   * a headland and is a flat grey plane where a starfield was carrying the
   * empty half of the frame. The two consumers want the OPPOSITE answer, so
   * there is no default that is not one of them silently inheriting the other's
   * lens.
   */
  dofBackground: DofBackgroundCap | null;
}

/**
 * WHICH POINT IN THE WORLD MUST STAY SHARP.
 *
 * The one thing in this spec that is not a number, and it is still a value: two
 * world points and two radii the game hands over. A first-person shooter
 * protects the CAMERA (the viewmodel lives on it) and focuses on the aim point;
 * a kart racer protects and focuses on the hero chassis. Parking the shooter's
 * hold-out on the player's feet would blur the gun and sharpen the floor, and
 * parking the racer's on the camera would protect thin air — so this cannot be
 * one behaviour with a flag, and it is not asked to be.
 *
 * A game returns a scratch object it owns and reuses; nothing here retains it
 * past the call, and both vectors are copied.
 */
export interface ChainSubject {
  /** world-space centre of the motion-blur hold-out sphere */
  centre: THREE.Vector3;
  /** inner radius: fully protected inside this */
  holdInner: number;
  /** outer radius: the mask has faded to nothing by here */
  holdOuter: number;
  /** world-space point depth of field focuses on */
  focus: THREE.Vector3;
}

/**
 * The three faults the grade probe documents, each aimed at a different row of
 * that probe. The names are the harness contract; do not
 * rename one without renaming it there.
 */
export type ChainFault = 'grade-bypassed' | 'look-constant-drift' | 'clock-unfrozen';

export const CHAIN_FAULTS: readonly ChainFault[] = [
  'grade-bypassed',
  'look-constant-drift',
  'clock-unfrozen',
];

/**
 * Validate a fault name the game read off `window.__probeFault`.
 *
 * THROWS on a name it does not know, and that is the point rather than
 * strictness. A fault anchored on a name must fail LOUDLY when nothing answers
 * to that name: five rotted silently on the last project and those harnesses
 * validated nothing while reporting green.
 *
 * WHAT THE THROW DOES NOT DO — measured, because the first draft of this
 * comment asserted the opposite. It does NOT take the page down. The pipeline
 * catches a chain that fails to build and degrades to the direct path
 * (degrade, do not die), so the game boots, `__gameReady` goes true
 * on schedule, and it renders with NO EFFECT CHAIN AT ALL. Asking for
 * 'grade-bypassd' prints exactly this and nothing else:
 *
 *     [gl:degrade] ldr-composer -> direct: effect chain failed to build:
 *     RangeError: PostFX: window.__probeFault = "grade-bypassd" is not one of
 *     [grade-bypassed, look-constant-drift, clock-unfrozen].
 *
 * A probe that only looked at pixels would then photograph a chain-less frame
 * twice, find the two identical, and pass its gate. What makes it honest is the
 * acknowledgement protocol: nothing echoes, the grade probe's acknowledgement
 * check blocks the whole run, and the colour is BLOCKED — "we could not
 * measure it", which must never render as "we measured it and it was fine".
 * The throw still earns its place by putting the offending name in the
 * console; the acknowledgement check is what carries the verdict.
 *
 * The message still says `PostFX:` and `window.__probeFault` even though this
 * function is in a package that cannot see a window, because the message is
 * read by a person looking at a game's console and that is where the flag they
 * set lives.
 */
export function readProbeFault(asked: unknown): ChainFault | null {
  if (asked === undefined || asked === null) return null;
  if (typeof asked !== 'string' || !CHAIN_FAULTS.includes(asked as ChainFault)) {
    throw new RangeError(
      `PostFX: window.__probeFault = ${JSON.stringify(asked)} is not one of `
        + `[${CHAIN_FAULTS.join(', ')}]. A fault nobody implements must never `
        + 'look like a pass.',
    );
  }
  return asked as ChainFault;
}

/**
 * Everything the chain needs that this package may not work out for itself:
 * the art direction, the subject policy, and the two `window` reads.
 *
 * Every field required. A `held` that defaulted to `() => false` is a chain
 * whose freeze silently stops working, which is the 92%-noise-floor defect
 * `Clock.ts` exists to have fixed.
 */
export interface ChainSpec<W> {
  look: ChainLook;
  /**
   * HOW THIS GAME'S LENS RESPONDS TO THIS GAME'S WORLD. Required, both halves.
   *
   * `read` is the accessor that used to be two fields of `ChainWorld`; `look`
   * is every constant that used to be a literal inside `sync`. A game with no
   * motion cue writes `{ read: () => LENS_AT_REST, look: STILL_LENS }`, which
   * is two names it had to type — and typing them is the point, because the
   * alternative is a default and a default here is one game inheriting
   * another's art direction while looking completely fine.
   *
   * See `./Lens.ts` for why `RACER_LENS` being a shipped preset is not a
   * default in disguise, and for the two independent reports that moved this.
   */
  lens: { read: (world: W) => LensInput; look: LensLook };
  /** null when there is nothing to protect — the whole frame is allowed to blur */
  /**
   * The subject of the view being presented. `camera` is explicit because a
   * world may carry several views while its legacy `world.camera` remains the
   * primary one used for simulation and culling.
   */
  subject: (world: W, camera: THREE.Camera) => ChainSubject | null;
  /** `window.__freeze === true`, asked in the game because this package may not */
  held: () => boolean;
  /** `readProbeFault(window.__probeFault)`, asked in the game for the same reason */
  faultAsked: () => ChainFault | null;
  /** called FROM THE BRANCH THAT TOOK THE FAULT; the game writes `window.__probeFaultApplied` */
  faultApplied: (fault: ChainFault) => void;
}

export interface PostFXOptions {
  /** true when we detected a software rasteriser (headless capture / CI) */
  software: boolean;
  /**
   * True when the composer's buffer is 8-bit rather than half-float, because
   * this GPU could not complete an RGBA16F attachment.
   *
   * It changes exactly one thing, and it has to. Every threshold in this file
   * is authored against SCENE-LINEAR HDR — the bloom gate sits at 1.55, i.e.
   * above sunlit diffuse white, on the assumption that there are values above 1
   * to select. An 8-bit buffer clamps at 1.0 before the bloom pass ever runs,
   * so a threshold of 1.55 selects the empty set and the tier loses its bloom
   * entirely and silently. Below, the gate moves into the range the buffer can
   * actually represent.
   *
   * REQUIRED, AND IT USED TO BE OPTIONAL IN BOTH GAMES. Read the paragraph
   * above as a specification of what a forgotten field costs: `undefined` is
   * not `true`, so a caller that omits it gets the HDR gate on an 8-bit buffer
   * and ships with the bloom silently missing. `PostChain<W>` in
   * `@homie-rocks/render/pipeline.ts` already declared it required and the pipeline
   * has always passed it; the games' own `PostFXOptions` was the only place it
   * could be dropped. A field whose default is a defect must not have one.
   */
  ldr: boolean;
}

/**
 * THE UNIFORM SURFACE `sync()` DRIVES — every member of it, and nothing else.
 *
 * Derived by counting the references in `syncHeld` and `applySubject` rather
 * than by naming `GradeEffect`: nine accessors, which is the whole of what this
 * orchestrator ever touches on the effect it built. `PostFXChain` is generic
 * over it, so a game whose grade is a SECOND SHADER rather than a drifted copy
 * of `Grade.ts`'s can still be a consumer of the chain around it.
 *
 * THAT DISTINCTION IS THE POINT AND IT IS MEASURED, not a courtesy. A space
 * racer's grade fragment was diffed line for line against `Grade.ts`'s on
 * 2026-08-21: 916 of 1,232 lines differ. They agree on the tone curve and
 * disagree on everything spent on the clock, on the eight-ship per-object
 * velocity field, on the hue-arc law and on the day/night blend. Merging two
 * ~500-line GLSL programs each right about a different picture would compile,
 * pass everything, and quietly make one game look like the other. So the
 * shaders stay two, and the ORCHESTRATION around them stops being two.
 *
 * `clock` is write-only in both implementations (`set clock(v: number)`), which
 * is why it is declared as a plain number here: an interface cannot say
 * "settable but not readable", and nothing in this file reads it back.
 */
export interface ChainGrade {
  grade: THREE.Vector4;
  lens: THREE.Vector4;
  clock: number;
  rush: THREE.Vector3;
  vig: THREE.Vector2;
  subject: THREE.Vector3;
  hold: THREE.Vector2;
  prevViewProj: THREE.Matrix4;
  invViewProj: THREE.Matrix4;
}

/**
 * Everything one `build()` is deciding, handed to each stage rather than
 * recomputed by it.
 *
 * `high` and `ultra` are here and not read off `world.settings.quality` in each
 * stage for one reason: they are a THRESHOLD POLICY, and a stage that
 * re-derived one could disagree with its neighbour about which tier it is
 * building for. One derivation per build, six readers.
 */
export interface ChainBuild<W> {
  world: W;
  composer: EffectComposer;
  opts: PostFXOptions;
  /** `quality >= Quality.High` */
  high: boolean;
  /** `quality >= Quality.Ultra` */
  ultra: boolean;
}

/**
 * ONE SLOT IN THE CHAIN. See `PostFXChain.stages`.
 *
 * A stage adds zero or more passes to `b.composer` through `this.add` and
 * records whatever the per-frame sync will need. It returns nothing: the chain
 * is the composer's pass list, in the order the stages ran.
 */
export type ChainStage<W> = (b: ChainBuild<W>) => void;

/**
 * Builds and drives the effect chain. One instance lives for the lifetime of
 * the pipeline; `build()` may be called repeatedly as quality settings change.
 *
 * ---------------------------------------------------------------------------
 *  `build()` IS A SEQUENCE A CONSUMER CAN REORDER, AND THAT IS NEW
 * ---------------------------------------------------------------------------
 *  It used to be one straight-line method, which is why a space racer remained
 *  the largest competing implementation of this file: it needs an ACCUMULATING
 *  TEMPORAL RESOLVE between the ambient occlusion and the depth of field, and
 *  there was no hook of any kind for a pass that this package had not decided
 *  about. The three capabilities it alone carried (`./Resolve.ts`,
 *  `./Bloom.ts`, `applyDofBackground`) were published first, and the
 *  orchestrator was still a second copy because `build()` had no room in it.
 *
 *  So the body is now `for (const stage of this.stages()) stage(b)` and every
 *  slot is a `protected` method. A consumer overrides `stages()` to insert its
 *  own pass at its own point in the order — and, because the ORDER is the thing
 *  returned rather than a fixed list with holes punched in it, "after the AO"
 *  is expressed by where the entry sits and not by a hook named after one
 *  game's requirement.
 *
 *  The default `stages()` returns exactly the five slots this file has always
 *  built, in exactly the order it always built them, so the six consumers that
 *  do not override anything produce a bit-identical chain — the chain probe
 *  compares 588 values per game per tier against the pinned pre-move sources
 *  under `Object.is` and is what says so.
 */
export class PostFXChain<W extends ChainWorld, G extends ChainGrade & Effect = GradeEffect> {
  grade: G | null = null;
  bloom: BloomEffect | null = null;
  dof: DepthOfFieldEffect | null = null;
  smaa: SMAAEffect | null = null;
  /** N8AOPostPass — untyped, the package has no declarations. */
  ao: unknown = null;

  /**
   * Every pass this chain put into the composer, in order.
   *
   * PROTECTED, because a subclass that adds a stage has to add its passes
   * through `this.add` — a pass registered anywhere else is a pass `dispose()`
   * leaks and `holdPassClocks` cannot freeze, and a chain with one unfrozen
   * clock in it is the 92%-noise-floor defect `./Clock.ts` exists to have
   * fixed.
   */
  protected passes: Pass[] = [];
  /**
   * The chain's own clock. Every time-driven term in the grade reads it; the
   * built-in `time` uniform is read by nothing in this file any more.
   *
   * Its four values are the same in both grade shaders this chain drives —
   * 0.37 Hz on a 977-texel stride, pinned at 0 while held, wrapped at 600 s —
   * so this is not a subclass hook and `clockTerms()` below is. What diverges
   * is the LIST OF TERMS the wrap is audited against, not the reading itself.
   */
  protected readonly frameClock = createFrameClock({
    hz: CLOCK_TERMS.grain.hz,
    stride: GRAIN_STRIDE,
    stillSeconds: CLOCK_STILL_SECONDS,
    wrapSeconds: CLOCK_WRAP_SECONDS,
  });
  protected gradePass: EffectPass | null = null;
  /**
   * The injected fault for this build, read ONCE in `build()`. Null in every
   * run that is not a fault run of the grade probe. See the
   * fault block in the header.
   */
  protected fault: ChainFault | null = null;
  /**
   * The eased lens state and the whole response, `./Lens.ts`'s.
   *
   * A follower owned per chain, not per module: three of its values are
   * HISTORY, and history at module scope is history two chains on one page
   * share by accident.
   */
  protected readonly lens = new LensFollower();
  private readonly viewHistory = new ViewHistory();

  // Scratch — nothing below allocates once the chain is built.
  //
  // PER INSTANCE, NOT PER MODULE, and that is a deliberate change from the two
  // game copies these came from. There they were module-level `_viewProj` /
  // `_dofTarget`, which was safe because a game has one chain; in a package a
  // module-level mutable Matrix4 is shared by every chain any consumer ever
  // builds, and a second chain on one page would silently write the first one's
  // reprojection history. Both games' copies carried a comment worrying about
  // exactly this class of thing when the grade moved out. Instance fields make
  // the worry unnecessary rather than answered.
  protected readonly viewProj = new THREE.Matrix4();
  protected readonly dofTarget = new THREE.Vector3();

  constructor(protected readonly spec: ChainSpec<W>) {}

  build(world: W, composer: EffectComposer, opts: PostFXOptions): void {
    this.dispose();

    // The injected fault, read ONCE and read HERE — after `dispose()`, so a
    // quality switch mid-session re-arms it rather than inheriting a stale
    // one, and before the chain is assembled, because two of the three faults
    // are decisions this method makes while it assembles. The game does the
    // `window` read; see the fault block in the header for why.
    this.fault = this.spec.faultAsked();

    // ── THE WRAP IS AUDITED, AND THE ANSWER IS COMPARED TO THE DECLARATION ──
    // Not "are there any pops" — there are four and they ship (see
    // CLOCK_KNOWN_POPS). The assertion is that the audit's answer EQUALS the
    // list this file says it knows about, so a seventh term added tomorrow, or
    // one of these six frequencies edited, throws at build time instead of
    // becoming a shape change nobody can attribute at minute ten. It is the
    // known-red rule, applied in product code: a defect that already ships
    // must not make the check for a NEW one useless.
    //
    // A throw and not a warn. This cannot happen at runtime — only in an edit —
    // and a survey of these five chains counted 41 warns and 0 throws, which
    // is a defect in its own right.
    const pops = wrapAudit(CLOCK_WRAP_SECONDS, Object.values(this.clockTerms())).pops;
    if (pops.join(',') !== CLOCK_KNOWN_POPS.join(',')) {
      throw new RangeError(
        `PostFX: the ${CLOCK_WRAP_SECONDS}s clock wrap pops [${pops.join(', ')}] Hz, `
          + `but this file declares [${CLOCK_KNOWN_POPS.join(', ')}]. A term was added or `
          + 'a frequency moved: update CLOCK_KNOWN_POPS with what you saw, or pick a wrap '
          + 'that is a whole number of turns of it.',
      );
    }

    const q = world.settings.quality;
    const b: ChainBuild<W> = {
      world,
      composer,
      opts,
      high: q >= Quality.High,
      ultra: q >= Quality.Ultra,
    };
    for (const stage of this.stages()) stage(b);

    this.viewHistory.reset();
  }

  /**
   * THE CHAIN, AS AN ORDERED LIST OF SLOTS. Override to reorder or to insert.
   *
   * Five entries, and they are the five this file has built since it existed:
   * scene, ambient occlusion, the merged depth-of-field/bloom pass, the grade,
   * the edge resolve. A consumer that needs a pass of its own inserts it by
   * returning a longer array — a space racer returns six, with its
   * temporal resolve between the AO and the lens pass, because the occlusion is
   * computed from a jittered depth buffer and has to land inside the same
   * accumulation, and because a temporal filter downstream of the grain would
   * average the grain toward zero.
   *
   * ARROWS, NOT BARE METHOD REFERENCES. `[this.buildScene, …]` would hand the
   * caller five unbound functions and every `this.add` in them would throw on
   * `undefined` — the failure would be at the first build, loudly, but the
   * wrapper costs five closures per build (and `build()` runs on a quality
   * change, not per frame) and cannot be got wrong by a subclass copying the
   * shape.
   */
  protected stages(): ReadonlyArray<ChainStage<W>> {
    return [
      (b) => this.buildScene(b),
      (b) => this.buildAmbientOcclusion(b),
      (b) => this.buildLensPass(b),
      (b) => this.buildGradePass(b),
      (b) => this.buildEdgeResolve(b),
    ];
  }

  /**
   * EVERY TERM IN THIS CHAIN'S GRADE THAT SPENDS A CLOCK, for the wrap audit.
   *
   * A subclass whose grade shader has a term this one does not — a second grain
   * hash, say — overrides this so the audit sees it. It is the LIST that is the
   * hook and not the reading: `frameClock` above is identical in both shaders
   * this chain drives and is therefore not overridable, so a subclass cannot
   * accidentally give itself a different grain phase while claiming to have
   * audited it.
   */
  protected clockTerms(): Readonly<Record<string, ClockTerm>> {
    return CLOCK_TERMS;
  }

  /** Slot 1 — the scene into the composer's HDR buffer. */
  protected buildScene(b: ChainBuild<W>): void {
    const renderPass = new RenderPass(b.world.scene, b.world.camera);
    this.add(b.composer, renderPass);
  }

  /**
   * THE OCCLUSION TINT, and it is the one AO value that is still this package's
   * rather than the game's.
   *
   * It is a protected method and NOT a required `ChainAOLook` field, which is a
   * scope call and not an argument that it should be one. Promoting it means
   * editing all six consumers' `LOOK` literals in one commit — all six carry
   * `0x101c2a` today and a space racer carries `0x141b2e` — and a change that
   * touches six games' files to add one field conflicts with every other
   * change in flight. So: overridable now, and the promotion to a
   * required field is named here as its own commit.
   *
   * The art direction is real either way. "The occlusion must sit in the fill
   * colour family or it reads as a black hole punched in the frame" — the only
   * thing lighting a cavity in that space racer is the planet, so a cavity that
   * gets darker must get BLUER, and one that goes toward black is claiming to
   * be lit by something that does not exist.
   */
  protected aoTint(): number {
    return 0x101c2a;
  }

  /** Slot 2 — ambient occlusion. */
  protected buildAmbientOcclusion(b: ChainBuild<W>): void {
    const { world, composer, high, ultra } = b;
    const look = this.spec.look;
    const s = world.settings;
    if (s.ssao) {
      const ao = new N8AOPostPass(world.scene, world.camera, world.width, world.height);
      const cfg = ao.configuration;

      // MSAA lives on the COMPOSER's input buffer, and this pass is the reason
      // it has to.
      //
      // The note that used to sit here said N8AOPostPass re-renders the scene
      // into a `beautyRenderTarget` and composites onto that, so the samples
      // had to be moved off the composer and onto that target. Both halves of
      // that are wrong, and the second half threw:
      //
      //   - `beautyRenderTarget` is a field of `N8AOPass`, the raw three.js
      //     pass. `N8AOPostPass` — the postprocessing-compatible one we build
      //     here — has no such field. It takes the composer's `inputBuffer` as
      //     `sceneDiffuse` and composites the occlusion onto that, which is
      //     exactly what a well-behaved post pass should do.
      //   - So `ao.beautyRenderTarget.samples = ...` was a TypeError on
      //     undefined. `build` is called inside a try/catch in
      //     RenderPipeline.rebuild, which caught it, tore the composer down and
      //     set `usePost = false`.
      //
      // `msaaSamples()` returns non-zero at Quality.High and Ultra on every
      // device (4 on hardware, 2 on a software rasteriser), and `ssao` is on at
      // both. So this line threw on every High/Ultra boot and the game ran with
      // NO post chain at all: no AO, no DoF, no bloom, no grade, no tone map
      // beyond the renderer's own fallback, no SMAA. The whole colour grade and
      // the bloom were dead on the tier the art direction targets.
      //
      // Nothing needs to be assigned here. RenderPipeline keeps the samples on
      // the composer, where the surviving scene render actually happens.

      // N8AO defines this in world units. A package default here would make the
      // first game's metre scale an invisible assumption in every later world.
      cfg.aoRadius = look.ao.radius;
      // N8AO documents 1.0 as the safe proportional attenuation value. Unlike
      // radius, it does not encode the dimensions of the caller's scene.
      cfg.distanceFalloff = 1.0;
      // N8AO's `intensity` is the exponent on the visibility term, so it is the
      // only knob that changes how *dark* contact gets. Measured against this
      // stack on a kart-sized box on tarmac: at 3.0 the road under the chassis
      // came out 29% below open road and the tyre contact strip 8% below, which
      // is inside the noise of a frame this bright — the art directors read it
      // as "no AO at all" and they were right to. 5.0 doubles both (44% / 19%),
      // which is the shipped-kart-racer look, and it costs nothing: the sample
      // count is unchanged.
      //
      // THE NUMBER IS THE GAME'S. The kart racer runs 5.0/5.4 (the paragraph
      // above is its measurement); the first-person shooter runs 2.2/2.5
      // against a much darker interior where the same exponent would crush the
      // floor. Required fields, so neither can inherit the other's by
      // forgetting.
      cfg.intensity = ultra ? look.ao.intensityUltra : look.ao.intensityBase;
      // THREE VALUES, NOT A TERNARY, because the two games do not step at the
      // same tier: the shooter goes 8/8/16 (up at Ultra) and the kart racer
      // 8/16/16 (up at High). AO is still the dearest pass in the chain, so
      // this is frame time and not decoration, and a shared gate would have
      // handed one game the other's budget at Quality.High while changing no
      // pixel a screenshot reviewer would look at.
      cfg.aoSamples = ultra
        ? look.ao.samplesUltra
        : (high ? look.ao.samplesHigh : look.ao.samplesBase);
      cfg.denoiseSamples = 8;
      // A 6-texel poisson denoise at half res is a 12-pixel blur, which is
      // wider than the contact band it is supposed to be cleaning up and turns
      // a tyre patch into a smudge. Tighter still now that the radius came
      // down — a 0.9 m radius produces a contact band only a few pixels wide at
      // chase distance, and a 3-texel half-res denoise is 6 px, i.e. wider than
      // the signal. One iteration at High; the second buys smoothness the tyre
      // contact does not want.
      cfg.denoiseRadius = 2;
      // ONE ITERATION EVERYWHERE, INCLUDING ULTRA.
      //
      // The paragraph above already argues that the second pass "buys
      // smoothness the tyre contact does not want", and it only ever ran on
      // Ultra, which was also the only tier running AO at full resolution. Now
      // that Ultra is on the half-res buffer with everything else (see below),
      // a second 2-texel poisson pass on a half-res buffer is a 8 px blur on
      // the contact band this radius was widened to protect — it would undo the
      // widening rather than polish it. It is also the cheaper half of a pair
      // of changes: the AO pass is the most expensive thing in the chain.
      cfg.denoiseIterations = 1;
      // Occlusion tinted toward the sky fill instead of black — the art bible
      // forbids pure-black shadow, and cool crevices sit right next to the
      // warm key light. See `aoTint()` for why this one AO value is a
      // protected method rather than a required `ChainAOLook` field.
      cfg.color = new THREE.Color(this.aoTint());
      cfg.colorMultiply = true;
      cfg.screenSpaceRadius = false;
      cfg.depthAwareUpsampling = true;
      // HALF RESOLUTION ON EVERY TIER. This used to read `q < Quality.Ultra`,
      // which made Ultra the only tier in the game running ambient occlusion at
      // full drawing-buffer resolution — and Ultra is handed out to every Apple
      // M, RTX, Radeon RX and Arc machine, i.e. to exactly the desktops the
      // 60 fps target is written for.
      //
      // It was the single most expensive thing in the frame. Measured with a
      // paired A/B inside one session (a fresh baseline block before every arm,
      // the simulation held still with `window.__freeze` so both arms render
      // the same frame, the adaptive scaler pinned), flipping Ultra to half res
      // took 5.1, 5.3 and 8.7 ms out of a 1080p-equivalent frame across three
      // runs on a machine that was carrying other test harnesses at the time.
      // An earlier audit, measured on a quiet machine, puts the same change at
      // 2.24 -> 0.84 ms/Mpx, i.e. ~2.9 ms at 1080p. Either way it is the
      // largest single saving available in this chain.
      //
      // And it costs nothing that was ever signed off: half res is what
      // Quality.High has always shipped, it is the buffer the whole radius /
      // falloff / denoise argument above was reasoned and measured against, and
      // `depthAwareUpsampling` (on, just above) is what keeps the occlusion
      // pinned to the depth discontinuities on the way back up. Ultra still
      // differs from High where it can be seen — 16 aoSamples against 8, and a
      // stronger `intensity` — it just stops paying four times the fill rate
      // for a buffer nobody was judging at full resolution.
      cfg.halfRes = true;
      cfg.accumulate = false;
      cfg.neuralDenoise = false;
      // The auto-detect walks the entire scene graph every single frame.
      ao.autoDetectTransparency = false;
      cfg.transparencyAware = false;
      this.ao = ao;
      this.add(composer, ao as Pass);
    }
  }

  /**
   * THE FOUR NUMBERS THAT PLACE THE LENS, and the same scope call as `aoTint`:
   * a protected method today, a required `ChainLook` field the day somebody
   * spends the commit that edits all six consumers.
   *
   * They are not decoration. A space racer runs 16 m / 170 m against
   * this 9 m / 60 m because both moved with the speed — at 142 m/s a 60 m focus
   * range covers 0.42 s of track, so the next corner was softening while the
   * player was still committing to it.
   */
  protected dofLook(): {
    focusDistance: number; focusRange: number; bokehScale: number; resolutionScale: number;
  } {
    return {
      // Garnish only: a long focus range means the road, the kerbs and the
      // next two corners stay razor sharp and only the bay and the headland
      // soften. bokehScale stays small for the same reason.
      focusDistance: 9,
      focusRange: 60,
      bokehScale: 1.25,
      // Applied ON TOP of the halved base in ScaledDepthOfFieldEffect, so the
      // blur tier lands at a quarter of the drawing buffer. The near-field
      // half of that tier is very nearly a no-op in this game anyway: with
      // focusDistance 9 and focusRange 60, a subject 1 m from the lens has a
      // near CoC of smoothstep(0, 60, 8) = 0.05.
      resolutionScale: 0.5,
    };
  }

  /**
   * Every bloom effect that joins the lens pass, in the order they join it, and
   * the hook a game with a SECOND mip chain overrides.
   *
   * An array and not one effect, because a space racer runs two — an
   * anamorphic 5.2:1 primary and an isotropic halo — and they are one bloom
   * SLOT with two effects in it rather than two slots. Both are
   * `BlendFunction.ADD` with `EffectAttribute.NONE`, so postprocessing merges
   * them into the same pass and the second mip chain costs its own up/down walk
   * and no extra full-screen round trip.
   */
  protected makeBlooms(b: ChainBuild<W>): Effect[] {
    if (!b.world.settings.bloom) return [];
    // Threshold sits above diffuse white on purpose: only the sun on chrome,
    // the water sparkle, drift sparks and boost flame clear it. A low
    // threshold is what turns a frame milky.
    //
    // It is measured on the SCENE-LINEAR buffer, not on display values, and
    // that is where 0.9 went wrong: with exposure 1.05 through ACES a linear
    // 0.9 lands around 0.6 on screen, i.e. below every lit road surface, wall
    // and kerb in the game. The whole frame was above threshold, so bloom
    // welded the sun-facing tarmac into the sky and ate the vanishing point,
    // the roof ridges and the boost chevrons.
    //
    // 2.0 was NOT the reason an early capture set had no visible bloom — 2.0
    // linear displayed at about 202 on the old tone curve, so the sun disc, the
    // road sheen and the sky around the sun all cleared it comfortably; the
    // shoulder then crushed the bloom and its source into the same 232-250
    // band, which is what made it read as a milky smear instead of a glow.
    // Dropping the threshold to the 1.15-1.3 the review suggested would have
    // re-created the milky-frame regression above without touching the actual
    // cause.
    //
    // With the shoulder fixed the threshold has to move a little anyway: the
    // new curve puts linear 2.0 at display ~220, so holding the number would
    // quietly RAISE the gate. 1.55 lands back at ~205, i.e. the same "just
    // above sunlit diffuse white" population as before, now on a curve that
    // lets the result read.
    const bloom = new ScaledBloomEffect({
      // ADD, not SCREEN: the buffer is scene-linear HDR, and screen blending
      // values above 1 actually *darkens* them. Bloom is light being added.
      blendFunction: BlendFunction.ADD,
      // 0.78 on an 8-bit buffer, and that number is not a taste call. The
      // buffer clamps at 1.0, so a gate of 1.55 selects nothing whatsoever
      // and the fallback tier ships with the bloom silently missing — the
      // exact class of invisible degradation this change exists to remove.
      // 0.78 keeps the same population it was aiming at (just above sunlit
      // diffuse white) inside the range the buffer can represent.
      luminanceThreshold: b.opts.ldr === true ? 0.78 : 1.55,
      luminanceSmoothing: 0.32,
      mipmapBlur: true,
      // Slightly hotter to pay back the pixels the higher threshold removed:
      // fewer sources, each allowed to glow harder.
      intensity: 0.88,
      // Wide and soft — a big mip chain with a high radius reads as a lens,
      // a small one reads as a glow filter.
      //
      // A CEILING NOW, NOT A COUNT — see `ScaledBloomEffect` above. Six is what
      // a 1080-row buffer buys and it is what a 1080-row buffer still gets,
      // exactly; every rung
      // below it now buys fewer levels so the veil reaches the same fraction
      // of the SCREEN instead of the same fraction of the buffer.
      //
      // ONE MORE LEVEL OFF, and this is the "the entire midground dissolves
      // into a formless white haze" note. Measured on a boost capture: nothing
      // in that frame clips — 0.000% of pixels are above display luma 250 and
      // the whole shot ceilings at 245 — so it is NOT overexposure and
      // clamping the additive term (the review's suggestion) would have
      // treated a symptom that is not present. What the numbers show is a
      // VEIL: the horizon band at y300-400 runs 158 -> 218 -> 164 across the
      // frame with a local sd of 52, i.e. plenty of energy and no structure.
      // A seven-level chain at 1080p blurs the top mip over ~128 px, so the
      // sun sitting on the horizon smears a halo a fifth of the frame wide
      // over the road, the trackside props and the vanishing point — which is
      // exactly the region the reviewers say they cannot read. Six levels
      // halves that reach to ~64 px, keeps the disc glow the art direction
      // asks for, and costs one fewer up/down mip pair per frame.
      radius: 0.72,
      levels: 6,
    });
    this.bloom = bloom;
    return [bloom];
  }

  /** Slot 3 — depth of field and bloom, in ONE full-screen pass. */
  protected buildLensPass(b: ChainBuild<W>): void {
    const { world, composer } = b;
    const look = this.spec.look;
    const s = world.settings;

    // --- depth of field ----------------------------------------------------
    // Built here, ADDED BELOW. DoF and bloom go into one EffectPass together;
    // see the note on `merged` after the bloom block.
    let dofEffect: DepthOfFieldEffect | null = null;
    if (s.dof) {
      const dofLook = this.dofLook();
      const dof = new ScaledDepthOfFieldEffect(world.camera, dofLook);
      // THE GAME'S, AND REQUIRED. See `ChainLook.dofBackground`: whether a lens
      // is allowed to be honest about infinity is art direction, and this
      // package must not hold an opinion about it. Called unconditionally
      // because `null` is a statement and `applyDofBackground` does nothing
      // with it — a branch here would be a second place the policy is decided.
      //
      // THE BOKEH SCALE IS READ OFF THE SAME OBJECT the effect was constructed
      // from, and that is load-bearing rather than tidy: the package derives
      // the CoC clamp from the blend caps AND this scale, so a second literal
      // here would silently mean something different the moment the authored
      // scale moved. It was two literal 1.25s until 2026-08-21.
      applyDofBackground(dof, dofLook.bokehScale, look.dofBackground);
      dof.target = this.dofTarget.set(0, 0, 0);
      this.dof = dof;
      dofEffect = dof;
    }

    // --- one pass for both -------------------------------------------------
    // TWO EFFECTS, ONE FULL-SCREEN ROUND TRIP. Each EffectPass is a read of the
    // composer's 1920x1080 half-float buffer and a write back to the other one
    // — 15.8 MB each way, 31.6 MB per pass per frame, 1.9 GB/s at 60 Hz — so a
    // pass that exists only because two effects were constructed separately is
    // pure bandwidth. Merged, the chain goes from 6 full-screen passes to 5 and
    // from 122 programs to 121.
    //
    // ONLY these two, and the rule is mechanical rather than a matter of taste:
    //
    //   - postprocessing refuses to merge two effects that both declare
    //     `EffectAttribute.CONVOLUTION` ("Convolution effects cannot be
    //     merged"). GradeEffect declares it (reprojection motion blur samples
    //     along a velocity vector) and so does SMAAEffect, so those two can
    //     never share a pass with each other.
    //   - GradeEffect cannot join THIS pass either, and the reason is the sort
    //     rather than the rule: `EffectPass` orders its effects by
    //     `b.attributes - a.attributes`, and CONVOLUTION|DEPTH is 3 against
    //     DoF's DEPTH 1 and Bloom's NONE 0. The grade would be reordered to
    //     FIRST, which would run the display transform before bloom added
    //     scene-linear HDR energy on top of an already display-referred image.
    //   - SMAA has to stay last on its own regardless: it is the final resolve,
    //     and it is deliberately placed after the grain and the aberration.
    //
    // DoF (1) then Bloom (0) is the order that same sort produces, which is the
    // order they were already in. One semantic change and it is small: bloom's
    // `update()` now prefilters the composer's input buffer instead of the
    // DoF's output, so it sources from the unblurred image. The bloom sources
    // in this game are the sun disc, chrome, water sparkle and boost flame, and
    // the far-field CoC that DoF applies to them is ~2.5 px going into a
    // six-level mip chain.
    //
    // AND `makeBlooms` MAY RETURN MORE THAN ONE. Both games' blooms are
    // `BlendFunction.ADD` with `EffectAttribute.NONE`, so postprocessing merges
    // however many of them there are into this one pass — a space racer's
    // anamorphic primary and its isotropic halo cost a second mip walk and no
    // second round trip. That is still ONE bloom slot, with two effects in it.
    const merged: Effect[] = [];
    if (dofEffect !== null) merged.push(dofEffect);
    merged.push(...this.makeBlooms(b));
    if (merged.length > 0) {
      this.add(composer, new EffectPass(world.camera, ...merged));
    }
  }

  /**
   * How many taps the reprojection motion blur gets, or 1 for "off".
   *
   * OVERRIDABLE, AND THE TWO KNOWN ANSWERS GENUINELY DISAGREE ABOUT
   * `software`. This one drops to a single tap on a software rasteriser
   * because a headless capture is a still frame anyway; a space racer
   * measured that the saving is not real in its shader — `SMEAR_SAMPLES` is
   * `max(12, samples)` regardless and the loop runs whenever there is any
   * travel — so all the flag removed there was the REPROJECTION, i.e. the only
   * part its art direction permits, and a whole review pass scored a radial
   * smear the player never sees. Two shaders, two right answers.
   */
  protected gradeSamples(b: ChainBuild<W>): number {
    // Software rasterisers pay for every tap, and a headless capture is a
    // still frame anyway — one tap keeps the aberration and drops the blur.
    // (The shader honours that literally now: below two taps it zeroes the
    // velocity instead of stochastically displacing the single tap.)
    return !b.world.settings.motionBlur || b.opts.software ? 1 : (b.high ? 6 : 4);
  }

  /**
   * THE GRADE EFFECT ITSELF. See `ChainGrade` for why this is a hook.
   *
   * The six options are the same six in both shaders — they are the interface
   * a tone curve, an S-curve, a saturation rolloff, a vignette and a grain
   * amplitude present, and both programs agree on the tone curve. What the two
   * disagree on is everything downstream of it, which is why the shader is
   * constructed here rather than shared.
   */
  protected makeGrade(opts: {
    samples: number; exposure: number; contrast: number;
    saturation: number; vignette: number; grain: number;
  }): G {
    return new GradeEffect(opts) as unknown as G;
  }

  /** Slot 4 — the grade, on its own pass. */
  protected buildGradePass(b: ChainBuild<W>): void {
    const { world, composer } = b;
    const look = this.spec.look;

    // --- merged grade / lens ----------------------------------------------
    const samples = this.gradeSamples(b);
    // ── FAULT look-constant-drift ──────────────────────────────────────────
    // ONE look constant, moved 1%, and nothing else in the frame touched. It
    // must red the probe's picture row (the picture changed) and must NOT red
    // its reproducibility row (a constant is still a constant — the frame is
    // exactly as reproducible as it was).
    //
    // EXPOSURE, and the choice is the whole value of this fault. The picture
    // row compares hashes, so its tolerance is zero and any nudge at all
    // reddens it; what the probe cannot do without this is say HOW MUCH
    // PICTURE a red is worth. Exposure multiplies every lit pixel, so the mean
    // |delta| it produces is a CALIBRATION in the same units the
    // reproducibility row's noise floor is quoted in — read it against the old
    // noise floor of 3.2833 and the 3.5658 of an entire frame of real change
    // (see `Clock.ts`). `CA_REST` was the prettier
    // choice and the wrong one: 1% of a 0.4 px fringe at rest is under the
    // 8-bit quantiser on almost every pixel, and a fault that reddens nothing
    // is not a fault.
    let exposureScale = 1;
    if (this.fault === 'look-constant-drift') {
      exposureScale = 1.01;
      this.spec.faultApplied(this.fault);
    }
    const grade = this.makeGrade({
      samples,
      exposure: look.grade.exposure * exposureScale,
      contrast: look.grade.contrast,
      saturation: look.grade.saturation,
      vignette: look.grade.vignette,
      // Trimmed with the shadow rolloff added in the shader — the grain was
      // never the coloured speckle the review saw, but at 0.012 flat it was
      // still +/-1.8 counts of white noise sitting on top of the darkest eighth
      // of the frame, which is where it is most visible and least wanted.
      grain: look.grade.grain,
    });
    this.grade = grade;
    this.gradePass = new EffectPass(world.camera, grade);
    // ── FAULT grade-bypassed — THE ONE THAT MUST NEVER BE GREEN ────────────
    // The pass is BUILT and never inserted, which is the fault exactly as the
    // probe's header specifies it: the whole grade — tone map, aberration,
    // vignette, grain, speed lines — leaves the picture while everything
    // around it stays where it was. It must red the picture row and it must NOT
    // red the reproducibility row: a chain with no grade in it is still
    // perfectly reproducible, and that gap
    // between the two rows is what makes this a PICTURE detector rather than a
    // second copy of the gate.
    //
    // OMITTED, NOT `enabled = false`, and the difference is a trap already paid
    // for once: `renderToScreen` is a sticky flag on `passes[len-1]` regardless
    // of `enabled`, and `render()` merely `continue`s past a disabled pass, so
    // disabling the LAST pass leaves the canvas holding a frame nobody redrew
    // and two screenshots of it agree perfectly. That is a fault that FAKES A
    // PASS. Here the SMAA pass is still added below either way, so the chain
    // continues to end in a pass that actually draws.
    if (this.fault === 'grade-bypassed') {
      this.spec.faultApplied(this.fault);
    } else {
      this.add(composer, this.gradePass);
    }
  }

  /** Slot 5 — the final edge resolve, on top of MSAA, dithered to the screen. */
  protected buildEdgeResolve(b: ChainBuild<W>): void {
    const { world, composer, high } = b;
    // --- resolve -----------------------------------------------------------
    const smaa = new SMAAEffect({
      // Low tier runs without MSAA, so SMAA has to carry the whole edge budget.
      preset: high ? SMAAPreset.ULTRA : SMAAPreset.HIGH,
      // LUMA, not COLOR. COLOR edge detection compares all three channels, so
      // on a frame that carries any chroma noise at all it fires on the noise
      // and spends its edge budget smearing speckle instead of finding the kerb
      // stripe underneath — and it runs last, after grain and aberration, so it
      // sees the worst version of the image. LUMA is also the cheaper of the
      // two and is what SMAA was designed around; with real MSAA restored
      // underneath it there is nothing left for COLOR to buy.
      edgeDetectionMode: EdgeDetectionMode.LUMA,
    });
    this.smaa = smaa;
    const smaaPass = new EffectPass(world.camera, smaa);
    // Ordered dither on the final 8-bit write; without it the sky gradient
    // bands, which section 9 of the art bible calls out by name.
    smaaPass.dithering = true;
    this.add(composer, smaaPass);
  }

  /**
   * Per-frame uniform sync. Called immediately before `composer.render()`, so
   * the camera has already been placed by the chase camera's lateUpdate.
   */
  sync(world: W, dt: number): void {
    // ── IS THE WORLD BEING HELD? ────────────────────────────────────────────
    // `@homie-rocks/postfx` may not read `window`, so the game asks and the
    // package is told, which is also what lets a Node harness
    // drive the same protocol. This entry point asks the spec; `present` below
    // is handed the pipeline's answer instead, and USES IT, so that a frame is
    // never converged against one reading of "held" and graded against another.
    this.syncHeld(world, world.camera, dt, this.spec.held());
  }

  /**
   * `PostChain.present` — the whole frame, for a chain with nothing per-draw to
   * converge, which is every consumer of this base class.
   *
   * The capture obligation of such a chain is nil: its output is already a pure
   * function of the frozen world and the pinned clock, so N identical draws
   * would be N identical images and there is nothing to accumulate. A chain
   * that DOES carry an accumulating temporal resolve overrides this and runs
   * `@homie-rocks/postfx/Capture.ts`'s protocol over `draw`.
   */
  present(
    world: W, camera: THREE.Camera, dt: number, held: boolean, draw: () => void,
  ): void {
    this.syncHeld(world, camera, dt, held);
    draw();
  }

  /**
   * `PostChain.setSize` — nothing in the shared chain is authored in screen
   * pixels.
   *
   * NOT AN EMPTY METHOD FOR TIDINESS. Every value this chain resolves against
   * the surface — the bloom's level count, the DoF's scaled targets, the AO's
   * depth buffer — is read back out of `composer.setSize`'s own pass walk,
   * which the pipeline has already run by the time this is called. There is
   * genuinely nothing left to re-resolve, and a chain that adds a
   * screen-pixel-authored value later must override this rather than discover
   * at retina that it arrived a level short.
   */
  setSize(_bufW: number, _bufH: number): void {}

  /** Resize and resolution changes invalidate every camera's projection history. */
  invalidate(): void { this.viewHistory.reset(); }

  private syncHeld(world: W, camera: THREE.Camera, dt: number, held: boolean): void {
    const grade = this.grade;
    if (grade === null) return;

    // The clock the grade spends, in seconds, pinned while held. `advance`
    // returns the single-frequency PHASE, which is what a chain with one
    // time-driven term wants; this one has six, so it takes the reading.
    if (this.fault === 'clock-unfrozen') {
      // ── FAULT clock-unfrozen ────────────────────────────────────────────
      // The 92%-noise-floor defect, restored verbatim: A WALL CLOCK, which no
      // `__freeze` can reach and which the frame clock above exists precisely
      // to replace. The grain's phase is `fract(clock * 0.37) * 977` texels,
      // so the 600 ms the probe leaves between two captures walks the grain
      // field about 217 texels and the two PNGs cannot be the same file.
      //
      // It must red the reproducibility row — the gate — and it must NOT red
      // the picture row, because this is a REPRODUCIBILITY defect and not a
      // look change. The picture row then reports BLOCKED rather than FAIL for
      // a game that failed the gate, and that is the
      // right third colour: any difference such a game shows is
      // indistinguishable from its own capture noise, and any agreement it
      // shows is luck. "We could not measure it" and "we measured it and it
      // was fine" must never render as the same colour.
      //
      // The frame clock is deliberately left un-advanced. This fault changes
      // where the reading COMES FROM; advancing it as well would inject two
      // defects at once and the probe could not attribute the red to either.
      grade.clock = performance.now() / 1000;
      this.spec.faultApplied(this.fault);
    } else {
      this.frameClock.advance(dt, held);
      grade.clock = this.frameClock.seconds();
    }

    // AND STOP EVERY PASS'S OWN CLOCK, which is belt and braces rather than
    // decoration. postprocessing accumulates `material.time += deltaTime *
    // timeScale` on every EffectPass, and that uniform is visible to any effect
    // compiled into the pass. The grade no longer reads it — that is what the
    // two lines above are for — but the next effect somebody adds to this chain
    // would inherit the identical un-freezable clock and the identical silent
    // corruption, and nothing would say so. Zeroing the scale means an effect
    // that reads `time` is frozen by default and has to opt OUT.
    holdPassClocks(this.passes as unknown as { timeScale?: number }[], held);

    // The renderer will do this again in a moment, but we need this frame's
    // view matrix *now* — otherwise the velocity we compute lags the depth
    // buffer we compute it against by a frame.
    camera.updateMatrixWorld();

    // Each split-screen camera reprojects against its own previous frame.
    // A held capture uses its current transform, so a teleported capture pose
    // does not invent motion. Other cameras keep their independent history.
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    grade.invViewProj.copy(this.viewProj).invert();
    this.viewHistory.sample(camera, this.viewProj, grade.prevViewProj, held);

    // ── THE WHOLE LENS RESPONSE IS `./Lens.ts`'S NOW ────────────────────────
    //
    // What used to sit here was forty lines of dense float arithmetic reading
    // eleven constants imported from `Grade.ts` — `CA_REST`, `CA_BOOST`,
    // `STREAK_*`, `VIGNETTE_SPEED`, `IGNITE_TAU`, `SPEED_FLATOUT`, `KICK_*` —
    // off two fields of `ChainWorld` called `speedIntensity` and `fovPunch`.
    // Two games that could not see each other's code reported the same
    // defect: a seven-field platform interface, two of whose fields were a
    // racer's, driving constants a platform package had quietly decided.
    //
    // Every number is a field of `spec.lens.look` now and the two world fields
    // are `spec.lens.read`, so a game states its own lens or names a shipped
    // one. The arithmetic did not change — the chain probe compares 588
    // values per game per tier against the PINNED pre-move chains
    // by Object.is with no epsilon, and it is what says so rather than this
    // comment.
    const L = this.lens.update(
      this.spec.lens.look, this.spec.lens.read(world), dt, world.settings.motionBlur);

    const lens = grade.lens;
    lens.x = L.ca;
    lens.z = L.streak;
    lens.w = L.shutter;

    const vig = grade.vig;
    // THREE TERMS ADDED IN THIS ORDER, and it is not tidiness. See
    // `LensOut.vignetteDrive`: the first draft summed the two lens terms inside
    // the package, so this line computed `base + (drive + ignite)` where the
    // code it replaced computed `(base + drive) + ignite`. Floating-point
    // addition is not associative, and the chain probe reddened 4 of 588
    // values in a first-person shooter and 3 in a kart racer at the last unit
    // in the last place.
    vig.x = grade.grade.w + L.vignetteDrive + L.vignetteIgnite;
    vig.y = L.vignetteInner;

    const rush = grade.rush;
    rush.x = L.rush;
    rush.y = L.comb;
    rush.z = L.combBoost;

    if (this.bloom !== null) this.bloom.intensity = L.bloom;

    this.applySubject(world, camera, grade);
  }

  /**
   * Park the motion-blur hold-out and the depth-of-field focus on whatever this
   * game says must stay sharp.
   *
   * PROTECTED so a chain with its own `sync()` — one carrying an accumulating
   * temporal resolve, say — still asks the spec rather than writing a third
   * copy of these ten lines. It was two copies until 2026-08-21, and they
   * agreed exactly: this block is not where the games differ.
   *
   * WHAT MUST STAY SHARP is asked of the game because the answer is the one
   * place these chains genuinely disagree and it is not a branch. A
   * first-person shooter protects the camera (the viewmodel lives on it) and
   * focuses on the aim point; a kart racer protects and focuses on the hero
   * chassis, and nothing about
   * that is derived from the camera: the arm length, the rig's pitch and the
   * camera mode all move the kart around the frame and around the depth range,
   * and none of them move it relative to itself.
   */
  protected applySubject(world: W, camera: THREE.Camera, grade: G): void {
    const subject = this.spec.subject(world, camera);

    const hold = grade.hold;
    if (subject !== null) {
      grade.subject.copy(subject.centre);
      hold.set(subject.holdInner, subject.holdOuter);
    } else {
      // No subject to protect — release the mask and let the whole frame blur.
      hold.set(-2, -1);
    }

    if (this.dof !== null) {
      if (subject !== null) {
        this.dofTarget.copy(subject.focus);
        this.dof.target = this.dofTarget;
      } else {
        this.dof.target = null;
      }
    }
  }

  dispose(): void {
    // Fault-tolerant per pass, and that matters in exactly one place: this is
    // called from the 'webglcontextlost' handler, against a context that is
    // already dead. A pass whose `dispose` reaches for a GL object that no
    // longer exists must not be allowed to abort the loop and leave the rest of
    // the chain — and the notice the player is waiting to see — half done.
    for (const pass of this.passes) {
      try { pass.dispose(); } catch (err) { console.warn('[postfx] pass dispose failed', err); }
    }
    this.passes.length = 0;
    this.grade = null;
    this.bloom = null;
    this.dof = null;
    this.smaa = null;
    this.ao = null;
    this.gradePass = null;
    // A rebuilt chain has no history and no clock. Without this a quality
    // switch mid-session would hand the fresh grade a phase from the old
    // one, which is invisible and unattributable.
    this.frameClock.reset();
    // The eased lens state is history, and after a teardown there is none. Left
    // alone, a chain rebuilt while the player happened to be mid-boost came
    // back with a full-strength streak and aberration over a frame whose
    // reprojection history had just been reseeded to "no motion" — a lens that
    // says 120 km/h over an image that says parked.
    this.lens.reset();
    this.viewHistory.reset();
  }

  /**
   * Registers a pass with the composer and tracks it for disposal.
   *
   * PROTECTED, because a subclass stage has to add its passes through this and
   * not through `composer.addPass`. See `passes`.
   */
  protected add(composer: EffectComposer, pass: Pass): void {
    composer.addPass(pass);
    this.passes.push(pass);
  }
}
