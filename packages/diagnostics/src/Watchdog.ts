/**
 * ============================================================================
 *  @homie-rocks/diagnostics/Watchdog.ts — self-diagnosis, and the thing that ACTS on
 *  it, for "the HUD works but the world is missing".
 * ============================================================================
 *  Reported by several players on Chromium browsers while the same build runs
 *  fine elsewhere. The screenshot shows a live HUD — timer counting, minimap
 *  drawing, standings updating — over a flat dark page background. So the game
 *  loop is running and only the 3D scene is absent, which is a rendering
 *  failure, not a crash.
 *
 *  WHAT THE OLD WATCHDOG COULD NOT SEE, MEASURED.
 *  ---------------------------------------------------------------------------
 *  This used to watch one number: draw calls submitted by the scene pass. Four
 *  of the five failure modes were reproduced on real hardware by forcing the
 *  driver to misbehave, and the draw-call count survived ALL of them:
 *
 *     forced failure                     scene draws   frame on screen
 *     none (control)                        234        lit 0.91, luma sd 63.6
 *     draw calls silently dropped           179        canvas never painted
 *     RGBA16F attachment refused            222        canvas never painted
 *     PBR shader family rejected            234        white void, sd 11.1
 *     float extensions withheld             197        91% of pixels below 12
 *
 *  Every one of those is the player's screenshot, and in every one of them the
 *  old watchdog stayed silent, because three counts a draw call whether or not
 *  the GPU rasterises anything. Draw calls are a proxy for the thing we care
 *  about and they are a bad one. So there are three detectors, and each of them
 *  ACTS rather than merely announcing:
 *
 *  1. **The presented image itself.** Two strips of the finished frame are read
 *     back — inside the same task that drew it, before the compositor takes the
 *     surface, which is the only moment the default framebuffer can be read
 *     without `preserveDrawingBuffer` — and scored for luma spread. A frame
 *     with no structure in it is not a frame. This is the only detector that
 *     cannot be fooled, because it looks at what the player looks at.
 *  2. **Shader link failures.** three logs one and then carries on with a
 *     material that never draws; if the family that failed is the one the world
 *     is made of, the world silently disappears. Caught here and escalated.
 *  3. **The draw-call watchdog**, kept, because it is the one that catches a
 *     scene graph that genuinely stopped submitting.
 *
 *  Acting means calling into the render pipeline to force it down a rung —
 *  half-float composer, 8-bit composer, direct render, simple materials, flat
 *  materials — and re-checking. The banner is the LAST resort, shown only when
 *  even the simplest path draws nothing.
 *
 *  `?debug=gl` and `__gl()` still print one copy-pasteable block, now including
 *  the capability probe and the full degrade log, so a report that does arrive
 *  says exactly which rung the pipeline ended on and why.
 *
 *  ---------------------------------------------------------------------------
 *  EXTRACTED, NOT REWRITTEN. This was `src/core/Diagnostics.ts` in two games
 *  (a first-person shooter and a kart racer), which differed by SIX lines —
 *  two comment, four code, ZERO structural — and all four of the code lines
 *  were `BLANK_SD` and `BLANK_LIT`. Those are now supplied by the game
 *  (`WatchdogOptions.thresholds`) and the predicate itself lives in
 *  `FrameHealth.ts`, pure and exported, so a harness drives the shipped test
 *  rather than a copy of it.
 *
 *  ---------------------------------------------------------------------------
 *  A LATER REVIEW OVERTURNED HALF OF AN EARLIER REFUSAL.
 *
 *  Two more games' versions (a space racer's and a base-building game's) were
 *  at first NOT folded in: measured at 17% and 22% structural divergence, and
 *  the space racer carries a wall-clock `BLANK_HOLD_S` hold fitted to an
 *  eclipse arc. Forcing them together looked like the solveTyre/solveAxle
 *  mistake.
 *
 *  That was wrong about the space racer: the divergence was **a mechanism
 *  worth a dozen lines and two numbers**, not opposite behaviour under one
 *  name. Read side by side, the two files agreed line for line on all three
 *  detectors, the escalation order, the report and the banner; what the space
 *  racer had that this did not was a HOLD — the blank condition must persist
 *  on the wall clock for longer than the world can legitimately be dark before
 *  anything is acted on. That is not a second implementation of a watchdog. It
 *  is a capability this package lacked, and every consumer gains it:
 *  `WatchdogSchedule` below.
 *
 *  `solveTyre`/`solveAxle` is a refusal because the two clamp in OPPOSITE
 *  ORDERS and a shared solve quietly makes one game drive like the other. There
 *  is no such inversion here: `held < blankHoldS` at `blankHoldS: 0` is false
 *  on the first sample, so the games that never had a hold run the identical
 *  expression they always ran, with no branch to read.
 *
 *  The base-building game's version IS still a different file wearing the
 *  same name and is NOT folded in. That refusal stands.
 * ============================================================================
 */

