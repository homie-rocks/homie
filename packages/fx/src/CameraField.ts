import * as THREE from 'three';

/**
 * ============================================================================
 *  CameraField — an instanced billboard field that lives AROUND THE CAMERA.
 * ============================================================================
 *
 *  Weather, in the general case: a fixed pool of instanced quads that is placed
 *  relative to where the camera is standing and looking, advected by a wind,
 *  respawned back into the frustum when it falls out of the bottom of the
 *  world, and — the part nothing else here has — RE-SEEDED DETERMINISTICALLY
 *  ON A FROZEN FRAME so a still capture prints a full frustum instead of
 *  whatever the last live frame happened to leave behind.
 *
 *  ## Why this is not `MoteField`, which is three files away
 *
 *  `Motes.ts` is the near-field swarm the racers draw. It is a GPU field: one
 *  `InstancedBufferGeometry`, a seed attribute, and a vertex shader that wraps
 *  the swarm into a box centred on `uCam`. Zero CPU per frame, forever, and it
 *  is the right answer for a machine doing 142 m/s through vacuum haze.
 *
 *  It cannot be a blizzard. It has no floor, so nothing lands; no respawn, so
 *  nothing can be re-aimed at where the player is now looking; no per-instance
 *  CPU state, so a game cannot give one flake in eleven a different size, speed
 *  and tint; and no still-frame path at all, because a wrap computed from
 *  `uTime` is the same wrap at `dt = 0`. Bending it into one means a mode flag
 *  that changes behaviour, which is a smell this codebase avoids.
 *
 *  This file came out of a first-person shooter, and it fills a real gap: until
 *  it existed, the whole of `@homie-rocks/fx` — `wake`, `drive`, `racer`,
 *  `blast`, `DragParticles`, `Trails`, `RacerSystem`, the skid-mark `Decals` —
 *  was a racer's effects system. A walking shooter in a storm had nothing to
 *  import.
 *
 *  ## What is HERE, and it is the mechanism only
 *
 *  · The camera basis, with the degenerate guard for looking straight up.
 *  · Placing an instance ahead of the camera, in the two frames that turn out
 *    to be needed: WORLD (ground weather — lateral spread about the view
 *    azimuth, height set absolutely) and CAMERA (volume weather — spread
 *    across the screen plane, so density follows the lens).
 *  · Advection by a wind vector at a per-instance speed, and the floor test.
 *  · The frozen-frame policy: `dt < 1e-6` is a still, a still whose camera has
 *    TELEPORTED wants a fresh seed, and coming back live resets both.
 *  · The pool: the `InstancedMesh`, the position array, the scratch `Object3D`,
 *    the two `needsUpdate` flags and dispose.
 *  · `softDisc`, the radial-falloff sprite a field of these is drawn with.
 *
 *  ## What is DELIBERATELY NOT HERE, and there are no callbacks
 *
 *  An earlier attempt to share this would have needed *"a spec with a
 *  room-lookup callback and eight required fields, written against one
 *  consumer."* That cost came from trying to move the LOOP.
 *
 *  Nothing here takes a callback and nothing here knows a level. The game keeps
 *  its own loop and calls into this class; the art — which instance is a clump,
 *  how big it is, how fast it falls, what colour it is, how far out it spawns,
 *  what the floor height is in this part of the level, and how opaque the
 *  material is from here — never crosses the seam, because the game never hands
 *  it over. A `Ctx` cannot reach this file: every method takes a vector, a
 *  camera or a number.
 *
 *  The consequence is that `place*` is called with numbers the game already had
 *  in a local. That is the point. A spec with eight fields would have had to be
 *  filled in by a caller that knows all eight at once; six call sites each
 *  passing the three numbers they know is the same information with none of the
 *  coupling.
 *
 *  ## Bit-exactness, and one claim this file used to make that is FALSE
 *
 *  Every arithmetic expression below is transcribed in its original evaluation
 *  order from the shooter's effects code, and a parity test holds every
 *  instance matrix against that copy with `Object.is` and no epsilon.
 *
 *  An earlier version of this comment said that re-ordering
 *  `wind.x * speed * dt` into `wind.x * (speed * dt)` "moves flakes by an ULP",
 *  and the test carried a fault injection to prove it. **That fault ran green,
 *  and it was the comment that was wrong.** Measured: at this field's
 *  magnitudes the two orderings agree in the DOUBLE, and the positions are then
 *  stored in a `Float32Array`, which rounds away a great deal more than an ULP
 *  of a double. Six hundred accumulated frames of both orderings land on the
 *  same float32.
 *
 *  That is worth knowing rather than quietly deleting, because it says what the
 *  parity test actually protects: not the shape of an expression, but the whole
 *  field at float32 — a real retune of a distance, a spread, a speed or a
 *  floor, at 1,500 instances across four rooms. An arithmetic tidy-up that no
 *  float32 can see is not a behaviour change and this file should not pretend
 *  it is one.
 *
 *  `sinHash01` is a different matter and does have to be exact: it is the
 *  game's own sine hash and NOT `@homie-rocks/noise`'s `hash2`, which is an
 *  integer mix and would hand every frozen still a different frame of weather.
 * ============================================================================
 */

