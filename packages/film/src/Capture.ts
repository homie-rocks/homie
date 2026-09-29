/**
 * ============================================================================
 *  Capture — the plan a deterministic render follows, and the receipt it
 *  leaves behind, both computable without rendering anything.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **A render can be stopped at any point and resumed at the last verified
 *   chunk, a single shot can be re-rendered and remuxed into an existing
 *   master, and the frame numbering of both is provably the same as a render
 *   that ran straight through.**
 *
 * ## Why the plan is a data structure and not a loop
 *
 * One short film's recorder was a `for` loop over 3,705 frames. It could
 * not resume, could not render a range, could not report an ETA, and a failure
 * at frame 3,600 threw away twenty minutes. The retrospective's acceptance
 * tests are all statements about a PLAN — *"a failed capture resumes at the
 * last verified chunk"*, *"`--from-shot` and `--to-shot` can patch one
 * sequence and safely remux the master"* — and a loop has no plan to make
 * statements about.
 *
 * Splitting the plan out has a second payoff that matters more: the frame
 * arithmetic is the part that goes subtly wrong, and here it is testable in a
 * Node test with no browser, no GPU and no FFmpeg. An off-by-one at a chunk
 * boundary duplicates or drops one frame in a hundred thousand; it is
 * invisible in the picture and it desynchronises the audio by 33 ms for the
 * rest of the film. Nobody finds that by watching.
 *
 * ## Chunks are aligned to shots, not to a round number of seconds
 *
 * A chunk boundary in the middle of a shot means a resume has to reconstruct
 * mid-shot state; a boundary ON a cut is a place where the film is already
 * discontinuous and every subsystem is already being reset. So chunks END at
 * cuts. They are therefore uneven, which is fine — a chunk is a unit of
 * resumability, not a unit of time.
 *
 * A shot longer than the target chunk length is split anyway, at frame
 * boundaries, because a single 40-second shot must not become an unresumable
 * 40-second chunk.
 */

import type { Film } from './Timeline.ts';
import type { Stage } from './Stage.ts';

export interface CaptureChunk {
  readonly index: number;
  /** Inclusive first frame. */
  readonly fromFrame: number;
  /** EXCLUSIVE last frame. */
  readonly toFrame: number;
  /** Authored time of the first frame. */
  readonly fromTime: number;
  /** Shots this chunk covers, in order. */
  readonly shots: readonly string[];
  /**
   * The time a resuming render must actually START driving frames from, which
   * may be earlier than `fromTime` when a subsystem has declared it cannot
   * reconstruct. Frames before `fromFrame` are rendered and discarded.
   */
  readonly entryTime: number;
}

export interface CapturePlan {
  readonly filmId: string;
  readonly fps: number;
  /** Inclusive first frame of the whole request. */
  readonly fromFrame: number;
  /** EXCLUSIVE last frame of the whole request. */
  readonly toFrame: number;
  readonly frames: number;
  readonly chunks: readonly CaptureChunk[];
  /** True when this plan covers the whole film — the only kind that may be a master. */
  readonly whole: boolean;
}

export interface PlanOptions {
  /** Render only from this shot's cut in. */
  readonly fromShot?: string;
  /** Render up to and including this shot. */
  readonly toShot?: string;
  /** Or a raw frame range, exclusive at the top. */
  readonly fromFrame?: number;
  readonly toFrame?: number;
  /** Target chunk length. Chunks end at cuts, so the real lengths vary around it. */
  readonly chunkSeconds?: number;
  /** A stage, to ask what needs pre-rolling. Optional; without it, no pre-roll. */
  readonly stage?: Stage;
}

/**
 * Turn a film and a request into the exact list of frames to render.
 *
 * Throws on a request that names a shot the film does not have, rather than
 * quietly rendering the whole thing: a typo in `--from-shot` that silently
 * becomes "everything" is twenty minutes and a wrong answer.
 */
export function planCapture(film: Film, options: PlanOptions = {}): CapturePlan {
  const chunkSeconds = options.chunkSeconds ?? 10;

  let fromFrame = 0;
  let toFrame = film.frames;

  if (options.fromShot) {
    if (!film.shot(options.fromShot)) throw new Error(`no shot "${options.fromShot}" in film "${film.id}"`);
    fromFrame = film.framesOf(options.fromShot).from;
  }
  if (options.toShot) {
    if (!film.shot(options.toShot)) throw new Error(`no shot "${options.toShot}" in film "${film.id}"`);
    toFrame = film.framesOf(options.toShot).to;
  }
  if (options.fromFrame !== undefined) fromFrame = options.fromFrame;
  if (options.toFrame !== undefined) toFrame = options.toFrame;

  fromFrame = Math.max(0, Math.min(film.frames, Math.round(fromFrame)));
  toFrame = Math.max(fromFrame, Math.min(film.frames, Math.round(toFrame)));
  if (toFrame === fromFrame) throw new Error('a capture range with no frames in it');

  // Cut frames inside the range, so a chunk can end on one.
  const cuts = film.shots
    .map((s) => film.framesOf(s.id).from)
    .filter((f) => f > fromFrame && f < toFrame);

  const targetFrames = Math.max(1, Math.round(chunkSeconds * film.fps));
  const boundaries: number[] = [fromFrame];
  let cursor = fromFrame;
  let cutIndex = 0;
  while (cursor < toFrame) {
    const wanted = cursor + targetFrames;
    // The first cut at or after the target, if it is not miles away; else
    // split mid-shot at the target. "Miles away" is two chunks' worth: a
    // 40-second shot inside a 10-second chunk plan should not produce one
    // 40-second chunk, and a 12-second shot should not be split for two.
    while (cutIndex < cuts.length && cuts[cutIndex]! <= cursor) cutIndex++;
    const nextCut = cuts[cutIndex];
    let next: number;
    if (nextCut !== undefined && nextCut <= wanted + targetFrames) next = nextCut;
    else next = Math.min(toFrame, wanted);
    if (next <= cursor) next = Math.min(toFrame, cursor + 1);
    boundaries.push(Math.min(next, toFrame));
    cursor = next;
  }

  const chunks: CaptureChunk[] = [];
  for (let i = 1; i < boundaries.length; i++) {
    const start = boundaries[i - 1]!;
    const end = boundaries[i]!;
    if (end <= start) continue;
    const fromTime = film.timeOfFrame(start);
    const covered = film.shots
      .filter((s) => {
        const range = film.framesOf(s.id);
        return range.from < end && range.to > start;
      })
      .map((s) => s.id);
    chunks.push({
      index: chunks.length,
      fromFrame: start,
      toFrame: end,
      fromTime,
      shots: covered,
      entryTime: options.stage ? options.stage.safeEntry(fromTime) : fromTime,
    });
  }

  return {
    filmId: film.id,
    fps: film.fps,
    fromFrame,
    toFrame,
    frames: toFrame - fromFrame,
    chunks,
    whole: fromFrame === 0 && toFrame === film.frames,
  };
}

