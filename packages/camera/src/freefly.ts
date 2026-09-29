/**
 * ============================================================================
 *  freefly — the photographer's camera: drag to look, keys to fly, and one
 *  rule about who writes the transform.
 * ============================================================================
 *
 *  ── "LAST WRITE WINS" ONLY HOLDS IF THE WRITE IS ABSOLUTE ──────────────────
 *
 *  This is the whole reason the rig owns a `position` of its own rather than
 *  pushing the camera around.
 *
 *  A gameplay rig writes `camera.position.copy(...)` from its own state EVERY
 *  FRAME. A free camera that integrates with `camera.position.addScaledVector(
 *  vel, dt)` is therefore adding a frame of travel on top of something that is
 *  about to be overwritten, and every metre of it is discarded on the next
 *  frame. MEASURED on a real game by flying with real key events: the ROTATION
 *  was absolute and did win; the POSITION was relative and did not, so the free
 *  camera contributed exactly one frame of travel forever — and it LOOKED like
 *  it worked, because the fly keys were also the gameplay pan keys and the
 *  gameplay rig was moving underneath.
 *
 *  So the rig integrates into `state.position` and the caller copies that onto
 *  the camera. Any package that ever offers a free-fly camera has to state that
 *  it takes the WHOLE transform or none of it, and this one takes the whole
 *  transform.
 *
 *  ── TWO THINGS SCALE WITH FOCAL LENGTH, AND BOTH ARE THE POINT ─────────────
 *
 *  LOOK: a long lens must pan slowly. At a fixed radians-per-pixel, framing a
 *  50 m subject at 300 m through a 200 mm lens is chasing it around the screen.
 *  Real long lenses behave the other way and so does this.
 *
 *  FLY: at 200 mm you are working at distance and want to creep; at 14 mm you
 *  are inside the scene and want to move. One multiplier, stated once.
 *
 *  ── AND THE VELOCITY IS EASED, NOT SET ─────────────────────────────────────
 *
 *  An instant-velocity free camera is unusable for framing, because every
 *  correction overshoots. The ease is an exponential approach on a time
 *  constant the caller names.
 *
 *  ── EVERY NUMBER IS THE CALLER'S ───────────────────────────────────────────
 *
 *  `FreeFlyTuning` ships no defaults. A base speed is a statement about one
 *  world's scale — 14 m/s is right on a two-kilometre playfield and absurd
 *  inside a corridor — and a look sensitivity is a statement about one game's
 *  pointer feel.
 */
import * as THREE from 'three';
import { expApproach } from './spring.ts';

