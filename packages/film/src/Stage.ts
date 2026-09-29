/**
 * ============================================================================
 *  Stage — the seek/reset contract every stateful part of a film obeys, and
 *  the driver that makes an arbitrary jump in time indistinguishable from
 *  having played there.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **Rendering time t produces the same frame whether the film arrived at t
 *   by playing forward from 0, by jumping backwards from the end, or by being
 *   asked for t and nothing else.**
 *
 * ## The failure it is built from
 *
 * Measured on one short film: prewarming a later shot leaked its state into
 * an earlier one, and the fix was scattered — the Director explicitly reset
 * visibility on individual meshes at individual times, because there was no
 * shared answer to "you are now at 41.2 s and you were at 98.8 s". Its
 * retrospective: *"Actors, fleet simulation, instancing, particles,
 * postprocessing history, visibility, and other systems did not share a
 * standard response to backward or discontinuous seeks."*
 *
 * The contract is five verbs, and the ordering between them is the whole
 * design:
 *
 *   `prepare()`   once, before any frame. Build what exists for the whole film.
 *   `resetAt(t)`  discard all history and reconstruct the state at t from the
 *                 manifest alone. Called for a DISCONTINUOUS move.
 *   `seek(from,to)` advance across a continuous step. May integrate.
 *   `settle()`    "am I ready to be photographed?" — assets, shaders, layout.
 *   `presented()` the frame you asked for was painted. Retire one-shot state.
 *
 * ## Why `resetAt` and `seek` are two verbs and not one
 *
 * A particle system that has been running for four seconds looks different
 * from one that has just been switched on, and the difference is the point of
 * having it. `seek(from, to)` with a small positive delta lets it integrate;
 * `resetAt(t)` requires it to answer from t alone — spawn its population at
 * the ages the authored emitter implies, or show nothing and say so.
 *
 * A subsystem that cannot reconstruct from t alone declares that with
 * {@link FilmSubsystem.reconstructs} = false. It is not a failure to be honest
 * about; it is a fact the capture tool needs, because it means a chunked
 * render must PRE-ROLL through this subsystem rather than jump. Guessing that
 * everything reconstructs is what produced a contaminated frame that looked
 * completely fine.
 *
 * ## The rule this file exists to obey
 *
 * "Ask, do not remember." Nothing here caches what a subsystem last said.
 * `settle()` is asked every frame; `atTime()` is a fresh walk. A cache of a
 * fact will outlive the fact and then answer for it.
 */

/** Why the stage is moving. A subsystem may legitimately behave differently. */
export type SeekReason = 'play' | 'scrub' | 'capture' | 'prewarm' | 'rewind';

export interface SeekMove {
  /** Where the stage was. `null` means "nowhere yet" — the first move. */
  readonly from: number | null;
  readonly to: number;
  readonly reason: SeekReason;
  /**
   * True when the stage could not get here by advancing: a jump backwards, a
   * jump forward past the tolerance, or the first move of all.
   */
  readonly discontinuous: boolean;
}

/**
 * Why a subsystem is not ready to be photographed.
 *
 * A string, not a boolean, because "not settled" with no reason is the
 * unfalsifiable state a capture tool spins in for five minutes before timing
 * out with nothing to report.
 */
export interface Unsettled {
  readonly who: string;
  readonly why: string;
}

export interface FilmSubsystem {
  /** Stable id. Appears in every diagnostic; a subsystem with no name is a mystery in a log. */
  readonly id: string;
  /**
   * Can this subsystem reconstruct its state at an arbitrary t from the
   * manifest alone? Default true. Declare false and the capture tool pre-rolls
   * instead of jumping — see the header.
   */
  readonly reconstructs?: boolean;
  /** How far back a pre-roll must start, in seconds, when `reconstructs` is false. */
  readonly prerollSeconds?: number;

  /** Once, before any frame. Build the whole-film scaffolding. */
  prepare?(): void | Promise<void>;
  /** Discard history; reconstruct at t from authored data. */
  resetAt?(t: number): void;
  /** A continuous step. `from` is null only on the first move. */
  seek?(move: SeekMove): void;
  /** Ready to be photographed? Return null when ready, a reason when not. */
  settle?(): Unsettled | null;
  /** The frame at `t` was painted. Retire one-shot state. */
  presented?(t: number): void;
  dispose?(): void;
}

