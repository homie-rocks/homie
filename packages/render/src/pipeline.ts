/**
 * ============================================================================
 *  RenderPipeline — owns the WebGLRenderer and the post-processing composer.
 * ============================================================================
 *  This is the only object in a game permitted to call `renderer.render()` or
 *  `composer.render()`. Everything else draws by putting objects in the scene
 *  graph.
 *
 *  `PipelineAdapter<W>` is deliberately optional policy and hooks, never a
 *  game mode; a base-building game adopted this pipeline without changing its
 *  look.
 *
 *  The chain itself is the GAME'S — see `PostChain` below; this file is
 *  responsible for the device, the buffers, the resolution policy, and for
 *  degrading all of it gracefully when the hardware — or a software rasteriser
 *  under a headless screenshot run — cannot take the full stack.
 *
 * ----------------------------------------------------------------------------
 *  WHY THIS FILE IS HERE, AND WHAT THE SEAM ACTUALLY WAS
 * ----------------------------------------------------------------------------
 *  It was the `Renderer.ts` of a first-person shooter and of a kart racer, at
 *  1,354 and 1,345 lines, of which **1,344 were byte-identical** by LCS over
 *  lines. The largest duplicate left in the codebase, and the whole
 *  divergence was THIRTEEN LINES.
 *
 *  The post-processing extraction found its seam at a single line number, with
 *  everything past it divergent. THIS FILE WAS NOT THAT SHAPE, and that is the
 *  reason it reads the way it does. Lines 1-272 were identical, lines 578-1354
 *  were identical, and the divergence was interleaved between them — so there
 *  was no "half that knows what this game draws" to leave behind in the games.
 *  What separated them was TWO VALUES:
 *
 *      toneMappingExposure          1.72 (shooter)  against  1.05 (kart racer)
 *      the shadow-cascade cadence   every other frame    against every frame
 *
 *  Both are now fields of `PipelineLook`, supplied by the game. The first was
 *  settled in the design before the extraction started: @homie-rocks/render
 *  may know "a rung, a pixel ratio, a draw call, AN EXPOSURE".
 *  The second is a NUMBER and deliberately not a mode; see `PipelineLook`.
 *
 * ----------------------------------------------------------------------------
 *  WHAT THIS FILE MAY NOT KNOW
 * ----------------------------------------------------------------------------
 *  `Ctx` does not cross this seam, including as an `import type` — it carries
 *  race, track, items, match, combat and colony, and one type alias would put
 *  every one of those inside the engine. The pipeline declares the NARROW
 *  STRUCTURAL SHAPE it actually reads (`PipelineWorld`) and is generic over it.
 *  Each game's `Ctx` satisfies that shape without either side naming the other,
 *  which is also why the migration rewrote no call sites: TypeScript is
 *  structural, so `pipeline.render(ctx)` still typechecks unchanged.
 * ============================================================================
 */
import * as THREE from 'three';
import { EffectComposer } from 'postprocessing';
import {
  Quality, glCapabilities, forcedFailure, drainErrors, consumedFailures,
  type GLCapabilities,
} from './caps.js';
import { glRect, equalSized, type PipelineView } from './views.js';
import { heldForCapture } from './held.js';
import { maxRenderbufferSize, resolutionCeiling } from './resclamp.js';

/**
 * How much of a frame the health watchdog could read, and what it found.
 *
 * DECLARED HERE RATHER THAN IMPORTED, and that is a package boundary rather
 * than a copy. Each game's own diagnostics module declares the same shape;
 * this package cannot import a game's module, and `sampleFrame()` has to
 * return SOMETHING. The shape is four numbers about a framebuffer — no game
 * vocabulary in it — so the two declarations are compatible by structure, and
 * once @homie-rocks/diagnostics takes this one both sides can delete their
 * copy.
 */
export interface FrameSample {
  /** fraction of sampled pixels above display luma 12 */
  lit: number;
  mean: number;
  /** luma standard deviation — structure, not brightness */
  sd: number;
  /** false when the read could not be performed at all */
  ok: boolean;
}

/**
 * The two things the pipeline says out loud, injected because their home has
 * not moved yet.
 *
 * `logPipeline` is the ring buffer every black-screen investigation is read
 * out of, and `recordShaderError` is what makes a rejected material family
 * visible instead of merely absent. Both live in each game's own diagnostics
 * module. Passing them in costs one struct and keeps the two independent;
 * re-deriving them here would put a second ring buffer in the process and the
 * two would disagree about the same boot.
 */
export interface PipelineDiagnostics {
  logPipeline(kind: string, message: string): void;
  recordShaderError(text: string, label: string, world: boolean): void;
}

/**
 * The only fields of a game's context this pipeline reads.
 *
 * IT IS NOT `Ctx` AND MUST NEVER BECOME IT. `Ctx` carries race, track, items,
 * match, combat and colony; one `import type` of it would put all of those
 * inside the engine. This is the list that was actually consulted across 1,354
 * lines, and it is nine fields, every one of which is a renderer's vocabulary.
 *
 * `renderer` is written, not read — `finishInit` publishes the device back to
 * the game the way it always did, so no call site had to change.
 */
export interface PipelineWorld {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  dt: number;
  width: number;
  height: number;
  settings: PipelineSettings;
  /**
   * HOW MANY PICTURES THIS FRAME IS. Absent or empty means one, filling the
   * surface, which is every game that existed when this field was added and is
   * the only state the four of them can produce.
   *
   * OPTIONAL, AND IT IS THE ONE OPTIONAL FIELD IN THIS FILE. Every other
   * interface here refuses defaults on `BootSpec`'s reasoning — a game that
   * forgets a field should fail to compile rather than inherit another game's
   * art direction. This one is different in kind: `undefined` here does not
   * mean "the caller forgot", it means "this game has one view", and making it
   * required would be a contract change forced on four games to describe a
   * capability none of them uses. The absence is also load-bearing for the
   * byte-exact check: `render()` reads it and takes a code path that did not
   * move, so a single-view game's frame cannot have changed.
   */
  views?: readonly PipelineView[];
}

/**
 * The render policy a game hands over. Every field is a switch about how the
 * frame is BUILT, never about what is in it.
 *
 * Structurally identical to both games' `Settings` minus `masterVolume`,
 * `particleDensity`, `foliageDensity` and `reflections`, which this file has
 * never read.
 */
export interface PipelineSettings {
  quality: Quality;
  maxPixelRatio: number;
  shadows: boolean;
  ssao: boolean;
  bloom: boolean;
  motionBlur: boolean;
  dof: boolean;
  renderScale: number;
  volumetrics: boolean;
}

/**
 * THE THIRTEEN LINES. Everything that separated the shooter's renderer from
 * the kart racer's, as values a game supplies.
 *
 * ON `shadowCascadeInterval` BEING A NUMBER AND NOT A MODE, because that is
 * the whole test this extraction had to pass. The two games did this
 * differently: the shooter set `shadowMap.autoUpdate = false` and flipped
 * `needsUpdate` on alternate frames, the kart racer left `autoUpdate` true.
 * Written as a flag — `amortiseShadows: boolean` — that is a BRANCH inside a
 * shared function, the smell the reduction test names, and a `mode`
 * parameter is that same smell wearing a suit.
 *
 * It is not a flag, because the two are the same arithmetic at two cadences.
 * three's `autoUpdate = true` means "set needsUpdate every frame", so the
 * renderer-driven form with an interval of 1 is not LIKE the kart racer's
 * behaviour, it IS the kart racer's behaviour: `(gate++ % 1) === 0` is true on
 * every frame. Both games now run one code path with no branch in it, and the
 * number is the tuning knob it always was — 1 rebuilds the cascade every
 * frame, 2 on alternate frames.
 *
 * The shooter's own comment for choosing 2 travels with it and is quoted where
 * the cadence is applied, because the reason is a fact about that game's world
 * (a static moon, a station that does not deform) and not about renderers.
 */
export interface PipelineLook {
  /**
   * `renderer.toneMappingExposure`. The design grants this package "a rung, a
   * pixel ratio, a draw call, AN EXPOSURE" and no other look constant.
   */
  exposure: number;
  /**
   * Surface frames between requested shadow-cascade rebuilds. 1 requests one
   * at the first renderer submission of every surface frame. A chain that
   * deliberately invokes `renderer.render()` again inside that frame may set
   * `shadowMap.autoUpdate = true` from `setupRenderer` when every internal
   * submission must rebuild too. Must be >= 1;
   * a 0 would divide the gate by zero and is rejected at construction rather
   * than producing a shadowless game nobody can explain.
   */
  shadowCascadeInterval: number;
}

/**
 * The deliberately small host seam around the shared renderer controller.
 *
 * A game may choose numbers and run work immediately around a submit; it may
 * not replace the submit, composer, context-loss or resize control flow. That
 * distinction is what lets a game with a supersample FLOOR and a DOM film
 * layer use the same drawing-buffer owner as games with a DPR cap.
 */
export interface PipelineAdapter<W extends PipelineWorld> {
  /** Override the normal `?debug=frames` choice when the host already parsed it. */
  preserveDrawingBuffer?: boolean;
  /** Resolve the effective drawing-buffer ratio. The shared cap policy is the default. */
  pixelRatio?(frame: PipelineResolutionFrame<W>): number;
  /** Resolve composer MSAA. The shared quality/AO policy is the default. */
  multisampling?(frame: PipelineResolutionFrame<W> & { pixelRatio: number }): number;
  /** Decide whether the current picture is held. The default is `dt === 0`. */
  held?(world: W): boolean;
  /** One-time renderer configuration after the real GL context is available. */
  setupRenderer?(frame: PipelineRendererFrame<W>): void;
  /** Runs once per picture, before the chain is asked to present it. */
  beforePresent?(frame: PipelinePresentFrame<W>): void;
  /** Runs inside the chain's draw verb, immediately before counter reset and submit. */
  beforeDraw?(frame: PipelinePresentFrame<W>): void;
  /** Runs once after every complete surface frame. */
  afterPresent?(frame: PipelinePresentFrame<W>): void;
  /** Runs on every resolution check, including a no-op display-DPR change. */
  resolution?(frame: PipelineResolutionEvent<W>): void;
  /** Releases host-owned companions before the shared GL objects are released. */
  dispose?(): void;
}

export interface PipelineRendererFrame<W extends PipelineWorld> {
  world: W;
  renderer: THREE.WebGLRenderer;
  device: Readonly<DeviceProfile>;
}

export interface PipelineResolutionFrame<W extends PipelineWorld> extends PipelineRendererFrame<W> {
  width: number;
  height: number;
  dynamicScale: number;
}

export interface PipelineResolutionEvent<W extends PipelineWorld> extends PipelineResolutionFrame<W> {
  pixelRatio: number;
  bufferWidth: number;
  bufferHeight: number;
  changed: boolean;
}

export interface PipelinePresentFrame<W extends PipelineWorld> extends PipelineRendererFrame<W> {
  camera: THREE.Camera;
  composer: EffectComposer | null;
  dt: number;
  held: boolean;
  pixelRatio: number;
}

/**
 * The post-processing chain, which belongs to the GAME.
 *
 * The design settled this seam before the extraction started:
 * "@homie-rocks/render/pipeline.ts declares the interface;
 * @homie-rocks/postfx/chain.ts implements it." Both games' `PostFX` already has
 * exactly this shape, so neither had to change to satisfy it.
 *
 * IT IS GENERIC OVER THE WORLD RATHER THAN TAKING ONE. `PostFX.build` and
 * `PostFX.sync` take the game's `Ctx` — they read fovPunch, hurt, speed and a
 * dozen other things this package has no business naming. Making the chain
 * generic means the pipeline hands the world straight through without ever
 * looking inside it, and `W` is INFERRED at the game's `new RenderPipeline`
 * call. `Ctx` therefore appears in neither this file's imports nor its types.
 */
export interface PostChain<W> {
  build(world: W, composer: EffectComposer, opts: { software: boolean; ldr: boolean }): void;
  /**
   * Put one finished frame on the surface. `draw()` submits the composer once,
   * with the renderer's counters already zeroed for attribution.
   *
   * ==========================================================================
   *  WHY THIS IS `present(…, draw)` AND NOT `sync()` FOLLOWED BY ONE DRAW
   * ==========================================================================
   *  Because HOW MANY TIMES A FRAME IS DRAWN IS THE CHAIN'S ANSWER, NOT THE
   *  PIPELINE'S, and until this hook existed there was no way to say so — which
   *  is the entire reason the space racer's renderer was a 1,796-line second
   *  copy of this file. Its `render()` differed from this one's in one
   *  respect: a HELD frame runs the chain N times over the frozen scene,
   *  accumulating an unweighted mean of N jitter positions, so that two
   *  screenshots of one held frame are the same bytes. `@homie-rocks/postfx/
   *  Capture.ts` already owns that control flow; this pipeline could not reach
   *  it, so a whole renderer was forked to hold four lines of call order.
   *
   *  A chain with nothing per-draw to converge implements this as `sync(world,
   *  camera, dt, held); draw();`. `PostFXChain` in @homie-rocks/postfx owns
   *  that implementation; a later change added the active camera input without
   *  changing the one-draw behaviour.
   *
   *  THE ARROW IS WHY THE CALLBACK GOES THIS WAY. The package graph has
   *  `render → postfx`, so this package cannot import the capture protocol; it
   *  can only hand the chain the verb and let the chain decide the order. That
   *  constraint produced the better shape: the pipeline never learns that a
   *  capture protocol exists.
   *
   * `held` is an INPUT, not a mode — see `heldForCapture` in `held.ts` for what
   * the word means and why it is `dt === 0` rather than a flag.
   */
  /**
   * `camera` is the camera being presented, not necessarily `world.camera`.
   * They are identical for a one-view world. A multi-view pipeline retargets
   * the composer for each rectangle, so handing only the world here made every
   * post effect continue deriving reprojection and focus from view zero.
   */
  present(
    world: W, camera: THREE.Camera, dt: number, held: boolean, draw: () => void,
  ): void;
  /**
   * The DRAWING BUFFER changed size — not the canvas, and not the CSS box.
   *
   * Anything in a chain whose AUTHORED value is stated in SCREEN PIXELS rather
   * than in buffer texels has to be re-resolved here and not only at build:
   * the adaptive ladder moves the buffer through `setDynamicScale` every second
   * or two and deliberately never rebuilds. The space racer's bloom is the
   * measured case — a freshly built bloom seeds its mip count from the CSS
   * height, which is the drawing buffer only at pixel ratio 1, so on a retina
   * panel its six-level reach silently arrived a level short.
   */
  setSize(bufW: number, bufH: number): void;
  /**
   * Whatever this chain accumulates is no longer a history of the same image.
   *
   * Called on a resize and on a rung change. A resized history IS a history of
   * a different image — `TemporalResolvePass.setSize` says so and discards it —
   * so a capture converged before the resize has nothing left to present from,
   * and presenting it anyway is a held frame that is stale rather than
   * reproducible.
   */
  invalidate(): void;
  dispose(): void;
}

