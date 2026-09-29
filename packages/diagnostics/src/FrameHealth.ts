/**
 * ===========================================================================
 *  @homie-rocks/diagnostics/FrameHealth.ts — the two predicates, pure and exported.
 * ===========================================================================
 *
 * WHAT THIS FILE IS AUTHORITATIVE FOR: whether one presented frame has a
 * picture in it, and whether one sampled row has a TEAR in it. Nothing here
 * knows what the picture is of, nothing here acts, and nothing here allocates.
 *
 * PURE AND EXPORTED IS THE WHOLE POINT, not a tidiness preference.
 * ---------------------------------------------------------------------------
 * The game this came from already established the pattern: its threshold
 * fitter drives THIS function with synthetic frames of known ground truth
 * rather than re-implementing the predicate on its side, because a harness
 * that carries its own copy of the thing it is testing is testing the copy —
 * and that mistake has already been paid for once.
 *
 * Both watchdogs in this package therefore call in here and hold no test of
 * their own, so the package's test harness and the shipped game agree by
 * construction rather than by luck.
 *
 * EVERY THRESHOLD IS A VALUE THE GAME SUPPLIES. THERE IS NO MODE.
 * ---------------------------------------------------------------------------
 * The reduction test: reduce when two things are the same THING,
 * parameterise when they are only the same SHAPE, and a flag that changes
 * BEHAVIOUR inside a shared function means they were never one thing.
 * These predicates are one thing in every game that has them; what differs is
 * five numbers fitted against five different art directions, and a fitted
 * number is exactly the kind of parameter this rule permits.
 *
 * Measured before the move (2026-08-20): two games' copies of this file (a
 * first-person shooter's and a kart racer's) differed by SIX lines and ZERO
 * structural ones — and four of those six lines were `BLANK_SD`, `BLANK_LIT`
 * and the comment explaining why the shooter re-fitted them for a night
 * scene. Their `FrameWatch.ts` copies differed by four lines, of which one was
 * `DARK`. Two whole files existed to hold three numbers.
 *
 * `flatSpan: Infinity` IS A VALUE, NOT A SWITCH.
 * ---------------------------------------------------------------------------
 * The tear test's third term asks whether the dark run is also FLAT. A game
 * that does not want that requirement passes `Infinity`, which is a threshold
 * every spread satisfies — `spread <= Infinity` — so the expression is
 * unchanged and there is no branch to read. That matters here specifically:
 * two of the games ran the two-term test when this package was cut, and
 * `Infinity` is how their behaviour was reproduced EXACTLY in the parity commit
 * without an `if (game === …)` anywhere. The package's test harness has a
 * `two-term-tear` fault that forces every caller into that state and must go
 * red.
 */

import type { FrameSample } from './Host.ts';

/* ========================================================================== */
/* The presented image: is there a picture in it                              */
/* ========================================================================== */

/**
 * The five fitted numbers behind `classifyFrame`.
 *
 * `blankSd` / `blankLit` — a frame with less luma spread than this, that is
 * also this dark, has nothing painted in it. The margin is enormous and that is
 * deliberate: measured on a kart racer, a healthy frame reads sd 63.6 and the
 * two "canvas never painted" failures read 0.0. A detector that fires on a
 * healthy frame ships a downgrade to every player, so it is tuned to be certain
 * rather than sensitive; the shader and draw-call detectors cover the subtler
 * failures.
 *
 * `flatSd` / `flatMean` — a uniformly BRIGHT frame is just as empty as a
 * uniformly dark one; that is what a rejected shader family looks like once
 * bloom has had the bare sky to itself. Brightness alone is not proof, so it
 * needs the same absence of structure.
 *
 * THESE ARE TWO THRESHOLDS ON TWO DIFFERENT THINGS AND THEY MUST STAY SEPARATE.
 * One space racer recorded why: the measured rejected-PBR-family failure
 * presented as `white void, sd 11.1`, so at `flatSd = blankSd = 4` that case
 * was never actually caught by this branch — the shader detector caught it
 * first and this test was decoration. A game that has not re-fitted it passes
 * its own `blankSd` here and gets exactly the behaviour it had.
 */
export interface FrameThresholds {
  readonly blankSd: number;
  readonly blankLit: number;
  readonly flatSd: number;
  readonly flatMean: number;
}

/** The verdict on one sampled frame — the harness-facing surface of the detector. */
export interface FrameVerdict {
  /** dark and structureless — nothing was painted */
  blank: boolean;
  /** bright and structureless — painted, but not with the world */
  flat: boolean;
  /** human-readable, for the pipeline log */
  reason: string;
}

