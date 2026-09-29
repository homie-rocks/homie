/**
 * The lens, and the one rotation that decides where a subject lands on screen.
 *
 * Three copies of the frame solver were measured on 2026-08-19 — two racers'
 * `frameSubject` (40 and 52 lines) and the host runtime's camera script
 * (~35) — and three of `fitFov`. They construct the same thing, 97%
 * identically, and the one that diverged did so in its *bounds*, which is why
 * bounds are a parameter here.
 *
 * **Nothing in this file is a tuning constant and nothing in it has a default.**
 * A host page composing a title card wants a longer lens than a kart racer
 * does — the host's copy deliberately widened the harvested range to V 24..78,
 * H 50..100 against the racers' V 30..78, H 62..100, and that was a *good*
 * decision. A shared `fitFov` that shipped either pair as a default would have
 * picked one of them for everybody, silently, and the frames would have looked
 * completely fine. `FovBounds` is therefore required, and a game that omits it
 * fails to compile rather than inheriting somebody else's art direction.
 *
 * `three` is a **peer** dependency, never a dependency: the games take
 * `three@0.185.1` from npm through Vite and a host page may serve vendored
 * bytes, and two copies of three.js is two `instanceof` universes in which a
 * Vector3 made by one is not a Vector3 to the other. The symptom is an object
 * that renders as nothing, with no error at all.
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/**
 * The four bounds a lens is allowed to move between, in degrees.
 *
 * Both pairs are needed and they fail differently in kind: too much horizontal
 * is a fisheye that shrinks the subject, too little is a telephoto that hides
 * the corner.
 */
export interface FovBounds {
  vMin: number;
  vMax: number;
  hMin: number;
  hMax: number;
}

/**
 * Turn a requested vertical field into one this aspect can carry: solve
 * horizontal from the request, clamp it, solve back, clamp the vertical.
 *
 * At 16:9 with a racer's bounds neither horizontal limit binds, which is why
 * three games got away with never having this: the first-person shooter wrote
 * `BASE_FOV = 78` straight onto `camera.fov` with no aspect term at all, and
 * 78° vertical is **110.4° horizontal at 16:9 and 124.2° at 21:9**, unbounded
 * in both directions. On a measured 1920×1080 panel the symptom today is zero.
 * It is a portability guarantee for other panels and for games nobody has
 * written yet, and at 16:9 it is a provable no-op.
 */
export function fitFov(vDeg: number, aspect: number, bounds: FovBounds): number {
  const a = aspect > 0 ? aspect : 16 / 9;
  let v = clampNum(Number(vDeg), bounds.vMin, bounds.vMax);
  const h = 2 * Math.atan(Math.tan(v * 0.5 * DEG) * a) * RAD;
  const hFit = clampNum(h, bounds.hMin, bounds.hMax);
  if (hFit !== h) v = 2 * Math.atan(Math.tan(hFit * 0.5 * DEG) / a) * RAD;
  return clampNum(v, bounds.vMin, bounds.vMax);
}

/**
 * Visible width and height of a plane facing the lens at `distance` metres.
 *
 * Layered plates use this so a far plate still fills the frame: the same
 * 14.4×8.1 m card at z = −6 sits inside a taller frustum and reads as a postage
 * stamp, which is how "two pictures" fails to become parallax. Size is the
 * lens's, not a taste. Overscan belongs to the caller.
 */
export function frustumAt(
  fovDeg: number, aspect: number, distance: number,
): { width: number; height: number; distance: number } {
  const d = Math.max(1e-4, Math.abs(Number(distance) || 0));
  const height = 2 * d * Math.tan(fovDeg * 0.5 * DEG);
  return { width: height * aspect, height, distance: d };
}

/**
 * Eye distance that just covers a facing plate. `overscan > 1` crops into the
 * photograph (a shot); 1 is exact fill.
 */
export function coverDistance(
  fovDeg: number, aspect: number, planeW: number, planeH: number, overscan = 1,
): number {
  const half = Math.tan(fovDeg * 0.5 * DEG);
  const byH = (planeH / 2) / half;
  const byW = (planeW / 2) / (half * aspect);
  return Math.max(byH, byW) / Math.max(1e-4, overscan);
}

