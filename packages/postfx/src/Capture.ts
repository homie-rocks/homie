/**
 * ── THE CAPTURE PROTOCOL ────────────────────────────────────────────────────
 *
 * The outcome this file is authoritative for, in one sentence:
 *
 *   **Screenshot one held frame twice and the two files are the same bytes.**
 *
 * It is the first requirement of any work on the picture, because it gates
 * every other one rather than because it is the prettiest:
 *
 *   > You cannot attribute a moved frame to a commit while two captures of the
 *   > *same* frame differ.
 *
 * `Clock.ts` is one half — no clock in the chain may move while the world is
 * held. This file is the other half: **no accumulator in the chain may depend
 * on how many times the compositor happened to draw.**
 *
 * ── WHY "CONVERGE N FRAMES THEN STOP ADVANCING" WAS REJECTED ─────────────────
 * (From the note in the space racer this came from, because it was the
 * obvious answer and it is wrong.)
 *
 * Nothing in the capture path controls WHEN the shutter fires relative to the
 * draw loop: the capture harness raises `__freeze` in one CDP round trip and
 * screenshots in another, the tear-retry loop shoots again after an arbitrary
 * number of rAFs, and a render-drift check deliberately draws 12 more and
 * shoots a third time. A scheme that is only reproducible after N drawn frames
 * is reproducible if and only if the compositor cooperates, which is exactly
 * the class of bug this removes.
 *
 * ── SO THE CONVERGENCE IS A UNIT OF WORK, NOT A NUMBER OF FRAMES ────────────
 *
 * The first held frame of a hold runs the chain `samples` times over the frozen
 * scene, stepping the jitter sequence from position 0 to position N-1 and
 * accumulating each result into the history at weight `1 - 1/k` — an exact
 * unweighted running mean, so what the history ends up holding is the mean of
 * all N jitter positions. Every held frame after that PRESENTS that history
 * unchanged, so the first held draw of a hold and the hundredth produce the
 * same image and the harness may fire the shutter whenever it likes.
 *
 * THIS IS NOT "TEMPORAL AA OFF FOR CAPTURES", and it must not be. Sub-pixel
 * geometry — a space racer's 30-90 mm handrail stanchions and truss diagonals
 * at 1080p — prints as a dashed chain of beads at one shading sample per pixel,
 * and killing the resolve for the capture path would photograph the specular
 * aliasing storm that took a whole iteration to remove. The capture runs MORE
 * of the temporal filter than a live frame does, not less: same pass, same
 * variance clip, same tone space, N positions guaranteed rather than N
 * positions if you happened to be standing still.
 *
 * ── WHY THE PRESENT IS A SEPARATE DRAW ──────────────────────────────────────
 *
 * Because it makes the second, third and hundredth held draw of one hold
 * bit-identical to the first WITHOUT REDOING THE ACCUMULATION, and that turned
 * out to be a correctness requirement rather than a saving.
 *
 * Re-converging on every held draw was the first shape of it. It is
 * reproducible, and it costs N+1 scene renders every held frame — which
 * measured over the frame watchdog's stall threshold, so the watchdog dropped
 * the next live present. How many held frames a hold contains is decided by the
 * compositor, so the number of dropped presents was decided by the wall clock,
 * and both the grade's clock and the live history advance per present. Two runs
 * therefore reached the shutter with decorrelated film grain: **measured over
 * four shots, the A/A difference was 5.07/765 across 88% of pixels**, on a pair
 * whose `stateHash` and simulated frame counts were identical.
 *
 * ── HOW THIS FILE IS SHAPED, AND WHY IT TAKES CALLBACKS ─────────────────────
 *
 * Everything here is control flow over a `HeldFrameChain` the consumer
 * implements. No `three`, no `postprocessing`, no `window` — this package's
 * boundary rule forbids the last one by name, and the first two would make
 * the protocol untestable anywhere without a GPU. The consumer
 * supplies the five verbs; this file decides the order, the weights, and what
 * happens in the `finally`.
 */

/**
 * The exponential feedback weight for accumulation sub-draw `i` of a converging
 * held frame.
 *
 * THE SCHEDULE IS `1 - 1/k`, WHICH IS A RUNNING MEAN AND NOT A TUNING. Sub-draw
 * 1 takes the frame whole (the history was just discarded, so the pass's own
 * first-frame gate does this anyway); sub-draw 2 mixes half and half; sub-draw
 * k contributes 1/k. Unrolled, every one of the N samples ends up carrying
 * exactly 1/N of the history, so what the accumulation leaves behind is the
 * unweighted mean of N jitter positions.
 *
 * A live chain's feedback — one space racer authors 0.92 — is the right number
 * for a live frame, because it is a filter with a memory of the frames before
 * it. It is the wrong number here: **a fixed exponential weight never reaches a
 * fixed point, and "never reaches a fixed point" is the defect.**
 */
export function captureFeedback(i: number): number {
  return i === 0 ? 0 : 1 - 1 / (i + 1);
}