export function classifyFrame(s: FrameSample, t: FrameThresholds): FrameVerdict {
  const blank = s.sd < t.blankSd && s.lit < t.blankLit;
  const flat = s.sd < t.flatSd && s.mean > t.flatMean;
  return {
    blank,
    flat,
    reason: blank
      ? `dark and structureless (sd ${s.sd.toFixed(2)} < ${t.blankSd}, `
        + `lit ${(s.lit * 100).toFixed(2)}% < ${t.blankLit * 100}%)`
      : flat
        ? `bright and structureless (mean ${s.mean.toFixed(1)} > ${t.flatMean}, `
          + `sd ${s.sd.toFixed(2)} < ${t.flatSd})`
        : 'has a picture in it',
  };
}

/* ========================================================================== */
/* One sampled row: is that black band a tear, or is it the night             */
/* ========================================================================== */

/**
 * The three fitted numbers behind `classifyRow`.
 *
 * `dark` — display luma at or below which a pixel counts as near-black.
 * `tearFrac` — a run longer than this fraction of the row MAY be a tear.
 * `flatSpan` — the greatest luma spread, in 8-bit counts, that a run may have
 *   and still be called uninitialised. `Infinity` removes the requirement and
 *   gives the original two-term test, unchanged.
 *
 * WHY THE THIRD TERM EXISTS, from the space racer that paid for it:
 * `DARK = 6` and `TEAR_FRAC = 0.12` were fitted against a golden-hour coastal
 * scene in which the sampled row crossed road, vehicles and scenery and a long
 * black run could only be a defect. Neither assumption survives that game's
 * eclipse arc, which is 27.2% of every lap.
 *
 * A torn region is UNIFORM — it is uninitialised or discarded buffer, one value
 * repeated. A legitimately dark frame is not: a grade carries constant grain as
 * banding cover, plus a starfield and a toe lift. So a black run is only
 * reported when it is also FLAT, and the measured spread is returned so a
 * future disagreement is argued from the recorded number rather than
 * re-litigated.
 *
 * This is a more dangerous correction than it looks, and the reason is worth
 * keeping: a false *"the frame is torn"* reading looks entirely plausible.
 */
export interface TearThresholds {
  readonly dark: number;
  readonly tearFrac: number;
  readonly flatSpan: number;
}

export interface TearVerdict {
  /** true when this row should be recorded as a partial-black present */
  tear: boolean;
  /** longest unbroken run of near-black pixels along the row, in pixels */
  runPx: number;
  runFrac: number;
  /** x of the first pixel of that run, or -1 when there was no dark pixel */
  startX: number;
  /**
   * Luma spread across that run, in 8-bit counts. 0 is a buffer that was never
   * written; anything above `flatSpan` is scene content. Reported whether or
   * not the run was long enough to be a candidate, so a disputed reading can be
   * argued from the number.
   */
  flatSpan: number;
}

/**
 * Classify one row of RGBA bytes read off the default framebuffer.
 *
 * `row` is `w * 4` bytes. Nothing is allocated: the caller owns the buffer and
 * reuses it every sampled frame, because this runs immediately after a present
 * on the machine a player is holding.
 */
export function classifyRow(
  row: Uint8Array | number[],
  w: number,
  t: TearThresholds,
): TearVerdict {
  let run = 0, best = 0, start = -1, bestStart = -1;
  for (let x = 0; x < w; x++) {
    const i = x * 4;
    const l = ((row[i] ?? 0) + (row[i + 1] ?? 0) + (row[i + 2] ?? 0)) / 3;
    if (l <= t.dark) {
      if (run === 0) start = x;
      run++;
      if (run > best) { best = run; bestStart = start; }
    } else run = 0;
  }

  // Spread across the winning run only. A row whose dark pixels are scattered
  // has no run to measure, and reporting the whole row's spread there would
  // describe something nobody is deciding about.
  let lo = 255, hi = 0;
  if (best > 0) {
    for (let x = bestStart; x < bestStart + best; x++) {
      const i = x * 4;
      const l = ((row[i] ?? 0) + (row[i + 1] ?? 0) + (row[i + 2] ?? 0)) / 3;
      if (l < lo) lo = l;
      if (l > hi) hi = l;
    }
  } else {
    lo = 0;
  }
  const spread = hi - lo;

  return {
    tear: best > w * t.tearFrac && spread <= t.flatSpan,
    runPx: best,
    runFrac: w > 0 ? best / w : 0,
    startX: bestStart,
    flatSpan: spread,
  };
}