/**
 * WHAT THE DRIVER SAID IT COULD DO.
 *
 * NOT THE SAME TYPE AS `DeviceProfile` IN A GAME'S Settings.ts, which is
 * a PANEL profile — shortest edge, core count, dpr — and belongs to
 * @homie-rocks/device. Two unrelated records under one word, in files that sit two
 * directories apart, and extracting by symbol name would have merged them.
 * This one is four facts about a GL context.
 */
export interface DeviceProfile {
  webgl2: boolean;
  /** RGBA16F was BUILT as a colour attachment and reported complete */
  halfFloat: boolean;
  /** SwiftShader / llvmpipe / ANGLE-on-CPU, i.e. a headless capture or CI */
  software: boolean;
  name: string;
}

/**
 * The device profile, taken from the one shared capability probe.
 *
 * This used to open a second throwaway context of its own and decide
 * `halfFloat` from the extension string. Both were wrong: browsers cap live
 * contexts (we were spending two before the game started), and the extension
 * string is a promise about a FORMAT, not about an ATTACHMENT — a driver can
 * advertise it and still refuse the framebuffer, at which point every draw into
 * the composer's buffer is discarded and the canvas is uniformly black. That
 * exact condition, forced on real hardware, produced 222 draw calls into a
 * canvas that was never painted. `glCapabilities()` builds the attachment and
 * asks; see the long note there.
 */
function probeDevice(caps: GLCapabilities): DeviceProfile {
  return {
    webgl2: caps.webgl2,
    halfFloat: caps.halfFloatRenderable,
    software: caps.software,
    name: caps.renderer,
  };
}

// ---------------------------------------------------------------------------
//  THE FALLBACK LADDER
// ---------------------------------------------------------------------------
/**
 * Every rung is a real, playable frame except the last, and each one removes
 * the thing the rung above it depends on. A driver that cannot do the top rung
 * gets the next one down, not a black screen.
 *
 *   Hdr     composer with a half-float HDR buffer — the shipping look
 *   Ldr     composer with an 8-bit buffer: the grade clips earlier, everything
 *           else is intact. This is what a GPU with no renderable float
 *           attachment gets, and it is chosen at BOOT from the probe rather
 *           than discovered by going black first.
 *   Direct  no composer at all: `renderer.render()` straight to the canvas.
 *           No grade, no bloom, no AO, no SMAA — three's own ACES tone map
 *           carries the exposure. A worse-looking game, and a game.
 *   Safe    Direct, plus every material in the scene replaced with a simple lit
 *           one and shadows off. This is the rung for a driver that rejects the
 *           PBR shader family: the geometry is all still there, it just stops
 *           being invisible.
 *   Flat    Direct, plus the simplest shader three has that still shows form.
 *           No lights, no textures, no environment — if this draws nothing,
 *           nothing will.
 *   Dead    the banner. Reached only after every rung above it drew nothing.
 */
// NOT AN `enum`, AND THE REASON IS MEASURED RATHER THAN STYLISTIC — it is the
// same one caps.ts records for `Quality`. `node --experimental-strip-types`
// REJECTS the `enum` keyword outright, both forms, because stripping removes
// types and cannot emit the object an enum needs. Some test runners execute
// TypeScript that way, so a package file containing one could never be
// loaded by them. Same members, same numbers, same comparisons.
const Rung = { Hdr: 0, Ldr: 1, Direct: 2, Safe: 3, Flat: 4, Dead: 5 } as const;
type Rung = (typeof Rung)[keyof typeof Rung];

// A TOTAL MAP RATHER THAN AN ARRAY, because this package compiles under
// `noUncheckedIndexedAccess` and `RUNG_NAMES[this.rung]` would otherwise be
// `string | undefined`. The fix is not a fallback: this string is what a
// degrade line in the diagnostic ring buffer NAMES ITSELF WITH, and a
// `?? 'unknown'` would put a rung nobody can look up into the one log a black
// screen is investigated from. Keyed by `Rung`, the compiler requires an entry
// for every rung that exists, and adding a seventh without naming it stops the
// build.
const RUNG_NAMES: Record<Rung, string> = {
  [Rung.Hdr]: 'hdr-composer',
  [Rung.Ldr]: 'ldr-composer',
  [Rung.Direct]: 'direct',
  [Rung.Safe]: 'safe-materials',
  [Rung.Flat]: 'flat-materials',
  [Rung.Dead]: 'dead',
};

/**
 * Fullscreen quads the post chain submits regardless of what the scene drew.
 * Only used to keep the health signal honest, so a rough figure is fine.
 */
const POST_QUADS = 20;

/**
 * Works out which material a failing program belonged to, and whether it is one
 * of the ones the WORLD is made of.
 *
 * `debug.onShaderError` is handed the GL objects and nothing else, so the
 * identity has to be recovered from the source — three stamps
 * `#define SHADER_NAME <name>` into every prefix it generates.
 *
 * BOTH shaders are read, and that is the fix for a bug this very check had on
 * its first outing. The name lives in both prefixes but the LIGHTING MODEL only
 * appears in the fragment shader, and reading only the vertex shader therefore
 * returned 'tarmac-vc' with no idea what kind of material that was. Every world
 * material in this game is a MeshStandardMaterial under a descriptive name —
 * 'tarmac-vc', 'kerb-vc', 'bridge-stone-2s' — so a family test that looks for
 * three's type name in the LABEL matches none of them, and a driver that
 * rejected the entire textured PBR family was recorded as one anonymous
 * failure. Sniffing the fragment source for the lighting chunks catches all of
 * them, whatever they are called.
 *
 * `#define SHADER_NAME` is also EMPTY when a material has no name, which is why
 * the label falls back to the family.
 */