/* ========================================================================== */
/* Resume                                                                     */
/* ========================================================================== */

/** What a completed chunk left behind. Written to disk after each chunk. */
export interface ChunkReceipt {
  readonly index: number;
  readonly fromFrame: number;
  readonly toFrame: number;
  /** The encoded piece. */
  readonly path: string;
  /** sha256 of that file, so a resume can tell a finished chunk from a truncated one. */
  readonly sha256: string;
  /** Every frame's authored time, as the handle reported it AFTER presenting. */
  readonly presentedTimes?: readonly number[];
}

/**
 * Which chunks still have to be rendered.
 *
 * A chunk counts as done only when its receipt's frame range matches the
 * plan's exactly. A receipt from a plan with different chunk boundaries — a
 * different `--chunk-seconds`, or a film whose shot lengths changed — does
 * NOT count, and that is the whole point: reusing a chunk whose boundaries
 * moved is how a resumed render gains or loses a frame in the middle.
 */
export function remainingChunks(plan: CapturePlan, done: readonly ChunkReceipt[]): CaptureChunk[] {
  const finished = new Set(done.map((r) => `${r.fromFrame}:${r.toFrame}`));
  return plan.chunks.filter((c) => !finished.has(`${c.fromFrame}:${c.toFrame}`));
}

/**
 * Everything wrong with a set of chunk receipts, as a list.
 *
 * The checks are boring and each one is a real way a concatenated master goes
 * wrong: a gap drops frames, an overlap duplicates them, and a range outside
 * the plan is a receipt from a different render that happened to be in the
 * directory.
 */
export function verifyChunks(plan: CapturePlan, done: readonly ChunkReceipt[]): string[] {
  const problems: string[] = [];
  const sorted = [...done].sort((a, b) => a.fromFrame - b.fromFrame);
  let expect = plan.fromFrame;
  for (const receipt of sorted) {
    if (receipt.fromFrame < plan.fromFrame || receipt.toFrame > plan.toFrame) {
      problems.push(`chunk ${receipt.index} covers ${receipt.fromFrame}…${receipt.toFrame}, outside the plan's ${plan.fromFrame}…${plan.toFrame}`);
      continue;
    }
    if (receipt.fromFrame > expect) problems.push(`frames ${expect}…${receipt.fromFrame} are in no chunk — the master would be ${receipt.fromFrame - expect} frames short`);
    if (receipt.fromFrame < expect) problems.push(`chunk ${receipt.index} overlaps the previous one by ${expect - receipt.fromFrame} frames`);
    expect = Math.max(expect, receipt.toFrame);
  }
  if (expect < plan.toFrame) problems.push(`frames ${expect}…${plan.toFrame} were never captured`);
  return problems;
}

/* ========================================================================== */
/* The frame-time fence                                                       */
/* ========================================================================== */

/**
 * Did the renderer present the frame we asked for?
 *
 * Half a frame is the tolerance, and it is a real tolerance rather than an
 * exact comparison because the authored time is a float that has been through
 * a division and a clamp. Anything further out is a different frame, and an
 * earlier production proved that a different frame is what you get when you
 * assume otherwise.
 */
export function framePresented(requested: number, presented: number, fps: number): boolean {
  return Number.isFinite(presented) && Math.abs(presented - requested) <= 0.5 / fps;
}

/**
 * The receipt for a whole capture. Everything needed to say the render is
 * reproducible, and nothing that changes between two identical runs.
 */
export interface CaptureReceipt {
  readonly schema: 'homie.film-capture/1';
  readonly filmId: string;
  readonly fps: number;
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly frames: number;
  readonly width: number;
  readonly height: number;
  /** Every frame's requested authored time, in order — the honest record of what was asked for. */
  readonly framesDigest: string;
  readonly chunks: readonly ChunkReceipt[];
  readonly outPath: string;
  readonly outSha256: string;
  /** Subsystems that declared they cannot reconstruct, and the pre-roll they demanded. */
  readonly preroll: readonly { readonly id: string; readonly prerollSeconds: number }[];
  /** Warnings that did not stop the render. Empty is a real answer; absent is not. */
  readonly warnings: readonly string[];
}
