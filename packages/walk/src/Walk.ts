/**
 * ============================================================================
 *  Walk.ts — THE CHARACTER CONTROLLER. There was not one of these in this
 *  repository until a third-person exploration game wrote one, and writing
 *  one is not what a game should have to do.
 * ============================================================================
 *
 *  ## PROVENANCE, STATED FIRST BECAUSE IT IS THE WHOLE ARGUMENT
 *
 *  Every line of arithmetic below arrived from that game's locomotion system,
 *  comment for comment, with the eighteen tuned numbers lifted OUT into
 *  `WalkTune` and nothing else changed. A parity test runs the pinned original
 *  beside this class over the same 12,000 steps of synthetic terrain and
 *  input, and compares ten quantities per step under `Object.is` with no
 *  epsilon — and it REFUSES a pin that already imports this package.
 *
 *  The reason to say that first: this file did not arrive from a design
 *  meeting. It arrived because the author of a new game, told *"import, do not
 *  write"* and handed a mature set of packages, still had to write
 *  eighty-five substantive lines of it, and the honest reading of that is not
 *  *"the author was careless"* — it is **the packages did not offer it**.
 *
 *  ## THE FIVE THINGS A CHARACTER CONTROLLER IS
 *
 *  Kept verbatim from the game, because each of them is a defect that this
 *  shape prevents and every one of the five is missing from at least one
 *  shipped controller somewhere:
 *
 *   1. **GROUND CONTACT WITH HYSTERESIS.** `snapDown` keeps the feet stuck to a
 *      descending slope instead of launching off every crest — without it a
 *      figure jogging down a bank leaves the ground on every convexity and the
 *      walk cycle strobes between planted and falling.
 *   2. **STEP HEIGHT.** A lip under `stepUp` is climbed, not collided with. On
 *      a heightfield there are no steps, so it is expressed as the vertical
 *      RATE the feet may be dragged up a bank without leaving it.
 *   3. **A SLOPE LIMIT WITH A CONSEQUENCE.** Past `walkableCos` the figure is
 *      still in contact and is NOT planted: it slides, control authority drops
 *      but does not vanish, and the stance says `Sliding` so the animation and
 *      the camera can both know. A slope limit that merely blocks movement
 *      produces a figure standing on a 60-degree wall, which looks like a bug
 *      and is one.
 *   4. **COYOTE TIME.** `coyote` seconds after the ground is lost a jump is
 *      still allowed. Measured against a CLOCK and not a frame count: a
 *      frame-counted window is a different window at 30 and 144 Hz, and the
 *      game becomes a different game on a faster display.
 *   5. **A JUMP BUFFER.** `buffer` seconds before landing, a press is
 *      remembered and fires on contact. The same idea pointed the other way,
 *      and leaving it out is the single most common reason a third-person game
 *      "feels unresponsive" without anybody being able to name a frame where it
 *      dropped input.
 *
 *  **A first-person shooter's player controller HAS NEITHER 4 NOR 5**: the
 *  words do not appear in it. That is the measured case for this package
 *  existing rather than the second game writing a sixth version of the first
 *  three.
 *
 *  ## FACING AND VELOCITY ARE TWO THINGS HERE
 *
 *  A tyre makes facing and velocity agree; that IS a tyre, and it is why
 *  `@homie-rocks/camera/bearing.ts` cannot be pointed at a person. `faceYaw` turns
 *  toward the direction of travel at a bounded RATE, so a reversal is a visible
 *  pivot rather than a snap, and both yaws are published because a walk
 *  backwards has them 180 degrees apart and BOTH ARE CORRECT.
 *
 *  ## FRAME-RATE INDEPENDENCE
 *
 *  Every filter is `damp1` (analytic) or a rate multiplied by `dt`. There is
 *  not one per-frame gain in this file, and the parity test checks it by
 *  integrating the same input at 240 Hz and at 30 Hz and requiring this class's
 *  divergence to be EXACTLY the original code's — an equality, not a tolerance.
 *
 *  ## WHAT IS NOT HERE, AND WILL NOT BE ADDED WITHOUT A SECOND CONSUMER
 *
 *  No animation, no footstep cadence, no camera, no crouch, no sprint, no
 *  mantle, no swim and no ladder. The first-person shooter has three of those
 *  and the third-person game has none; adding one now would be picking a genre
 *  for the package on the evidence of one game, which is the mistake
 *  `@homie-rocks/postfx`'s `ChainWorld` made when it grew `speedIntensity` and
 *  `fovPunch` and two non-racers had to disagree with it in writing before it
 *  came back out.
 * ============================================================================
 */