import { classifyFrame, type FrameThresholds } from './FrameHealth.ts';
import type { FrameHost, FrameSample } from './Host.ts';
import { pipeline } from './Host.ts';
import {
  interceptConsoleShaderErrors, logPipeline, readPipelineLog, readShaderErrors,
  failedMaterialNames, worldMaterialsFailed,
} from './PipelineLog.ts';

export interface GLReport {
  vendor: string;
  renderer: string;
  version: string;
  glsl: string;
  contextAttributes: WebGLContextAttributes | null;
  /** the ones this pipeline actually needs, and whether they are present */
  extensions: Record<string, boolean>;
  limits: Record<string, number>;
  quality: number;
  pixelRatio: number;
  drawCalls: number;
  programs: number;
  shaderErrors: string[];
  composer: boolean;
  /** which rung of the fallback ladder the pipeline is running on */
  rung: string;
  /** every capability decision and every degrade, in order */
  pipelineLog: string[];
  /** the boot capability probe, verbatim */
  capabilities: unknown;
  /** luma statistics of the last frame actually sampled off the canvas */
  frameSample: FrameSample | null;
  userAgent: string;
}

/** Extensions the render pipeline genuinely leans on, and why. */
const NEEDED = [
  'EXT_color_buffer_half_float', // HDR composer buffer; without it the grade clips
  'EXT_color_buffer_float',
  'OES_texture_float_linear',    // smooth sampling of float targets (PMREM, AO)
  'EXT_texture_filter_anisotropic',
  'WEBGL_debug_renderer_info',
  'KHR_parallel_shader_compile', // only affects pre-warm speed
];

const QUIET_FRAMES = 90;

/**
 * Frames to wait before the first look at the presented image, and between
 * looks after that.
 *
 * `readPixels` on the default framebuffer is a synchronous stall — it is the
 * one thing in this file with a real cost — so it happens a handful of times
 * in the life of the page and never in a steady state. Two clean samples and
 * the detector retires for good: on hardware that works this costs two stalls
 * during the title screen and nothing ever again.
 */
const FIRST_LOOK = 150;
const LOOK_INTERVAL = 75;
/** Clean samples before the detector retires. */
const CLEAN_STREAK = 2;
/** Frames after boot before any detector is allowed an opinion. */
const SETTLE_FRAMES = 120;

/**
 * The scheduling constants that are the SAME THING in every consumer, published
 * so a harness reads them instead of copying them.
 *
 * `BLANK_STREAK` and `DEAD_CALLS` USED TO BE HERE AND ARE NOT ANY MORE. They
 * left because they are not the same thing in every consumer, and two separate
 * consumers proved it independently:
 *
 *   · `DEAD_CALLS = 4` encodes *a scene is hundreds of objects*, which was
 *     true of all four consumers at the time and **is not a property of a
 *     scene**. One small lakeside game had to pin `frustumCulled = false` on
 *     its lake so a five-object scene could not be culled to four and be
 *     declared a dead renderer.
 *   · a space racer shipped `BLANK_STREAK = 3` and a wall-clock hold beside
 *     it, because 0.272 of every lap is inside a planet's shadow cone.
 *
 * Both are now `WatchdogSchedule` fields the game supplies. See there.
 */
export const WATCHDOG_SCHEDULE = {
  QUIET_FRAMES, FIRST_LOOK, LOOK_INTERVAL, CLEAN_STREAK, SETTLE_FRAMES,
} as const;