/** Which way the player is pushing, this frame. All six are independent. */
export interface FlyAxes {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

/** The rig's own state. Create one, keep it, hand it back every call. */
export interface FlyState {
  /** Radians. Applied as a YXZ euler, so this is the Y term. */
  yaw: number;
  /** Radians, clamped by `pitchLimit`. */
  pitch: number;
  /** Vertical field of view, degrees. The truth; a focal length is a display. */
  fov: number;
  /** World position, integrated here and copied onto the camera by the caller. */
  readonly position: THREE.Vector3;
  /** Eased world velocity. Reset it when the rig is adopted. */
  readonly velocity: THREE.Vector3;
}

/** Every number the rig uses. None of them has a default. */
export interface FreeFlyTuning {
  /** Radians of look per pointer pixel, at `lookRefFov`. */
  lookRadPerPx: number;
  /** The field of view the sensitivity above was authored at. */
  lookRefFov: number;
  /** Sensitivity stops narrowing below this field of view. */
  lookMinFov: number;
  /** Radians either side of level the pitch may reach. */
  pitchLimit: number;
  /** Time constant of the velocity ease, seconds. */
  velTau: number;
  /**
   * The ease SETTLES rather than asymptoting: below this much remaining
   * difference the velocity is set to the target exactly.
   *
   * NOT tidiness. An exponential never arrives, so a rig let go of at speed
   * keeps integrating a vanishing velocity for the rest of the session and the
   * camera never stops — which reads as drift, not as a bug. `@homie-rocks/ui`'s
   * `approach` carries the same snap for the same reason on a readout; this is
   * that reason applied to a position.
   */
  velSnap: number;
  /** World units per second at `speedRefFov`, before boost and scale. */
  baseSpeed: number;
  /** The field of view `baseSpeed` was authored at. */
  speedRefFov: number;
}

// Scratch. Live only inside one call and read by nobody outside it.
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _wish = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/** A fresh state at the origin, looking down -Z at `fov`. */
export function flyState(fov: number): FlyState {
  return {
    yaw: 0, pitch: 0, fov,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
  };
}

/**
 * Take the camera's CURRENT transform, so opening the free camera never moves
 * the frame the player was looking at. Zeroes the velocity, because a rig
 * adopted mid-flight would otherwise coast off the pose it just adopted.
 */
export function adoptCamera(cam: THREE.PerspectiveCamera, s: FlyState): FlyState {
  s.position.copy(cam.position);
  _euler.setFromQuaternion(cam.quaternion, 'YXZ');
  s.yaw = _euler.y;
  s.pitch = _euler.x;
  s.fov = cam.fov;
  s.velocity.set(0, 0, 0);
  return s;
}

/**
 * A pointer drag, in CSS pixels. Positive `dx` is a rightward drag, which turns
 * the camera to the left — the world follows the hand.
 */
export function lookDelta(s: FlyState, dx: number, dy: number, o: FreeFlyTuning): void {
  const k = o.lookRadPerPx * (o.lookRefFov / Math.max(o.lookMinFov, s.fov));
  s.yaw -= dx * k;
  const p = s.pitch - dy * k;
  s.pitch = p < -o.pitchLimit ? -o.pitchLimit : p > o.pitchLimit ? o.pitchLimit : p;
}

/**
 * `expApproach` with the settle. Kept beside the caller rather than published,
 * because the pair is one behaviour and splitting them is how a rig ends up
 * with the curve and not the stop.
 */
function settle(cur: number, target: number, o: FreeFlyTuning, dt: number): number {
  if (!(o.velTau > 0)) return target;
  const next = expApproach(cur, target, o.velTau, dt);
  return Math.abs(target - next) < o.velSnap ? target : next;
}

/**
 * One frame. Writes the camera's quaternion, position and — when it has moved —
 * its field of view and projection matrix; returns the speed the rig is
 * commanding, in world units per second, which is what a readout wants.
 *
 * `boost` multiplies the base speed and is the caller's: a sprint modifier and
 * a crawl modifier are two values, not a mode.
 */
export function flyStep(
  cam: THREE.PerspectiveCamera, s: FlyState, axes: FlyAxes,
  boost: number, speedScale: number, dt: number, o: FreeFlyTuning,
): number {
  _euler.set(s.pitch, s.yaw, 0, 'YXZ');
  cam.quaternion.setFromEuler(_euler);
  cam.getWorldDirection(_fwd);
  _right.copy(_fwd).cross(_up).normalize();

  _wish.set(0, 0, 0);
  if (axes.forward) _wish.add(_fwd);
  if (axes.back) _wish.sub(_fwd);
  if (axes.right) _wish.add(_right);
  if (axes.left) _wish.sub(_right);
  if (axes.up) _wish.add(_up);
  if (axes.down) _wish.sub(_up);
  if (_wish.lengthSq() > 1e-6) _wish.normalize();

  const base = o.baseSpeed * speedScale * boost * (s.fov / o.speedRefFov);
  _wish.multiplyScalar(base);
  s.velocity.x = settle(s.velocity.x, _wish.x, o, dt);
  s.velocity.y = settle(s.velocity.y, _wish.y, o, dt);
  s.velocity.z = settle(s.velocity.z, _wish.z, o, dt);
  // Into OUR position, and copied on. See the header for the frame of travel
  // that a relative write costs.
  s.position.addScaledVector(s.velocity, dt);
  cam.position.copy(s.position);

  if (Math.abs(cam.fov - s.fov) > 1e-3) {
    cam.fov = s.fov;
    cam.updateProjectionMatrix();
  }
  cam.updateMatrixWorld();
  return base;
}