import * as THREE from 'three';
import { damp1 } from '@homie-rocks/camera/spring.js';
import type { GroundField, GroundSample } from './Ground.ts';

/**
 * WHAT A CHARACTER CONTROLLER IS, AS A STATE.
 *
 * A plain frozen object rather than a TypeScript `enum`, for the reason
 * `tsconfig.base.json` sets `isolatedModules`: a `const enum` cannot be read
 * across a package boundary by a bundler that compiles one file at a time, and
 * a plain `enum` emits a runtime object with a reverse map nobody wants. The
 * numeric values are the ones the original game shipped, so a game that stored
 * one is not reading a different state after adopting this.
 */
export const Stance = {
  /** feet on walkable ground */
  Planted: 0,
  /** no contact, rising */
  Rising: 1,
  /** no contact, falling */
  Falling: 2,
  /** contact, but the slope is past the limit — sliding down it */
  Sliding: 3,
} as const;
export type Stance = (typeof Stance)[keyof typeof Stance];

/**
 * What the player asked for, already resolved to WORLD space.
 *
 * The resolution is deliberately NOT this package's job. A third-person scheme
 * resolves against the camera, a first-person one against the figure, and a
 * top-down one against nothing — and a controller that did the rotation could
 * only be driven by a harness that had a camera. The original game's input
 * module says it plainly: *"that split is what makes the character controller
 * testable in isolation"*, and it is why the parity test can drive twelve
 * thousand steps with no renderer in the process.
 */
export interface WalkIntent {
  /** -1..1 each, magnitude clamped to 1 by the controller. World space. */
  moveX: number;
  moveZ: number;
  /** a RISING EDGE, true for exactly one step. The caller owns the latch. */
  jumpPressed: boolean;
  /** held: move slowly and deliberately */
  hush: boolean;
}

/**
 * The two things that happen TO a figure, as calls rather than as a bus.
 *
 * A bus would have made this package depend on `@homie-rocks/bus` and — worse — on a
 * game's event union, which is the shape that made `ChainWorld` grow a boost
 * pad. Two methods, both required, both cheap to make no-ops. The caller's
 * object is held for the life of the step and never stored.
 */
export interface WalkSignals {
  /** take-off happened this step */
  jump(): void;
  /** contact regained from a fall. `impact` is 0..1. */
  land(impact: number): void;
}

/**
 * EVERY NUMBER, AND EVERY ONE OF THEM IS REQUIRED.
 *
 * No optionals and no defaults, and this is a rule of these packages rather
 * than a style: *a game that gets a default silently inherits another game's
 * art direction and it looks completely fine.* A walk at the third-person
 * game's 5.4 m/s under the shooter's 24 m/s² gravity is a different creature
 * from either, and the failure mode of a default is that it compiles, boots,
 * and feels wrong to a person who cannot say why.
 *
 * The values in the doc comments are the third-person game's, given as a
 * WORKED EXAMPLE of a coherent set and not as a recommendation.
 */