export interface StageOptions {
  /**
   * A forward step larger than this is treated as discontinuous.
   *
   * Default is deliberately generous — a third of a second. Under capture the
   * step is one frame; under playback a dropped frame or a garbage collection
   * pause can legitimately hand a subsystem a 200 ms step, and calling that a
   * seek would reset every particle in the film once a minute on a hot day.
   */
  readonly continuityWindow?: number;
  /**
   * A backward step smaller than this is NOT a rewind.
   *
   * Zero by default: any backward move is discontinuous. Floating-point
   * accumulation can produce a step of −1e−15 and treating that as a rewind
   * would reset the world for free, which is the more expensive mistake.
   */
  readonly backwardSlop?: number;
}

export interface Stage {
  /** Register a participant. Returns an unsubscribe. */
  add(subsystem: FilmSubsystem): () => void;
  /** Every registered subsystem, in registration order. */
  readonly members: readonly FilmSubsystem[];
  /** Where the stage currently is, or null before the first move. */
  readonly time: number | null;
  /** Call once. Idempotent; the second call is a no-op, not an error. */
  prepare(): Promise<void>;
  /**
   * Move to t. Decides continuity, calls `resetAt` or `seek` on every member
   * in registration order, and returns what it decided so a capture tool can
   * log it. Does NOT render — that is the caller's, because only the caller
   * knows what a frame is.
   */
  goto(t: number, reason?: SeekReason): SeekMove;
  /** Everything not ready to be photographed. Empty means ready. */
  unsettled(): Unsettled[];
  /** Tell every member the frame at `time` was painted. */
  presented(): void;
  /** The earliest time a chunked capture may jump to and still be correct. */
  safeEntry(t: number): number;
  dispose(): void;
}

export function createStage(options: StageOptions = {}): Stage {
  const window_ = options.continuityWindow ?? 1 / 3;
  const slop = options.backwardSlop ?? 0;
  const members: FilmSubsystem[] = [];
  let time: number | null = null;
  let prepared = false;

  const stage: Stage = {
    get members() { return members; },
    get time() { return time; },

    add(subsystem) {
      if (members.some((m) => m.id === subsystem.id)) {
        // Two subsystems under one id means one of them is invisible to every
        // diagnostic this file produces, and the pair will be reset in an
        // order nobody chose. It is cheap to refuse and expensive to debug.
        throw new Error(`a subsystem with id "${subsystem.id}" is already on this stage`);
      }
      members.push(subsystem);
      return () => {
        const i = members.indexOf(subsystem);
        if (i >= 0) members.splice(i, 1);
      };
    },

    async prepare() {
      if (prepared) return;
      prepared = true;
      // Serially, and awaited. A parallel prepare is faster and lets one
      // subsystem's constructor observe another's half-built state, which is
      // exactly the class of bug this whole file exists to remove.
      for (const m of members) await m.prepare?.();
    },

    goto(t, reason = 'play') {
      const from = time;
      const discontinuous =
        from === null ||
        t < from - slop ||
        t > from + window_;
      const move: SeekMove = { from, to: t, reason, discontinuous };
      for (const m of members) {
        if (discontinuous && m.resetAt) m.resetAt(t);
        m.seek?.(move);
      }
      time = t;
      return move;
    },

    unsettled() {
      const out: Unsettled[] = [];
      for (const m of members) {
        const why = m.settle?.();
        if (why) out.push(why);
      }
      return out;
    },

    presented() {
      if (time === null) return;
      for (const m of members) m.presented?.(time);
    },

    safeEntry(t) {
      // The furthest-back pre-roll any member demands. A capture tool that
      // resumes a chunk at t must actually start driving frames from here.
      let earliest = t;
      for (const m of members) {
        if (m.reconstructs === false) {
          earliest = Math.min(earliest, t - (m.prerollSeconds ?? 0));
        }
      }
      return Math.max(0, earliest);
    },

    dispose() {
      for (const m of members) m.dispose?.();
      members.length = 0;
      time = null;
      prepared = false;
    },
  };

  return stage;
}

/**
 * Every member that has told the truth about not being reconstructible.
 *
 * A capture tool prints this before it starts. A film in which nothing
 * declares `reconstructs: false` is either genuinely stateless or has not been
 * audited, and those two must not render as the same colour.
 */
export function nonReconstructing(stage: Stage): { readonly id: string; readonly prerollSeconds: number }[] {
  return stage.members
    .filter((m) => m.reconstructs === false)
    .map((m) => ({ id: m.id, prerollSeconds: m.prerollSeconds ?? 0 }));
}