/**
 * THE THREE NUMBERS THAT ARE A FACT ABOUT THIS GAME'S WORLD, NOT ABOUT
 * RENDERERS. Every one is required; there is no default and no `Partial`.
 *
 * A default here would be one game's world silently deciding another game's
 * degrade policy, and — the reason this is required rather than merely
 * parameterised — **it would look completely fine**. A watchdog that downgrades
 * a healthy pipeline prints a plausible console line and hands the player a
 * worse picture; a watchdog that never fires prints nothing at all. Neither is
 * visible from the outside, so the only place the answer can be checked is at
 * the call site, in the game that knows its own dark.
 */
export interface WatchdogSchedule {
  /**
   * Consecutive blank SAMPLES before the blank condition is believed at all.
   *
   * A transition can legitimately be black, so this is never 1. The shooter
   * and the kart racer ship 2; the space racer ships 3 because its eclipse arc
   * can produce two in a row without anything being wrong.
   */
  readonly blankStreak: number;
  /**
   * Seconds the blank condition must hold CONTINUOUSLY, on the WALL CLOCK,
   * before it is acted on. `0` is "act as soon as `blankStreak` is reached",
   * which is what the shooter and the kart racer have always done.
   *
   * WALL CLOCK AND NOT A SAMPLE COUNT, and the difference is not cosmetic:
   * `LOOK_INTERVAL` is in FRAMES, so on a machine limping at 12 fps a fixed
   * count of samples is a five-fold longer wait. What this number has to
   * outlast is an arc of the real world — the space racer's own derivation is
   * "0.272 of a 29-33 s lap plus one 2.6 s respawn taken inside it = ~11.6 s
   * worst case", so it ships 12.
   *
   * It is what makes a THIN margin safe. The space racer's `blankSd` separation
   * between a legitimate eclipse frame and a dead one is 2x, not the 16x a
   * golden-hour racer enjoys; a detector with a 2x margin that acts instantly
   * is a detector that will act on a healthy player, mid-race, every time they
   * look at the planet.
   */
  readonly blankHoldS: number;
  /**
   * At or below this many scene draw calls, nothing meaningful was submitted.
   *
   * This field's whole justification: as a module constant of 4 it declared a
   * five-object world a dead renderer and silently deleted a healthy effect
   * chain. "How many draws is suspiciously few" is a property of
   * the SCENE, and only the game knows how many objects its scene has.
   */
  readonly deadCalls: number;
}

export interface WatchdogOptions {
  /** the five numbers this game fitted against its own art direction */
  readonly thresholds: FrameThresholds;
  /** the three numbers that are a fact about this game's world */
  readonly schedule: WatchdogSchedule;
  /**
   * The bracketed prefix on every console line this file writes, e.g. `racer`.
   *
   * A value, because it is the first word a player copies into a report and it
   * has to name the game they were playing. It is not a mode: nothing branches
   * on it.
   */
  readonly label: string;
}

export class Diagnostics {
  private quiet = 0;
  private announced = false;
  /** set once the image detector is satisfied; it never runs again */
  private frameProven = false;
  private nextLook = FIRST_LOOK;
  private blankStreak = 0;
  /**
   * `ctx.time` at which the current unbroken run of blank samples started, or
   * -1 when the last sample had a picture in it. Wall-clock rather than a
   * sample count — see `WatchdogSchedule.blankHoldS`.
   */
  private blankSince = -1;
  private cleanStreak = 0;
  private lastSample: FrameSample | null = null;
  private materialsEscalated = false;
  private singleShaderNoted = false;
  /** frame number before which a fresh degrade is given time to take effect */
  private settleUntil = 0;

  private readonly t: FrameThresholds;
  private readonly s: WatchdogSchedule;
  private readonly tag: string;

  constructor(opts: WatchdogOptions) {
    this.t = opts.thresholds;
    this.s = opts.schedule;
    this.tag = opts.label;
    // REFUSED AT THE DOOR RATHER THAN DIVIDED BY, for the same reason
    // `@homie-rocks/render`'s `PipelineLook.shadowCascadeInterval` is: a `blankStreak` of 0 or NaN
    // makes `++this.blankStreak < this.s.blankStreak` false on the first blank
    // sample and the hold the game asked for silently disappears, leaving a
    // detector that fires on the first dark frame of an eclipse. Nothing throws
    // and nothing logs; the player just gets a worse picture. A crash gets
    // fixed, a plausible default gets quoted.
    requirePositive(this.s.blankStreak, 'blankStreak');
    requireFiniteAtLeastZero(this.s.blankHoldS, 'blankHoldS');
    requireFiniteAtLeastZero(this.s.deadCalls, 'deadCalls');
  }