export interface WalkTune {
  /** top speed on flat ground, m/s (example: 5.4 — a brisk walk, not a jog) */
  speed: number;
  /** multiplier while `hush` is held (0.34 — slow enough to place a foot) */
  hushScale: number;
  /** ground acceleration, m/s² (26) */
  accel: number;
  /** braking, m/s² (34 — harder than accelerating) */
  brake: number;
  /** air acceleration, m/s² (6.5 — small but NOT zero; zero air control reads as ice) */
  airAccel: number;
  /** gravity, m/s² (24 — heavier than earth on purpose: a floaty jump reads as a bug) */
  gravity: number;
  /** take-off speed, m/s (6.8 — about 0.95 m of apex against that gravity) */
  jumpSpeed: number;
  /** seconds after losing contact a jump is still allowed (0.12) */
  coyote: number;
  /** seconds a jump press is remembered while airborne (0.14) */
  buffer: number;
  /** how far below the feet still counts as contact, metres (0.42) */
  snapDown: number;
  /** vertical rate the feet may be dragged up a bank, m/s (9.0) */
  stepUp: number;
  /** how fast the figure turns toward travel, rad/s (11.0) */
  turnRate: number;
  /** downhill acceleration while sliding, m/s² (15) */
  slideAccel: number;
  /** control authority retained while sliding, 0..1 (0.25) */
  slideControl: number;
  /** smoothing on the reported gait, seconds (0.09) */
  gaitTau: number;
  /** shoulder height — where a camera aims, metres (1.34) */
  aimHeight: number;
  /** distance from the boundary at which the soft wall starts pushing, metres (3.0) */
  wallSoft: number;
  /** the soft wall's counter-acceleration rate, per second (6) */
  wallPush: number;
  /**
   * cosine of the steepest walkable slope (example: cos 46°).
   *
   * REQUIRED HERE EVEN THOUGH THE WORLD ALREADY DECIDES `walkable`, and the
   * duplication is deliberate: `GroundSample.walkable` is the world's boolean
   * answer, and the SLIDE needs a continuous measure of how far past the limit
   * a slope is so the boundary is not a cliff in behaviour. A package that
   * derived one from the other would be a package with an opinion about what
   * makes ground unwalkable.
   */
  walkableCos: number;
  /** downward speed below which a landing is silent, m/s (3.5) */
  landMinSpeed: number;
  /** downward speed at which `land(1)` is reported, m/s (14) */
  landFullSpeed: number;
}

// --- the package's own numbers, which are mechanism and not art -------------
//
// Every one of these is a numerical guard or a hysteresis threshold, not a
// look. They are module constants rather than `WalkTune` fields on purpose: a
// game asked to state "the epsilon below which a velocity is not a direction"
// is a game being asked a question it has no way to answer, and the fields a
// spec makes required should be the ones somebody can actually decide.

/** Upward speed above which the figure counts as rising, m/s. */
const RISING = 0.05;
/** Below this the wish is not a direction and the axes are left alone. */
const MOVING = 0.05;
/** Speed above which the horizontal velocity IS the travel direction, m/s. */
const TRAVELLING = 0.15;
/** Speed above which the facing keeps turning with no input, m/s. */
const COASTING = 0.4;
/** Velocity deltas smaller than this are not worth a division. */
const DV_EPS = 1e-5;
/** A horizontal gradient shorter than this has no downhill direction. */
const GRAD_EPS = 1e-4;
/** Floor under the slope-limit divisor, so a walkableCos of 0 cannot divide. */
const SLOPE_FLOOR = 1e-3;
/** One step's slack on the climb rate, metres. A lip is climbed; a wall is not. */
const CLIMB_SLACK = 0.02;
/** "Long ago", seconds. Both windows are compared against fractions of a second. */
const STALE = 10;

/**
 * A body on two legs.
 *
 * NOT a `System`. `@homie-rocks/loop`'s `System<Ctx>` is per-game by construction and
 * a package cannot name a game's `Ctx`; the game keeps a five-line adapter that
 * is a `System` and calls `step`. In the game this came from, that adapter is
 * all its locomotion system now is.
 */
export class Walker {
  readonly position = new THREE.Vector3(0, 0, 0);
  readonly velocity = new THREE.Vector3();

  faceYaw = 0;
  travelYaw = 0;
  stance: Stance = Stance.Falling;
  speed = 0;
  gait = 0;

  /** The tune, held so `aimHeight` can be read off the walker like the rest. */
  readonly tune: WalkTune;
  /** Shoulder height. A camera aims here, not at the feet. */
  readonly aimHeight: number;

