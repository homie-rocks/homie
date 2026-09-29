/**
 * ============================================================================
 *  Camera — the lens pose at an authored time, sampled from the shot's own
 *  keys by the studio's spline rather than a second copy of one.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **Asking for the lens at t twice gives the same answer, and asking for it
 *   at the cut in gives exactly the first key.**
 *
 * ## Why it is four functions and not four hundred lines
 *
 * `@homie-rocks/camera/keyframe.js` already owns the hard part: a cardinal spline
 * through unevenly spaced keys whose tangents do not kink at the joins, and an
 * ease that is a REPARAMETERISATION rather than a curve on the output — so a
 * shot that eases in and out still lasts exactly as long as it was authored to.
 * That file was extracted from a game's trailer camera, on the same set the
 * short film this package came from was shot on.
 *
 * That film did not use it. Its Director interpolated `camA → camB`
 * with a hand-written smoothstep, which is why every one of its forty-five
 * shots has exactly two camera positions: with a linear lerp and no spline
 * there is nothing a third key could do except add a corner. The declarative
 * timeline allows any number of keys precisely because the sampler underneath
 * can hold a curve through them.
 *
 * So this file is glue, on purpose, and the glue is the product: it is what
 * makes the film manifest's `CameraKey[]` and the studio's sampler the same
 * thing rather than two things that agree for now.
 */

import { sampleKeys, easeRamp } from '@homie-rocks/camera/keyframe.js';
import type { CameraKey, CompiledShot, Film, Vec3 } from './Timeline.ts';

/** Where the lens is and what it is doing, at one instant. */
export interface LensPose {
  readonly eye: Vec3;
  readonly aim: Vec3;
  readonly fovDeg: number;
  readonly rollDeg: number;
}

/**
 * The lens inside one shot, at normalised position `p`.
 *
 * The ease is applied to `p` BEFORE sampling, which is what makes it a
 * reparameterisation: the keys still land where they were authored and only
 * the rate of travel between them changes. Applying it after would move the
 * keys, and a director who put a key at the halfway point would find it
 * somewhere else.
 */
export function lensAt(shot: CompiledShot, p: number): LensPose | null {
  const camera = shot.camera;
  if (!camera || camera.keys.length === 0) return null;
  const keys = camera.keys;
  const first = keys[0]!;
  if (keys.length === 1) {
    return { eye: first.eye, aim: first.aim, fovDeg: first.fov, rollDeg: first.roll ?? 0 };
  }
  const ease = camera.ease;
  const t = ease ? easeRamp(clamp01(p), ease.head, ease.tail) : clamp01(p);

  // Flattened once per call. `sampleKeys` reads a NAMED channel off each key,
  // and `eye` is an array — so the channels have to exist as scalars. Doing it
  // here rather than storing flattened keys in the manifest keeps the authored
  // form readable: `eye: [3, 1.2, -8]` is a place, `ex: 3, ey: 1.2, ez: -8` is
  // three numbers somebody has to reassemble in their head.
  const flat = keys.map(flatten);
  return {
    eye: [sampleKeys(flat, 'ex', t), sampleKeys(flat, 'ey', t), sampleKeys(flat, 'ez', t)],
    aim: [sampleKeys(flat, 'ax', t), sampleKeys(flat, 'ay', t), sampleKeys(flat, 'az', t)],
    fovDeg: sampleKeys(flat, 'fov', t),
    rollDeg: sampleKeys(flat, 'roll', t),
  };
}

/** The lens at an absolute time in the film. */
export function lensAtTime(film: Film, t: number): { shot: CompiledShot; lens: LensPose | null } {
  const placement = film.at(t);
  return { shot: placement.shot, lens: lensAt(placement.shot, placement.p) };
}

interface FlatKey {
  readonly p: number;
  readonly ex: number; readonly ey: number; readonly ez: number;
  readonly ax: number; readonly ay: number; readonly az: number;
  readonly fov: number; readonly roll: number;
}

function flatten(key: CameraKey): FlatKey {
  return {
    p: key.p,
    ex: key.eye[0], ey: key.eye[1], ez: key.eye[2],
    ax: key.aim[0], ay: key.aim[1], az: key.aim[2],
    fov: key.fov, roll: key.roll ?? 0,
  };
}

/**
 * How fast the lens is moving, in metres per second of authored time.
 *
 * Used by `QA.ts` to tell an authored hold from a stall, and by a director to
 * find the shot that whips. Measured by difference rather than analytically:
 * the spline's derivative exists but a difference over one frame is the
 * quantity that actually matters, because a move that only happens between two
 * rendered frames is a move nobody sees.
 */
export function lensSpeed(shot: CompiledShot, p: number, fps: number): number {
  const dp = 1 / Math.max(1e-6, shot.seconds * fps);
  const a = lensAt(shot, Math.max(0, p - dp / 2));
  const b = lensAt(shot, Math.min(1, p + dp / 2));
  if (!a || !b) return 0;
  const distance = Math.hypot(b.eye[0] - a.eye[0], b.eye[1] - a.eye[1], b.eye[2] - a.eye[2]);
  return distance * fps;
}

/**
 * Does this shot's lens move at all?
 *
 * A separate question from `lensSpeed` because a shot with two identical keys
 * is authored as a locked-off frame, and a locked-off frame is allowed to
 * produce identical pixels. `QA.ts` asks this before calling a run of
 * identical frames a defect.
 */
export function lensIsLocked(shot: CompiledShot): boolean {
  const keys = shot.camera?.keys;
  if (!keys || keys.length <= 1) return true;
  const first = keys[0]!;
  return keys.every((k) =>
    k.eye[0] === first.eye[0] && k.eye[1] === first.eye[1] && k.eye[2] === first.eye[2] &&
    k.aim[0] === first.aim[0] && k.aim[1] === first.aim[1] && k.aim[2] === first.aim[2] &&
    k.fov === first.fov && (k.roll ?? 0) === (first.roll ?? 0));
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
