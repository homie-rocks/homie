/**
 * ============================================================================
 *  shake — a jolt from a source, falling off with distance, that reads the
 *  same at two metres and at two kilometres.
 * ============================================================================
 *
 *  Something in the world is violent — a launch, an impact, a collapse — and
 *  the lens should feel it. Three properties, and each of them is the
 *  difference between a jolt and a wobble:
 *
 *  ── IT FALLS OFF, AND WITH AN INVERSE SQUARE OF A RADIUS ───────────────────
 *
 *  A launch nine hundred metres away is a SPECTACLE, not a jolt. Linear falloff
 *  either kills the near case or leaves the far one buzzing; `1 / (1 + (d/r)^2)`
 *  is 1 at the source, a quarter at the radius and a hundredth at three times
 *  it, which is the shape a person expects. `r` is the caller's, because it is
 *  a statement about one world's scale.
 *
 *  ── THE AMPLITUDE SCALES WITH THE SHOT, NOT WITH THE WORLD ─────────────────
 *
 *  A fixed metre amplitude is a blur at two metres and invisible at two
 *  kilometres. Scaling it by the camera's own range makes the shake a constant
 *  fraction of the FRAME, which is the unit an eye actually measures it in.
 *  The cap is what stops a regional shot from swinging half a kilometre.
 *
 *  ── THREE INCOMMENSURATE FREQUENCIES, OR IT LOOKS LIKE A SINE ──────────────
 *
 *  One frequency on all three axes is a circle; two that share a factor close
 *  on themselves within a second and read as a mechanism rather than as an
 *  event. Three that do not divide each other never repeat inside a shot. They
 *  are the caller's for the same reason a tuning always is, and the vertical
 *  one is separately weighted because up-down reads stronger than side-to-side
 *  at the same amplitude.
 *
 *  ── AND IT IS AN OFFSET, NOT A WRITE ───────────────────────────────────────
 *
 *  Returned into `out` and added by the caller, so a rig that already owns
 *  `camera.position` keeps owning it. A shake that wrote the camera would be a
 *  second author of the transform, which is the defect `freefly.ts`'s header
 *  spends two paragraphs on.
 */
import * as THREE from 'three';

/** Every number the shake uses. None of them has a default. */
export interface ShakeTuning {
  /** Distance at which a source contributes a quarter of its amplitude. */
  falloffM: number;
  /** Amplitude per unit of camera range, before the cap. */
  ampPerRange: number;
  /** Ceiling on the amplitude, world units. */
  ampMax: number;
  /** Radians per second on each axis. Pick three that do not divide each other. */
  freqX: number;
  freqY: number;
  freqZ: number;
  /** Multiplier on the vertical axis. Up-down reads stronger than side-to-side. */
  verticalK: number;
  /** Amplitudes at or below this produce nothing at all. */
  floor: number;
}

/**
 * How much of a source's amplitude survives `distance`. 1 at zero, a quarter
 * at `falloffM`. Exposed on its own because a caller usually has to take the
 * MAX over several sources before it knows what to ask for.
 */
export function shakeFalloff(distance: number, falloffM: number): number {
  const k = distance / falloffM;
  return 1 / (1 + k * k);
}

/**
 * The offset for one frame, written into `out`. False — and `out` untouched —
 * when the amplitude is below the floor, so a caller can skip its own
 * `updateMatrixWorld`.
 *
 * `range` is how far the lens is from what it is looking at; `t` is a clock in
 * seconds and may be the simulation's, so a frozen frame does not shake.
 */
export function shakeOffset(
  amount: number, range: number, t: number, o: ShakeTuning, out: THREE.Vector3,
): boolean {
  if (!(amount > o.floor)) return false;
  const amp = Math.min(o.ampMax, range * o.ampPerRange) * amount;
  out.set(
    Math.sin(t * o.freqX) * amp,
    Math.sin(t * o.freqY) * amp * o.verticalK,
    Math.sin(t * o.freqZ) * amp,
  );
  return true;
}