  init(ctx: FrameHost) {
    (window as any).__gl = () => this.report(ctx);

    /**
     * Harness-facing surface, and the reason `classifyFrame` is pure.
     *
     * It hands out the PRODUCTION predicate and the PRODUCTION constants, so a
     * fitter can push a synthetic frame of known ground truth through the exact
     * code a player runs. Anything less and the harness is validating a second
     * implementation that agrees with this one only by luck.
     *
     * The space racer has had this handle since it wrote its threshold
     * fitter; the shooter and the kart racer never did, which is why nobody
     * could re-fit their thresholds without editing the game. Added when the
     * watchdog moved into this package.
     */
    (window as any).__frameDetector = {
      classify: (s: FrameSample) => classifyFrame(s, this.t),
      constants: this.t,
      /**
       * The three world facts, published beside the four thresholds.
       *
       * The space racer's threshold fitter prints `blankHoldS` in its
       * separation table and its whole argument depends on it — the two
       * numbers only make sense together, because a thin `blankSd` margin is
       * safe if and only if a hold covers it. A harness that could read one and
       * not the other would print half of a decision.
       */
      schedule: this.s,
      /** the live reading, so a run can be attributed to a real frame */
      sample: () => pipeline()?.sampleFrame() ?? null,
    };

    interceptConsoleShaderErrors();

    if (new URLSearchParams(location.search).get('debug') === 'gl') {
      // Give the scene a few frames to build before reporting.
      setTimeout(() => this.print(ctx), 3000);
    }
    console.info(
      `%c[${this.tag}] if the world is missing but the HUD is visible, run __gl() and send the output.`,
      'color:#8ab4ff',
    );
  }

  /**
   * Called immediately after the present, inside the same frame, with the
   * draw-call count of the scene pass.
   *
   * The order below is the order of confidence. A shader family that failed to
   * link is a KNOWN cause with a known remedy, so it is acted on first and
   * without waiting for the picture to prove it; the image check is the
   * backstop for everything we did not anticipate.
   */
  afterPresent(ctx: FrameHost, sceneCalls: number) {
    if (this.announced) return;
    // Only meaningful once the game believes it is showing a world.
    if (ctx.frame < SETTLE_FRAMES) return;

    if (this.checkShaders(ctx)) return;
    if (this.checkImage(ctx)) return;
    this.checkDrawCalls(ctx, sceneCalls);
  }

  // -- detector 1: a material family the world is made of failed to link -----
  private checkShaders(ctx: FrameHost): boolean {
    if (this.materialsEscalated) return false;
    const n = worldMaterialsFailed();
    if (n === 0) return false;
    if (n === 1) {
      // ONE failure is not evidence of a systemic one, and the remedy — every
      // material in the game replaced with an untextured variant — is far too
      // expensive to spend on a single prop's shader. Say so once, in the
      // report, and leave the picture alone. The boot trial is what catches the
      // systemic case, and it catches it before the world is even built.
      if (!this.singleShaderNoted) {
        this.singleShaderNoted = true;
        logPipeline('shader-error', `one material failed to compile (${failedMaterialNames()[0]}); ` +
          'not enough to be systemic, so the pipeline is left alone — expect that object to be missing');
      }
      return false;
    }
    this.materialsEscalated = true;
    const names = failedMaterialNames().join(', ');
    const why = `${n} world material families failed to compile on this GPU (${names})`;
    logPipeline('shader-error', why);
    const p = pipeline();
    if (p !== null && p.degradeToSafeMaterials(why)) {
      this.settleUntil = ctx.frame + LOOK_INTERVAL;
      this.blankStreak = 0;
      this.blankSince = -1;
      // Not proven yet — the image detector below now has to confirm the
      // simpler material actually draws.
      this.frameProven = false;
      this.nextLook = ctx.frame + LOOK_INTERVAL;
      return true;
    }
    return false;
  }

