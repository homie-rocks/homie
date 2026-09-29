/**
 * ── THE OWNED FRAME CLOCK ────────────────────────────────────────────────────
 *
 * The one thing in a post chain that decides whether a capture of a HELD frame
 * is reproducible, and it is not a look constant. It is the answer to "where
 * does the grain's phase come from".
 *
 * THE BUG THIS EXISTS TO REMOVE, MEASURED. Four of the five post chains this
 * was extracted from seed their film grain off `postprocessing`'s built-in
 * `time` uniform:
 *
 *     float g = krHash12(uv * resolution * 1.37 + fract(time * 0.37) * 977.0);
 *
 * `EffectPass.render` drives that uniform with `material.time += deltaTime *
 * timeScale`, and `deltaTime` is whatever `composer.render(dt)` was handed —
 * in every one of these renderers, a `performance.now()` difference. It is a
 * REAL-TIME clock and no freeze in any of these games has ever touched it.
 *
 * So the harness's freeze did not freeze. Measured on one game — a mature
 * scenario, the reference camera, 1920x1080, ultra, world frozen, two
 * consecutive `page.screenshot()` captures with ZERO simulation advance:
 *
 *     rect (x,y,w,h)          mean |delta|   max |delta|
 *     whole frame               3.2833        123
 *     sky        700,60,400,120 3.4878         24
 *     midground 700,420,400,200 3.1946         70
 *     foreground 400,820,600,200 3.5400        46
 *     leftroad   80,700,360,300 3.7285         55
 *
 * and one `__step(1/60)` apart the whole frame moves 3.5658 — i.e. **the noise
 * floor was 92% of the signal an entire simulated frame produces.** Every
 * ablation and every A/B in that project was read against that floor.
 * That game's draw-budget readout measured the same thing independently
 * (4.53 mean, 96 block max at 1600x900) and worked around it with
 * `setStill(true)`, which removes the grain from the picture entirely — a
 * workaround, not a fix, and one every future measurement has to remember to
 * apply.
 *
 * THE FIX, WHICH THAT GAME SHIPPED AND THIS PACKAGE NOW OWNS: the phase is a
 * uniform the chain owns, and while the world is held it is PINNED to a
 * constant. That buys three things at once:
 *
 *   1. two captures with zero advance are bit-identical, because nothing in the
 *      chain is reading a clock that moves;
 *   2. the grain is still THERE — it is banding cover and it is not optional,
 *      so a still must not simply drop it the way `setStill` does;
 *   3. the pinned phase is the SAME NUMBER in every run and every build, so two
 *      capture sets rsynced from two trees can be subtracted pixel for pixel.
 *      A phase derived from elapsed time — even a freeze-aware one — would
 *      differ between two boots and would leave exactly the floor above.
 *
 * MEASURED AFTER THE FIX on the same game, identical rects, identical staging:
 * the floor is 0.0000 / max 0, i.e. bit-identical, and one `__step(1/60)` apart
 * still moves the frame.
 *
 * ── WHAT THIS MODULE REFUSES ────────────────────────────────────────────────
 *
 * It owns no number. `hz`, `stride`, `stillSeconds` and `wrapSeconds` are all
 * required and none has a default, because each of them is a measurement taken
 * against one game's grain and one game's art direction — one game authors
 * 0.37/977 against a near-black sky, a space racer spends two hashes at
 * 0.37/977 and 0.29/331 through an sRGB round trip. A package that shipped a
 * default for any of them would have picked one game's look for all five, and
 * it would look completely fine. A game that omits one must fail to compile.
 *
 * `@homie-rocks/postfx` owns the `FrameClock` (the owned grain phase) and
 * never owns a threshold, an exposure, a tint or a radius.
 */

/**
 * The numbers a game supplies. Every one is required; see the refusal note
 * above. There is deliberately no `Partial`, no default object and no merge.
 */