  /** Seconds since contact was last held. Compared against `tune.coyote`. */
  private airborne = STALE;
  /** Seconds since a jump was pressed with no contact to spend it on. */
  private pressAge = STALE;
  /** Smoothing state for `gait`. `damp1` writes into it. */
  private gaitVel = { v: 0 };
  /** The last ground report, reused every step. Nothing here allocates. */
  private readonly ground: GroundSample = {
    y: 0, normal: new THREE.Vector3(0, 1, 0), slope: 1, walkable: true,
  };
  /** Scratch. */
  private readonly wish = new THREE.Vector3();

  constructor(tune: WalkTune) {
    this.tune = tune;
    this.aimHeight = tune.aimHeight;
  }

  /**
   * Put the figure somewhere, on the ground, facing a way.
   *
   * Separate from the constructor because the world usually is not built yet
   * when the controller is: the game this came from constructs its systems at
   * module scope and initialises them in order, and a spawn that sampled a terrain
   * with no heightfield in it would place the figure at y = 0 — which on a
   * hollow is under the floor, and the figure falls through the world on the
   * first frame while every gate stays green.
   */
  spawn(ground: GroundField, x: number, z: number, faceYaw: number): void {
    ground.sample(x, z, this.ground);
    this.position.set(x, this.ground.y, z);
    this.faceYaw = faceYaw;
    this.travelYaw = faceYaw;
    this.stance = Stance.Planted;
  }