/**
 * THE FRAME SOLVER.
 *
 * > Given the final eye position — after every constraint has had its say —
 * > there is exactly one view axis that puts the subject at a chosen point on
 * > screen, and it is one rotation of the eye→subject vector by
 * > `atan(ndc · tan(halfFov))`. So the composition is not hoped for, it is
 * > constructed… **`frameX` IS the subject's screen position.**
 * > — the kart racer's camera
 *
 * There is no search and no feedback here. A point at NDC (x, y) sits along the
 * direction `forward + x·tanH·right + y·tanV·up` in camera space, so the
 * inverse is two rotations of the eye→subject vector: yaw by `atan(x·tanH)`
 * about the camera up, then pitch by `−atan(y·tanV)` about the camera right.
 *
 * Yaw first, then pitch about the **yawed** right vector. The two rotations do
 * not commute, but at these angles the coupling error is under a fifth of a
 * degree, which is a hundred times smaller than anything the eye reads.
 *
 * The consequence worth stating: the subject's screen position is no longer an
 * emergent property of eleven filters that have never heard of it. It is an
 * INPUT — `ndcX` cannot be exceeded, so *"the subject left the screen"* is not
 * a failure mode a rig built on this has.
 *
 * Allocation-free: every temporary is a module scratch, and `outQuat` /
 * `outAim` are written rather than returned. A minor GC in the wrong frame is a
 * dropped frame, and a person reads a dropped frame while turning as the game
 * stuttering when they aim.
 */
export function solveViewAxis(
  eye: THREE.Vector3,
  subject: THREE.Vector3,
  up: THREE.Vector3,
  ndcX: number,
  ndcY: number,
  fovDeg: number,
  aspect: number,
  outQuat: THREE.Quaternion,
  outAim?: THREE.Vector3,
): void {
  _dir.copy(subject).sub(eye);
  const r = _dir.length();
  if (r < 1e-4) {
    // Degenerate: the eye is on the subject. Leave the orientation alone
    // rather than writing a quaternion built from a zero vector, which is a
    // NaN that reaches a projection matrix and never comes back out.
    if (outAim) outAim.copy(subject);
    return;
  }
  _dir.multiplyScalar(1 / r);

  const tanV = Math.tan(fovDeg * 0.5 * DEG);
  const tanH = tanV * aspect;

  // Basis about the eye→subject ray, in the rolled frame the player sees.
  _right.crossVectors(_dir, up);
  if (_right.lengthSq() >= 1e-6) {
    _right.normalize();
    _up.crossVectors(_right, _dir).normalize();
    _q.setFromAxisAngle(_up, Math.atan(ndcX * tanH));
    _dir.applyQuaternion(_q);
    _right.crossVectors(_dir, up);
    if (_right.lengthSq() >= 1e-6) {
      _right.normalize();
      _q.setFromAxisAngle(_right, -Math.atan(ndcY * tanV));
      _dir.applyQuaternion(_q);
    }
  }

  _aim.copy(eye).addScaledVector(_dir, r);
  if (outAim) outAim.copy(_aim);
  _m.lookAt(eye, _aim, up);
  outQuat.setFromRotationMatrix(_m);
}

/**
 * Slerp-limit an orientation change to `maxRadPerSec · dt`.
 *
 * Stated per second on purpose. A ceiling spelled as "this fraction per frame"
 * is a different ceiling at every frame rate, which is the whole of the
 * `per-frame-gain` defect: the composition stays exact and the game becomes a
 * different game at 144 Hz. Writes `out` and returns it.
 */
export function slewLimit(
  prev: THREE.Quaternion, next: THREE.Quaternion,
  maxRadPerSec: number, dt: number, out: THREE.Quaternion,
): THREE.Quaternion {
  out.copy(next);
  if (!(dt > 0) || !(maxRadPerSec > 0)) return out;
  const angle = prev.angleTo(next);
  const max = maxRadPerSec * dt;
  if (angle > max) out.copy(prev).slerp(next, max / angle);
  return out;
}

/**
 * Support radius of a box along a world axis:
 * `|hx·(a·ex)| + |hy·(a·ey)| + |hz·(a·ez)|`.
 *
 * The exact support function of an oriented box along any axis — three dots and
 * three multiplies, hemisphere-free, exact at any attitude. That is why it
 * survives a track that rolls past vertical where a world AABB does not: the
 * space racer measured the same 8.8 m hull as `[9.3, 1.7, 7.3]` level and
 * `[5.1, 4.6, 8.8]` on a banked section.
 *
 * `half` is in the subject's own frame; `ex`/`ey`/`ez` are its unit axes.
 */
export function supportRadius(
  half: THREE.Vector3,
  ex: THREE.Vector3, ey: THREE.Vector3, ez: THREE.Vector3,
  axis: THREE.Vector3,
): number {
  return Math.abs(half.x * axis.dot(ex))
    + Math.abs(half.y * axis.dot(ey))
    + Math.abs(half.z * axis.dot(ez));
}

/**
 * Invert *"hold the subject at `wantFrac` of frame height"* into a range.
 *
 * `r(h) = rFwd + cal · rUp / (h · tan(fov/2))`. The size solve, from the
 * space racer, which is the only game that has one — and the failure it exists
 * to stop is in that game's own header:
 *
 * > Idea 3 guarantees WHERE the subject is on screen and says nothing whatever
 * > about HOW BIG it is, and for a long time that was the difference between a
 * > rig that was provably correct and a frame in which you could not find your
 * > own machine.
 *
 * `cal` is the calibration between the support radius and the projected box —
 * the game's, because it depends on the shape of that game's subject.
 */