export interface FrameClockOptions {
  /**
   * Cycles per second the pattern walks through while the world is live.
   * One game and the three chains it inherited from all author 0.37; that is
   * a coincidence of a shared ancestor, not an agreement, and it is why this
   * is a parameter.
   */
  readonly hz: number;
  /**
   * Spatial stride the phase is spent on, in texels of the pattern's own
   * coordinate space. One wrap of the phase moves the field this far.
   */
  readonly stride: number;
  /**
   * The reading of the clock every held frame is pinned to, in seconds.
   *
   * **A constant, not "wherever the clock happened to stop".** A stopped clock
   * still holds a different value in every run, and a capture set that cannot
   * be subtracted from another run's is exactly the failure this replaces.
   *
   * SECONDS AND NOT A PHASE, which is the one thing this interface changed
   * after its first two consumers. The first consumer's grade spends the clock
   * on exactly ONE term and wanted a pinned phase; the shared grade in
   * `Grade.ts` spends it on SIX — the grain at 0.37, the motion-blur dither at
   * 1.0, and four streak-noise frequencies at 1.6 / 2.4 / 7.5 / 11.0 — so what
   * those chains have to pin is the clock itself, and the phase is derived from
   * it. Nothing is lost: every phase in [0, stride) is reachable from some
   * `stillSeconds` in [0, 1/hz), and the first consumer's authored still phase
   * of 0.0 is `stillSeconds: 0` exactly.
   */
  readonly stillSeconds: number;
  /**
   * Seconds after which the accumulated clock wraps to zero.
   *
   * THIS IS A DECLARED SEAM, NOT A TIDY-UP, and it is required precisely so
   * that it cannot be improvised. Four of the chains this came from already
   * wrapped, by reaching into `pass.fullscreenMaterial.time` and setting it to
   * 0 the moment it passes 600. Nothing reports the jump: *the grain field
   * TELEPORTS ten minutes into a stage*.
   *
   * A wrap is invisible for any term of the form `fract(clock * f)` when
   * `wrapSeconds * f` is a whole number — at 600 both 0.37 (222) and 1.0 (600)
   * qualify, which is why the grain and the aberration dither survive it. It is
   * **visible** for any term that spends the clock raw inside a noise lookup;
   * see `wrapAudit()`, which will tell you which of your frequencies are safe
   * and which are not, rather than leaving you to find out at minute ten.
   */
  readonly wrapSeconds: number;
}

/**
 * The clock. Created once per chain, lives as long as the chain does.
 *
 * Functions by default, and one obvious home: state lives in one place per
 * package, created by exactly one `create*()`, and the public surface is
 * functions. This is that one place for the post chain's time.
 */
export interface FrameClock {
  /**
   * Advances the clock by `dt` seconds unless the world is held, and returns
   * the phase to push into the shader this frame.
   *
   * `held` is an input, not a mode: this module's entire subject is what time
   * means while the world is not moving. A held frame does not advance the
   * accumulator AT ALL — not by a small amount, not by the frame's real dt —
   * because a hold that lasts a hundred compositor frames would otherwise
   * advance a hundred times and the hundredth capture would differ from the
   * first.
   */
  advance(dt: number, held: boolean): number;
  /** The phase pushed by the last `advance`, without advancing again. */
  phase(): number;
  /**
   * The clock reading the last `advance` settled on, in seconds — pinned to
   * `stillSeconds` while held, wrapped while live.
   *
   * This is what a grade that spends its clock at more than one frequency
   * pushes into the shader, in place of `postprocessing`'s built-in `time`.
   * `phase()` above is the single-frequency convenience derived from it.
   */
  seconds(): number;
  /** Accumulated live seconds, after wrapping. Diagnostics and harnesses. */
  elapsed(): number;
  /** Back to the beginning. A rebuilt chain has no history and no clock. */
  reset(): void;
}

/**
 * Builds a frame clock. Throws — loudly, at construction — rather than
 * defaulting anything.
 *
 * A catch-all that returns a plausible default is worse than a crash. A clock
 * that silently defaulted `hz` to 0.37 would report a perfectly good picture
 * in the wrong game's grain, and nothing would ever go red.
 */
export function createFrameClock(opts: FrameClockOptions): FrameClock {
  requireFinite(opts.hz, 'hz');
  requireFinite(opts.stride, 'stride');
  requireFinite(opts.stillSeconds, 'stillSeconds');
  requireFinite(opts.wrapSeconds, 'wrapSeconds');
  if (opts.wrapSeconds <= 0) {
    throw new RangeError(`@homie-rocks/postfx: wrapSeconds must be > 0, got ${opts.wrapSeconds}`);
  }

  // Mutation, contained, inside what is effectively a frame loop, and the
  // reason belongs in a comment: `advance` runs
  // once per drawn frame at 60 Hz for the life of a stage, and allocating a
  // fresh state object per frame is a GC pause a person can see.
  let clock = 0;
  let reading = opts.stillSeconds;

  return {
    advance(dt: number, held: boolean): number {
      if (!held) {
        // `Math.max(0, dt)` and not `dt`: a `performance.now()` difference
        // across a tab that was backgrounded and restored can arrive negative
        // on some platforms, and a clock that can run backwards is a clock two
        // captures can disagree about while both being "live".
        clock += Math.max(0, Number.isFinite(dt) ? dt : 0);
        // The declared wrap. Modulo rather than a compare-and-zero, so the
        // seam lands at the same phase every wrap instead of at whatever the
        // frame happened to overshoot to — the difference between a seam you
        // can subtract two capture sets across and one you cannot.
        if (clock >= opts.wrapSeconds) clock %= opts.wrapSeconds;
      }
      // THE PINNED PRIMITIVE IS THE CLOCK READING, and the phase is derived
      // from it. Pinning the phase alone would leave any OTHER term the shader
      // drives off the same clock still walking through a hold — which is what
      // four of the five original chains do — and nothing would say so.
      reading = held ? opts.stillSeconds : clock;
      return ((reading * opts.hz) % 1) * opts.stride;
    },
    phase: () => ((reading * opts.hz) % 1) * opts.stride,
    seconds: () => reading,
    elapsed: () => clock,
    reset(): void {
      clock = 0;
      reading = opts.stillSeconds;
    },
  };
}