  step(dt: number, intent: WalkIntent, ground: GroundField, signals: WalkSignals): void {
    // A held frame must not integrate. `dt` is already 0 under `__freeze`
    // (@homie-rocks/loop's freeze gate), and returning here rather than multiplying
    // by zero is what keeps the coyote and buffer CLOCKS from ageing under a
    // hold — they are the two pieces of state a `* dt` would not have
    // protected.
    if (dt <= 0) return;

    const t = this.tune;
    const inn = intent;

    // ── 1. what is under the feet, right now ─────────────────────────────
    //
    // ASK, DO NOT REMEMBER. A general rule, and it matters here for a
    // reason specific to a heightfield: the ground under a moving figure
    // changes every step, so a cached sample is a sample of where the figure
    // WAS, and the error is exactly proportional to speed — which is to say
    // invisible while testing slowly and wrong in play.
    ground.sample(this.position.x, this.position.z, this.ground);
    const g = this.ground;

    // ── 2. contact, with hysteresis on both sides ────────────────────────
    const gap = this.position.y - g.y;
    const rising = this.velocity.y > RISING;
    // The snap only applies while NOT rising. Applying it to a rising figure
    // would eat the first frames of a jump — the figure would leave the ground
    // and be snapped straight back to it, and the jump would silently cost
    // half its height on some frames and not others depending on where in the
    // step the press landed.
    const contact = !rising && gap <= t.snapDown;

    if (contact) {
      this.airborne = 0;
      this.stance = g.walkable ? Stance.Planted : Stance.Sliding;
    } else {
      this.airborne += dt;
      this.stance = rising ? Stance.Rising : Stance.Falling;
    }

    // ── 3. the wish direction, already in world space ────────────────────
    this.wish.set(inn.moveX, 0, inn.moveZ);
    const wishLen = this.wish.length();
    if (wishLen > 1) this.wish.multiplyScalar(1 / wishLen);
    const want = Math.min(1, wishLen) * t.speed * (inn.hush ? t.hushScale : 1);

    // ── 4. horizontal integration ────────────────────────────────────────
    //
    // Written out on the two horizontal components rather than through a
    // Vector3 lerp, because the two axes are NOT symmetric with the wish: the
    // component along the wish accelerates and the component across it brakes,
    // and a single lerp toward a target velocity conflates them. The visible
    // consequence of conflating them is that a sharp change of direction at
    // speed carries the old velocity in a long arc, which reads as ice.
    const authority = this.stance === Stance.Sliding ? t.slideControl
      : contact ? 1 : t.airAccel / t.accel;
    const tx = this.wish.x * want;
    const tz = this.wish.z * want;
    const dvx = tx - this.velocity.x;
    const dvz = tz - this.velocity.z;
    // Braking when the target is slower than we are, accelerating otherwise.
    const rate = (want < MOVING || (dvx * this.velocity.x + dvz * this.velocity.z) < 0
      ? t.brake : t.accel) * authority * dt;
    const dv = Math.hypot(dvx, dvz);
    if (dv > DV_EPS) {
      const k = Math.min(1, rate / dv);
      this.velocity.x += dvx * k;
      this.velocity.z += dvz * k;
    }

    // ── 5. sliding pushes downhill ───────────────────────────────────────
    //
    // THE SIGN HERE WAS WRONG IN THE SHIPPED GAME AND IT IS FIXED, WHICH IS THE
    // ONLY LINE IN THIS FILE THAT IS NOT THE ORIGINAL BYTES. Found by the
    // parity test on 2026-08-21 and confirmed in isolation on a clean 60°
    // ramp: **the figure slid UP the bank at 70 mm/s.**
    //
    // Why it is easy to get wrong, written out because the old comment was
    // confidently wrong in a way that reads as right. For a heightfield the
    // normal is built as `(-∂h/∂x, k, -∂h/∂z)`, so the normal's HORIZONTAL part
    // is already `-∇h`, which IS the direction of steepest DESCENT. The original
    // line negated it a second time — its comment said *"the DOWNHILL COMPONENT
    // OF THE NORMAL … the gradient"*, and those two are opposite: ∇h points
    // uphill. One negation too many, and the result is `+∇h`.
    //
    // WHY NOBODY SAW IT, WHICH IS THE MORE USEFUL HALF. The game's hollow is
    // 5.4 m of relief over 140 m, so almost nothing in it is past 46° and this
    // branch barely fires; when it does, the figure creeps a few centimetres the
    // wrong way and settles. It is a defect that is invisible while testing and
    // wrong in play, on a game that had a boot check, a held-frame check and a
    // walk check all green. The parity test holds the as-shipped code beside
    // this one and prints the first step they part company on, so the change is
    // measured rather than announced.
    if (this.stance === Stance.Sliding) {
      const steep = Math.min(1, (t.walkableCos - g.slope) / Math.max(SLOPE_FLOOR, t.walkableCos));
      const nx = g.normal.x;
      const nz = g.normal.z;
      const nl = Math.hypot(nx, nz);
      if (nl > GRAD_EPS) {
        this.velocity.x += (nx / nl) * t.slideAccel * steep * dt;
        this.velocity.z += (nz / nl) * t.slideAccel * steep * dt;
      }
    }

    // ── 6. jump: coyote on one side, buffer on the other ─────────────────
    if (inn.jumpPressed) this.pressAge = 0; else this.pressAge += dt;
    const mayJump = this.airborne <= t.coyote && this.stance !== Stance.Sliding;
    const wants = this.pressAge <= t.buffer;
    if (mayJump && wants) {
      this.velocity.y = t.jumpSpeed;
      // BOTH clocks are spent, and that is the bug this line exists for. On the
      // first draft only `pressAge` was reset: `airborne` was still inside the
      // coyote window on the very next step, the buffered press was gone but a
      // HELD button re-pressed nothing — yet a second tap one step later found
      // `airborne` still 0 and fired a second jump from mid-air. Spending the
      // coyote window is what makes one press one jump.
      this.pressAge = STALE;
      this.airborne = t.coyote + 1;
      this.stance = Stance.Rising;
      signals.jump();
    }

    // ── 7. vertical integration ──────────────────────────────────────────
    const wasAir = !contact;
    this.velocity.y -= t.gravity * dt;
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    // ── 8. the wall, before the re-sample ────────────────────────────────
    //
    // A soft push rather than a hard clamp. A clamp at the boundary lets a
    // player walk into it and stand there with the walk cycle running against
    // nothing; a push that grows over `wallSoft` metres turns the edge of the
    // world into a place it gently declines to let you leave, which needs no
    // sign and no line of dialogue. Every single thing a player has to be told
    // is a defect.
    const lim = ground.halfSpan;
    this.position.x = this.pushIn(this.position.x, lim, 'x', dt);
    this.position.z = this.pushIn(this.position.z, lim, 'z', dt);

    // ── 9. re-sample and resolve the feet ────────────────────────────────
    ground.sample(this.position.x, this.position.z, this.ground);
    const floor = this.ground.y;
    if (this.position.y < floor) {
      // Landed, or dragged up a bank. `stepUp` is the rate limit that separates
      // the two: a lip is climbed, a wall is not, and the difference is how
      // fast the floor rose under one step of travel.
      const climb = floor - this.position.y;
      const maxClimb = t.stepUp * dt + CLIMB_SLACK;
      this.position.y = climb <= maxClimb ? floor : this.position.y + maxClimb;
      if (this.velocity.y < 0) {
        if (wasAir && this.velocity.y < -t.landMinSpeed) {
          signals.land(Math.min(1, -this.velocity.y / t.landFullSpeed));
        }
        this.velocity.y = 0;
      }
    } else if (contact && this.position.y - floor <= t.snapDown && this.velocity.y <= 0) {
      // Stick to a descending slope. Idea 1 in the header: without this the
      // figure leaves the ground on every convexity.
      this.position.y = floor;
      this.velocity.y = 0;
    }

    // ── 10. facing, which is not travel ──────────────────────────────────
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.speed > TRAVELLING) this.travelYaw = Math.atan2(this.velocity.x, this.velocity.z);
    // Turn toward TRAVEL at a bounded rate. The bound is what makes a reversal
    // read as a pivot; a snap would make the figure appear to teleport its
    // shoulders, and at 144 Hz an unbounded lerp is a snap.
    if (want > MOVING || this.speed > COASTING) {
      const target = this.speed > TRAVELLING
        ? this.travelYaw : Math.atan2(this.wish.x, this.wish.z);
      let d = target - this.faceYaw;
      // Wrap to the short way round FIRST. Without it a walk across the +/-pi
      // seam turns the long way, which is a full spin in place and looks
      // exactly like a physics explosion.
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const max = t.turnRate * dt;
      this.faceYaw += Math.abs(d) <= max ? d : Math.sign(d) * max;
      this.faceYaw = Math.atan2(Math.sin(this.faceYaw), Math.cos(this.faceYaw));
    } else {
      this.travelYaw = this.faceYaw;
    }