  // -- detector 2: the presented image has no picture in it ------------------
  private checkImage(ctx: FrameHost): boolean {
    if (this.frameProven) return false;
    if (ctx.frame < this.nextLook || ctx.frame < this.settleUntil) return false;
    this.nextLook = ctx.frame + LOOK_INTERVAL;

    const p = pipeline();
    const sample = p?.sampleFrame() ?? null;
    this.lastSample = sample;
    if (sample === null || !sample.ok) {
      // The read itself failed. That is not evidence of a blank frame, and
      // guessing from it would risk downgrading a machine that is fine — but it
      // does mean the best detector in the file is unavailable here, which a
      // report needs to say out loud.
      logPipeline('image', 'the frame could not be read back; falling back to the draw-call watchdog');
      this.frameProven = true;
      return false;
    }
    if (this.cleanStreak === 0 && this.blankStreak === 0) {
      logPipeline('image', `first look: luma mean ${sample.mean.toFixed(1)}, ` +
        `spread ${sample.sd.toFixed(1)}, ${(sample.lit * 100).toFixed(0)}% lit`);
    }

    const verdict = classifyFrame(sample, this.t);
    if (!verdict.blank && !verdict.flat) {
      this.blankStreak = 0;
      this.blankSince = -1;
      if (++this.cleanStreak >= CLEAN_STREAK) this.frameProven = true;
      return false;
    }

    this.cleanStreak = 0;
    this.blankStreak++;
    if (this.blankSince < 0) this.blankSince = ctx.time;
    const held = ctx.time - this.blankSince;

    // TWO CONDITIONS, AND THE SECOND ONE IS THE DARK-WORLD GUARD. A run of
    // blank samples that has not yet outlasted `blankHoldS` is not evidence of
    // anything in a game that has a legitimate dark arc — a planet's shadow
    // cone in a space racer produces exactly this reading and it is CORRECT there. A game with
    // no such arc ships `blankHoldS: 0` and this term is `held < 0`, which is
    // false on the first sample: the expression is unchanged and there is no
    // branch to read. Same shape as `FrameHealth`'s `flatSpan: Infinity`.
    //
    // Returning `true` while waiting is deliberate — it suppresses the
    // draw-call watchdog for the same frames, which would otherwise reach the
    // same wrong conclusion from a different direction.
    if (this.blankStreak < this.s.blankStreak || held < this.s.blankHoldS) {
      if (this.blankStreak === this.s.blankStreak && this.s.blankHoldS > 0) {
        logPipeline('image', `${verdict.reason}; holding for ` +
          `${this.s.blankHoldS}s before acting, because this world can legitimately look like this`);
      }
      return true;
    }
    this.blankStreak = 0;
    this.blankSince = -1;

    const why = this.s.blankHoldS > 0
      ? `nothing has reached the screen for ${held.toFixed(1)}s — longer than this world can `
        + `legitimately stay dark (luma mean ${sample.mean.toFixed(1)}, `
        + `spread ${sample.sd.toFixed(2)}, ${(sample.lit * 100).toFixed(2)}% lit)`
      : `nothing is reaching the screen (luma mean ${sample.mean.toFixed(1)}, `
        + `spread ${sample.sd.toFixed(1)}, ${(sample.lit * 100).toFixed(0)}% lit)`;
    if (p !== null && p.degrade(why)) {
      this.settleUntil = ctx.frame + LOOK_INTERVAL;
      return true;
    }
    this.fail('The GPU accepted every frame and drew none of them.', ctx);
    return true;
  }

  // -- detector 3: the scene stopped submitting anything ---------------------
  private checkDrawCalls(ctx: FrameHost, sceneCalls: number) {
    this.quiet = sceneCalls <= this.s.deadCalls ? this.quiet + 1 : 0;
    if (this.quiet < QUIET_FRAMES) return;
    this.quiet = 0;

    const why = `the scene submitted ${sceneCalls} draw calls for ${QUIET_FRAMES} frames`;
    const p = pipeline();
    if (p !== null && p.degrade(why)) {
      this.settleUntil = ctx.frame + LOOK_INTERVAL;
      this.frameProven = false;
      this.nextLook = ctx.frame + LOOK_INTERVAL;
      // The image detector is being re-armed, so its wall-clock hold starts
      // again from the next blank sample rather than from one taken before a
      // degrade that has just changed what is on screen.
      this.blankSince = -1;
      return;
    }
    this.fail('The scene is not being submitted to the GPU.', ctx);
  }

