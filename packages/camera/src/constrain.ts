/**
 * ============================================================================
 *  The two hard constraints both chase rigs apply, before they stop agreeing.
 * ============================================================================
 *
 *  `constrainEye` is a chain: rate-limit the free motion, then push the lens
 *  out of everything it may not be inside. When the rig was first extracted
 *  the whole chain was read and **REFUSED**, correctly, on its tail — the kart
 *  racer's floor and ceiling work in world Y where the space racer works in
 *  DEPTH along the deck normal, and a world-Y floor is wrong by the whole bank
 *  angle and wrong in SIGN through an inversion. That refusal stands and
 *  nothing here touches it.
 *
 *  **BUT THE HEAD OF THE CHAIN IS TWENTY-TWO BYTE-IDENTICAL LINES**, and the
 *  clamp under it diverges by a NUMBER. Refusing a function is not the same as
 *  refusing every line in it, and the two halves are separated by an ordinary
 *  statement boundary rather than by anything structural:
 *
 *  - {@link limitEyeSpeed} — identical, character for character, in both.
 *  - {@link pushMinRange} — identical except that the space racer's floor is
 *    `Math.max(MIN_RANGE, this.subjMinRange)` where the kart racer's is
 *    `MIN_RANGE`. Both games pass the floor they want; a game with no
 *    screen-height solve passes its bare constant and gets exactly the four
 *    lines it used to run. The same shape as `poseChase`'s `push`, which is
 *    `+ 0` in the game that has no such solve.
 *
 *  Everything downstream of these two — the surface probe, the floor, the
 *  bore roof, the barrier push and the furniture ejection — stays in the
 *  games, where its two geometric models can go on being two.
 *
 *  **THE EYE IS THE CALLER'S VECTOR AND IS MUTATED IN PLACE.** Same
 *  arrangement as `cinematics.ts` and `chase.ts`: the games keep writing into
 *  their own module-scope `_eye`, and nothing downstream reads a vector this
 *  file owns.
 * ============================================================================
 */
import * as THREE from 'three';

/** This file's scratch. See the header of `chase.ts`: deliberately NOT the
 *  games', so a caller's `_tmp` keeps whatever the caller last put in it.
 *  Every `_tmp` site in both `Camera.ts` files was read for this move and all
 *  of them write before their next read, so nothing depended on the clobber
 *  these two functions used to perform. */
const _t = /* @__PURE__ */ new THREE.Vector3();

/** Exactly the two fields {@link limitEyeSpeed} reads off a rig. Not a
 *  camera, not a `Ctx`. */
export interface EyeRig {
  /** Where the lens was last frame. */
  prevEye: THREE.Vector3;
  /** Whether the above is a real answer. False on the frame after a cut. */
  hasPrevEye: boolean;
}

/** Where the machine is and how fast. Not the game's vehicle type, which carries a lap. */
export interface EyeSubject {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
}

/**
 * How fast the lens itself may move, in metres per second.
 *
 * **Order matters, and the reason belongs at the top of the caller's chain
 * rather than here:** the rate limit applies to the FREE motion — the pose,
 * the dip, the kick — and the constraints are applied to the result. A
 * constraint is not a move: it is the statement that the lens cannot be here,
 * and it has to win outright or it does nothing at all. Run the other way
 * round, the one thing whose job is to get the lens out of solid matter is
 * immediately undone by a clamp pulling it back toward where it came from.
 *
 * Measured RELATIVE TO THE MACHINE, so following it down a straight at 30 m/s
 * costs nothing against the budget and only the rig's own motion is charged.
 *
 * Sets `hasPrevEye` on the way out, so the frame after a cut is the one frame
 * that is not charged. The caller does NOT also write it; a flag set in two
 * places is a flag that gets cleared in one.
 */
export function limitEyeSpeed(
  eye: THREE.Vector3, rig: EyeRig, subject: EyeSubject, maxSlip: number, dt: number,
): void {
  if (rig.hasPrevEye) {
    _t.copy(eye).sub(rig.prevEye).addScaledVector(subject.velocity, -dt);
    const len = _t.length();
    const maxStep = maxSlip * dt;
    if (len > maxStep) eye.sub(_t.multiplyScalar(1 - maxStep / len));
  }
  rig.hasPrevEye = true;
}

/**
 * The lens may not be closer to the machine than `minRange` metres.
 *
 * During a spin the bearing rotates around the machine and a straight path
 * between two poses cuts the chord; without this the lens can pass within a
 * metre of the chassis and the machine goes through the near plane.
 *
 * `arm` is the escape direction for the degenerate case only — a lens exactly
 * on the machine's origin has no direction to be pushed along, and the bearing
 * is the one that puts it behind rather than in front. 1e-3 m rather than an
 * epsilon because below a millimetre the normalised direction is noise.
 *
 * **`minRange` IS THE WHOLE OF THE DIVERGENCE.** The kart racer passes its
 * near-plane constant. The space racer passes `Math.max(MIN_RANGE, subjMinRange)`,
 * because MIN_RANGE answers "is the ship through the near plane", which is a
 * question about 0.2 m of clip distance, while `subjMinRange` answers "is the
 * ship still a shape" — and it is the larger of the two on every frame that
 * matters. No default is shipped for either, here or anywhere in this package.
 */
export function pushMinRange(
  eye: THREE.Vector3, pos: THREE.Vector3, arm: THREE.Vector3, minRange: number,
): void {
  _t.copy(eye).sub(pos);
  const r = _t.length();
  if (r < minRange) {
    if (r > 1e-3) eye.copy(pos).addScaledVector(_t, minRange / r);
    else eye.copy(pos).addScaledVector(arm, -minRange);
  }
}
