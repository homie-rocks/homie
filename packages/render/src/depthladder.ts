/**
 * ============================================================================
 *  DepthLadder — near and far derived from the camera's height above ground,
 *  snapped to rungs with hysteresis, as a state machine with no GL.
 * ============================================================================
 *
 *  ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
 *
 *  A world that holds 50 m ships and 2 cm boot prints, with a camera that zooms
 *  across the whole range, cannot pick one near plane. The two ends have
 *  OPPOSITE requirements and both are satisfiable: at ground level nothing is
 *  more than a horizon away, so `far` can be small; at altitude nothing is
 *  nearer than several kilometres, so `near` can be huge. Deriving both from
 *  altitude is the answer, and it is the answer that does not cost a global
 *  depth ENCODING.
 *
 *  ── THE LADDER IS THE POINT, NOT AN OPTIMISATION ───────────────────────────
 *
 *  A continuously varying near plane changes the projection matrix every frame,
 *  which re-quantises the depth buffer every frame, which makes any
 *  depth-derived effect — an AO pass, a depth-aware upsample, a contact shadow —
 *  SHIMMER on a completely static camera. Snapping to rungs of roughly 1.6x
 *  means it moves a handful of times across a whole zoom, and the hysteresis
 *  means a camera hovering exactly on a boundary does not flip the matrix back
 *  and forth.
 *
 *  ── WHY THE RUNGS ARE NOT IN THIS FILE ─────────────────────────────────────
 *
 *  Every number below is a property of a particular world's SCALE — how far the
 *  horizon is, how small the smallest thing worth resolving is, how high the
 *  camera goes. `NEAR_LADDER` fitted to a 5 km lunar map would be actively
 *  wrong in a corridor twelve metres long. Same reasoning as `ScalerSpec` and
 *  `BootSpec`: no defaults, so a caller that forgets one fails to compile
 *  rather than inheriting another world's depth range.
 *
 *  What is shared is the ARITHMETIC — pick a rung, hold it while the target is
 *  inside the hold band, derive far, and report only when something actually
 *  moved so the caller can skip `updateProjectionMatrix`.
 *
 *  THIS FILE IMPORTS NOTHING, and it never touches a camera. It takes an
 *  altitude and returns two numbers, which is what lets a Node harness sweep a
 *  whole zoom through the exact state machine the game runs.
 * ============================================================================
 */

/** Every number the ladder runs on. No defaults; see the header. */
export interface DepthSpec {
  /**
   * Near-plane rungs, ASCENDING. Index 0 is the closest the camera will ever
   * be able to see, and it is the one that sets depth precision at the bottom
   * of the zoom.
   */
  rungs: readonly number[];
  /** Target near plane as a fraction of the camera's height above ground. */
  perAltitude: number;
  /** Far plane as a multiple of that altitude, before the two bounds below. */
  farPerAltitude: number;
  /** Floor on far. Usually the world's horizon plus its map. */
  farMin: number;
  /** Ceiling on far. Past here the depth range is being spent on nothing. */
  farMax: number;
  /**
   * The hold band around the current rung, as multipliers of that rung's own
   * value: the rung is kept while the target sits between `hold[0]` and
   * `hold[1]` times it.
   *
   * It must straddle 1 and it must be WIDER than the gap between rungs in at
   * least one direction, or it is not hysteresis — it is a rounding rule with
   * extra steps, and the matrix flips on the boundary exactly as before.
   */
  hold: readonly [number, number];
  /**
   * Fractional change in far below which far is left alone.
   *
   * Far is continuous, unlike near, so without a deadband every frame of a
   * climb rebuilds the projection matrix even when the rung has not moved —
   * which is the shimmer this whole file exists to avoid, arriving through the
   * other plane.
   */
  farDeadband: number;
}

/** A depth range, when it moved. `range()` returns null when it did not. */
export interface DepthRange {
  near: number;
  far: number;
  /** Index into `spec.rungs`. Readable, so a probe can assert the rung. */
  rung: number;
}

export class DepthLadder {
  private readonly spec: DepthSpec;
  /** -1 until the first `range()`, which therefore always reports. */
  private rung = -1;
  private appliedFar = -1;

  constructor(spec: DepthSpec) {
    this.spec = spec;
  }

  /** The rung currently held, or -1 before the first call. */
  index(): number {
    return this.rung;
  }

  /** Forgets the held rung, so the next `range()` reports whatever it picks. */
  reset(): void {
    this.rung = -1;
    this.appliedFar = -1;
  }

  /**
   * The depth range for this altitude, or null when nothing moved.
   *
   * NULL IS THE COMMON ANSWER AND IT IS THE USEFUL ONE: the caller only calls
   * `camera.updateProjectionMatrix()` when it is handed a range, which is what
   * makes the ladder a ladder rather than a per-frame recompute wearing one's
   * name.
   */
  range(altitude: number): DepthRange | null {
    const s = this.spec;
    const rungs = s.rungs;
    // AN EMPTY LADDER IS A CALLER BUG AND IT MUST NOT RENDER AS A DEPTH RANGE.
    // Returning a plausible default here — 0.1 and 1000, say — is the classic
    // silent failure: the projection would be built, the frame would look
    // merely wrong, and nothing would say why.
    if (rungs.length === 0) throw new Error('DepthLadder: spec.rungs is empty');
    const want = altitude * s.perAltitude;

    let idx = 0;
    while (idx < rungs.length - 1 && (rungs[idx + 1] as number) <= want) idx++;
    if (this.rung >= 0) {
      const held = rungs[this.rung] as number;
      if (want > held * s.hold[0] && want < held * s.hold[1]) idx = this.rung;
    }

    const far = Math.min(s.farMax, Math.max(s.farMin, altitude * s.farPerAltitude));
    if (idx === this.rung && Math.abs(far - this.appliedFar) < far * s.farDeadband) return null;

    this.rung = idx;
    this.appliedFar = far;
    return { near: rungs[idx] as number, far, rung: idx };
  }
}