/**
 * The five verbs a consumer implements. Each is one already-shipped line or two
 * in the game's own `PostFX`; this package does not reimplement any of them.
 */
export interface HeldFrameChain {
  /**
   * How many accumulation sub-draws a held frame needs before it can present.
   *
   * **Zero when there is nothing per-draw to converge** — no temporal resolve
   * in the chain at all, or a quality rung below the one that builds it. A held
   * frame is then already a pure function of the frozen world and the loop
   * would be identical draws. The kart racer and the first-person shooter this
   * came from return 0 here: their chains carry a reprojection motion blur
   * rather than an accumulating resolve, so their whole capture obligation is
   * `beginCapture`'s history discard.
   */
  samples(): number;
  /**
   * Opens the accumulation: throw the history away and start the sequence at
   * position 0. The reset is what makes the result independent of everything
   * that was ever drawn before it, which is the property the whole exercise is
   * for — including for a chain whose `samples()` is 0, where discarding a
   * history built from frames before a harness teleported the camera is the
   * difference between a clean shot and a viewmodel smeared across half of it.
   */
  beginCapture(): void;
  /** Prepares accumulation sub-draw `i`, at jitter position `i`, weight `w`. */
  captureSubframe(i: number, feedback: number): void;
  /**
   * Prepares the draw that actually reaches the screen: full chain, history
   * taken whole at feedback 1, history copy OFF so it cannot move.
   *
   * `lastIndex` is the LAST ACCUMULATED position, not an (N+1)th one. The
   * current frame is only read for the variance clip's neighbourhood here, and
   * reusing a position the mean already contains keeps the box centred on the
   * sample distribution rather than on a fresh corner of the pixel footprint.
   */
  capturePresent(lastIndex: number): void;
  /** A live frame: advance the sequence by one and leave the chain alone. */
  liveFrame(): void;
  /**
   * Puts the chain back exactly as a live frame expects to find it — jitter
   * cleared, tail passes on, history copy on, feedback back to the live weight.
   *
   * This runs in a `finally`. A throw out of the composer that left the tail
   * passes disabled would leave the game rendering into a buffer and presenting
   * nothing: a black screen that survives the fault that caused it, which is
   * the worst kind. The history is deliberately NOT discarded here — it holds a
   * fully converged still of the exact scene the next live frame starts from,
   * which is the best seed a temporal filter can be handed.
   */
  endFrame(): void;
  /** One `composer.render()`. */
  draw(): void;
}

/**
 * Whether the converged history still describes the world.
 *
 * One boolean, held by the caller across frames, because the invalidation rule
 * has to survive not knowing when a hold ended. `dirty` is SET by every live
 * frame rather than CLEARED on release: there is then no state to get wrong
 * about the transition, and the first held frame of every hold re-converges
 * while every held frame after it is one draw.
 */
export interface CaptureState {
  dirty: boolean;
}

/** A fresh state. Dirty, because nothing has been converged yet. */
export function createCaptureState(): CaptureState {
  return { dirty: true };
}

/** What one call to {@link renderFrame} actually did. For harnesses and logs. */
export interface FrameReport {
  readonly held: boolean;
  /** True when this frame paid for the accumulation. At most once per hold. */
  readonly converged: boolean;
  /** Accumulation sub-draws run. 0 on a live frame and on a reused hold. */
  readonly subdraws: number;
  /** Total `draw()` calls, accumulation included. Always at least 1. */
  readonly draws: number;
}

/**
 * Draws one frame — live or held — through the capture protocol.
 *
 * This is the loop that lived in one space racer's renderer and nowhere
 * else. It is control flow only: every GL call is behind one of the
 * chain's verbs.
 */
export function renderFrame(
  chain: HeldFrameChain,
  state: CaptureState,
  held: boolean,
): FrameReport {
  const samples = held ? Math.max(0, Math.floor(chain.samples())) : 0;
  let subdraws = 0;
  let converged = false;
  let draws = 0;
  try {
    if (held) {
      // Converge — but only if the world has moved since the last time we did.
      // Everything the accumulation reads (the scene, the camera, and the
      // history it is about to overwrite) is unchanged for as long as the hold
      // lasts, so redoing it would rebuild the same history at N times the
      // price, and the price is the part that breaks it.
      if (state.dirty) {
        chain.beginCapture();
        for (let i = 0; i < samples; i++) {
          chain.captureSubframe(i, captureFeedback(i));
          chain.draw();
          subdraws++;
          draws++;
        }
        state.dirty = false;
        converged = true;
      }
      // `samples - 1` and not `samples`: see `capturePresent`. At samples 0
      // this is -1, which a chain with no resolve ignores — it has no sequence
      // to address.
      chain.capturePresent(samples - 1);
    } else {
      chain.liveFrame();
      // Set on every live frame rather than cleared on release, so there is no
      // state to get wrong about when a hold ended.
      state.dirty = true;
    }
    chain.draw();
    draws++;
  } finally {
    chain.endFrame();
  }
  return { held, converged, subdraws, draws };
}
