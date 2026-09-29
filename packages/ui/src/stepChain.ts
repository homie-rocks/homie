/**
 * ============================================================================
 *  stepChain — where in a list of steps is this world already, and how to stop
 *  reading a veteran the tutorial.
 * ============================================================================
 *
 *  An objective list, a checklist, a guided setup: an ordered chain of steps,
 *  each of which knows how to ask the world whether it is already done. The
 *  DOM, the words and the predicates are the caller's. What is here is the
 *  POINTER, and the pointer is the part that is subtle every single time.
 *
 *  ── THE POSITION IS INFERRED FROM THE WORLD, NOT STORED ────────────────────
 *
 *  A saved index restored on top of a world that was built some other way puts
 *  step one in front of somebody who finished step nine, which is worse than
 *  saying nothing. So on every reseeding the pointer WALKS FORWARD over
 *  everything the world has already achieved, and a stored index is not part of
 *  this file's vocabulary at all.
 *
 *  ── AND IT CANNOT BE DONE IN ONE PASS. THIS IS THE MEASURED PART. ──────────
 *
 *  Derived state does not exist on the tick the world is replaced. A colony
 *  seeded with three plants, two mines and thirty-two bunks read as housing 0,
 *  online 0, power 0 — because the bookkeeping pass had not run yet — and the
 *  inference obediently landed on "give the crew somewhere to sleep". The
 *  numbers were real fields, correctly read, ONE FRAME TOO EARLY.
 *
 *  So the walk re-runs for a window after a reseeding, and it is MONOTONIC: a
 *  pass that sees LESS derived state than the last one may not drag the pointer
 *  backwards.
 *
 *  ── THE WINDOW CLOSES ON A CLOCK, NOT ON A FRAME COUNT ─────────────────────
 *
 *  A fixed frame window is a second bug wearing the first one's clothes: the
 *  player's FIRST genuine completion can happen inside it, and an inference
 *  pass moves the pointer SILENTLY — no completion state, no announcement, no
 *  record — so the step is ticked off and the game says nothing about it. One
 *  tick in which the simulation clock MOVED is one tick in which the derived
 *  state exists, which is the entire reason the window is there. So it closes
 *  on the clock, and the frame cap is only a backstop for a world that is never
 *  stepped — a scene seeded from a console while paused, which would otherwise
 *  re-infer forever.
 *
 *  ── WHAT IS NOT HERE ───────────────────────────────────────────────────────
 *
 *  No DOM, no timer, no words, no celebration, no storage. A caller owns all of
 *  those and calls `advance` when its own predicate says so. The chain does not
 *  even know what a step IS beyond "something `done` can be asked about".
 */

/**
 * Every number and hook the chain uses. None of them has a default.
 *
 * `S` IS THE CALLER'S OWN STEP TYPE AND THE PREDICATES ARE SPEC-LEVEL, rather
 * than the chain demanding an interface each step must implement. That is not
 * ceremony: one real chain asks `done` about a whole world view and `stale`
 * about one field of it, and a shape that forced both onto the same argument
 * would have made the caller build an adapter array — at which point
 * `current()` hands back the adapter and not the step, and every reader has to
 * index the original list by hand.
 */
export interface StepChainSpec<S, T> {
  /** The chain. Its length is the chain's length. */
  steps: readonly S[];
  /**
   * Backstop frame cap on the re-inference window. Only reached when the clock
   * never moves; see the header.
   */
  window: number;
  /** Read the world for a pass. Called once per pass, never per step. */
  world(): T;
  /** Is this step already true of the world? */
  done(step: S, world: T): boolean;
  /**
   * Is this step MOOT — not done, but no longer worth asking for? A step the
   * world has made impossible or irrelevant is skipped by the inference exactly
   * like a completed one, and the two are separate questions because only one
   * of them deserves an announcement.
   */
  stale?(step: S, world: T): boolean;
  /**
   * Called when a pass MOVED the pointer. The caller repaints, resets its own
   * per-step counters and reveals whatever it reveals; this file does none of
   * that because none of it is the pointer's business.
   */
  onMove(index: number): void;
}

export interface StepChain<S> {
  /** Current index. Equal to `steps.length` when the chain is finished. */
  readonly index: number;
  /** The step at `index`, or null past the end. */
  current(): S | null;
  /** Restart the inference window against a world that has just been replaced. */
  reseed(clock: number): void;
  /**
   * One tick. `clock` is the SIMULATION clock — a wall clock here would close
   * the window on a paused world, which is the case it exists for.
   */
  tick(clock: number): void;
  /** Move past the current step. The caller's own completion path. */
  advance(): void;
}

export function stepChain<S, T>(spec: StepChainSpec<S, T>): StepChain<S> {
  let index = 0;
  let inferFor = 0;
  let seedClock = -1;

  /** Walk forward over everything already done or moot. Forward only. */
  function inferOnce(): void {
    const world = spec.world();
    let i = 0;
    while (i < spec.steps.length) {
      const d = spec.steps[i];
      if (d === undefined) break;
      const skip = (spec.stale ? spec.stale(d, world) : false) || spec.done(d, world);
      if (!skip) break;
      i++;
    }
    const want = Math.min(i, spec.steps.length - 1);
    // A pass that sees less than the last one must not drag the player back to
    // a step they have already passed.
    if (want <= index && inferFor < spec.window) return;
    index = Math.max(index, want);
    spec.onMove(index);
  }

  return {
    get index() { return index; },
    current(): S | null {
      return index >= 0 && index < spec.steps.length ? spec.steps[index] ?? null : null;
    },
    reseed(clock: number): void {
      index = 0;
      inferFor = spec.window;
      seedClock = clock;
      inferOnce();
    },
    tick(clock: number): void {
      if (inferFor <= 0) return;
      inferFor--;
      inferOnce();
      // Against a STORED clock rather than a per-frame delta: a caller stepping
      // by 1/60 sixty times inside one frame has advanced the world sixty
      // times, and a delta read off the frame would say nothing moved.
      if (clock > seedClock + 1e-9) inferFor = 0;
    },
    advance(): void {
      index++;
      if (index > spec.steps.length) index = spec.steps.length;
    },
  };
}