export function rangeForScreenHeight(
  rFwd: number, rUp: number, tanHalfV: number, wantFrac: number, cal: number,
): number {
  const h = Math.max(1e-4, wantFrac);
  return rFwd + (cal * rUp) / (h * Math.max(1e-6, tanHalfV));
}

/** Projected half-height, as a fraction of half the frame, of a sphere of
 *  `radius` at `distance`. */
export function projectedHalfHeight(radius: number, distance: number, tanHalfFov: number): number {
  return radius / (Math.max(1e-4, distance) * Math.max(1e-6, tanHalfFov));
}

/**
 * ── THE FOCAL-LENGTH RELATION ──
 *
 * `focalFromFov` and `fovFromFocal` were extracted from the base-building
 * game's photo mode. It is the definition of a rectilinear lens and there is
 * nothing game-specific in it.
 *
 * `sensorMm` IS THE CALLER'S AND HAS NO DEFAULT. It is the SHORT axis of the
 * frame the game wants a player to read its focal lengths against, and it is a
 * fiction: the base-building game says 24 because that is full-frame's height,
 * so its "50 mm" reads like a photographer's 50 mm. A game framing on the long
 * axis would say 36 and get completely different numbers on the same screen. A
 * default here would hand the next game that game's camera body.
 */
export function focalFromFov(vFovDeg: number, sensorMm: number): number {
  return (sensorMm * 0.5) / Math.tan((vFovDeg * DEG) * 0.5);
}

/**
 * The inverse. The 4 mm floor is a DOMAIN guard and not a look: at zero the
 * arctangent is π/2 and the camera's vertical FOV is 180°, which names no lens
 * and no frame. A game wanting a wider stop clamps its own slider.
 */
export function fovFromFocal(mm: number, sensorMm: number): number {
  return 2 * Math.atan((sensorMm * 0.5) / Math.max(4, mm)) / DEG;
}

/**
 * Depression, radians, that puts the horizon `frac` down from the top edge.
 *
 * Exact, and it depends on nothing but pitch and vertical FOV. From the
 * base-building game, and its argument is the derivation direction rather than
 * the arithmetic:
 *
 * > Stating the number the art direction is written in and deriving the pitch
 * > makes the assertion true BY CONSTRUCTION rather than by a number somebody
 * > has to keep re-checking. Stating a pitch and hoping is what produced a
 * > first capture in which not one frame contained any sky.
 *
 * **THE PERMITTED BAND IS THE CALLER'S AND IT IS NOT IN HERE.** The clamp below
 * is `[0, 1]` and it is a DOMAIN guard — a fraction of frame height outside
 * that names no point on any screen. It is not art direction. The game's copy
 * of this function clamped its argument into `[0.15, 0.35]` before doing any
 * arithmetic — that one game's framing rule, baked into a shared solver where
 * the next game would have had to fight it.
 *
 * That is not a hypothetical cost, and that game already paid it: its own
 * trailer needed a 5.8 m street beat at 0.385, could not get it past the
 * clamp, and **wrote the arithmetic out inline** to escape — a third copy of
 * this function inside the game that owned the second. A band inside a shared
 * function is how a shared function gets copied.
 */
export function pitchForHorizon(frac: number, fovDeg: number): number {
  const tanHalf = Math.tan(fovDeg * 0.5 * DEG);
  // NDC y of the requested band: +1 is the top edge, −1 the bottom.
  const ndcY = 1 - 2 * clampNum(frac, 0, 1);
  return Math.atan(ndcY * tanHalf);
}

/**
 * Where the horizon actually is in the CURRENT frame, as a fraction from the
 * top edge, read off the camera's **world matrix** rather than off the pitch
 * that was requested. Null when the horizon is out of frame.
 *
 * The distinction is the reason this function exists at all: *"the ground
 * clamp and the occlusion lift both move the eye, and a gate that reads back
 * the request instead of the result is a citation, not a measurement."* Every
 * constraint in a rig runs after the pose was chosen.
 */