/** One term of a grade shader that spends the clock. See {@link wrapAudit}. */
export interface ClockTerm {
  /** Cycles per second this term walks at. */
  readonly hz: number;
  /**
   * Whether the shader wraps this term in `fract()` before it uses it.
   *
   * **This is the field that decides everything**, and getting it from the
   * caller rather than guessing is the point. `fract(clock * 0.37) * 977.0` —
   * the grain — is periodic in the clock, so a wrap at a whole number of turns
   * is invisible. `krValueNoise(ang * 26.0 + clock * 1.6)` — the streak noise in
   * `Grade.ts` — spends the clock RAW inside a noise
   * lookup that has no period at all, so **no** wrap is invisible for it. The
   * first survives 600 s; the second pops at 600 s and would pop at any other
   * number too. An audit that only compared `wrapSeconds * hz` against a whole
   * number would call the second one seamless, which is the answer that reads
   * fine and is wrong.
   */
  readonly fract: boolean;
}

/**
 * Which of a chain's time-driven terms survive its wrap, and which pop.
 *
 * Call it once at build time and log what it returns. This does not fix a pop.
 * It **names** it, which is the whole difference between *"the grain field
 * TELEPORTS ten minutes into a stage and nothing reports it"* and a number
 * somebody can decide about. Returning the lists rather than
 * throwing is deliberate: three shipped chains wrap visibly today, and a throw
 * would take the picture away rather than tell anybody about it.
 */
export function wrapAudit(
  wrapSeconds: number,
  terms: readonly ClockTerm[],
): { seamless: number[]; pops: number[] } {
  const seamless: number[] = [];
  const pops: number[] = [];
  for (const t of terms) {
    const turns = wrapSeconds * t.hz;
    // A RELATIVE tolerance, and it has to be relative. 600 * 0.37 is
    // 222.00000000000003 in IEEE754 doubles, so an exact test calls the one
    // frequency here that IS seamless a pop; and 600 * 1.6 is
    // 960.0000000000001, so a fixed 1e-6 absolute tolerance passes any large
    // product at all and the audit degenerates into "yes".
    const whole = Math.abs(turns - Math.round(turns)) <= Math.abs(turns) * 1e-12 + 1e-12;
    (t.fract && whole ? seamless : pops).push(t.hz);
  }
  return { seamless, pops };
}

/**
 * The belt-and-braces half, and it is not decoration.
 *
 * `postprocessing` accumulates `material.time += deltaTime * timeScale` on
 * every `EffectPass`, and that uniform is visible to any effect compiled into
 * the pass. Once a chain's grain reads the owned phase instead, the NEXT effect
 * somebody adds inherits the identical un-freezable clock and the identical
 * silent corruption, and nothing says so. Zeroing the scale while held means an
 * effect that reads `time` is frozen **by default** and has to opt out.
 *
 * Duck-typed on `{ timeScale?: number }` rather than importing `postprocessing`
 * — this package has `three` as a peer and no business taking a second one for
 * one field. Returns how many passes it actually touched, so a harness can tell
 * "every pass was frozen" from "there were no passes".
 */
export function holdPassClocks(
  passes: Iterable<{ timeScale?: number }>,
  held: boolean,
): number {
  let touched = 0;
  for (const pass of passes) {
    if (typeof pass.timeScale === 'number') {
      pass.timeScale = held ? 0 : 1;
      touched++;
    }
  }
  return touched;
}

function requireFinite(v: number, name: string): void {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(
      `@homie-rocks/postfx: FrameClockOptions.${name} must be a finite number, got ${String(v)}. `
        + 'This package owns no look constant and will not default one — see the header.',
    );
  }
}