  /** Last resort: every rung has been tried and nothing draws. */
  private fail(what: string, ctx: FrameHost) {
    if (this.announced) return;
    this.announced = true;
    const r = this.report(ctx);
    const why = r.shaderErrors.length > 0
      ? 'Some shaders failed to compile on this GPU.'
      : !r.extensions['EXT_color_buffer_half_float'] && !r.extensions['EXT_color_buffer_float']
        ? 'This GPU cannot render to a floating-point buffer.'
        : what;
    logPipeline('give-up', why);
    console.error(`[${this.tag}] THE WORLD IS NOT BEING DRAWN.`, why, r);
    this.banner(why);
  }

  private banner(why: string) {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); z-index:200;
      max-width:min(560px,86vw); padding:22px 26px; border-radius:16px; text-align:center;
      background:rgba(14,10,8,.93); border:1.5px solid rgba(255,190,120,.45); color:#f6efe4;
      font:500 15px/1.55 system-ui,-apple-system,sans-serif; box-shadow:0 18px 50px rgba(0,0,0,.6);
    `;
    el.innerHTML =
      `<div style="font-weight:800;font-size:18px;letter-spacing:.02em;margin-bottom:8px">
         Graphics could not start
       </div>
       <div style="opacity:.85">${why}</div>
       <div style="opacity:.6;margin-top:12px;font-size:13px">
         Every simpler renderer was tried too. Open the console and run
         <code style="background:rgba(255,255,255,.1);padding:2px 6px;border-radius:5px">__gl()</code>,
         then send the output.
       </div>`;
    document.body.appendChild(el);
  }

  report(ctx: FrameHost): GLReport {
    const renderer = ctx.renderer;
    const gl = renderer?.getContext() as WebGL2RenderingContext | undefined;
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    const ext: Record<string, boolean> = {};
    for (const name of NEEDED) ext[name] = !!gl?.getExtension(name);

    const limits: Record<string, number> = {};
    if (gl) {
      limits.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      limits.maxTextureUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
      limits.maxVertexUniforms = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS);
      limits.maxFragmentUniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
      limits.maxVaryings = gl.getParameter(gl.MAX_VARYING_VECTORS);
      limits.maxSamples = gl.getParameter(gl.MAX_SAMPLES);
      limits.maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    }

    const p = pipeline();
    return {
      vendor: dbg && gl ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : 'unknown',
      renderer: dbg && gl ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown',
      version: gl ? String(gl.getParameter(gl.VERSION)) : 'no context',
      glsl: gl ? String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)) : '-',
      contextAttributes: gl?.getContextAttributes() ?? null,
      extensions: ext,
      limits,
      quality: ctx.settings?.quality ?? -1,
      pixelRatio: renderer?.getPixelRatio?.() ?? 0,
      drawCalls: renderer?.info.render.calls ?? 0,
      programs: renderer?.info.programs?.length ?? 0,
      shaderErrors: readShaderErrors(),
      composer: !!(globalThis as any).__render?.composer,
      rung: p?.rungName() ?? 'unknown',
      pipelineLog: readPipelineLog().slice(),
      capabilities: p?.capabilities() ?? null,
      frameSample: this.lastSample,
      userAgent: navigator.userAgent,
    };
  }

  private print(ctx: FrameHost) {
    const r = this.report(ctx);
    console.info(`%c[${this.tag}] GL report — copy everything below`, 'color:#ffb020;font-weight:bold');
    console.info(JSON.stringify(r, null, 2));
  }
}

/* ========================================================================== */
/* The two door guards. See the constructor for why they throw.               */
/* ========================================================================== */

function requirePositive(v: number, name: string): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) {
    throw new RangeError(
      `@homie-rocks/diagnostics: WatchdogSchedule.${name} must be a finite number >= 1, got ${String(v)}. `
        + 'This package owns no fact about your world and will not default one — see the interface.',
    );
  }
}

function requireFiniteAtLeastZero(v: number, name: string): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new RangeError(
      `@homie-rocks/diagnostics: WatchdogSchedule.${name} must be a finite number >= 0, got ${String(v)}. `
        + 'This package owns no fact about your world and will not default one — see the interface.',
    );
  }
}
