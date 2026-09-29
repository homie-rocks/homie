/**
 * ============================================================================
 *  sightline — raise the whole shot until the ground stops standing in it.
 * ============================================================================
 *
 *  A foreground ridge across the lower half of the frame, with the subject
 *  behind it. The fix is a PARALLEL translation of the eye and the aim point
 *  together, and that is what makes it the right fix rather than adding
 *  depression: the horizon's position in frame depends only on pitch and field
 *  of view and not at all on altitude, so lifting clears the ridge and leaves
 *  a horizon gate exactly where the pose put it. Adding depression clears the
 *  same ridge and spends the sky.
 *
 *  ── THE CAP IS THE LOAD-BEARING PART ───────────────────────────────────────
 *
 *  The subject slides DOWN the frame by `lift / dist` radians, so an uncapped
 *  lift clears every ridge on the map by pushing the subject out of the bottom
 *  of the frame — trading a visible-but-occluded subject for an
 *  unoccluded-but-absent one, which is the same failure in a hat. The cap is a
 *  fraction of the vertical half-frame at the subject's range, so it scales
 *  with the shot instead of being a metre count somebody typed.
 *
 *  ── AND THE MARGIN TAPERS TO ZERO AT THE SUBJECT ───────────────────────────
 *
 *  A constant margin would lift every shot by the margin, because the ground AT
 *  the look-at point is inside the sample set and is supposed to be in frame.
 *  Tapering it to zero there means the margin only ever buys clearance over
 *  something between the lens and the subject.
 *
 *  ── EVERY NUMBER IS THE CALLER'S ───────────────────────────────────────────
 *
 *  `SightlineTuning` has no defaults, deliberately. A cap fraction and a margin
 *  ladder are a statement about one world's relief and one art direction's
 *  tolerance for a subject low in frame; a package that shipped a default would
 *  hand the next world the first world's terrain. The two failure modes a float
 *  comparison cannot see are a tuned constant crossing into a package and an
 *  extracted option welded shut, and the answer to both is that this file holds
 *  no number at all.
 *
 *  Iterative because the eye moves with the lift. Two passes is ample for a
 *  ray translated parallel to itself, and the caller says how many.
 */
import * as THREE from 'three';
import { forwardFromYawPitch } from './lens.ts';

/** Every number the solve uses. None of them has a default. */
export interface SightlineTuning {
  /** Cap, as a fraction of the vertical half-frame at `dist`. */
  maxFrac: number;
  /** Clearance over the ridge at the lens, metres, before the distance term. */
  marginBase: number;
  /** ...and metres of extra clearance per metre of subject range. */
  marginPerDist: number;
  /** Samples along the ray, endpoints excluded. */
  steps: number;
  /**
   * Refinement passes.
   *
   * A SECOND PASS CANNOT CHANGE THE ANSWER FOR A PURE HEIGHTFIELD, and that is
   * provable rather than measured: the eye is `aim - forward * dist`, so
   * raising `aim.y` by the lift raises the eye by exactly the same amount and
   * the whole ray is TRANSLATED. Every sampled intrusion falls by exactly the
   * lift, the next pass finds zero, and the loop breaks.
   *
   * It is an option, at the value the game that wrote it shipped, for two
   * reasons: deleting the loop would be a behaviour change smuggled into a
   * move, and a caller whose `groundY` is NOT a pure function of (x, z) — a
   * level-of-detail field, a clamped sampler, a field that grows detail near
   * the eye — is the case iteration was written for and is the case where the
   * second pass earns its keep.
   *
   * The parity probe's not-welded check deliberately leaves this option
   * off, with the same argument written out: a check that can never go red is a
   * green light wired to nothing.
   */
  passes: number;
  /** Metres of remaining intrusion below which the solve stops. */
  settle: number;
}

// Scratch. Live only between two adjacent statements inside `liftForSightline`
// and read by nobody outside it — see `scratch.ts` for why a shared `_eye`
// would be a different matter entirely.
const _fwd = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _eye = new THREE.Vector3();

/**
 * Metres the shot has to rise for the sightline between the eye and the aim
 * point to clear the ground under it. Zero when nothing is in the way.
 *
 * `target` is the SUBJECT, not the aim point: the aim point is the subject
 * plus the lift this returns, which is why the caller adds it rather than
 * this writing it.
 */
export function liftForSightline(
  target: THREE.Vector3,
  yaw: number, pitch: number, dist: number, fovDeg: number,
  groundY: (x: number, z: number) => number,
  o: SightlineTuning,
): number {
  const cap = dist * Math.tan(fovDeg * Math.PI / 360) * o.maxFrac;
  const margin = o.marginBase + dist * o.marginPerDist;
  const steps = o.steps;
  let lift = 0;
  for (let iter = 0; iter < o.passes; iter++) {
    forwardFromYawPitch(yaw, pitch, _fwd);
    _aim.copy(target); _aim.y += lift;
    _eye.copy(_aim).addScaledVector(_fwd, -dist);
    let need = 0;
    for (let i = 1; i < steps; i++) {
      const s = i / steps;
      const x = _eye.x + (_aim.x - _eye.x) * s;
      const z = _eye.z + (_aim.z - _eye.z) * s;
      const y = _eye.y + (_aim.y - _eye.y) * s;
      // Taper the margin to zero at the look-at point — see the header.
      const g = groundY(x, z) + margin * (1 - s);
      if (g - y > need) need = g - y;
    }
    if (need <= o.settle) break;
    lift = Math.min(cap, lift + need);
    if (lift >= cap) break;
  }
  return lift;
}
