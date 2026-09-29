import * as THREE from 'three';

/**
 * ============================================================================
 *  RacerFx — the per-machine effect state both racers keep.
 * ============================================================================
 *  `wake.ts`, `blast.ts` and `drive.ts` moved the emitters. This moves the
 *  BAG THEY WRITE INTO.
 *
 *  Every one of the fields below was declared, with the same name, the same
 *  initial value and — where there was one — the same doc comment, in both
 *  racers' own effects file. Byte-identical, in two files, and every fix to
 *  either had one chance in two of being applied to a copy.
 *
 *  WHY A CLASS AND NOT AN INTERFACE. `drive.DriveState` and `wake.WakeState`
 *  already declare the SHAPE structurally, which is what lets the moved
 *  emitters take `fx: S` without either game's type crossing the seam. What
 *  they cannot declare is the INITIAL VALUES — `tierFlashLen = 0.22`,
 *  `boostTier = 1`, `trail = -1`, an identity `groundN`, the four contact-patch
 *  vectors — and those are the half that was actually duplicated. A base class
 *  carries them; each game's own fx record `extends RacerFx` and adds its own.
 *
 *  NOTHING GAME-SPECIFIC MAY LAND HERE. A field that only one racer reads
 *  belongs in that racer's subclass, where its reasons can be written next to
 *  the code that has them: the ship game's mag-lock, thermal and combat state,
 *  and its variable engine-stack count, are all still declared in its own file
 *  for exactly that reason.
 *
 *  `surface` is a plain `number` rather than either game's `Surface`, on the
 *  same rule the rest of this package follows — the game's own const enum stays
 *  the thing the game's own code reads, and `Surface.Road` is 0 in both.
 * ============================================================================
 */
export class RacerFx {
  sparkAcc = 0;
  smokeAcc = 0;
  dustAcc = 0;
  flameAcc = 0;
  sparkleAcc = 0;
  exhaustAcc = 0;
  scorchAcc = 0;
  poolAcc = 0;
  /** tier-2+ rising ember jet */
  jetAcc = 0;
  /** grit torn off the contact patch while sliding */
  gritAcc = 0;
  /** tier-3 ground pulse; counts beats, not particles */
  beatAcc = 0;
  rollAcc = 0;
  padAcc = 0;
  starAcc = 0;
  /** the ribbon-trail slot this machine holds while boosting, or -1 */
  trail = -1;
  lastTier = 0;
  /** seconds left of the ignition flash, drives the boost light's overshoot */
  igniteT = 0;
  /** seconds left of the drift-tier promotion flash */
  tierFlash = 0;
  /** what `tierFlash` was set to, so the flash can be normalised per tier */
  tierFlashLen = 0.22;
  /**
   * The mini-turbo tier the CURRENT boost was cashed from, latched on the
   * `boost` event and held until it expires.
   *
   * The game's drift release applies the boost and then zeroes `driftTier` in the
   * same call, so every consumer that read `k.driftTier` during a boost — the
   * plume tint, the ribbon colour, the boost lamp — saw 0, fell back to
   * `|| 1`, and painted the flame BLUE. A tier-3 mini-turbo, the hardest thing
   * in the game to earn, cashed out looking exactly like a mushroom. That is
   * the payoff half of the loop being invisible, and it was a one-line bug.
   */
  boostTier = 1;
  wasBoosting = false;
  stunPhase = 0;
  /** squash-and-stretch: signed impulse plus its velocity, a critically-ish
   *  damped spring so the chassis rebounds instead of snapping back */
  squash = 0;
  squashV = 0;
  squashOwned = false;
  resolved = false;
  /**
   * THE MODEL'S OWN EXHAUST / ENGINE ANCHORS, and the retry that finds them.
   *
   * `stacksResolved` came first; the four below joined it when
   * `RacerSystem.resolveStacks` replaced two resolvers that were
   * the same mechanism with one of them carrying a bug the other had already
   * found and written down. See that method.
   *
   * `stackCount` starts at 2 and is never 0 — `stackMouth`'s fallback pair
   * backs it — so a machine whose model publishes nothing still gets a flame
   * somewhere plausible rather than none at all.
   */
  stacksResolved = false;
  /** the anchors themselves. Length is the MODEL'S answer, not a constant. */
  readonly stackNode: (THREE.Object3D | null)[] = [];
  /** nozzle throat radius per anchor, metres, from the model's own def */
  readonly stackRadius: number[] = [];
  /** how many of `stackNode` are real. Never 0; see above. */
  stackCount = 2;
  /** clock at which the next resolve attempt is allowed. See `resolveStacks`. */
  stackTry = 0;
  /** seconds of boost rush streaks still owed, so the effect outlives one frame */
  rushAcc = 0;
  readonly offL = new THREE.Vector3(-0.62, 0, -0.80);
  readonly offR = new THREE.Vector3(0.62, 0, -0.80);
  readonly skidL = new THREE.Vector3();
  readonly skidR = new THREE.Vector3();
  skidding = false;
  skidStrength = 0;
  groundY = 0;
  readonly groundN = new THREE.Vector3(0, 1, 0);
  /** the game's own `Surface` numbering — see `WakeHost.onRoad` */
  surface = 0;
}