export function horizonFraction(camera: THREE.PerspectiveCamera): number | null {
  camera.updateMatrixWorld();
  /*
   * THE BASIS COMES OFF `matrixWorld`, NOT OFF `camera.quaternion`.
   *
   * This paragraph used to say "read off the camera's world matrix" over code
   * that read the LOCAL rotation, and the two are the same thing only for a
   * camera with no parent — which every consumer happened to have, which is
   * why nobody noticed. `Object3D.lookAt` divides out the parent's world
   * rotation before it writes `quaternion`, so the moment a rig hangs its
   * camera off a dolly, a turret or a shake node, the quaternion describes the
   * pose *relative to that node* and this function would answer confidently
   * about a frame nobody is looking at. The comment was right and the code was
   * wrong; this is the code catching up.
   *
   * `elements[8..10]` is the camera's local +Z in world space and the view
   * direction is −Z; `elements[4..6]` is its up. Taken from the base-building
   * game's own `actualDepression()`, which has read the world matrix all along.
   */
  const e = camera.matrixWorld.elements;
  _dir.set(-e[8]!, -e[9]!, -e[10]!);
  _up.set(e[4]!, e[5]!, e[6]!);
  // The horizon sits where the view ray is level. Its NDC y is the tangent of
  // the depression, over the tangent of the half-field.
  const tanHalf = Math.tan(camera.fov * 0.5 * DEG);
  /*
   * `atan2` against the horizontal run, and NOT `asin` of the vertical.
   *
   * The source game wrote `asin(−forward.y)`, which is the same angle and is
   * one character shorter — for a UNIT forward vector. A basis read off a world
   * matrix is unit only if nothing in the chain carries a scale, and `asin` of
   * a component larger than 1 is `NaN`, which reaches the caller as "the
   * horizon is out of frame" rather than as an error. `atan2(−y, √(x²+z²))`
   * is the same number for the unit case — measured across that game's whole
   * shot list at **1.2e-13 px of a 1080-line frame** — and stays the right
   * number for every other case.
   */
  const denom = Math.sqrt(Math.max(1e-12, _dir.x * _dir.x + _dir.z * _dir.z));
  const depression = Math.atan2(-_dir.y, denom);
  // A camera rolled onto its side has no horizontal horizon to report; say so
  // rather than returning a number that is a projection of a rolled frame.
  // Normalised for the same reason `atan2` replaced `asin` above: the basis
  // now comes off a world matrix, so `_up.y` is only comparable with a
  // threshold once its length is divided out.
  if (Math.abs(_up.y) < 1e-3 * Math.max(1e-12, _up.length())) return null;
  const ndcY = Math.tan(depression) / tanHalf;
  if (!Number.isFinite(ndcY) || ndcY < -1 || ndcY > 1) return null;
  return (1 - ndcY) * 0.5;
}

/**
 * The view direction of an orbit rig, from yaw and a DEPRESSION angle.
 *
 * The sign convention is the one an orbit rig wants and it is not the one a
 * flyer wants: `pitch` here is how far the camera looks DOWN, so it is positive
 * going down and `out.y` is negative. Stated because the other convention
 * compiles perfectly and inverts the whole camera.
 */
export function forwardFromYawPitch(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(pitch);
  return out.set(Math.sin(yaw) * c, -Math.sin(pitch), Math.cos(yaw) * c);
}

/**
 * Where a screen ray meets a HORIZONTAL PLANE at height `planeY`. False when it
 * does not — the ray is within `1e-4` of parallel, or the hit is behind the
 * lens or further than `maxDist`.
 *
 * A plane and not a terrain raymarch, deliberately. The consumer is
 * zoom-toward-cursor and pick-a-spot, where being a metre out on a slope is
 * imperceptible and a sixty-step march on every wheel notch is not free. A
 * caller that genuinely needs the ground uses `@homie-rocks/heightfield/Sight`.
 *
 * `out` carries the direction while the solve runs and the world point after
 * it, so this allocates nothing and needs no Raycaster.
 */
export function planeUnderNDC(
  camera: THREE.PerspectiveCamera,
  ndcX: number, ndcY: number,
  planeY: number,
  maxDist: number,
  out: THREE.Vector3,
): boolean {
  const tanY = Math.tan(camera.fov * 0.5 * DEG);
  const tanX = tanY * camera.aspect;
  out.set(ndcX * tanX, ndcY * tanY, -1).applyQuaternion(camera.quaternion).normalize();
  const dy = out.y;
  if (Math.abs(dy) < 1e-4) return false;
  const t = (planeY - camera.position.y) / dy;
  if (t <= 0 || t > maxDist) return false;
  out.multiplyScalar(t).add(camera.position);
  return true;
}

/**
 * The unit world direction through a pixel, for a caller marching its own
 * rays. Same projection as `planeUnderNDC`, without the plane solve.
 */
export function rayThroughNDC(
  camera: THREE.PerspectiveCamera,
  ndcX: number, ndcY: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const tanY = Math.tan(camera.fov * 0.5 * DEG);
  const tanX = tanY * camera.aspect;
  return out.set(ndcX * tanX, ndcY * tanY, -1).applyQuaternion(camera.quaternion).normalize();
}

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Module scratch. Allocation-free in the frame loop is a property the racers
// state and enforce; see `spring.ts`'s note on where immutability stops.
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