function describeProgram(
  gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader,
): { label: string; world: boolean } {
  let name = '';
  let world = false;
  for (const shader of [vs, fs]) {
    let src = '';
    try { src = gl.getShaderSource(shader) || ''; } catch { src = ''; }
    if (src === '') continue;
    if (name === '') {
      const m = src.match(/#define SHADER_NAME (\S+)/);
      // `?? ''` and not `!`: the empty string is ALREADY this function's
      // sentinel for a material with no name — `#define SHADER_NAME` is
      // emitted empty in that case, which is why the label falls back to the
      // family below. So the one value the compiler is worried about is a value
      // the next twenty lines already know what to do with.
      if (m !== null) name = m[1] ?? '';
    }
    // The lit families three ships. Any of them being rejected takes visible
    // geometry with it; a postprocessing EffectMaterial being rejected does not.
    if (/RE_Direct_Physical|RE_Direct_BlinnPhong|RE_Direct_Lambert|RE_Direct_Toon/.test(src)) {
      world = true;
    }
  }
  return { label: name !== '' ? name : (world ? 'an unnamed lit material' : 'unknown'), world };
}

/** Packs the settings the pipeline actually reacts to into one comparable int. */
function pipelineSignature(s: PipelineSettings): number {
  return (s.quality & 3) |
    (s.shadows ? 1 << 2 : 0) |
    (s.ssao ? 1 << 3 : 0) |
    (s.bloom ? 1 << 4 : 0) |
    (s.motionBlur ? 1 << 5 : 0) |
    (s.dof ? 1 << 6 : 0) |
    (Math.round(THREE.MathUtils.clamp(s.renderScale, 0.25, 2) * 64) << 7) |
    (Math.round(THREE.MathUtils.clamp(s.maxPixelRatio, 0.5, 4) * 8) << 16);
}

export class RenderPipeline<W extends PipelineWorld, C extends PostChain<W>> {
  renderer!: THREE.WebGLRenderer;
  /** Public so debug tooling and a quality menu can reach into the chain. */
  composer: EffectComposer | null = null;
  /**
   * The game's chain. Public and typed as the game's own class, because
   * main.ts's `window.__pipeline` handle reaches into it and every capture
   * tool in the four games reads passes off it.
   */
  readonly fx: C;

  /**
   * False from the moment the GPU takes the context away until the rebuild
   * after `webglcontextrestored` has finished. NOTHING may draw while it is
   * false — every GL call in that window is a silent no-op, so a loop that
   * keeps calling `render()` is just burning CPU and queueing work that will
   * never be presented.
   */
  contextLost = false;

  /**
   * Raised as soon as the context is lost, before anything else. The frame loop
   * subscribes so it can stop simulating on the same tick.
   */
  onContextLost: (() => void) | null = null;
  /**
   * Raised after the composer, its render targets and the effect chain have
   * been rebuilt against the new context. Everything that owns GPU state three
   * cannot re-derive on its own — the PMREM environment probe above all, whose
   * texture comes back allocated but EMPTY — has to re-bake here. May be async;
   * the notice stays up until it settles.
   */
  onContextRestored: (() => void | Promise<void>) | null = null;

  private ctx!: W;
  private device: DeviceProfile = { webgl2: false, halfFloat: false, software: false, name: '' };
  private usePost = false;
  /** Current position on the fallback ladder. Only ever moves downward. */
  private rung: Rung = Rung.Hdr;
  /** The material every object is drawn with at Rung.Safe / Rung.Flat. */
  private overrideMat: THREE.Material | null = null;
  /** Scratch for `sampleFrame`, allocated at most once per width. */
  private samplePixels: Uint8Array | null = null;
  /** True only while `trialDraw` is running, so its own failures are not counted. */
  private inTrial = false;
  private width = 1;
  private height = 1;
  private signature = -1;
  /** Last values `applyResolution` actually pushed at the GL side. */
  private appliedRatio = -1;
  private appliedW = -1;
  private appliedH = -1;
  private appliedSamples = -1;
  private notice: HTMLElement | null = null;
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  /**
   * True only while a WebXR session is presenting. See `setXRPresenting`.
   *
   * It is NOT a rung and it is NOT on the fallback ladder, deliberately. Every
   * other way this pipeline stops using the composer is a one-way retreat from
   * a driver that has proved it cannot be trusted; this is a person putting a
   * headset on and, in a minute or two, taking it off again. Folding it into
   * `rung` would mean a game came out of VR permanently ungraded, and the
   * player would have no idea why the room looked flat afterwards.
   */
  private xrPresenting = false;

  private readonly canvasParent: HTMLElement;
  private readonly look: PipelineLook;
  private readonly diag: PipelineDiagnostics;
  private readonly adapter: PipelineAdapter<W>;

  /**
   * Written out rather than using parameter properties, for the same reason
   * `Rung` is not an enum: `node --experimental-strip-types` cannot emit the
   * assignments a parameter property implies, so a package file using one
   * cannot be loaded by a strip-types runner.
   */
  constructor(
    canvasParent: HTMLElement,
    chain: C,
    look: PipelineLook,
    diag: PipelineDiagnostics,
    adapter: PipelineAdapter<W> = {},
  ) {
    this.canvasParent = canvasParent;
    this.fx = chain;
    this.diag = diag;
    this.adapter = adapter;
    // A CADENCE OF ZERO IS REFUSED AT THE DOOR RATHER THAN DIVIDED BY.
    //
    // `(gate++ % 0)` is NaN, `NaN === 0` is false, and `needsUpdate` would
    // therefore never be set on a renderer whose `autoUpdate` this file has
    // just turned off: a game with shadow maps enabled, a full cascade
    // allocated, and no shadows in the picture — from one wrong number, with
    // nothing thrown and nothing logged. It is exactly the class of defect
    // this package exists to stop having four copies of.
    // `Number.isFinite` FIRST, AND A TEST IS WHY THIS LINE READS LIKE
    // THIS. It was `Math.max(1, Math.round(interval))`, which looks like a
    // clamp and is not one: `Math.round(NaN)` is NaN and `Math.max(1, NaN)` is
    // NaN, so the single input most likely to arrive from a settings parse or a
    // URL parameter went straight through the guard written to stop it — and
    // then `(gate++ % NaN) === 0` is false on every frame for ever. A test of
    // this package caught it on the first run it existed, which is the whole
    // argument for writing the check before believing the guard.
    const raw = look.shadowCascadeInterval;
    const interval = Number.isFinite(raw) ? Math.max(1, Math.round(raw)) : 1;
    if (interval !== look.shadowCascadeInterval) {
      diag.logPipeline('look',
        `shadowCascadeInterval ${look.shadowCascadeInterval} is not a whole number >= 1; using ${interval}`);
    }
    this.look = { exposure: look.exposure, shadowCascadeInterval: interval };
  }

  /**
   * The cadence this pipeline RESOLVED, which is not necessarily the one it was
   * handed — see the constructor.
   *
   * Public because the corrected value is the one that matters and the handed
   * one is not readable anywhere else: a quality menu that offers the knob, and
   * the `window.__pipeline` handle every capture tool in these games reads,
   * both want the number actually in force. Same reason `rungName()` and
   * `dynamicScale` are public.
   */
  get shadowCadence(): number { return this.look.shadowCascadeInterval; }

  /** The exposure in force, for the same reason. */
  get exposure(): number { return this.look.exposure; }

  /** The live renderer identity and capability outcome currently in force. */
  get deviceProfile(): Readonly<DeviceProfile> { return this.device; }

  /** Effective ratio and drawing-buffer size actually pushed to GL. */
  get pixelRatio(): number { return this.appliedRatio; }
  get drawingBufferSize(): { width: number; height: number } {
    return { width: this.appliedW, height: this.appliedH };
  }

  init(ctx: W) {
    this.ctx = ctx;

    // THE FIRST RUNG IS CHOSEN FROM THE PROBE, NOT DISCOVERED BY GOING BLACK.
    // A GPU that cannot complete an RGBA16F attachment starts on the 8-bit
    // composer; one that cannot complete an RGBA8 attachment either has no
    // off-screen rendering at all and starts on the direct path.
    const caps = glCapabilities();
    this.device = probeDevice(caps);
    this.usePost = this.device.webgl2;
    if (!caps.webgl2) {
      // three r185 creates WebGL2 contexts and nothing else, so there is no
      // renderer to build and no frame to degrade to. Say so in a way a player
      // can act on, and make it survive main.ts's boot-failure handler — which
      // replaces the whole of <body> — by hanging it off <html> instead.
      this.showFatal(
        'This browser cannot start WebGL 2',
        'The game needs WebGL 2, and this browser or graphics driver is not providing it. ' +
        'Updating the graphics driver, or enabling hardware acceleration in the browser settings, usually fixes it.',
      );
      this.diag.logPipeline('fatal', 'no WebGL2 context — nothing can be rendered');
      throw new Error('WebGL 2 is unavailable, so the renderer cannot be created.');
    }
    if (!caps.halfFloatRenderable) this.rung = Rung.Ldr;
    if (!caps.byteRenderable) this.rung = Rung.Direct;
    if (this.rung !== Rung.Hdr) {
      this.diag.logPipeline('start', `pipeline starts on ${RUNG_NAMES[this.rung]} (boot probe)`);
    }
    // Settled BEFORE the renderer is built, because it decides a context
    // attribute (`antialias`) and those cannot be changed afterwards without
    // replacing the canvas. A device that starts on the direct path needs the
    // driver's own MSAA — there is no composer to carry the edges for it.
    this.usePost = caps.webgl2 && this.rung <= Rung.Ldr;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = this.createRenderer(ctx);
    } catch (err) {
      this.showFatal(
        'Graphics could not start',
        'The browser refused to create a WebGL context for this page. Updating the graphics driver, ' +
        'or enabling hardware acceleration in the browser settings, usually fixes it.',
      );
      this.diag.logPipeline('fatal', 'WebGLRenderer could not be constructed: ' + String(err));
      throw err;
    }
    this.finishInit(ctx, renderer);
  }

  private createRenderer(ctx: W): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({
      // With the composer running, MSAA lives on the composer's render target
      // and the default framebuffer only ever receives one fullscreen triangle.
      // Without a composer, the driver's MSAA is the only edge treatment left.
      antialias: !this.usePost,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
      // False in normal play: keeping the drawing buffer costs a copy every
      // frame. But `?debug=frames` exists to read that buffer back, and with
      // this false the read returns DISCARDED contents — measured as all zeros
      // on a frame that presented perfectly — so the watchdog reports 100%
      // black on a healthy frame. An instrument that lies is worse than none.
      preserveDrawingBuffer:
        this.adapter.preserveDrawingBuffer ??
          new URLSearchParams(location.search).get('debug') === 'frames',
      failIfMajorPerformanceCaveat: false,
    });

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // The grade shader inside the composer does the actual tone map — three
    // skips its own whenever it renders into a render target. Setting it here
    // anyway keeps the no-composer fallback looking identical rather than
    // blowing out to white.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // THE GAME'S EXPOSURE, and the one look constant the design grants this
    // package. It was 1.72 in the shooter and 1.05 in the kart racer — one of
    // the two lines that separated 1,354 lines from 1,345.
    //
    // The fault that proves it is still a VALUE and not a hoisted constant
    // lives in each game's Renderer.ts, where the number does: a package may
    // not read `window`, and `exposure-shared` is not a GL capability, so
    // `?glfail=` is the wrong wire for it too.
    renderer.toneMappingExposure = this.look.exposure;

    renderer.shadowMap.enabled = ctx.settings.shadows;
    // PCF over VSM: the cascade rig is authored elsewhere, and VSM light bleed
    // through thin kerb, railing and fence geometry costs more than the softer
    // penumbra buys with the sun this low.
    //
    // Explicitly PCFShadowMap, not PCFSoftShadowMap: three r185 deprecated the
    // latter and silently substitutes this one anyway, while logging a warning
    // on every boot — which a capture run records as a frame warning. Asking
    // for what we actually get also stops `DirectionalLightShadow.radius`
    // reading as if it did something (PCF ignores it), so the softness has to
    // come from map resolution and cascade extent, where it really lives.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // THE RENDERER DRIVES THE SURFACE-FRAME CADENCE. `autoUpdate` is off for
    // the original consumers, whose chain submits the world once; interval 1
    // therefore reproduces their old every-frame result. It is NOT universally
    // equivalent to autoUpdate=true: a base-building game's AO path invokes
    // renderer.render() again inside one surface frame, and measured 114 shadow
    // draws with autoUpdate against 40 with one `needsUpdate`. Its adapter sets
    // autoUpdate back to true in setupRenderer. The distinction was found by a
    // picture comparison when that game adopted this renderer, not by
    // typechecking this number.
    //
    // The shooter's reason for asking for 2 travels with it and is quoted here
    // because it is the reason the knob exists at all: "The moon is static and
    // the station does not deform. Rebuilding the cascade every frame is a
    // second full geometry pass. We flip `needsUpdate` on alternate frames in
    // `render()` — bots skate a centimetre between maps and the contact still
    // reads." That is a fact about that game's world, not about renderers,
    // which is exactly why it is a value and not a policy in here.
    renderer.shadowMap.autoUpdate = false;

    renderer.domElement.setAttribute('aria-hidden', 'true');
    this.canvasParent.appendChild(renderer.domElement);

    // ---- context loss ------------------------------------------------------
    // A mobile GPU under memory pressure takes the context away rather than
    // killing the tab, and until this was added nothing in the game listened
    // for it: the canvas simply went black and stayed black, because there is
    // no automatic recovery for a scene's GPU resources.
    //
    // `preventDefault()` on the loss event is the whole ballgame. Without it
    // the browser never fires 'webglcontextrestored' at all, so recovery is not
    // merely unhandled, it is impossible. (three's own listener also calls it,
    // but relying on that is relying on an implementation detail of a library
    // we pin by caret; calling it here is one line and cannot be wrong.)
    //
    // Ours are registered AFTER three's, which is deliberate: on restore three
    // re-runs `initGLContext()` and throws away its WebGLProperties cache, so
    // by the time we are called the device is live again and every texture,
    // geometry and program will re-upload on next use. What does NOT come back
    // on its own is anything whose *contents* were baked once — see
    // `onContextRestored`.
    renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost, false);
    renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored, false);
    renderer.domElement.addEventListener('webglcontextcreationerror', ((e: WebGLContextEvent) => {
      console.error('[render] context creation error:', e.statusMessage);
    }) as EventListener, false);

    return renderer;
  }

  private finishInit(ctx: W, renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    try { this.gl = renderer.getContext(); } catch { this.gl = null; }
    // Renderer identity must come from the context that will draw the game.
    // The capability probe above asks whether formats can be allocated; it is
    // intentionally not allowed to answer which device rendered this frame.
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext === null ? '' : String(
        gl.getParameter((ext as unknown as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL) || '',
      );
      this.device = {
        ...this.device,
        name,
        software: /swiftshader|llvmpipe|software|basic render/i.test(name),
      };
    } catch {
      // Keep the measured capability profile if renderer identity is hidden.
    }
    // Before anything can draw, so no frame is ever counted unattributed.
    this.instrumentShadowPass(renderer);
    ctx.renderer = renderer;
    this.adapter.setupRenderer?.({ world: ctx, renderer, device: this.device });
    // Same contract as `window.__drawBudget`: the capture and perf tools
    // need to read the device profile and reach into the effect chain (which
    // is deliberately not on Ctx) to A/B a single pass.
    (globalThis as unknown as { __render?: unknown }).__render = this;

    // A LINK FAILURE IS THE LEADING THEORY AND THIS IS WHERE IT SURFACES.
    //
    // three logs a shader error and then carries on using the program, so a
    // material family the driver rejects does not throw, does not stop the
    // frame, and does not reduce the draw-call count — it just stops appearing.
    // Installing this hook suppresses three's own console.error, so it has to
    // both record and re-emit, and the info log it hands over is the exact text
    // the bug report we never received would have contained.
    renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const who = describeProgram(gl, vs, fs);
      const text =
        `program link failed for "${who.label}"${who.world ? ' (a lit world material)' : ''}\n` +
        `  program: ${gl.getProgramInfoLog(program) || '(no log)'}\n` +
        `  vertex : ${gl.getShaderInfoLog(vs) || '(ok)'}\n` +
        `  frag   : ${gl.getShaderInfoLog(fs) || '(ok)'}`;
      // The boot trial's own material is excluded from the "how many world
      // materials failed" count on purpose: it is OUR probe, it already has a
      // dedicated line in the log, and letting it into the count made the
      // report say "one material failed, not enough to be systemic, the
      // pipeline is left alone" on a boot where the pipeline had in fact
      // already dropped to the safe rung because of that very failure.
      this.diag.recordShaderError(text, who.label, who.world && !this.inTrial);
      console.error('[render] ' + text);
    };

    this.width = Math.max(1, ctx.width);
    this.height = Math.max(1, ctx.height);
    this.signature = pipelineSignature(ctx.settings);
    this.applyResolution();

    // DOES A REPRESENTATIVE MATERIAL ACTUALLY DRAW? Asked before the world is
    // built, so the answer is available before any of it can go missing.
    const trial = this.trialDraw();
    if (!trial.ok) {
      this.diag.logPipeline('trial', 'a representative PBR material drew nothing: ' + trial.detail);
      if (this.rung < Rung.Safe) this.rung = Rung.Safe;
    }

    this.rebuild();
  }

  /**
   * Tears the effect chain down and reassembles it against the current
   * settings and the current rung. Safe to call at any time — quality may
   * change mid-race, and so may the rung.
   *
   * Each attempt that fails moves one rung DOWN and is retried, so a device
   * that cannot build the composer ends this call on the direct path with a
   * frame in hand rather than with an exception and a black canvas. The loop
   * is bounded by the number of rungs; it cannot spin.
   */
  rebuild(): void {
    if (this.contextLost) return;
    // A rebuilt chain has a brand-new, empty temporal history, so any capture
    // converged against the old one describes a chain that no longer exists.
    this.fx.invalidate();
    for (let attempt = 0; attempt <= Rung.Dead; attempt++) {
      if (this.tryBuild()) return;
    }
  }

  /** One attempt at the current rung. False means "moved down, try again". */
  private tryBuild(): boolean {
    this.applyMaterialOverride();
    // Shadow maps are the other thing a rejected shader family takes with it,
    // and at the safe rungs there are no PBR materials left to receive them.
    this.renderer.shadowMap.enabled = this.ctx.settings.shadows && this.rung < Rung.Safe;
    this.usePost = this.rung <= Rung.Ldr;

    if (!this.usePost) {
      this.fx.dispose();
      if (this.composer !== null) {
        try { this.composer.removeAllPasses(); this.composer.dispose(); } catch { /* going away */ }
        this.composer = null;
      }
      // Nothing owns the default framebuffer's clear any more. See render().
      this.renderer.autoClear = true;
      this.invalidateResolutionCache();
      this.applyResolution();
      return true;
    }

    if (this.composer === null) {
      try {
        if (forcedFailure('composer')) throw new Error('forced by ?glfail=composer');
        this.composer = new EffectComposer(this.renderer, {
          depthBuffer: true,
          stencilBuffer: false,
          multisampling: 0,
          // Half float is what makes a high bloom threshold and our own tone
          // map meaningful; without it the scene clips to white before there
          // is anything left to grade. `Rung.Ldr` is that trade taken
          // deliberately, on a device that proved it cannot do the other one.
          frameBufferType: this.rung === Rung.Hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
        });
        // A brand-new composer starts at multisampling 0 and at whatever size
        // its constructor picked, so the `applyResolution` guard has no history
        // to compare against and must not skip the first push.
        this.invalidateResolutionCache();
      } catch (err) {
        this.dropComposer();
        this.fall(`composer could not be constructed: ${String(err)}`);
        return false;
      }
    } else {
      this.fx.dispose();
      this.composer.removeAllPasses();
    }

    // The composer's input buffer is the only place the scene is rasterised,
    // so it is the only place multisampling can do anything.
    //
    // Assigned through the guard rather than directly: postprocessing's
    // `multisampling` setter DISPOSES the input buffer even when the value it
    // is handed is the one already in force, so a stream of no-op resizes —
    // which is exactly what iOS Safari produces while the URL bar animates —
    // reallocates a half-float MSAA HDR attachment tens of times a second.
    // See `applyResolution`.
    //
    // This used to read `ssao ? 0 : msaa`, on the belief that N8AOPostPass
    // re-renders the scene into a private target and discards the composer's
    // colour buffer. That is true of `N8AOPass`; `N8AOPostPass` reads the
    // composer's `inputBuffer` as its scene colour and composites onto it. So
    // zeroing this dropped MSAA on exactly the tier that asks for it — and the
    // line in PostFX that was supposed to take over threw on a missing field
    // and killed the whole effect chain with it (see PostFX.build).
    this.setMultisampling(this.msaaSamples());

    try {
      this.fx.build(this.ctx, this.composer, {
        software: this.device.software,
        // The chain has to know it is writing into 8 bits: with an LDR buffer
        // the scene is clamped at 1.0 before bloom ever sees it, so a threshold
        // authored against scene-linear HDR selects nothing at all.
        ldr: this.rung >= Rung.Ldr,
      });
    } catch (err) {
      this.dropComposer();
      // Degrade, do not die. The direct path is a real frame —
      // no grade, no bloom, but a legible game.
      this.fall(`effect chain failed to build: ${String(err)}`);
      return false;
    }

    // The chain has just created a fresh scene pass; count what it actually
    // draws rather than guessing what everything after it costs. See
    // `instrumentScenePass`.
    this.instrumentScenePass();

    this.applyResolution();

    // THE TARGETS THE COMPOSER ACTUALLY GOT, NOT THE ONES IT ASKED FOR.
    //
    // `new WebGLRenderTarget(...)` never fails: three defers the allocation to
    // the first bind, and a driver that refuses the format then leaves an
    // INCOMPLETE framebuffer behind, into which every draw is silently
    // discarded. That is a uniformly black canvas with a full draw-call count —
    // reproduced on real hardware by refusing RGBA16F attachments, 222 draws
    // into a canvas that was never painted. Binding it and asking is the whole
    // difference between shipping that and catching it.
    const status = this.targetStatus(this.composer.inputBuffer);
    if (!status.ok) {
      this.dropComposer();
      this.fall(`the composer's ${this.rung === Rung.Hdr ? 'half-float' : '8-bit'} buffer is not ` +
        `renderable at ${this.appliedW}x${this.appliedH} (framebuffer status 0x${status.status.toString(16)})`);
      return false;
    }
    return true;
  }

  /** Releases the effect chain and the composer, tolerating a dead context. */
  private dropComposer(): void {
    this.fx.dispose();
    try {
      this.composer?.removeAllPasses();
      this.composer?.dispose();
    } catch { /* the composer is being abandoned either way */ }
    this.composer = null;
    this.usePost = false;
    // The EffectComposer constructor turns `autoClear` off on its way in and
    // nothing else would ever turn it back on. Without this the default
    // framebuffer is never cleared and whatever the previous frame left in the
    // pixels the scene does not cover stays on screen: a permanent
    // partial-render.
    this.renderer.autoClear = true;
    this.invalidateResolutionCache();
  }

  /** Steps one rung down from inside a build attempt, and says why. */
  private fall(reason: string): void {
    const from = RUNG_NAMES[this.rung];
    this.rung = Math.min(this.rung + 1, Rung.Dead) as Rung;
    this.diag.logPipeline('degrade', `${from} -> ${RUNG_NAMES[this.rung]}: ${reason}`);
  }

  /**
   * Is this render target's framebuffer complete and error-free?
   *
   * `setRenderTarget` is what makes three allocate and bind it, so this is also
   * the moment the allocation either happens or does not.
   */
  private targetStatus(rt: THREE.WebGLRenderTarget): { ok: boolean; status: number } {
    const gl = this.gl as WebGL2RenderingContext | null;
    if (gl === null) return { ok: true, status: 0 };
    const prev = this.renderer.getRenderTarget();
    let status = 0;
    let err = 0;
    try {
      drainErrors(gl);
      this.renderer.setRenderTarget(rt);
      status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      err = gl.getError();
    } catch {
      return { ok: false, status: 0 };
    } finally {
      this.renderer.setRenderTarget(prev);
    }
    return { ok: status === gl.FRAMEBUFFER_COMPLETE && err === gl.NO_ERROR, status };
  }

  /**
   * Draw calls the SCENE pass submitted on the last frame.
   *
   * Sampled before the composer's fullscreen passes run, because three resets
   * `info.render` at the top of every `render()` and the last pass in the frame
   * is a single quad — read afterwards, an empty world and a healthy one both
   * report about the same number. The diagnostics watchdog uses this to tell
   * "the world is not being drawn" apart from "the world is fine".
   *
   * ------------------------------------------------------------------------
   * IT USED TO INCLUDE THE SHADOW PASS, AND THAT MADE IT MEAN NOTHING.
   * ------------------------------------------------------------------------
   * A review of the picture code found the kart racer's equivalent was
   * `POST_QUADS = 20` and `lastSceneCalls = max(0, calls - POST_QUADS)`, a
   * constant shared by accident: *"What you see: nothing — you see a number,
   * and it is meaningless."* A cascade rebuild is a SECOND FULL GEOMETRY PASS,
   * so on the frames it runs the count includes the whole world twice.
   *
   * MEASURED HERE, on a world HELD so that nothing in it can change — every
   * difference between two consecutive samples is therefore the renderer and
   * not the game — 24 frames each, before this was fixed:
   *
   *     BEFORE                          AFTER
   *     shooter      299 254 299 254 …  254 254 254 …   swing 45 -> 0
   *     kart racer   176 176 231 …      126 126 126 …   swing 55 -> 0
   *
   * AND THE PREDICTION IN THIS PARAGRAPH WAS WRONG, WHICH IS WHY THE
   * MEASUREMENT IS HERE AND NOT THE REASONING. It said: the shooter's period
   * is 2, which is its cadence; the kart racer's is 3 while its cadence is 1,
   * so the racer's swing cannot be the cascade and subtracting shadows will
   * not flatten it. It flattened it completely. `lastShadowCalls` shows why —
   *
   *     shooter      0 45 0 45 …        cadence 2: the pass, every other frame
   *     kart racer   105 50 50 105 …    cadence 1: the pass EVERY frame, at
   *                                     three different sizes
   *
   * — the kart racer rebuilds on every frame and the pass costs a different
   * number of draws depending on which of its shadow-casting lights refresh
   * together. That is the review's own finding, arrived at from the other
   * end: cascades refresh on staggered intervals, so the same picture
   * reported 1280 and 2716 calls depending on which frame was sampled. A
   * cadence of 1 makes the pass CONSTANT IN FREQUENCY and not constant in
   * cost.
   *
   * WHAT IT COST TO HAVE THEM MIXED, in the detector that reads this: the kart
   * racer's shadow pass alone is 50 to 105 calls, and a game's `checkDrawCalls`
   * detector trips at `sceneCalls <= 4`. A kart racer frame that drew NONE OF
   * THE WORLD would still have reported ~156 and the detector could never have
   * fired — the shadow pass was covering for the scene it was supposed to be
   * evidence about. That is what the review meant by "you see a number, and it
   * is meaningless".
   */
  lastSceneCalls = 0;
  /**
   * Draw calls the SHADOW pass submitted on the last frame, counted separately.
   *
   * The base-building game already did this — `instrumentShadowPass` — by
   * wrapping `WebGLShadowMap.render`. Same technique
   * here, and now every game on this pipeline gets it at once, which is the
   * whole reason the extraction happened first.
   */
  lastShadowCalls = 0;
  /** Accumulated by the shadow-pass wrapper, drained at the end of `render`. */
  private shadowCallsThisFrame = 0;
  /**
   * Written by the scene-pass wrapper. -1 means "not attributed this frame",
   * which is a different statement from 0 and is why it is not 0. See
   * `instrumentScenePass`.
   */
  private sceneCallsThisFrame = -1;
  private shadowInstrumented = false;
  private shadowGate = 0;

  /**
   * Wrap `WebGLShadowMap.render` so its draw calls can be told from the
   * scene's.
   *
   * three offers no other seam: `info.render.calls` is a single running total
   * and the shadow pass runs inside `WebGLRenderer.render` between the reset
   * and the opaque pass, so the only way to attribute it is to read the counter
   * on both sides of the call. That is what the base-building game does and it
   * is what this does.
   *
   * INSTALLED ONCE PER RENDERER, AND THE GUARD IS LOAD-BEARING. `rebuild()` can
   * run many times in one session — every quality change, every rung fall, and
   * once per context restore — and it does not replace the renderer. Wrapping
   * again would nest the wrapper inside itself and count the same draws twice
   * on every rebuild, so the number would drift upward for the lifetime of the
   * page and only on machines that degrade. That is a bug that never appears on
   * the machine it is written on.
   */
  /**
   * ==========================================================================
   *  COUNT THE SCENE PASS. DO NOT SUBTRACT A CONSTANT FROM THE TOTAL.
   * ==========================================================================
   *  ADDED 2026-08-21, FOUND BY a small game — the first consumer of this
   *  pipeline whose scene is smaller than the post chain.
   *
   *  What was here was `lastSceneCalls = max(0, calls - POST_QUADS - shadow)`
   *  with `POST_QUADS = 20`, and its own comment calls that "a rough figure".
   *  It is a rough figure that is fine when the scene draws hundreds of
   *  objects, and it is CATASTROPHIC when the scene draws five:
   *
   *    MEASURED on that game, headless, `?quality=low`, hdr-composer rung:
   *      renderer.info.render.calls   20     (5 scene + the post chain)
   *      lastSceneCalls               0      max(0, 20 - 20 - 0)
   *
   *  The game's `checkDrawCalls` detector trips at `sceneCalls <= 4` for ninety
   *  consecutive frames, so ninety frames after boot it degraded a completely
   *  healthy HDR composer to LDR, and ninety frames after that to the direct
   *  path — deleting the entire effect chain, the grade with it, on hardware
   *  that had done nothing wrong. Nothing went red anywhere: the boot probe
   *  still passed, the frame still presented, and the picture just quietly
   *  stopped being the picture. `max(0, …)` is what made it silent — a
   *  plausible default answering for a subtraction that had gone out of range.
   *
   *  THE FIX IS THE TECHNIQUE THIS FILE ALREADY USES ONE METHOD DOWN. The
   *  shadow pass is attributed by reading the counter either side of the call;
   *  so is the scene pass now. The estimate is gone rather than re-tuned,
   *  because a better constant would have the same shape and would fail for
   *  the next consumer with a different chain.
   *
   *  RE-APPLIED ON EVERY REBUILD, unlike the shadow wrapper, and the asymmetry
   *  is real rather than an oversight: `rebuild()` calls `removeAllPasses()`
   *  and the chain constructs a NEW `RenderPass`, so a once-only guard would
   *  instrument the first composer's pass and then silently measure nothing
   *  for the rest of the session. The tag on the pass object is what stops the
   *  same pass being wrapped twice if that ever stops being true.
   */
  private instrumentScenePass(): void {
    // The first pass is the scene pass — the same assumption `render()` has
    // always made ("The scene pass is the first thing the composer runs"), and
    // now the only place that assumption lives.
    const pass = this.composer?.passes?.[0] as unknown as {
      render: (...args: unknown[]) => void;
      __homieSceneCounted?: boolean;
    } | undefined;
    if (pass === undefined || typeof pass.render !== 'function') {
      // NOT SILENT. A pipeline that cannot attribute its scene pass has to say
      // so, because the number it publishes is what a dead-frame detector acts
      // on: "we could not measure it" and "we measured it and it was fine" must
      // never be the same colour. `sceneCallsThisFrame` stays at -1 and
      // `render()` falls back to the old estimate, which is wrong in a known
      // direction rather than wrong in an unknown one.
      this.diag.logPipeline('draws',
        'the composer has no first pass to count; scene draw calls fall back to the estimate');
      return;
    }
    if (pass.__homieSceneCounted === true) return;
    pass.__homieSceneCounted = true;
    const original = pass.render;
    const self = this;
    pass.render = function instrumentedScenePass(...args: unknown[]): void {
      const before = self.renderer.info.render.calls;
      original.apply(this, args);
      self.sceneCallsThisFrame = self.renderer.info.render.calls - before;
    };
  }

  private instrumentShadowPass(renderer: THREE.WebGLRenderer): void {
    if (this.shadowInstrumented) return;
    // ?glfail=shadowcount RESTORES the old, unattributed state: the pass is
    // not wrapped, so its draws are reported as the scene's and
    // `lastSceneCalls` goes back to swinging with the cascade. It is the same
    // fault seam `forcedFailure('composer')` and `forcedFailure('ladder')` use,
    // and it is here rather than in a game because the code is here.
    if (forcedFailure('shadowcount')) return;
    const map = renderer.shadowMap as unknown as {
      render(...args: unknown[]): void;
    };
    const inner = map.render.bind(map);
    map.render = (...args: unknown[]): void => {
      const before = renderer.info.render.calls;
      inner(...args);
      this.shadowCallsThisFrame += renderer.info.render.calls - before;
    };
    this.shadowInstrumented = true;
  }

  render(ctx: W) {
    // Nothing may draw between 'webglcontextlost' and the rebuild that follows
    // 'webglcontextrestored'. Every GL call in that window is a silent no-op,
    // so continuing to render is pure waste — and on the device that just ran
    // out of memory, waste is the last thing to add.
    if (this.contextLost || this.renderer === undefined) return;

    // Quality can change at runtime; react without anyone having to tell us.
    const sig = pipelineSignature(ctx.settings);
    if (sig !== this.signature) {
      this.signature = sig;
      // `tryBuild` owns the shadow flag now, because at the safe rungs it is
      // not simply the setting — a driver that rejected the lit material family
      // is in no position to be handed a shadow pass either.
      this.rebuild();
      this.applyResolution();
    }

    if (this.renderer.shadowMap.enabled) {
      // `% interval` rather than `& 1`: the mask was the shooter's hard-coded
      // every-other-frame and could not express the kart racer's every frame.
      // The modulo is the same operation for interval 2 and is the identity
      // for interval 1, which is what makes one path serve both games.
      this.renderer.shadowMap.needsUpdate =
        (this.shadowGate++ % this.look.shadowCascadeInterval) === 0;
    }

    // Drained on both paths below. Zeroed HERE rather than inside either
    // branch, because a frame that draws nothing at all must report zero shadow
    // calls rather than last frame's — a stale count on a dead frame is the
    // cache-of-a-fact shape, and this number exists to diagnose dead frames.
    this.shadowCallsThisFrame = 0;
    // Same reason as the line above, and one more: -1 is "the wrapper did not
    // run", so a composer whose first pass is disabled reports "unattributed"
    // rather than last frame's count.
    this.sceneCallsThisFrame = -1;

    // ------------------------------------------------------------------------
    // HOW MANY PICTURES IS THIS FRAME?
    // ------------------------------------------------------------------------
    // The absent case is FIRST and it is a straight `return`, so a game with no
    // `views` reaches `present()` having executed nothing that did not execute
    // before this field existed. That is not tidiness, it is the safety
    // argument: the split-screen design asks for a one-view
    // render through the new path to be byte-identical to no split screen at
    // all, and the strongest form of that claim is the one where the old path
    // is still literally the old path. A split-view probe asserts the
    // WEAKER and more useful form as well — the same game rendered through
    // `views: [one full-surface view]` against `views: undefined` — because
    // that is the one that can actually go red.
    // ONCE PER SURFACE FRAME, and after every system has had its say — the
    // loop's whole `lateUpdate` walk is behind us by the time `render` is
    // called. See `beforeEachPresent` for why this is not a `System`.
    //
    // `[...]` because a listener is entitled to remove itself, and mutating a
    // Set while iterating it is the kind of thing that works for a year and
    // then does not.
    if (this.preDraw.size > 0) {
      for (const fn of [...this.preDraw]) {
        try {
          fn(ctx);
        } catch (err) {
          // A throw here must not take the frame with it. The render-failure
          // ladder exists for a renderer that cannot draw; a camera rig that
          // threw is a different fault and retreating a graphics tier over it
          // would be the wrong repair loudly applied.
          console.error('[render] a beforeEachPresent hook threw', err);
        }
      }
    }

    // See `setXRPresenting` point 3: in a session the two pictures are the eyes
    // and three owns the pair, so a game's own split is not a second layout, it
    // is four rectangles and a composer aimed at one of them.
    const views = this.xrPresenting ? undefined : ctx.views;
    if (views !== undefined && views.length > 0) {
      this.presentViews(ctx, views);
      this.afterPresent(ctx, ctx.camera);
      return;
    }

    const drawn = this.present(ctx);
    this.lastShadowCalls = drawn.shadow;
    this.lastSceneCalls = drawn.scene;
    this.afterPresent(ctx, ctx.camera);
  }

  private presentFrame(ctx: W, camera: THREE.Camera): PipelinePresentFrame<W> {
    return {
      world: ctx,
      renderer: this.renderer,
      device: this.device,
      camera,
      composer: this.composer,
      dt: ctx.dt,
      held: this.adapter.held?.(ctx) ?? heldForCapture(ctx.dt),
      pixelRatio: this.appliedRatio,
    };
  }

  private afterPresent(ctx: W, camera: THREE.Camera): void {
    this.adapter.afterPresent?.(this.presentFrame(ctx, camera));
  }

  /**
   * Two or more pictures in one frame, each with its own camera, its own
   * rectangle of the surface and its own run of the post chain.
   *
   * ---------------------------------------------------------------------------
   * WHY ONE COMPOSER AND NOT N, AND WHAT THAT HONESTLY COSTS
   * ---------------------------------------------------------------------------
   * `applyResolution` sizes the composer's buffers to the VIEW rather than to
   * the canvas when a view size is set, so the chain runs at the view's aspect
   * and its screen-space effects are authored against the VIEW's edges. That is
   * the property the split-screen plan says the cheap version gets wrong:
   * *"a vignette drawn over a split screen darkens the middle of the television
   * rather than the edge of each player's view."* It is not wrong here — the
   * vignette, the chromatic aberration and the bokeh circle all belong to the
   * half they were drawn in, because the buffer they were drawn into is that
   * half.
   *
   * WHAT ONE COMPOSER CANNOT DO, said plainly rather than left to be discovered:
   * every view gets the SAME PASSES. `ssao`, `bloom`, `dof` and `motionBlur`
   * decide what is compiled into the chain at `tryBuild()` time, so a
   * television view at Ultra and a phone view at Low cannot differ in those
   * four — only in the values the passes read per view, which `fx.sync()`
   * refreshes on every iteration below. `PipelineView` therefore carries no
   * settings field: accepting one here would promise a value this pipeline
   * ignores. Building that feature means N composers, N chains and N sets of
   * AO/bloom/bokeh targets. It belongs to a named consumer that needs unequal
   * chains, not to the viewport contract speculatively.
   *
   * ---------------------------------------------------------------------------
   * EVERY VIEW MUST BE THE SAME SIZE, AND THE CHECK IS LOUD
   * ---------------------------------------------------------------------------
   * The buffers are allocated once, at one size. A set with unequal rects would
   * need a reallocation per view per frame — 25-30 MB of GPU churn at a
   * handheld's buffer size, per `applyResolution`'s own note — so it is refused
   * rather than accommodated. Refused by DRAWING THE FIRST VIEW AND SAYING SO,
   * not by drawing nothing: a black television is worse than a wrong layout,
   * and the console line names the file to fix.
   */
  private presentViews(ctx: W, views: readonly PipelineView[]): void {
    const rects = views.map((v) => v.rect);
    if (!equalSized(rects)) {
      if (!this.unequalViewsWarned) {
        this.unequalViewsWarned = true;
        this.diag.logPipeline('views',
          `${views.length} views were handed rects of different sizes ` +
          `(${rects.map((r) => `${r.w}x${r.h}`).join(', ')}). One composer serves every view and ` +
          'its buffers are allocated once, so only the first is drawn. See ' +
          'layoutViews() in @homie-rocks/render/views.ts — every layout it returns is equal-sized.');
      }
      const drawn = this.present(ctx, views[0]);
      this.lastShadowCalls = drawn.shadow;
      this.lastSceneCalls = drawn.scene;
      return;
    }

    let scene = 0;
    let shadow = 0;
    for (const view of views) {
      // Zeroed PER VIEW, and summed below. The wrapper on `shadowMap.render`
      // accumulates into this field and the whole point of it is to subtract
      // the cascade from the scene count; a single zero at the top of the frame
      // would attribute view A's cascade to view B's geometry.
      this.shadowCallsThisFrame = 0;
      // And the scene count with it, for the same reason plus one: -1 is "the
      // wrapper did not run for THIS view", so a view drawn without a composer
      // reports unattributed rather than inheriting the previous view's count.
      this.sceneCallsThisFrame = -1;
      const drawn = this.present(ctx, view);
      scene += drawn.scene;
      shadow += drawn.shadow;
    }
    this.lastSceneCalls = scene;
    this.lastShadowCalls = shadow;

    // THE VIEWPORT IS RESTORED, AND NOT BY THE NEXT FRAME.
    //
    // `sampleFrame()` reads the canvas back with `readRenderTargetPixels`, the
    // notice/fatal DOM is painted over the canvas, and a context-restore trial
    // draw runs outside `render()` entirely. Every one of those assumes the
    // renderer is looking at the whole surface. Leaving the last view's scissor
    // in force would give the health watchdog a quarter of the picture and let
    // it conclude the frame was blank — a plausible default answering for a
    // frame that was fine.
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.setScissor(0, 0, this.width, this.height);

    // ------------------------------------------------------------------------
    // AND A SEAM FOUND HERE AND DELIBERATELY NOT FIXED.
    // ------------------------------------------------------------------------
    // `sampleFrame()` reads two horizontal bands across the FULL WIDTH of the
    // drawing buffer, at 45% and 75% of its height, and `@homie-rocks/diagnostics`
    // decides "the frame is blank" from their mean and standard deviation. That
    // is a whole-frame question, and with two views it is being asked of two
    // pictures at once:
    //
    //   side by side   both bands cross BOTH views, so one entirely dead view
    //                  halves the numbers rather than zeroing them — a frame in
    //                  which one player sees nothing at all reads as a dim
    //                  frame, and the watchdog's answer is to walk the pipeline
    //                  down a rung, which does not help either player.
    //   over and under the 45% band is entirely inside view 0 and the 75% band
    //                  entirely inside view 1, so both ARE sampled — and then
    //                  averaged into one verdict with no way to say which half
    //                  went dark.
    //
    // Fixing it means `sampleFrame(view?)` and a watchdog that keeps a verdict
    // per view, which is a change to @homie-rocks/diagnostics' interface and to
    // the four shipped games' thresholds. It is real work and it is not this
    // change; what this change owes is the note. A split-view probe covers the
    // gap for THIS game by sampling each rect itself.
  }

  /** Set when the unequal-rect refusal has been said once; it is per-frame otherwise. */
  private unequalViewsWarned = false;

  /**
   * ONE PICTURE. The body this method holds is what `render()` ran inline
   * before there was such a thing as a view, moved verbatim and with its
   * comments, and the two assignments at the bottom turned into a return so a
   * caller can sum them across views.
   *
   * `view` is undefined for the single-view case and NOTHING in the body reads
   * the renderer's viewport state on that path — so an absent view is the old
   * frame, not a full-surface view that happens to look like it.
   */
  private present(ctx: W, view?: PipelineView): { scene: number; shadow: number } {
    if (view !== undefined) {
      // CSS pixels in, CSS pixels out: three multiplies by its own pixel ratio
      // on the way to GL. `glRect` is the only origin flip in the package —
      // see views.ts for why it is not written out here.
      const g = glRect(view.rect, this.height);
      this.renderer.setViewport(g.x, g.y, g.w, g.h);
      this.renderer.setScissor(g.x, g.y, g.w, g.h);
      this.renderer.setScissorTest(true);
      if (this.composer !== null) {
        // postprocessing's own API for re-aiming a built chain. Every pass
        // holds the camera it was constructed with; without this the second
        // view renders the first view's viewpoint into the second view's
        // rectangle, which looks like a layout bug and is a camera bug.
        this.composer.setMainCamera(view.camera as THREE.Camera);
      }
    }
    const camera = view === undefined ? ctx.camera : view.camera;
    const frame = this.presentFrame(ctx, camera);
    this.adapter.beforePresent?.(frame);
    let scene: number;
    let shadow: number;

    // See `setXRPresenting` point 1. The composer is still built, still sized
    // and still holds every pass; it is simply not the thing that can put two
    // eyes into a session's framebuffer, so it is not asked while one is open.
    if (this.composer !== null && !this.xrPresenting) {
      const composer = this.composer;
      const renderer = this.renderer;
      const self = this;
      renderer.info.autoReset = false;
      // ONE VERB, HANDED TO THE CHAIN, WHICH DECIDES HOW MANY TIMES TO SPEND
      // IT. A chain with no per-draw accumulator calls it once and this is the
      // same two statements it always was; a chain with a temporal resolve runs
      // the capture protocol over it while the world is held. See `PostChain`.
      //
      // THE COUNTERS ARE ZEROED INSIDE THE VERB, NOT OUTSIDE IT, and that is
      // the whole reason the reset moved. A held frame can spend this callback
      // NINE times; `renderer.info` accumulates and `shadowCallsThisFrame`
      // accumulates with `+=`, so a reset outside the loop would report nine
      // frames' worth of draws against one frame — and `scene = sceneCalls -
      // shadowCalls` would go NEGATIVE and clamp to 0, which is precisely the
      // reading a game's `checkDrawCalls` detector acts on. A dead-renderer
      // verdict on a healthy machine, reachable only under a capture run, i.e.
      // exactly where nobody would be watching the picture.
      this.fx.present(ctx, camera, ctx.dt, frame.held, () => {
        this.adapter.beforeDraw?.(frame);
        renderer.info.reset();
        self.shadowCallsThisFrame = 0;
        composer.render(ctx.dt);
      });
      // The scene pass is the first thing the composer runs, and every pass
      // after it is one quad. Subtracting the fixed post-chain cost is less
      // reliable across quality tiers than simply noting that a healthy frame
      // is in the hundreds and a dead one is in single digits.
      //
      // AND THE SHADOW PASS COMES OFF TOO — see `lastShadowCalls`. A cascade
      // rebuild is a second full geometry pass, so without this the number
      // alternates with the cadence: measured at 299/254 in the shooter on a
      // world that could not change.
      shadow = this.shadowCallsThisFrame;
      // MEASURED IF IT CAN BE, ESTIMATED ONLY IF IT CANNOT. See
      // `instrumentScenePass` for what the estimate cost the first consumer
      // whose scene was smaller than `POST_QUADS`. The shadow pass runs inside
      // the scene pass's own `renderer.render`, so it comes off either way.
      //
      // MERGE NOTE: this is one game's measurement written into another's
      // per-view return. The two changes touched the same four lines for
      // unrelated reasons — one made the frame more than one picture, the
      // other stopped a five-object scene reading as a dead one — and the
      // combination is per-view attribution of a MEASURED count, which is what
      // both of them wanted and neither could have written alone.
      scene = this.sceneCallsThisFrame >= 0
        ? Math.max(0, this.sceneCallsThisFrame - this.shadowCallsThisFrame)
        : Math.max(0,
          this.renderer.info.render.calls - POST_QUADS - this.shadowCallsThisFrame);
      this.renderer.info.autoReset = true;
    } else {
      this.adapter.beforeDraw?.(frame);
      // NEITHER OF THE NEXT TWO LINES IS RUN IN A SESSION, AND BOTH WOULD BE
      // WRONG THERE RATHER THAN MERELY WASTEFUL. `setRenderTarget(null)` binds
      // the CANVAS's default framebuffer; the session draws into its own, which
      // `renderer.render` binds for itself a moment later — so clearing here
      // clears a surface nobody is looking at, and, on a runtime that composites
      // the 2D canvas behind the layer, clears the wrong one visibly. The clear
      // the eyes need is three's own `autoClear`, inside the XR path, against
      // the XR target.
      if (!this.xrPresenting) {
        this.renderer.setRenderTarget(null);
        // Explicit, not left to `autoClear`: this path is reached both from a
        // device that never had a composer (autoClear untouched, true) and from a
        // composer that failed to build (autoClear turned off by postprocessing's
        // constructor before it threw). One of those two clears the canvas and
        // the other does not, and the one that does not shows the previous frame
        // wherever the scene has no geometry — sky included, since the sky dome
        // is drawn but the HUD-side letterbox is not.
        this.renderer.clear(true, true, false);
      }
      // `camera` is IGNORED while presenting and that is the contract, not an
      // accident: three reads it for `near`, `far` and its LAYERS, positions
      // the eye cameras from the session's reference space against this
      // camera's PARENT, and then substitutes its own `ArrayCamera`. Which is
      // exactly why `xr.ts` parents the game's camera to a rig and zeroes its
      // local transform — see that file. Passing `ctx.camera` here is right.
      this.renderer.render(ctx.scene, camera);
      // No composer, so no quads to subtract — but the shadow pass is still in
      // there, and this path is the one a degraded machine is on. It is the
      // last place a number should stop meaning what its name says.
      shadow = this.shadowCallsThisFrame;
      scene = Math.max(0,
        this.renderer.info.render.calls - this.shadowCallsThisFrame);
    }

    // ------------------------------------------------------------------------
    // THE PARTIAL-FRAME ARTEFACT — what it actually is, measured.
    // ------------------------------------------------------------------------
    // A screenshot tool's notes said "roughly one capture in five comes back as
    // a vertical split, with the left band holding the previous frame and
    // everything right of the seam holding a scene buffer that was never drawn
    // into", and writes it off as a SwiftShader quirk. The player sees the same
    // thing on a real phone, so it was worth measuring properly rather than
    // retrying past. Three arms, one session, 50 captures each at 1920x1080,
    // scored with the screenshot tool's own dark-fraction test:
    //
    //     arm                       torn / 50     worst frame
    //     stock pipeline               12          50.1% dark
    //     + gl.finish() per frame       3          24.8% dark
    //     no post-processing at all     3          11.7% dark
    //
    // Read those together and the artefact is not a logic bug in the chain:
    //
    //  - `finish()` — which blocks until the GPU is idle — cuts it four-fold.
    //    So most torn frames are frames the compositor sampled while the
    //    rasteriser was still working through them. The dark region is not a
    //    buffer "that was never drawn into", it is one that had not been drawn
    //    into YET, with the grade pass's grain and vignette already composited
    //    over the part of it that was still black. Its boundary is a tile
    //    corner — a column seam AND a row seam in the same frame — not a
    //    scanline, which is what partial tile coverage looks like.
    //  - Removing the composer cuts the RATE by the same four-fold and the
    //    SEVERITY by more than four-fold. Post-processing does not introduce
    //    the race; it makes the window wider, because it multiplies the GPU
    //    work behind a single present.
    //  - Neither arm reaches zero, so a residue lives in the capture path
    //    itself and is genuinely not ours.
    //
    // Which means there is no line to add here. The lever is per-frame GPU
    // cost, and that is what the rest of this work is: the watchdog in a
    // game's main.ts refuses to queue a second frame on top of an overrunning
    // one, the resize guard below stops the whole target set being reallocated
    // mid gesture, and the handheld tier ships without the passes it cannot
    // afford.
    //
    // `gl.flush()` was the obvious cheap candidate and it is deliberately NOT
    // here: A/B'd on its own, 70 captures each, it measured 4 torn frames
    // without and 8 with. It does not help.
    return { scene, shadow };
  }

  resize(w: number, h: number) {
    const nw = Math.max(1, Math.round(w));
    const nh = Math.max(1, Math.round(h));
    if (nw === this.width && nh === this.height) return;
    this.width = nw;
    this.height = nh;
    this.applyResolution();
  }

  /**
   * Tell the pipeline how big ONE VIEW is, so the composer's buffers are
   * allocated for a view rather than for the canvas.
   *
   * `null` restores the single-view arrangement, in which the buffers are the
   * canvas and `applyResolution` is the function it always was.
   *
   * IT IS A SEPARATE CALL FROM `ctx.views` ON PURPOSE. `views` changes every
   * frame — the cameras move — and `applyResolution` reallocates every render
   * target in the chain, which is 25-30 MB of GPU churn at a handheld's buffer
   * size. Reading the size off `ctx.views` inside `render()` would put that
   * reallocation one careless `map()` away from happening sixty times a second.
   * A game calls this when the LAYOUT changes: at boot, on resize, and when a
   * second person picks up a controller.
   */
  setViewSize(size: { w: number; h: number } | null): void {
    const w = size === null ? null : Math.max(1, Math.round(size.w));
    const h = size === null ? null : Math.max(1, Math.round(size.h));
    if ((this.viewSize === null) === (w === null)
      && (this.viewSize === null || (this.viewSize.w === w && this.viewSize.h === h))) return;
    this.viewSize = w === null || h === null ? null : { w, h };
    // The guard in `applyResolution` compares against what was last pushed, and
    // what was last pushed was a different surface entirely. Without this a
    // switch from one view to two at the same canvas size is a no-op and the
    // chain keeps rendering at full width into a half-width rectangle.
    this.invalidateResolutionCache();
    this.applyResolution();
  }

  /**
   * ==========================================================================
   *  A HEADSET IS PRESENTING (or has stopped). REVERSIBLE, UNLIKE EVERY OTHER
   *  WAY THIS PIPELINE STOPS RENDERING THE WAY IT NORMALLY DOES.
   * ==========================================================================
   * Called by `@homie-rocks/render/xr.ts` on `sessionstart` and `sessionend`, and by
   * nothing else. Three things change while it is true, and every one of them
   * is a correctness fix rather than a preference:
   *
   * 1. THE COMPOSER IS BYPASSED. `postprocessing`'s `EffectComposer` renders
   *    the scene into its own render targets and then blits one fullscreen
   *    triangle to whatever framebuffer is bound — ONE picture, from ONE
   *    camera, at the canvas's size. A presenting session needs two pictures
   *    from two cameras into the session's own framebuffer, which three sets up
   *    inside `renderer.render()` and the composer knows nothing about. The
   *    honest outcome of running the chain anyway is one eye's worth of a mono
   *    image stretched across both, which is not a graphical glitch, it is a
   *    thing that makes people feel ill. The direct path is the supported one
   *    and it is the one three's own XR examples use.
   *
   *    THE CHAIN IS NOT TORN DOWN. `disablePostProcessing` exists for the
   *    irreversible case and it drops the composer, its targets and every pass;
   *    rebuilding all of that when somebody takes the headset off is seconds of
   *    stall and a fresh set of 25-30 MB allocations. Here the composer simply
   *    is not asked, and the frame after the session ends is the graded frame
   *    that was there before it started.
   *
   * 2. RESOLUTION STOPS BEING PUSHED. `renderer.setSize` REFUSES while a device
   *    is presenting — three logs `Can't change size while VR device is
   *    presenting` and returns — but `setPixelRatio` writes its field first and
   *    then calls it, so a ladder rung taken during a session would move the
   *    renderer's idea of the ratio, fail to apply it, and leave the canvas
   *    wrong for the 2D page the moment the session ends. The session owns the
   *    buffer size; the ladder has nothing to say about it.
   *
   * 3. SPLIT VIEWS ARE IGNORED. In a session the two pictures ARE the views and
   *    three owns the pair. A game that also asked for a split screen would get
   *    four rectangles and a composer aimed at one of them.
   *
   * ON THE WAY OUT the resolution cache is invalidated before it is re-pushed,
   * because what was last pushed is a size the session chose and the canvas no
   * longer has — the same reason `setViewSize` invalidates.
   */
  setXRPresenting(on: boolean): void {
    if (on === this.xrPresenting) return;
    this.xrPresenting = on;
    this.diag.logPipeline('xr', on
      ? 'a headset is presenting: the post chain is bypassed and the ladder is parked'
      : 'the headset stopped presenting: the post chain and the ladder are back');
    if (on) return;
    // Everything below is the way back. Nothing is pushed on the way IN,
    // because the session is about to replace it all anyway.
    this.invalidateResolutionCache();
    this.applyResolution();
    // A chain that converged anything — temporal resolve, motion blur history,
    // an auto-exposure average — converged it on frames from before the
    // session, which are now minutes old and of a different scene. Same
    // argument `applyResolution` makes about a resized history.
    this.fx.invalidate();
  }

  /** True while a WebXR session is presenting. Read by tests. */
  get presentingXR(): boolean {
    return this.xrPresenting;
  }

  /**
   * ==========================================================================
   *  RUN THIS IMMEDIATELY BEFORE EVERY SURFACE FRAME IS DRAWN.
   * ==========================================================================
   * Returns the function that unregisters it.
   *
   * ADDED FOR `xr.ts` AND WORTH THE THIRTY LINES BECAUSE THE ALTERNATIVE HAS A
   * SILENT FAILURE IN IT. The XR rig has to be posed from the game's camera
   * after every system has finished moving that camera and before the draw
   * consumes it. A `System` could do it — the loop walks `lateUpdate` and then
   * presents — but only if the game puts that system LAST in its array, and a
   * game that puts it third poses from a camera two systems are about to move.
   * The symptom is a viewpoint one system-walk stale inside its own frame,
   * which in a headset is a faint swim nobody can attribute and on a panel is
   * invisible. Ordering that can be got wrong silently is ordering that will
   * be got wrong.
   *
   * `PipelineAdapter.beforePresent` is the same moment and is deliberately NOT
   * what this uses: the adapter is a CONSTRUCTOR argument owned by the game,
   * one per pipeline, and taking it would mean a game that has its own adapter
   * cannot also have VR. This is additive, and a `Set` so registering twice is
   * once.
   *
   * IT IS CALLED ONCE PER SURFACE FRAME AND NOT ONCE PER VIEW. A split-screen
   * game draws two pictures from one frame's state, and a camera rig posed
   * between them would be two different instants in one photograph.
   */
  beforeEachPresent(fn: (world: W) => void): () => void {
    this.preDraw.add(fn);
    return () => { this.preDraw.delete(fn); };
  }

  private readonly preDraw = new Set<(world: W) => void>();

  /** The CSS size of one view, or null for "one view, the whole canvas". */
  private viewSize: { w: number; h: number } | null = null;

  /** What the composer's buffers are currently sized for, for a test to read. */
  get viewBufferSize(): { w: number; h: number } {
    return this.viewSize === null
      ? { w: this.width, h: this.height }
      : { w: this.viewSize.w, h: this.viewSize.h };
  }

  dispose() {
    const el = this.renderer?.domElement;
    if (el !== undefined) {
      el.removeEventListener('webglcontextlost', this.handleContextLost, false);
      el.removeEventListener('webglcontextrestored', this.handleContextRestored, false);
    }
    this.adapter.dispose?.();
    this.fx.dispose();
    if (this.composer !== null) {
      this.composer.dispose();
      this.composer = null;
    }
    if (this.overrideMat !== null) {
      if (this.ctx?.scene?.overrideMaterial === this.overrideMat) this.ctx.scene.overrideMaterial = null;
      this.overrideMat.dispose();
      this.overrideMat = null;
    }
    this.samplePixels = null;
    this.notice?.remove();
    this.notice = null;
    this.renderer?.dispose();
    if (el !== undefined && el.parentNode !== null) el.parentNode.removeChild(el);
  }

  /**
   * Give up on post-processing and run the direct path from here on.
   *
   * The chain already degrades when it cannot be *built*; this is the same
   * retreat for a chain that built fine and then started throwing at render
   * time, which is what a driver in trouble looks like from up here. A game
   * without a grade is a worse-looking game; a game that throws once per frame
   * is a black rectangle.
   */
  disablePostProcessing(reason: string): void {
    if (this.rung >= Rung.Direct) return;
    this.diag.logPipeline('degrade', `${RUNG_NAMES[this.rung]} -> ${RUNG_NAMES[Rung.Direct]}: ${reason}`);
    this.rung = Rung.Direct;
    this.dropComposer();
    this.rebuild();
  }

  // -------------------------------------------------------------------------
  //  The fallback ladder, driven from Diagnostics
  // -------------------------------------------------------------------------

  /**
   * Step one rung down and rebuild. Returns false when there is nothing left
   * below — which is the only condition under which the banner is allowed.
   *
   * Called by the watchdogs in Diagnostics, which is deliberate: the pipeline
   * knows how to degrade and the diagnostics know when to. Neither of them
   * should be deciding both.
   */
  degrade(reason: string): boolean {
    if (this.rung >= Rung.Flat) {
      this.diag.logPipeline('degrade', `already on ${RUNG_NAMES[this.rung]}; nothing simpler to try (${reason})`);
      return false;
    }
    this.fall(reason);
    this.rebuild();
    return true;
  }

  /**
   * Jump straight to the simple-material rung.
   *
   * Used when the cause is KNOWN to be a material family the driver rejected.
   * Walking down through the composer rungs first would waste several seconds
   * of the player's time on changes that cannot possibly help: the shader is
   * broken wherever it is composited to.
   */
  degradeToSafeMaterials(reason: string): boolean {
    // Already there. Say so and change nothing: the remedy for this cause has
    // been applied, and the image detector is the thing entitled to decide
    // whether it worked. Escalating here as well is how a driver that rejects
    // ONE shader family ended up on flat normal-shading when the untextured lit
    // variant one rung up was drawing the world perfectly well.
    if (this.rung >= Rung.Safe) {
      this.diag.logPipeline('degrade', `already on ${RUNG_NAMES[this.rung]}, which covers this (${reason})`);
      return true;
    }
    this.diag.logPipeline('degrade', `${RUNG_NAMES[this.rung]} -> ${RUNG_NAMES[Rung.Safe]}: ${reason}`);
    this.rung = Rung.Safe;
    this.rebuild();
    return true;
  }

  rungName(): string { return RUNG_NAMES[this.rung]; }

  capabilities(): GLCapabilities { return glCapabilities(); }

  /**
   * The `?glfail=` switches that have actually FIRED in this page — not the
   * ones typed into the URL, the ones a call site consulted and got true from.
   *
   * A test needs this and had no way to ask for it. `GL_FAILURE_NAMES`
   * makes an unknown name loud and `forcedFailure()` makes a rotted call site
   * loud, but neither can tell "the fault was injected" from "the branch
   * carrying the fault was never reached" — and the second of those reads as a
   * clean green pass, which is the shape that once left three injected faults
   * validating nothing. A parity probe BLOCKS on an empty list.
   */
  forcedFailuresApplied(): string[] { return consumedFailures(); }

  /**
   * Read two strips of the finished frame back and score them.
   *
   * THE ONLY HONEST ORACLE IN THE FILE. Draw calls, framebuffer status and
   * shader logs are all proxies; this is the picture. It works without
   * `preserveDrawingBuffer` because it runs inside the same task that drew the
   * frame — the drawing buffer is only discarded when the compositor takes the
   * surface, which cannot happen until this task yields.
   *
   * `readPixels` is a synchronous pipeline stall, so this is called a handful
   * of times in the life of the page and never in a steady state; see the
   * game's diagnostics watchdog. The strips are 4 rows each at 45% and 75% of
   * frame height, which crosses sky, horizon, trackside and road — a band that
   * is featureless in every one of the failure modes and never featureless in a
   * working frame.
   */
  sampleFrame(): FrameSample | null {
    const gl = this.gl as WebGL2RenderingContext | null;
    if (gl === null || this.contextLost) return null;
    const w = gl.drawingBufferWidth | 0;
    const h = gl.drawingBufferHeight | 0;
    if (w < 8 || h < 8) return null;

    const rows = 4;
    const need = w * rows * 4;
    if (this.samplePixels === null || this.samplePixels.length < need) {
      this.samplePixels = new Uint8Array(need);
    }
    const buf = this.samplePixels;

    let n = 0;
    let sum = 0;
    let sum2 = 0;
    let lit = 0;
    const prev = this.renderer.getRenderTarget();
    try {
      // The default framebuffer is what the player sees; anything still bound
      // from the last pass is not.
      this.renderer.setRenderTarget(null);
      drainErrors(gl);
      for (const frac of [0.45, 0.75]) {
        const y = Math.min(h - rows, Math.max(0, Math.round(h * frac)));
        gl.readPixels(0, y, w, rows, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        if (gl.getError() !== gl.NO_ERROR) return { lit: 0, mean: 0, sd: 0, ok: false };
        for (let i = 0; i < need; i += 4) {
          // NON-NULL AND DELIBERATELY NOT `?? 0`. `buf` is allocated at
          // `need` bytes eighteen lines up (`length < need` reallocates), the
          // loop stops at `need`, and the furthest read is `need - 2` — in
          // bounds by construction, which `noUncheckedIndexedAccess` cannot
          // see through a `Uint8Array`. A zero default here would be the worst
          // possible place for one: this luma IS the black-frame watchdog, so
          // an out-of-range read would report the frame as dark, which is
          // exactly the alarm it exists to raise.
          const luma = 0.2126 * buf[i]! + 0.7152 * buf[i + 1]! + 0.0722 * buf[i + 2]!;
          n++;
          sum += luma;
          sum2 += luma * luma;
          if (luma > 12) lit++;
        }
      }
    } catch {
      return { lit: 0, mean: 0, sd: 0, ok: false };
    } finally {
      this.renderer.setRenderTarget(prev);
    }
    if (n === 0) return { lit: 0, mean: 0, sd: 0, ok: false };
    const mean = sum / n;
    return { lit: lit / n, mean, sd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), ok: true };
  }

  /**
   * Draws a representative material into a small off-screen target and reads
   * the result back. Runs once, at boot, before any of the world exists.
   *
   * A clearcoated MeshPhysicalMaterial under a directional light is the game's
   * headline material and shares its entire shader family with the road, the
   * kerbs, the buildings and the vehicles. If this comes back the
   * colour of the clear, that family does not draw on this GPU — which is the
   * leading theory for the empty-world reports, and the whole point of asking
   * before the player has anything to lose.
   */
  private trialDraw(): { ok: boolean; detail: string } {
    if (forcedFailure('trial')) return { ok: false, detail: 'forced by ?glfail=trial' };
    const size = 8;
    let rt: THREE.WebGLRenderTarget | null = null;
    const scene = new THREE.Scene();
    const geo = new THREE.PlaneGeometry(4, 4);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xe0453f, metalness: 0, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06,
    });
    // Named so `#define SHADER_NAME` carries it: three uses the material's name
    // for that define and leaves it EMPTY when there is none, which is exactly
    // the case where a report would say "unknown" about the one program whose
    // identity matters most.
    mat.name = 'boot-trial-physical';
    const prevTarget = this.renderer.getRenderTarget();
    const prevClear = new THREE.Color();
    this.renderer.getClearColor(prevClear);
    const prevAlpha = this.renderer.getClearAlpha();
    this.inTrial = true;
    try {
      // 8-bit on purpose: this probe asks about the MATERIAL, and pairing it
      // with a float target would confuse a shader failure with a format one.
      rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, depthBuffer: true });
      const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 20);
      cam.position.set(0, 0, 2.4);
      const key = new THREE.DirectionalLight(0xffd9a8, 4.2);
      key.position.set(0.5, 0.9, 1.4);
      scene.add(key, new THREE.AmbientLight(0xa8c8ff, 0.8), new THREE.Mesh(geo, mat));

      this.renderer.setRenderTarget(rt);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear(true, true, false);
      this.renderer.render(scene, cam);

      const px = new Uint8Array(size * size * 4);
      this.renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
      let brightest = 0;
      for (let i = 0; i < px.length; i += 4) {
        // Same bound and the same reason as `sampleFrame`: the loop is over
        // `px.length` and the reads are within the last whole RGBA group. A
        // `?? 0` here would darken the trial's brightest pixel, and the trial
        // reports "a representative PBR material drew nothing" when it is dark.
        brightest = Math.max(brightest, px[i]!, px[i + 1]!, px[i + 2]!);
      }
      // The quad fills the frame and is lit from the front, so a working driver
      // returns something in the hundreds. Anything under 8 counts is the clear
      // colour with rounding on top.
      return brightest >= 8
        ? { ok: true, detail: '' }
        : { ok: false, detail: `brightest channel was ${brightest}/255 on a fully-lit quad` };
    } catch (err) {
      return { ok: false, detail: String(err) };
    } finally {
      this.inTrial = false;
      this.renderer.setRenderTarget(prevTarget);
      this.renderer.setClearColor(prevClear, prevAlpha);
      scene.clear();
      geo.dispose();
      mat.dispose();
      rt?.dispose();
    }
  }

  /**
   * Installs, updates or removes the whole-scene material override.
   *
   * `Scene.overrideMaterial` is a blunt instrument and that is exactly what is
   * wanted here: at this point the driver has told us it will not draw the
   * materials the world is made of, and the choice is between one simple
   * material for everything and nothing at all. The geometry, the layout, the
   * vehicles and the track are all still there — they stop being invisible.
   */
  private applyMaterialOverride(): void {
    const scene = this.ctx?.scene;
    if (scene === undefined || scene === null) return;
    const want: 'safe' | 'flat' | null =
      this.rung >= Rung.Flat ? 'flat' : this.rung >= Rung.Safe ? 'safe' : null;
    const have = this.overrideMat === null ? null
      : (this.overrideMat as THREE.Material).userData.kartFallback as 'safe' | 'flat';
    if (want === have) return;

    if (this.overrideMat !== null) {
      if (scene.overrideMaterial === this.overrideMat) scene.overrideMaterial = null;
      this.overrideMat.dispose();
      this.overrideMat = null;
    }
    if (want === null) return;

    // 'safe' keeps the lights and the fog, so the frame still reads as
    // the golden-hour scene with its textures missing. 'flat' has no lights,
    // no textures and no environment at all — the simplest shader three has
    // that still shows the shape of a thing.
    const mat: THREE.Material = want === 'safe'
      ? new THREE.MeshLambertMaterial({ color: 0xb9b2a6, fog: true })
      : new THREE.MeshNormalMaterial();
    mat.userData.kartFallback = want;
    this.overrideMat = mat;
    scene.overrideMaterial = mat;
    this.diag.logPipeline('materials', `every material replaced with the ${want} variant`);
  }

  /**
   * A full-page explanation for the failures that leave nothing to render at
   * all, attached to <html> rather than <body>.
   *
   * That is not a stylistic choice. When the pipeline cannot be constructed,
   * `init` throws, and main.ts's boot handler replaces the entire contents of
   * <body> with a stack trace — which would take a panel inside it with it. A
   * node parented to the document element survives, so the player gets a
   * sentence they can act on instead of a red monospace dump.
   */
  private showFatal(title: string, detail: string): void {
    if (document.getElementById('gl-fatal') !== null) return;
    const el = document.createElement('div');
    el.id = 'gl-fatal';
    el.setAttribute('role', 'alert');
    el.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999', 'display:flex',
      'flex-direction:column', 'align-items:center', 'justify-content:center',
      'gap:.6em', 'padding:8vmin', 'text-align:center',
      'font-family:system-ui,-apple-system,sans-serif', 'color:#f6efe4',
      'background:radial-gradient(120% 100% at 50% 30%,#1d2436 0%,#0b0f18 70%)',
    ].join(';');
    const h = document.createElement('div');
    h.style.cssText = 'font-weight:800;font-size:clamp(18px,3.2vmin,26px);letter-spacing:.02em';
    h.textContent = title;
    const p = document.createElement('div');
    p.style.cssText = 'max-width:34em;opacity:.8;font-size:clamp(13px,2vmin,16px);line-height:1.6';
    p.textContent = detail;
    el.append(h, p);
    document.documentElement.appendChild(el);
  }

  /**
   * Put a line of text over the canvas, or take it away again with `null`.
   * The frame loop uses this for the one failure the pipeline cannot see from
   * in here: a renderer that keeps throwing without ever losing its context.
   */
  announce(title: string | null, detail = ''): void {
    if (title === null) this.hideNotice();
    else this.showNotice(title, detail);
  }

  /**
   * Test hook: drop the context on purpose, and optionally hand it back.
   *
   * Recovery code that has never been run is decoration, and the only way to
   * run this one is to ask the driver to take the context away. Exposed through
   * `__render` alongside the rest of the test surface.
   */
  debugLoseContext(restoreAfterMs = 900): void {
    const ext = this.renderer.getContext().getExtension('WEBGL_lose_context');
    if (ext === null) {
      console.warn('[render] WEBGL_lose_context unavailable; cannot simulate a loss');
      return;
    }
    ext.loseContext();
    if (restoreAfterMs >= 0) setTimeout(() => ext.restoreContext(), restoreAfterMs);
  }

  // -------------------------------------------------------------------------
  //  Context loss / restore
  // -------------------------------------------------------------------------

  private handleContextLost = (event: Event) => {
    // THE ONE LINE. Without `preventDefault()` the browser will never fire
    // 'webglcontextrestored', so there is no recovery to write.
    event.preventDefault();
    if (this.contextLost) return;
    this.contextLost = true;
    console.warn('[render] WebGL context lost — pausing until it is restored');

    // Drop our references to the effect chain. Every GPU object behind them is
    // already gone; the dispose calls are only there to release the JS side,
    // and they are wrapped because postprocessing will happily issue GL calls
    // against a dead context on the way out.
    try { this.fx.dispose(); } catch { /* already gone with the context */ }
    try { this.composer?.dispose(); } catch { /* likewise */ }
    this.composer = null;

    this.showNotice('Graphics paused', 'The device reclaimed the renderer. Restoring…');
    try { this.onContextLost?.(); } catch (err) { console.error('[render] onContextLost threw', err); }
  };

  private handleContextRestored = () => {
    console.info('[render] WebGL context restored — rebuilding the pipeline');
    // three's own listener runs first (it is registered in the WebGLRenderer
    // constructor, ours in init) and has already re-run `initGLContext()`, so
    // the device is live and every texture, geometry and program will re-upload
    // the next time it is used. What is left to us is everything that wraps a
    // GL resource of our own.
    //
    // The RUNG is deliberately not reset. Whatever the driver refused before
    // the context went away, it will refuse again, and climbing back up to a
    // pipeline this device has already failed would spend the recovery on a
    // second black screen.
    this.usePost = this.device.webgl2 && this.rung <= Rung.Ldr;
    this.composer = null;
    this.invalidateResolutionCache();
    this.signature = pipelineSignature(this.ctx.settings);

    try { this.gl = this.renderer.getContext(); } catch { this.gl = null; }
    this.renderer.shadowMap.enabled = this.ctx.settings.shadows;
    // Shadow maps come back as empty attachments; autoUpdate re-renders them on
    // the next frame, but only if nothing has latched `needsUpdate` off.
    this.renderer.shadowMap.needsUpdate = true;

    this.contextLost = false;
    this.applyResolution();
    this.rebuild();

    const done = () => {
      // A second loss can land while the first restore's pre-warm is still
      // running. If it has, the notice on screen belongs to that one and must
      // not be pulled down by a callback from the restore before it.
      if (this.contextLost) return;
      this.hideNotice();
      console.info('[render] pipeline restored');
    };
    try {
      const p = this.onContextRestored?.();
      if (p !== undefined && p !== null && typeof (p as Promise<void>).then === 'function') {
        (p as Promise<void>).then(done, (err) => {
          console.error('[render] onContextRestored failed', err);
          done();
        });
      } else {
        done();
      }
    } catch (err) {
      console.error('[render] onContextRestored threw', err);
      done();
    }
  };

  /**
   * A calm line of text over the frozen canvas. A black rectangle with no
   * explanation is the worst version of this; the frame underneath is stale but
   * it is still a picture of the game, so the notice sits on top of it rather
   * than replacing it.
   */
  private showNotice(title: string, detail: string): void {
    if (this.notice === null) {
      const el = document.createElement('div');
      el.id = 'gl-notice';
      el.setAttribute('role', 'status');
      el.style.cssText = [
        'position:fixed', 'inset:auto 0 0 0', 'z-index:120', 'display:flex',
        'flex-direction:column', 'align-items:center', 'gap:.35em',
        'padding:1.4em 1.2em calc(1.4em + env(safe-area-inset-bottom))',
        'font-family:system-ui,-apple-system,sans-serif', 'text-align:center',
        'color:#f3f6fb', 'pointer-events:none',
        'background:linear-gradient(180deg,rgba(8,11,22,0) 0%,rgba(8,11,22,.82) 46%,rgba(8,11,22,.94) 100%)',
        'opacity:0', 'transition:opacity .35s ease',
      ].join(';');
      el.innerHTML =
        '<b style="font-size:clamp(15px,2.4vmin,20px);font-weight:800;letter-spacing:.06em"></b>' +
        '<span style="font-size:clamp(12px,1.8vmin,15px);letter-spacing:.04em;color:rgba(233,240,250,.66)"></span>';
      document.body.appendChild(el);
      this.notice = el;
    }
    const [b, s] = [this.notice.querySelector('b'), this.notice.querySelector('span')];
    if (b !== null) b.textContent = title;
    if (s !== null) s.textContent = detail;
    // One frame of layout before the transition, or it snaps in.
    requestAnimationFrame(() => { if (this.notice !== null) this.notice.style.opacity = '1'; });
  }

  private hideNotice(): void {
    const el = this.notice;
    if (el === null) return;
    el.style.opacity = '0';
    setTimeout(() => { if (this.notice === el) { el.remove(); this.notice = null; } }, 420);
  }

  // -------------------------------------------------------------------------

  /**
   * The pixel ratio the internal buffers are actually allocated at, which is
   * what every per-sample cost in the chain scales with. Not the same thing as
   * `devicePixelRatio`: `maxPixelRatio` caps it, `renderScale` scales it, and a
   * software rasteriser is pinned to 1.
   */
  /**
   * Dynamic resolution, 0.5..1. Deliberately NOT part of `Settings`, because
   * `pipelineSignature` covers `renderScale` and any change there tears down and
   * rebuilds the entire effect chain. Adaptive scaling has to be able to move
   * every second or two; rebuilding the chain that often would cost far more
   * than it saves.
   */
  dynamicScale = 1;

  /**
   * Adjust internal render resolution without rebuilding the chain.
   *
   * This is the correct response to a GPU that cannot keep up, and it is what
   * replaced halving the PRESENT rate. For a racing game a smooth 25 fps at 80%
   * resolution beats a juddering 12 fps at full resolution every time: present
   * cadence is what the eye reads as motion, and the sim was already running at
   * full rate underneath, so halving the present only added judder and changed
   * nothing about latency.
   */
  setDynamicScale(scale: number): void {
    const next = THREE.MathUtils.clamp(scale, 0.5, 1);
    if (Math.abs(next - this.dynamicScale) < 0.01) return;
    this.dynamicScale = next;
    this.applyResolution();
  }

  private effectivePixelRatio(): number {
    const custom = this.adapter.pixelRatio?.({
      world: this.ctx,
      renderer: this.renderer,
      device: this.device,
      width: this.width,
      height: this.height,
      dynamicScale: this.dynamicScale,
    });
    if (custom !== undefined) {
      if (Number.isFinite(custom)) return THREE.MathUtils.clamp(custom, 0.25, 4);
      this.diag.logPipeline('resolution', `pixelRatio adapter returned ${custom}; using 1`);
      return 1;
    }
    const s = this.ctx.settings;
    const cap = this.device.software ? 1 : Math.max(0.5, s.maxPixelRatio);
    const scale = THREE.MathUtils.clamp(s.renderScale, 0.25, 2) * this.dynamicScale;
    const dpr = THREE.MathUtils.clamp(globalThis.devicePixelRatio || 1, 0.5, 4);
    const ratio = Math.min(dpr, cap) * scale;

    // THE TWO CEILINGS LIVE IN `./resclamp.js`, and so does the
    // multiply-back-in argument that had been written twice — verbatim, in this
    // file and in a base-building game's renderer, which is how that renderer
    // was identified as a fork of this one rather than an independent
    // implementation. The POLICY above stays split, deliberately: this is a
    // maxPixelRatio CAP and that game's is a supersample FLOOR, and a
    // shared `base()` would quietly hand one game the other's antialiasing.
    //
    // ?glfail=ladder RESTORES THE DEFECT `resclamp` DESCRIBES: forced,
    // `ladderScale` becomes 1, which is the arithmetic this function had before
    // the multiply-back-in was added — the exact state in which
    // `setDynamicScale` moved `dynamicScale`, `applyResolution` ran, and the
    // drawing buffer came back byte-identical.
    //
    // It is a fault seam and not a mode: nothing about it is reachable without
    // a URL parameter, it is the same shape as `forcedFailure('composer')` in
    // tryBuild(), and it exists because a ladder that has silently lost its
    // authority looks exactly like a ladder that is working. It is also GREEN
    // ON A SMALL PANEL — neither ceiling fires below the backstop, so
    // `ladderScale` is never consulted — and red on a retina one, which is
    // precisely why the original shipped unnoticed.
    const ladderScale = forcedFailure('ladder') ? 1 : scale;

    // 4.0 Mpx is deliberately a BACKSTOP rather than the policy. It is above
    // every native-resolution desktop these games are likely to meet — 2560x1440
    // is 3.69 Mpx and passes through untouched, and so does 1080p at any ratio
    // up to 1.39 — so it never blurs a monitor that is simply large. What it
    // catches is devicePixelRatio-2 SUPERSAMPLING, where the CSS pixels are
    // already small and the extra samples are the least visible pixels in the
    // frame. On a 1920x1200 retina panel it takes the ratio from 2.0 to ~1.29,
    // which is still 1.7 geometric samples per CSS pixel in each axis with SMAA
    // running last on top. The tier's `maxPixelRatio` remains the primary knob
    // and is applied above; this only ever takes the lower of the two.
    //
    // THIS RETURN CHANGED SHAPE AND IT CARRIES TWO ONE-CORNER BEHAVIOUR FIXES,
    // stated rather than smuggled, because both are strictly-safer clamps in
    // corners narrow enough to be worth writing down:
    //
    //  1. The old code RETURNED EARLY out of the driver-limit branch, so a ratio
    //     clamped by the driver was never tested against the pixel budget;
    //     `resolutionCeiling` takes the minimum of all three, which is what the
    //     two tests already meant (`longest * ratio > limit` IS
    //     `ratio > limit / longest`). The corner is real: a WebGL2 floor of 2048
    //     on both limits, on a near-square viewport, is 2048^2 = 4.19 Mpx
    //     through a 4.0 Mpx backstop.
    //  2. The 0.25 floor was applied on the two ceiling branches and NOT on the
    //     unclamped return, which was an accident of where the `Math.max` was
    //     typed. It is universal now. Reachable only at renderScale 0.25 with
    //     dynamicScale 0.5 on a devicePixelRatio-0.5 display: 0.0625, i.e. a
    //     sixteenth-resolution buffer nobody ever asked for.
    return Math.max(0.25, resolutionCeiling({
      ratio,
      ladderScale,
      width: this.width,
      height: this.height,
      // Every colour attachment in the chain is allocated at the drawing-buffer
      // size, and a target whose edge exceeds either limit comes back
      // INCOMPLETE and black rather than failing loudly. Not hypothetical on a
      // handheld: a 2532 CSS-px landscape panel at devicePixelRatio 3 is 7596
      // drawing-buffer pixels wide, and the WebGL2 floor for both is 2048.
      limit: Math.min(
        this.renderer?.capabilities?.maxTextureSize ?? 4096,
        maxRenderbufferSize(() => this.gl),
      ),
      pixelBudget: 4.0e6,
    }));
  }

  private msaaSamples(): number {
    const custom = this.adapter.multisampling?.({
      world: this.ctx,
      renderer: this.renderer,
      device: this.device,
      width: this.width,
      height: this.height,
      dynamicScale: this.dynamicScale,
      pixelRatio: this.effectivePixelRatio(),
    });
    if (custom !== undefined) {
      if (Number.isFinite(custom)) return THREE.MathUtils.clamp(Math.round(custom), 0, 8);
      this.diag.logPipeline('resolution', `multisampling adapter returned ${custom}; using 0`);
      return 0;
    }
    if (!this.device.webgl2) return 0;
    const q = this.ctx.settings.quality;

    // ---------------------------------------------------------------------
    // MSAA IS INCOMPATIBLE WITH THE AO PASS, AND THAT IS THE BLACK-FRAME BUG.
    //
    // `N8AOPostPass` samples the composer's `inputBuffer` as a TEXTURE to get
    // its scene colour. When that buffer is multisampled it has to be resolved
    // first, and that resolve does not reliably happen before the read — so the
    // pass composites over undefined contents and the frame comes back with a
    // large black region bounded by a stepped, tile-aligned edge.
    //
    // Measured, at the reporter's own window size, over 420 frames each:
    //     composer.multisampling = 2  ->  32 black frames  (7.6%)
    //     composer.multisampling = 0  ->   1 black frame   (0.2%)
    //
    // An earlier change found this expression reading `ssao ? 0 : msaa` and
    // removed the guard, because the stated justification for it was wrong:
    // the comment claimed N8AOPostPass renders the scene privately and discards
    // the composer's colour, which is true of `N8AOPass` but not of the `Post`
    // variant. The justification was wrong and the guard was right. It is
    // restored here with the reason it actually has, and with the numbers.
    //
    // Nothing is lost visually: SMAA is the last pass in the chain and resolves
    // edges on top of whatever it is given, which is exactly how Quality.Low
    // has always run.
    if (this.ctx.settings.ssao) return 0;
    // ---------------------------------------------------------------------

    // A software rasteriser pays for every sample of every fragment, so SMAA
    // carries the edges there. Quality.Low relies on SMAA alone by design.
    if (this.device.software) return q >= Quality.High ? 2 : 0;
    if (q < Quality.Medium) return 0;
    if (q === Quality.Medium) return 2;

    // MSAA SAMPLES AND RENDER RESOLUTION BUY THE SAME THING, AND WE WERE PAYING
    // FOR BOTH AT FULL PRICE. The frame budget is 60 fps at 1080p, but `High`
    // and `Ultra` both ship `maxPixelRatio: 2`, so on the retina Mac the budget
    // is written against the composer's input buffer is 3840x2160 — and it is
    // RGBA16F, because the whole grade depends on a half-float HDR buffer. At
    // 4x MSAA that single attachment is 3840 * 2160 * 8 bytes * 4 samples = 265
    // MB, and every fragment of every opaque draw is resolved out of it.
    // Dropping to 2x halves that bandwidth for the entire scene pass, which is
    // the largest single line item in the frame, and it is very close to free
    // visually: at an effective ratio of 1.5 or more each CSS pixel already
    // receives at least 2.25 geometric samples before MSAA is applied at all,
    // and SMAA still runs last on top of the resolve.
    //
    // Below 1.5 there is no supersampling to lean on and the 4 samples are
    // doing real work on the kerb stripes, the railings and the fence posts —
    // the "aliasing crawl on thin geometry" — so they stay.
    return this.effectivePixelRatio() >= 1.5 ? 2 : 4;
  }

  /**
   * Resolution policy. `renderScale` folds into the device pixel ratio, so the
   * canvas keeps its full CSS size and the compositor does the upscale on
   * present — while the internal buffers, the AO targets, the bloom mip chain
   * and the bokeh targets all shrink together.
   */
  private applyResolution(): void {
    if (this.renderer === undefined || this.contextLost) return;
    // See `setXRPresenting` point 2. `renderer.setSize` REFUSES while a device
    // is presenting and logs a warning per call, but `setPixelRatio` assigns
    // its field before calling it — so a rung taken inside a session would move
    // the renderer's idea of the ratio, fail to apply it, and hand the canvas
    // back to the flat page at a size nothing agrees on. The session owns the
    // buffer; `setXRPresenting(false)` pushes everything again on the way out.
    if (this.xrPresenting) return;

    const ratio = this.effectivePixelRatio();

    // NO-OP RESIZES ARE NOT FREE, AND ON A PHONE THERE ARE HUNDREDS OF THEM.
    //
    // `composer.setSize` reallocates the input and output buffers and calls
    // `setSize` on every registered pass, which reallocates the AO targets, the
    // whole bloom mip chain, the bokeh targets and the SMAA buffers. At a
    // handheld's drawing-buffer size that is on the order of 25-30 MB of GPU
    // allocation, and the driver frees the old attachments lazily, so the peak
    // is a multiple of the steady state.
    //
    // iOS Safari fires `resize` continuously while the URL bar collapses or
    // expands, on every rotation, and whenever the on-screen keyboard moves —
    // dozens of events for one gesture, most of which report a size we are
    // already at. Rebuilding every render target in the pipeline dozens of
    // times inside one animation is a memory spike on a device that is already
    // being killed for its footprint, and a stall long enough for the
    // compositor to present a half-drawn surface. Both of the player's reports
    // meet here.
    //
    // The guard compares what we would actually push at the GL side — the
    // drawing-buffer dimensions, not the CSS ones — so a ratio change with the
    // same CSS size still gets through, and a CSS change too small to move the
    // buffer does not.
    // THE BUFFERS ARE SIZED FOR A VIEW, THE CANVAS FOR THE SURFACE, and when
    // there is one view those are the same two numbers. `setViewSize` is what
    // separates them; see it for why it is not read off `ctx.views`.
    const surfW = this.viewSize === null ? this.width : this.viewSize.w;
    const surfH = this.viewSize === null ? this.height : this.viewSize.h;
    const bufW = Math.floor(surfW * ratio);
    const bufH = Math.floor(surfH * ratio);
    const changed = bufW !== this.appliedW || bufH !== this.appliedH || ratio !== this.appliedRatio;
    this.adapter.resolution?.({
      world: this.ctx,
      renderer: this.renderer,
      device: this.device,
      width: this.width,
      height: this.height,
      dynamicScale: this.dynamicScale,
      pixelRatio: ratio,
      bufferWidth: bufW,
      bufferHeight: bufH,
      changed,
    });
    if (bufW === this.appliedW && bufH === this.appliedH && ratio === this.appliedRatio) {
      // The sample count can still move on its own (see below), so it is
      // checked even when the size has not.
      if (this.composer !== null) {
        this.setMultisampling(this.msaaSamples());
        // AND SO CAN THE CHAIN, WITHOUT THE SIZE MOVING. `tryBuild` rebuilds
        // every pass and then calls this, which takes THIS branch whenever the
        // rebuild was a quality change rather than a resize — so a chain that
        // re-resolves screen-pixel values only on the size-changed path below
        // would miss every one of them. The space racer measured the case: a
        // freshly built bloom seeds its mip count from the CSS height, which is
        // the drawing buffer only at pixel ratio 1, and on a retina panel its
        // authored six-level reach silently arrived a level short. Guarded
        // inside the chain, so the common case is one compare.
        this.fx.setSize(bufW, bufH);
      }
      return;
    }
    this.appliedW = bufW;
    this.appliedH = bufH;
    this.appliedRatio = ratio;
    // A resized history is a history of a DIFFERENT IMAGE, so anything the
    // chain has converged is no longer presentable. See `PostChain.invalidate`.
    this.fx.invalidate();

    this.renderer.setPixelRatio(ratio);
    if (this.composer !== null) {
      // Re-evaluated here, not only in `rebuild`, because the sample count is a
      // function of the effective pixel ratio and `devicePixelRatio` can change
      // under us — dragging the window to a non-retina display fires a resize
      // and nothing else.
      this.setMultisampling(this.msaaSamples());
      // The composer resizes its own buffers and every registered pass from
      // the drawing buffer size, which already folds in the pixel ratio.
      this.composer.setSize(surfW, surfH, this.viewSize === null);
      if (this.viewSize !== null) {
        // ---------------------------------------------------------------------
        // TWO CALLS, AND THE ORDER IS THE WHOLE TRICK.
        // ---------------------------------------------------------------------
        // postprocessing's `EffectComposer.setSize` has no way to size its
        // buffers independently of the canvas: it calls `renderer.setSize` and
        // then reads `renderer.getDrawingBufferSize()` for every target and
        // every pass. So the composer is sized at the VIEW — which resizes the
        // canvas to a view, briefly and with `updateStyle` false so no CSS
        // moves — and the canvas is then put back to the whole SURFACE. The
        // targets keep the view's size; the default framebuffer gets the
        // surface's.
        //
        // Reaching into `composer.inputBuffer` / `outputBuffer` / `passes` and
        // sizing them by hand would avoid the second call and is deliberately
        // NOT what this does. Those are postprocessing's internals, `passes`
        // does not include a pass's own private targets — N8AO's depth and
        // normal buffers, the bloom mip chain, the bokeh pair — and a resize
        // that missed those would leave the AO sampling a buffer of the wrong
        // shape, which reads as a smear rather than as an error.
        //
        // THE COST, so nobody has to rediscover it: the canvas is resized twice
        // per resolution change. `applyResolution` is guarded and runs on a
        // layout change, a quality change or a ladder rung — not per frame —
        // and the second `setSize` is against the size the canvas already had
        // before the first, so the compositor sees one net change.
        this.renderer.setSize(this.width, this.height, true);
      }
      // Anything in the chain whose AUTHORED value is stated in SCREEN PIXELS
      // rather than in buffer texels re-resolves here, AFTER the composer has
      // sized its own targets. See `PostChain.setSize`.
      this.fx.setSize(bufW, bufH);
    } else {
      this.renderer.setSize(this.width, this.height, true);
    }
  }

  /**
   * Assigns the composer's sample count only when it genuinely changes.
   *
   * The comment this replaces claimed "the setter is a no-op when the value is
   * unchanged". It is not: postprocessing's setter reads
   *
   *     if (multisampling > 0 && value > 0) { buffer.samples = value; buffer.dispose(); }
   *
   * — an unconditional `dispose()` of the input buffer whenever both the old
   * and the new value are non-zero, which is every assignment on every tier
   * above Low. `dispose()` releases the GPU-side attachment and marks the
   * target for reallocation on next use, so handing the setter the value it
   * already holds throws away a half-float MSAA HDR buffer and builds an
   * identical one. Once per quality change is nothing; once per resize event,
   * on a platform that fires resize events in bursts, is the difference between
   * a steady footprint and a sawtooth.
   */
  /** Forgets what was last pushed, so the next `applyResolution` pushes it all. */
  private invalidateResolutionCache(): void {
    this.appliedRatio = -1;
    this.appliedW = -1;
    this.appliedH = -1;
    this.appliedSamples = -1;
  }

  private setMultisampling(samples: number): void {
    if (this.composer === null || samples === this.appliedSamples) return;
    this.appliedSamples = samples;
    this.composer.multisampling = samples;
  }
}