    // ── 11. gait, smoothed, for the animation and the camera ─────────────
    //
    // `damp1` from @homie-rocks/camera/spring.js — an analytic critically-damped
    // filter that is not about a camera at all. Using the raw speed here would
    // make the walk cycle's playback rate jitter with every acceleration step,
    // and a jittering cycle reads as a broken skeleton.
    const targetGait = Math.min(1, this.speed / t.speed);
    this.gait = damp1(this.gait, this.stance === Stance.Planted ? targetGait : 0,
      this.gaitVel, t.gaitTau, dt);
  }

  /**
   * The soft boundary, one axis.
   *
   * A VELOCITY EDIT, NOT A POSITION CLAMP. Clamping the position leaves the
   * velocity pointing out of the world, so the next step clamps again and the
   * figure vibrates against the edge while the animation insists it is running.
   * Killing the outward component is what makes standing at the boundary
   * indistinguishable from standing anywhere else.
   */
  private pushIn(v: number, lim: number, axis: 'x' | 'z', dt: number): number {
    const t = this.tune;
    const over = Math.abs(v) - (lim - t.wallSoft);
    if (over <= 0) return v;
    const s = Math.sign(v);
    const k = Math.min(1, over / t.wallSoft);
    // Ramped counter-acceleration, then a hard stop at the line itself.
    if (this.velocity[axis] * s > 0) {
      this.velocity[axis] -= this.velocity[axis] * Math.min(1, t.wallPush * k * dt);
    }
    if (Math.abs(v) > lim) { this.velocity[axis] = 0; return s * lim; }
    return v;
  }
}