/**
 * The per-instance deterministic sample, used for the seed on a frozen frame.
 *
 * `sin(i * 127.1 + salt * 311.7) * 43758.5453`, fract — the GLSL-idiom hash,
 * kept because a still capture must be the SAME still capture across boots and
 * across this extraction. `@homie-rocks/noise/hash2` is a better hash and
 * adopting it is a behaviour change with nothing on the other side of it.
 */
export function sinHash01(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * What `beginFrame` found, so the game can decide what to do about it.
 *
 * `'live'` — a real frame with real time. `'still'` — the caller is holding
 * `dt = 0` and the field must not move. `'reseed'` — a still whose camera has
 * jumped somewhere else since the last still, which is a capture rig walking
 * poses; the game should re-place the whole pool around the new position or the
 * shot prints the previous area's leftovers.
 */
export type FieldFrame = 'live' | 'still' | 'reseed';

export interface CameraFieldSpec {
  /** Instances. The game scales this off its own particle-density setting. */
  count: number;
  /** The billboard. One quad, usually; this class never looks at it. */
  geometry: THREE.BufferGeometry;
  /** The look. `softDisc()` below makes the map most callers want. */
  material: THREE.Material;
  /** `mesh.name`, for the draw-call inspector. A description, not a mechanism. */
  name: string;
  /**
   * How far the camera must move between two frozen frames before the field
   * counts as teleported, in METRES SQUARED — the test is
   * `distanceToSquared`, so no square root runs on a hot path.
   *
   * 0.25 (half a metre) is what the shooter shipped: small enough that a rig
   * stepping between poses always reseeds, large enough that a camera being
   * nudged inside one pose does not.
   */
  reseedAbove?: number;
}

export class CameraField {
  readonly mesh: THREE.InstancedMesh;
  /** `count * 3` world positions. Public: the game owns where its weather is. */
  readonly pos: Float32Array;
  readonly count: number;

  /**
   * The scratch transform every stamp is composed in. Public and shared on
   * purpose — a game writes its own rotation and scale onto this between
   * `loadDummy` and `writeDummy`, which is the whole of the art half.
   */
  readonly dummy = new THREE.Object3D();

  /** The camera basis, refreshed by `orient()`. Read-only in practice. */
  readonly fwd = new THREE.Vector3();
  readonly right = new THREE.Vector3();
  readonly up = new THREE.Vector3();

  /**
   * A still-frame size multiplier. THE PACKAGE OWNS THE RESET AND THE GAME OWNS
   * THE VALUE, and that split is not fussiness: forgetting to put it back to 1
   * when the clock starts again is how a game ships permanently fattened
   * weather that only a capture was ever supposed to see. `beginFrame` returns
   * it to 1 on every live frame; what it becomes on a still is the game's
   * decision and its art.
   */
  lod = 1;

  /** True while the clock is stopped. The game reads it; nothing here does. */
  frozen = false;

  private readonly seedAt = new THREE.Vector3(1e6, 0, 0);
  private readonly reseedAbove: number;

  constructor(spec: CameraFieldSpec) {
    this.count = spec.count;
    this.pos = new Float32Array(spec.count * 3);
    this.reseedAbove = spec.reseedAbove ?? 0.25;
    this.mesh = new THREE.InstancedMesh(spec.geometry, spec.material, spec.count);
    // The field is re-aimed at the camera every frame, so its real bounds are
    // wherever the camera is. Culling it against a box computed once is how a
    // whole storm pops out of frame at the first corner.
    this.mesh.frustumCulled = false;
    this.mesh.name = spec.name;
  }

  /**
   * The camera's forward / right / up, orthonormal.
   *
   * THE GUARD IS FOR LOOKING STRAIGHT UP OR STRAIGHT DOWN, and what it prevents
   * is not what you would guess. `fwd` is then parallel to `cam.up`, the cross
   * product collapses to zero length, and three.js's `Vector3.normalize()`
   * divides by `this.length() || 1` — so it does NOT produce NaN. It produces a
   * ZERO VECTOR, silently, and every subsequent `right.x * lateral` is zero.
   *
   * The consequence is worse than NaN, because NaN is at least loud once you go
   * looking: the whole field collapses onto a single line through the camera —
   * 1,500 instances stacked on one point — and the storm simply is not there
   * any more. No error, no warning, no NaN in a matrix, nothing in a frame
   * counter. The parity test therefore asserts SPREAD and not absence-of-NaN;
   * the first draft of that check looked for NaN, passed under its own fault,
   * and was measuring nothing.
   */
  orient(cam: THREE.Camera) {
    cam.getWorldDirection(this.fwd);
    this.right.crossVectors(this.fwd, cam.up);
    if (this.right.lengthSq() < 1e-8) this.right.set(1, 0, 0);
    else this.right.normalize();
    this.up.crossVectors(this.right, this.fwd).normalize();
  }

  /**
   * Classify the frame and maintain the freeze bookkeeping.
   *
   * A `'reseed'` answer has already recorded the new camera position, so a game
   * that ignores it gets exactly one reseed offered per teleport rather than
   * one per frame — which is the difference between a capture rig that costs a
   * pool re-place per pose and one that costs a pool re-place per frame for
   * ever.
   */
  beginFrame(dt: number, camPos: THREE.Vector3): FieldFrame {
    if (dt < 1e-6) {
      this.frozen = true;
      if (this.seedAt.distanceToSquared(camPos) > this.reseedAbove) {
        this.seedAt.copy(camPos);
        return 'reseed';
      }
      return 'still';
    }
    this.frozen = false;
    this.lod = 1;
    // Park the marker somewhere no camera can be, so the FIRST frozen frame
    // after a live one always reseeds rather than comparing against a stale
    // position that happens to be near.
    this.seedAt.set(1e6, 0, 0);
    return 'live';
  }

  /**
   * Place instance `i` ahead of the camera in the WORLD frame: `d` metres along
   * the view azimuth, `lateral` metres across it, at absolute height `y`.
   *
   * Only the x and z of the basis are read, so a camera that is pitched down
   * does not drag ground weather into the floor. The game computes `y` — a
   * floor height is a fact about a level and this file has never seen one.
   */
  placeWorld(i: number, origin: THREE.Vector3, d: number, lateral: number, y: number) {
    const f = this.fwd; const r = this.right;
    this.pos[i * 3] = origin.x + f.x * d + r.x * lateral;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = origin.z + f.z * d + r.z * lateral;
  }

  /**
   * Place instance `i` ahead of the camera in the CAMERA frame: `d` metres down
   * the view direction, `lateral` across the screen and `rise` up it.
   *
   * All three axes, so the volume tilts with the lens and a player who looks up
   * gets weather above them rather than a hole. This is the one to use for
   * anything that is meant to read as filling the air rather than sitting on
   * the ground.
   */
  placeCamera(i: number, origin: THREE.Vector3, d: number, lateral: number, rise: number) {
    const f = this.fwd; const r = this.right; const u = this.up;
    this.pos[i * 3] = origin.x + f.x * d + r.x * lateral + u.x * rise;
    this.pos[i * 3 + 1] = origin.y + f.y * d + r.y * lateral + u.y * rise;
    this.pos[i * 3 + 2] = origin.z + f.z * d + r.z * lateral + u.z * rise;
  }

  /**
   * Move instance `i` along `wind` at `speed` m/s for `dt` seconds.
   *
   * The `!` on the reads is `noUncheckedIndexedAccess`, and it is honest here
   * rather than lazy: `pos` is `count * 3` long, allocated in this constructor,
   * never resized, and every caller loops `i < this.count`. A runtime guard
   * would be a branch per instance per frame testing something that cannot be
   * false; the compile-time claim is where the fact belongs.
   */
  advect(i: number, wind: THREE.Vector3, speed: number, dt: number) {
    this.pos[i * 3] = this.pos[i * 3]! + wind.x * speed * dt;
    this.pos[i * 3 + 1] = this.pos[i * 3 + 1]! + wind.y * speed * dt;
    this.pos[i * 3 + 2] = this.pos[i * 3 + 2]! + wind.z * speed * dt;
  }

  /** The world height of instance `i`. The floor test is the game's — see below. */
  heightOf(i: number): number { return this.pos[i * 3 + 1]!; }

  /** Load instance `i`'s position into `dummy`, ready for the game's rotation and scale. */
  loadDummy(i: number) {
    this.dummy.position.set(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
  }

  /** Compose `dummy` and write it into instance `i`. Pair with `loadDummy`. */
  writeDummy(i: number) {
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
  }

  /** Hand the frame's MATRIX writes to the GPU. Called once per frame, not per instance. */
  commit() {
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Hand the instance COLOURS to the GPU. Separate from `commit()` on purpose.
   *
   * A field that tints once at build time and then only moves would otherwise
   * re-upload its whole colour buffer on every frame of the storm for ever,
   * which is a real cost that nothing on screen would ever show. `instanceColor`
   * is null until something has called `setColorAt`, so this is a no-op for a
   * field that does not tint.
   */
  commitColor() {
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    const m = this.mesh.material;
    if (Array.isArray(m)) for (const one of m) one.dispose();
    else m.dispose();
  }
}

/**
 * A soft radial disc, `size` square, RGBA, for a billboard that must not read
 * as a square.
 *
 * `falloff` is the exponent on `exp(-r2 * falloff)`: 7.2 is a flake with a
 * visible core and a fading edge, lower is fog, much higher is a hard dot with
 * an aliased rim. The colour is flat and the shape lives entirely in alpha, so
 * one texture serves a whole field that is tinted per instance.
 */
export function softDisc(
  size: number,
  rgb: readonly [number, number, number],
  falloff: number,
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const r2 = dx * dx + dy * dy;
      const a = Math.exp(-r2 * falloff);
      const i = (y * size + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  // Clamp, not repeat: the disc's alpha reaches zero before the edge but not
  // AT it, and a repeating sample bleeds the opposite rim into the corner.
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
