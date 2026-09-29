/**
 * =============================================================================
 *  @homie-rocks/render/xr.ts — Play in VR. One call from a game's main.ts.
 * =============================================================================
 *
 *  Decided 2026-09-11: WebXR is reachable because the controllers are already
 *  abstracted and the games are already 3D. A 3D game on these packages is a
 *  scene, a camera and a `WebGLRenderer` that nothing but `@homie-rocks/render`
 *  touches, and a frame clock that nothing but `@homie-rocks/loop` owns. Four
 *  seams, all of them somebody else's, and this file is what joins them.
 *
 *  -----------------------------------------------------------------------------
 *  WHAT A PERSON DOES
 *  -----------------------------------------------------------------------------
 *  Opens the game's page in a headset's browser. A key that says PLAY IN VR
 *  appears — only if `navigator.xr.isSessionSupported('immersive-vr')` actually
 *  resolved true, so it is never a key that appears and then fails. They press
 *  it, the runtime takes over, and they are in the game with the headset's own
 *  controllers. They take the headset off, or use its system menu; the session
 *  ends, the page is exactly what it was, and the flat game carries on.
 *
 *  Everybody else — every phone, every laptop, every television — never sees
 *  the key, and every statement this file executes for them is `xrSupported()`
 *  returning false.
 *
 *  -----------------------------------------------------------------------------
 *  THE FOUR THINGS THAT ARE ACTUALLY HARD, AND WHERE EACH ONE LIVES
 *  -----------------------------------------------------------------------------
 *
 *  1. **THE FRAME CLOCK.** `requestAnimationFrame` DOES NOT FIRE INSIDE AN
 *     IMMERSIVE SESSION. Not "fires slowly" — stops. A loop built on it freezes
 *     the last picture it drew in front of somebody's eyes on the frame the
 *     session opens. `@homie-rocks/loop`'s `GameLoop.driveWith()` is the swap, and
 *     `LoopFrameSource` in its Host.ts is the seam. Everything else here is
 *     detail; that is the blocker.
 *
 *  2. **THE CAMERA.** In a session the head decides where the camera is, and
 *     three OVERWRITES `camera.matrix` from the pose on every render. A game
 *     that writes `ctx.camera.position` every frame — which is every game on
 *     these packages — would have its viewpoint thrown away. So the camera is
 *     re-parented into a RIG, the rig is moved to where the game asked the
 *     camera to be, and the camera's own local transform is zeroed: three then
 *     composes `rig.matrixWorld × headPose` and the person is standing where
 *     the game wanted the camera, looking wherever they are looking. This is
 *     three's documented shape — `updateCamera()` multiplies by
 *     `camera.parent.matrixWorld` — and it means NO GAME'S CAMERA CODE CHANGES.
 *
 *  3. **THE POST CHAIN.** A composer draws one picture from one camera into the
 *     canvas. A session needs two, from two, into its own framebuffer. See
 *     `RenderPipeline.setXRPresenting` — bypassed, not destroyed.
 *
 *  4. **COMFORT.** Untreated first-person motion in a headset makes people ill,
 *     and no automated instrument can see it. What this file does and
 *     does not do about that is stated in `COMFORT_VIGNETTE` below, in full,
 *     including the parts it does not do.
 *
 *  -----------------------------------------------------------------------------
 *  UNVERIFIED, AND SAYING SO IS PART OF THE FILE
 *  -----------------------------------------------------------------------------
 *  **NOBODY HAS WORN THIS.** No headset was available when it was written.
 *  Every line below was written against the WebXR specification and against
 *  the three.js source this package pins (`three/src/renderers/webxr/`,
 *  0.185.1), read rather than remembered, and a frame probe drives the
 *  frame-driver swap against a fake session in Node and watches it go red.
 *  That probe proves the thing that is provable without hardware — that the
 *  clock changes hands exactly once, in each direction, and that no frame
 *  ever arrives from both. It proves NOTHING about what a person sees.
 *
 *  A test rig that supplies what production does not is a test that cannot
 *  fail. The fake session in that probe supplies a frame callback a real
 *  runtime supplies; it does not supply a head, a stomach, or a driver.
 *  **Everything about how this looks and feels is UNVERIFIED until a person
 *  wears it**, and the first thing to check when somebody does is the leaving
 *  path, because leaving is the path people actually hit.
 * =============================================================================
 */

import * as THREE from 'three';

/**
 * The world this file needs, as a STRUCTURE rather than a game's `Ctx`.
 *
 * Same seam and same reason as `@homie-rocks/loop/Host.ts`: naming a game's
 * context here would put `race`, `colony` and `match` inside an engine package.
 * Every game's `EngineCtx` satisfies this structurally.
 */
export interface XRWorld {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  dt: number;
}

/**
 * The frame loop, through the ONE method this file calls on it.
 *
 * Structural on purpose: `@homie-rocks/render` does not depend on `@homie-rocks/loop` and
 * this is not the change that should make it. `GameLoop` satisfies it.
 */
export interface XRLoopHost {
  driveWith(source: { setAnimationLoop(callback: ((time: number) => void) | null): void } | null): void;
}

/** The pipeline, through the two members this file calls. See `setXRPresenting`. */
export interface XRPipelineHost<W> {
  setXRPresenting(on: boolean): void;
  beforeEachPresent(fn: (world: W) => void): () => void;
}

/**
 * =============================================================================
 *  THE COMFORT VIGNETTE, AND AN HONEST LIST OF WHAT IS NOT HERE.
 * =============================================================================
 *
 *  WHAT IT IS. When the world moves under somebody who is sitting still, their
 *  eyes report motion and their inner ear reports none, and within a couple of
 *  minutes a meaningful fraction of people feel sick. The single most effective
 *  mitigation that costs nothing and changes no gameplay is to narrow the field
 *  of view WHILE they are moving: the peripheral vision, which is what carries
 *  the vection signal, is masked, and the middle of the frame — where they are
 *  actually looking — is untouched. It is off entirely when they are still, so
 *  a game spent standing and aiming never shows it at all.
 *
 *  IT IS A VALUE AND NOT A POLICY, and it is a REQUIRED field on `XRSpec`, for
 *  the reason `EngineCtxSpec` has no optional fields: a game that silently gets
 *  a default gets another game's art direction. A racer at 40 m/s and a walking
 *  game at 1.4 m/s cannot share a speed threshold, and the failure of sharing
 *  one is not a wrong picture — it is either a vignette that is never on when
 *  it is needed, or one that is on all the time and reads as a smeared lens.
 *  Write these numbers out at the call site so somebody can argue with them.
 *
 *  THESE DEFAULTS ARE A STARTING POINT AND NOT A MEASUREMENT. Nobody has worn
 *  this. They are the middle of the range the VR industry converged on for a
 *  walking-speed first-person game, and the honest thing to say about them is
 *  that they are a guess with a shape rather than a number with a receipt.
 *
 *  -----------------------------------------------------------------------------
 *  WHAT IS **NOT** HERE, SAID OUT LOUD RATHER THAN LEFT TO BE DISCOVERED
 *  -----------------------------------------------------------------------------
 *  · **No snap turn.** Smooth yaw driven by a thumbstick is the second worst
 *    thing for comfort after smooth strafing, and the fix is to rotate in
 *    discrete steps. It is not here because the yaw in these games comes from
 *    the GAME's camera, not from a stick this file reads, so imposing snap
 *    would mean this file overriding a racer's chase camera. It belongs to
 *    whichever game first puts a stick on yaw.
 *  · **No teleport locomotion.** Same reason: movement is the game's.
 *  · **No seated/standing recentre, and no height calibration beyond
 *    `eyeHeight`.** A person who starts the session leaning is leaning for the
 *    whole session.
 *  · **No third-person-to-first-person conversion.** A chase camera three
 *    metres behind a car, mapped to a head, is a person being flown around
 *    behind a vehicle, and that is genuinely unpleasant. The rig faithfully
 *    reproduces whatever the game's camera was doing — which for a cockpit view
 *    is right and for a chase view is a thing somebody has to look at.
 *  · **Pitch and roll from the game's camera are DISCARDED** — see `#poseRig`.
 *    That one is not a gap, it is a decision, and it is the most important
 *    comfort line in this file.
 */
export interface XRComfort {
  /**
   * Metres per second at which the vignette starts to close, and at which it is
   * fully closed. Below the first, nothing is drawn at all.
   */
  speedFrom: number;
  speedTo: number;
  /** Degrees per second of YAW, same two thresholds. Turning is worse than moving. */
  turnFrom: number;
  turnTo: number;
  /**
   * Half-angle, in degrees, of the clear circle left in the middle when the
   * vignette is fully closed. 40 is a wide tunnel — enough to keep a racing
   * line or a doorway in view, which is the difference between a comfort aid
   * and a blindfold. Below about 25 people start reporting they cannot play.
   */
  apertureDeg: number;
  /**
   * Seconds the vignette takes to open and close. It must NOT track speed
   * instantly: a mask that flickers with every bump is itself a motion signal,
   * which is the thing being treated.
   */
  easeSeconds: number;
}

/**
 * A starting point a game writes out explicitly. See `XRComfort`'s header for
 * why this is not a default applied behind anybody's back.
 */
export const COMFORT_VIGNETTE: XRComfort = {
  speedFrom: 1.2,
  speedTo: 6,
  turnFrom: 45,
  turnTo: 180,
  apertureDeg: 40,
  easeSeconds: 0.25,
};

/** One of the headset's controllers, as this file reports it. */
export interface XRPointer {
  /** 'left', 'right', or 'none' for a device that will not say. */
  readonly handedness: string;
  /** Is it currently tracking? A controller put down reports false. */
  readonly connected: boolean;
  /** The ray space, posed by three every frame. In the rig's coordinates. */
  readonly space: THREE.Group;
  /** Gamepad buttons, in WebXR's standard mapping order. */
  readonly buttons: readonly boolean[];
  /** Gamepad axes. [0,1] is the touchpad, [2,3] the thumbstick, per the mapping. */
  readonly axes: readonly number[];
}

export interface XRSpec<W extends XRWorld> {
  /** The game's context. Structurally an `XRWorld`. */
  ctx: W;
  /** The frame loop. Structurally an `XRLoopHost` — see `driveWith`. */
  loop: XRLoopHost;
  /** The render pipeline. `RenderPipeline` satisfies this. */
  pipeline: XRPipelineHost<W>;
  /**
   * HOW FAR ABOVE THE FLOOR THIS GAME'S CAMERA IS, in metres.
   *
   * REQUIRED, and there is no sensible default. A session's reference space is
   * floor-relative wherever the runtime can manage it, so the rig has to be
   * placed on the floor BENEATH where the game asked the camera to be — and
   * only the game knows how far beneath. 1.7 for a standing first-person game;
   * roughly 0.6 for a low racing seat; 0 for a camera that is already
   * describing a floor position. Getting it wrong is not subtle: the world is
   * visibly the wrong size and it is one of the reliable ways to make somebody
   * feel ill.
   *
   * IGNORED when the runtime could only give a head-relative `local` space,
   * because there the origin IS where the head started — see `#enter`.
   */
  eyeHeight: number;
  /** See `XRComfort`. `COMFORT_VIGNETTE` is a starting point, written out. */
  comfort: XRComfort;
  /**
   * The words on the key. A game's own voice, like its boot labels — there is
   * no shared answer and a package that invented one would put the same three
   * words in front of every room.
   */
  label: string;
  /**
   * Called when a session starts and when it ends, so a game can do the thing
   * only it knows about — pause a round while somebody fits a headset, hide a
   * DOM HUD that nobody in a session can see. An empty arrow rather than a
   * missing field: `XRSpec` has no optional members, for `BootSpec`'s reason.
   */
  onPresenting: (presenting: boolean) => void;
}

/**
 * Can this browser, on this device, actually open an immersive session?
 *
 * THE ONLY QUESTION THAT MAY GATE THE KEY. The rule for guests is that every
 * single thing a guest has to be told is a defect, and a key that appears and
 * then throws is a thing somebody has to be told about. `navigator.xr` merely
 * EXISTING is not the answer — a flat Chrome on a laptop with no headset has it
 * and answers false — so the existence check is the guard and the promise is
 * the answer.
 *
 * It never rejects. A `SecurityError` from a page in an iframe with no
 * `xr-spatial-tracking` permission, or a runtime that is installed but not
 * running, both mean "no" to a person standing in a room, and a rejected
 * promise here would mean the game booted with an unhandled rejection in the
 * console for every laptop on the network.
 */
export async function xrSupported(): Promise<boolean> {
  const xr = (navigator as unknown as { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
  if (xr === undefined || typeof xr.isSessionSupported !== 'function') return false;
  try {
    return await xr.isSessionSupported('immersive-vr') === true;
  } catch {
    return false;
  }
}

/**
 * Mount the key and own everything behind it.
 *
 * Call it once, from `main.ts`, after `bootGame`. It is deliberately NOT
 * awaited by the boot: a headset probe that hangs must not be able to hold up a
 * television's first frame, and the answer arriving a moment after the game is
 * playable is exactly right — the key appears, nothing else moves.
 *
 * Returns the session handle so a test (and a game that wants its own key)
 * can drive it; a game that just wants the key can ignore the return.
 */
export function installVR<W extends XRWorld>(spec: XRSpec<W>): XRSession2<W> {
  const session = new XRSession2(spec);
  session.mountKey();
  return session;
}

/**
 * The session, the rig, the key and the way back.
 *
 * Named with the 2 because `XRSession` is a DOM global and shadowing it inside
 * a file that has to hold real ones would be a genuinely confusing hour for
 * whoever reads this next.
 */
export class XRSession2<W extends XRWorld> {
  readonly #spec: XRSpec<W>;
  #key: HTMLButtonElement | null = null;
  #session: XRSessionLike | null = null;
  #unhook: (() => void) | null = null;

  /**
   * THE RIG. The camera's new parent, and the thing that is actually moved.
   *
   * three's `WebXRManager.updateCamera()` composes the session's view matrices
   * with `camera.parent.matrixWorld` and then OVERWRITES `camera.matrix` with
   * the resulting head pose. So whatever the game writes to `ctx.camera` is
   * thrown away every frame, and the only transform that survives to place the
   * player is this one. Read that sentence twice before changing anything here:
   * it is why a game's camera code does not have to change, and it is also why
   * writing the game's pose onto the camera instead would silently do nothing.
   */
  readonly #rig = new THREE.Group();
  /** Where the camera was parented before the session, so it can go back. */
  #cameraHome: THREE.Object3D | null = null;
  /** The camera's own local transform before the session, for the same reason. */
  readonly #cameraWas = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  /**
   * ==========================================================================
   *  WHAT THE GAME LAST WROTE TO ITS CAMERA, kept so it can be PUT BACK after
   *  every draw. This is the field that makes a game's camera code keep working.
   * ==========================================================================
   *
   *  three's `updateUserCamera()` decomposes the head pose into
   *  `camera.position` and `camera.quaternion` on every render — it overwrites
   *  the game's values, by design, so that a game reading the camera gets the
   *  real viewpoint. In a game whose camera system only ever WRITES, that costs
   *  nothing. In a game whose camera system READS ITS OWN PREVIOUS VALUE — and
   *  every smoothed chase camera in these games does, because a spring is
   *  `position.lerp(target, k)` — it is fatal and silent: the next frame's
   *  "previous position" is the headset's head pose, so the spring chases the
   *  head instead of the vehicle and the camera collapses toward the player.
   *
   *  So the pose is restored from here in `scene.onAfterRender`, which three
   *  calls at the bottom of `render()`, after the eyes have been drawn and
   *  after `updateUserCamera` has had its way. The head pose is in the camera
   *  for exactly the interval it is needed and for no longer, and every game's
   *  camera reads back precisely what it wrote — the flat behaviour, unchanged.
   */
  readonly #written = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  /** Whatever the game already had on `scene.onAfterRender`, so it is not lost. */
  #priorAfterRender: THREE.Scene['onAfterRender'] | null = null;
  /** True when the reference space is floor-relative, so `eyeHeight` applies. */
  #floorRelative = false;

  #vignette: Vignette | null = null;
  /** The rig's world position last frame, for the speed the vignette reads. */
  readonly #lastRigPos = new THREE.Vector3();
  #lastRigYaw = 0;
  #haveLast = false;

  readonly #pointers: MutablePointer[] = [];

  /** Scratch, allocated once. A `new Vector3()` per frame in a headset is 90 Hz of garbage. */
  readonly #scratchPos = new THREE.Vector3();
  readonly #scratchQuat = new THREE.Quaternion();
  readonly #scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(spec: XRSpec<W>) {
    this.#spec = spec;
    this.#rig.name = 'homie-xr-rig';
    // Not `matrixAutoUpdate = false`: the rig is written every frame and three
    // has to recompute its world matrix from those writes, which is exactly
    // what auto update is.
  }

  /** True while a session is presenting. */
  get presenting(): boolean {
    return this.#session !== null;
  }

  /**
   * What the headset's controllers are doing this frame.
   *
   * Empty when no session is open. Refreshed once per frame, immediately before
   * the draw, so every reader in a frame sees the same numbers — a game that
   * polled the gamepads itself would get a different answer at the top and the
   * bottom of its own update.
   */
  pointers(): readonly XRPointer[] {
    return this.#pointers;
  }

  // ── the key ────────────────────────────────────────────────────────────────
  /**
   * Ask whether this device can do it, and put the key up only if it can.
   *
   * THE PROBE IS ASYNC AND THE KEY IS MOUNTED IN ITS `then`, which is the whole
   * shape: there is no moment at which a key exists for a device that has not
   * yet answered. On a laptop the promise resolves false and this function's
   * entire remaining effect on the page is nothing.
   */
  mountKey(): void {
    void xrSupported().then((can) => {
      if (!can || this.#key !== null) return;
      this.#key = buildKey(this.#spec.label, () => { void this.enter(); });
      document.body.appendChild(this.#key);
    });
  }

  // ── entering ───────────────────────────────────────────────────────────────
  /**
   * Open a session. MUST be called from a user gesture — a browser will refuse
   * `requestSession` without one, and that refusal is correct.
   */
  async enter(): Promise<void> {
    if (this.#session !== null) return;
    const nav = navigator as unknown as { xr?: XRSystemLike };
    const xr = nav.xr;
    if (xr === undefined) return;

    const { ctx } = this.#spec;
    let session: XRSessionLike;
    try {
      session = await xr.requestSession('immersive-vr', {
        // OPTIONAL, EVERY ONE OF THEM, AND THAT IS THE POINT. A required
        // feature a runtime does not have makes `requestSession` REJECT — so a
        // key that `isSessionSupported` promised would work fails under a
        // thumb, which is the exact failure the capability probe exists to
        // prevent. Ask for everything, require nothing, and find out below what
        // was actually granted.
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'],
      });
    } catch (err) {
      // LOUD. A refusal here is the person pressing the key and nothing
      // happening, which is the worst outcome this file has; it must not also
      // be silent. The key stays on screen so they can try again.
      console.error('[xr] the headset refused to open a session', err);
      return;
    }

    /*
     * WHICH FLOOR, ASKED RATHER THAN ASSUMED.
     *
     * `local-floor` puts the origin on the physical floor, which is what a
     * standing game wants and what `eyeHeight` is measured against.
     * `local` puts it wherever the head was when the session opened. Every real
     * headset supports the first; a phone-in-a-holder or an emulator may not,
     * and the difference is a person either standing correctly or floating
     * `eyeHeight` metres in the air — visible, unpleasant, and completely
     * silent if it is guessed.
     *
     * The space requested here is discarded: three requests its own from the
     * type it is told. This call is the QUESTION, and the answer is which type
     * to tell it.
     */
    this.#floorRelative = true;
    try {
      await session.requestReferenceSpace('local-floor');
    } catch {
      this.#floorRelative = false;
      console.info('[xr] no floor-relative space on this runtime; the origin is where the head started');
    }
    ctx.renderer.xr.setReferenceSpaceType(this.#floorRelative ? 'local-floor' : 'local');
    ctx.renderer.xr.enabled = true;

    // ---- the rig, before the first frame can be drawn through it ------------
    this.#adoptCamera();
    this.#vignette = new Vignette(this.#spec.comfort);
    ctx.camera.add(this.#vignette.mesh);
    this.#collectPointers(session);

    try {
      await ctx.renderer.xr.setSession(session as unknown as XRSession);
    } catch (err) {
      console.error('[xr] the renderer could not take the session', err);
      this.#releaseCamera();
      return;
    }

    this.#session = session;
    // ORDER: the pipeline stops using the composer and the ladder BEFORE the
    // clock changes hands, so the very first session frame is already drawn the
    // way a session frame has to be drawn. The other order presents one frame
    // of a mono composed picture into a stereo framebuffer, which is one frame
    // of something genuinely horrible arriving as somebody's first impression.
    this.#spec.pipeline.setXRPresenting(true);
    this.#unhook = this.#spec.pipeline.beforeEachPresent(() => { this.#poseRig(); });
    this.#spec.loop.driveWith(ctx.renderer);
    if (this.#key !== null) this.#key.hidden = true;

    // `end` is THE WAY BACK AND IT IS THE ONLY ONE. There is no DOM inside a
    // session, so the key cannot be pressed again; leaving happens through the
    // headset's own system menu, or by taking it off, or by the runtime
    // deciding. All three arrive here.
    session.addEventListener('end', this.#onSessionEnd);
    // A controller switched on, put down or swapped mid-session. Without this
    // the buttons go dead on whichever hand was picked up second.
    session.addEventListener('inputsourceschange', this.#onInputSourcesChange);

    this.#haveLast = false;
    this.#spec.onPresenting(true);
    console.info(`[xr] presenting — ${this.#floorRelative ? 'floor-relative' : 'head-relative'} space`);
  }

  // ── leaving ────────────────────────────────────────────────────────────────
  /**
   * THE PATH PEOPLE ACTUALLY HIT, and the one that has to leave nothing behind.
   *
   * Everything `enter` did is undone here, in the reverse order, and the two
   * lists are meant to be read side by side. A session that ends without giving
   * the clock back is a dead canvas: `requestAnimationFrame` is not running
   * (the loop handed it away), the session's is not running (it has ended), and
   * the page sits on its last frame with no error anywhere. That is the failure
   * this method exists for and it is worth more attention than entering.
   */
  #onSessionEnd = (): void => {
    const { ctx } = this.#spec;
    this.#session = null;
    // 1. The clock comes back FIRST. Everything below this line is allowed to
    //    take a moment; being without a clock is not.
    this.#spec.loop.driveWith(null);
    // 2. The pipeline goes back to the composer and re-pushes the resolution —
    //    the canvas is whatever size the session left it.
    this.#unhook?.();
    this.#unhook = null;
    this.#spec.pipeline.setXRPresenting(false);
    // 3. The camera goes home, with the local transform it had. Without the
    //    second half the flat game comes back with a camera at the origin
    //    looking down the negative Z axis until its own camera system writes
    //    the next frame — one frame of somewhere else, every single time.
    this.#releaseCamera();
    ctx.renderer.xr.enabled = false;
    // 4. The key comes back, because they may want to go again.
    if (this.#key !== null) this.#key.hidden = false;
    this.#spec.onPresenting(false);
    console.info('[xr] the session ended; the flat game has the clock back');
  };

  /** Move the game's camera into the rig, remembering exactly where it came from. */
  #adoptCamera(): void {
    const { ctx } = this.#spec;
    this.#cameraHome = ctx.camera.parent ?? ctx.scene;
    this.#cameraWas.position.copy(ctx.camera.position);
    this.#cameraWas.quaternion.copy(ctx.camera.quaternion);
    // The game's last write IS the camera's local transform at this instant,
    // and it is what `#poseRig` will read on the very first session frame.
    this.#written.position.copy(ctx.camera.position);
    this.#written.quaternion.copy(ctx.camera.quaternion);
    ctx.scene.add(this.#rig);
    // `add` keeps the LOCAL transform, so the game's last write is still
    // sitting in `camera.position` — which is exactly what `#poseRig` reads.
    // It is `#poseRig` that zeroes the camera, and doing it here as well would
    // hand that first call a camera at the origin and put the player under the
    // map for one frame before the first real pose corrected them.
    this.#rig.add(ctx.camera);
    this.#poseRig();

    // See `#written`. Composed rather than replaced — a game may own this hook,
    // and `@homie-rocks/render/pipeline.ts` has already paid for replacing a
    // callback somebody else registered (`installContextRecovery`).
    // The signature is `Object3D`'s six-argument one — three calls a Scene's
    // hook with three, and typing it any narrower here would refuse to compile
    // against a game that had registered the wide form. Forwarded verbatim.
    this.#priorAfterRender = ctx.scene.onAfterRender;
    const prior = this.#priorAfterRender;
    ctx.scene.onAfterRender = (...args: Parameters<THREE.Scene['onAfterRender']>) => {
      prior?.(...args);
      ctx.camera.position.copy(this.#written.position);
      ctx.camera.quaternion.copy(this.#written.quaternion);
    };
  }

  /** Put it back exactly as it was. See `#onSessionEnd` point 3. */
  #releaseCamera(): void {
    const { ctx } = this.#spec;
    if (this.#priorAfterRender !== null) {
      ctx.scene.onAfterRender = this.#priorAfterRender;
      this.#priorAfterRender = null;
    }
    if (this.#vignette !== null) {
      ctx.camera.remove(this.#vignette.mesh);
      this.#vignette.dispose();
      this.#vignette = null;
    }
    for (const p of this.#pointers) p.space.removeFromParent();
    this.#pointers.length = 0;
    (this.#cameraHome ?? ctx.scene).add(ctx.camera);
    ctx.camera.position.copy(this.#cameraWas.position);
    ctx.camera.quaternion.copy(this.#cameraWas.quaternion);
    this.#rig.removeFromParent();
    this.#cameraHome = null;
  }

  // ── the frame ──────────────────────────────────────────────────────────────
  /**
   * ==========================================================================
   *  MOVE THE RIG TO WHERE THE GAME ASKED THE CAMERA TO BE. Once a frame,
   *  immediately before the draw, and this is the whole of "the XR rig replaces
   *  the camera without every game changing".
   * ==========================================================================
   *
   *  It runs from `pipeline.beforeEachPresent` and NOT from a `System`, which
   *  is a deliberate choice with a failure in it. A system would have to be
   *  LAST in the game's `systems` array — after the camera rig, after the HUD —
   *  and a game that put it anywhere else would pose from a camera some later
   *  system was about to move, producing a viewpoint one system-walk stale
   *  INSIDE the same frame. That is a defect whose only symptom is a slight
   *  swim nobody can attribute, on hardware nobody here has. Hooking the draw
   *  makes the ordering impossible to get wrong: there is no code between this
   *  and `renderer.render`.
   *
   *  ------------------------------------------------------------------------
   *  YAW ONLY. PITCH AND ROLL ARE DISCARDED, AND IT IS THE MOST IMPORTANT LINE
   *  IN THIS FILE.
   *  ------------------------------------------------------------------------
   *  A flat game's camera pitches to look down a slope and rolls into a corner,
   *  and both read beautifully on a television. Applied to a headset they tilt
   *  the HORIZON — the world rotates around a person whose inner ear is
   *  certain it did not — and that is not "a bit much", it is the single most
   *  reliable way to make somebody take a headset off and not put it back on.
   *  Every comfortable VR title on the market discards them, including ones
   *  whose flat version leans hard.
   *
   *  What it costs, said plainly: a game whose ENTIRE camera language is roll
   *  loses that language in VR. That is the correct trade and it is not close.
   */
  #poseRig(): void {
    const { ctx, comfort } = this.#spec;
    const cam = ctx.camera;
    const home = this.#cameraHome ?? ctx.scene;

    /*
     * THE GAME'S WRITE IS ABSOLUTE, AND THE RIG IS SET FROM IT ABSOLUTELY.
     *
     * `ctx.camera.position` holds whatever the game's camera system put there
     * this frame — an absolute placement, because before the session the camera
     * was a child of the scene and local WAS world. It is read here and kept in
     * `#written`, which is what `scene.onAfterRender` puts back once three has
     * finished overwriting it with the head pose.
     *
     * ABSOLUTE, NOT ACCUMULATED. An earlier draft of this method treated the
     * write as a delta and added it to the rig; that is wrong in the way that
     * cannot be seen in code review and is obvious in a headset — the rig
     * integrates the camera's world position once a frame and the player is
     * launched out of the map inside a second. A game that does not write its
     * camera at all this frame must leave the rig exactly where it is, and only
     * an absolute read does that.
     *
     * VIA THE OLD PARENT, because a game may have parented its camera to
     * something that moves and its writes are local to that. `updateWorldMatrix`
     * with ancestors and without descendants is the cheap correct call: the
     * scene graph has not been walked yet this frame — `renderer.render` does
     * that, and this runs immediately before it.
     */
    this.#written.position.copy(cam.position);
    this.#written.quaternion.copy(cam.quaternion);
    home.updateWorldMatrix(true, false);
    this.#scratchPos.copy(cam.position).applyMatrix4(home.matrixWorld);
    home.getWorldQuaternion(this.#scratchQuat).multiply(cam.quaternion);

    this.#rig.position.copy(this.#scratchPos);
    if (this.#floorRelative) this.#rig.position.y -= this.#spec.eyeHeight;
    // YAW ONLY — see the header. `YXZ` order puts yaw first, so taking `y` and
    // dropping `x` and `z` is exactly "keep the heading, throw away the tilt".
    this.#scratchEuler.setFromQuaternion(this.#scratchQuat, 'YXZ');
    this.#rig.rotation.set(0, this.#scratchEuler.y, 0);
    // The camera's own local transform is the head's, and the head's alone.
    cam.position.set(0, 0, 0);
    cam.quaternion.identity();
    this.#rig.updateMatrixWorld(true);

    this.#readPointers();

    // ---- comfort ----------------------------------------------------------
    if (this.#vignette === null) return;
    const pos = this.#rig.position;
    const yaw = this.#rig.rotation.y;
    let speed = 0;
    let turn = 0;
    if (this.#haveLast && ctx.dt > 0) {
      speed = pos.distanceTo(this.#lastRigPos) / ctx.dt;
      // Shortest way round, or a heading crossing ±π reads as 360°/frame and
      // slams the vignette shut once a lap for no reason anybody can see.
      let dy = yaw - this.#lastRigYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      turn = Math.abs(dy) * (180 / Math.PI) / ctx.dt;
    }
    this.#lastRigPos.copy(pos);
    this.#lastRigYaw = yaw;
    this.#haveLast = true;
    const want = Math.max(
      ramp(speed, comfort.speedFrom, comfort.speedTo),
      ramp(turn, comfort.turnFrom, comfort.turnTo),
    );
    this.#vignette.step(want, ctx.dt);
  }

  // ── the controllers ────────────────────────────────────────────────────────
  #onInputSourcesChange = (): void => {
    if (this.#session !== null) this.#collectPointers(this.#session);
  };

  /**
   * Rebuild the pointer list from the session's input sources.
   *
   * three's `getController(i)` is indexed, not identified, and the objects it
   * returns are stable for the life of the renderer — so the spaces are taken
   * once and re-pointed rather than recreated, and a controller that goes away
   * leaves its group parked in the rig with `visible` false rather than being
   * torn out of the graph while three still holds a reference to it.
   */
  #collectPointers(session: XRSessionLike): void {
    const { ctx } = this.#spec;
    const sources = [...session.inputSources];
    for (let i = 0; i < sources.length; i++) {
      let p = this.#pointers[i];
      if (p === undefined) {
        const space = ctx.renderer.xr.getController(i);
        // INTO THE RIG, not into the scene. A controller is in the player's
        // reference space exactly as the head is; parenting it to the scene
        // would leave both hands at the world origin while the player walked
        // away from them.
        this.#rig.add(space);
        p = { handedness: 'none', connected: false, space, buttons: [], axes: [] };
        this.#pointers[i] = p;
      }
      p.handedness = sources[i]?.handedness ?? 'none';
    }
    // Anything past the end of the list is a controller that left.
    for (let i = sources.length; i < this.#pointers.length; i++) {
      const p = this.#pointers[i]!;
      p.connected = false;
      p.buttons = [];
      p.axes = [];
      p.space.visible = false;
    }
  }

  /** Copy this frame's gamepad state. Once, before the draw. See `pointers()`. */
  #readPointers(): void {
    const session = this.#session;
    if (session === null) return;
    const sources = [...session.inputSources];
    for (let i = 0; i < this.#pointers.length; i++) {
      const p = this.#pointers[i]!;
      const src = sources[i];
      const pad = src?.gamepad;
      if (src === undefined || pad === undefined || pad === null) {
        p.connected = false;
        p.buttons = [];
        p.axes = [];
        continue;
      }
      p.connected = true;
      p.space.visible = true;
      // COPIED, NOT ALIASED. A `Gamepad`'s arrays are live views the runtime
      // rewrites under us, so handing them out would give a game a value that
      // changes between two reads in one frame — the same reason a gamepad
      // reader latches. The allocation is two small arrays per hand per frame,
      // which at 90 Hz is nothing next to a scene graph walk.
      p.buttons = pad.buttons.map((b) => b.pressed === true);
      p.axes = [...pad.axes];
    }
  }
}

// ─── the key ─────────────────────────────────────────────────────────────────
/**
 * The key itself: a real `<button>`, in the page, with its own styles inlined.
 *
 * NOT A THREE.JS OBJECT, and not part of the game's HUD. Before the session
 * starts, a headset's browser is showing an ordinary web page, and the thing a
 * person's hand-ray can press on an ordinary web page is a button. Drawing it
 * into the 3D scene would mean the one control that gets somebody INTO VR is
 * the one control that can only be pressed once they are already in it.
 *
 * Styles are inlined rather than taken from a stylesheet because this package
 * ships no CSS to a game's document and a key that depends on a class the game
 * happens to define is a key that is invisible in the game that forgot.
 */
function buildKey(label: string, press: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  // Large, high-contrast, and BOTTOM CENTRE. A headset's browser panel is a
  // rectangle a person is pointing a ray at from a metre away; a 14px control
  // in a corner is a thing they will miss. This is roughly a phone's tap target
  // scaled for a ray, and it sits where a hand naturally rests.
  b.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:6vh', 'transform:translateX(-50%)',
    'z-index:120', 'padding:1.1rem 2.4rem', 'border:1px solid rgba(190,208,226,.45)',
    'border-radius:999px', 'background:rgba(10,15,22,.82)', 'color:#e6edf5',
    'font:600 1.05rem/1 "Avenir Next","Helvetica Neue",Helvetica,Arial,sans-serif',
    'letter-spacing:.18em', 'text-transform:uppercase', 'cursor:pointer',
    // The page sets `touch-action:none` on the body to stop the game scrolling.
    // A button inside that still needs to be pressable by a finger on a phone
    // that happens to support WebXR, so it says so for itself.
    'touch-action:manipulation', '-webkit-tap-highlight-color:transparent',
  ].join(';');
  b.addEventListener('click', press);
  return b;
}

// ─── the vignette ────────────────────────────────────────────────────────────
/**
 * An inverted sphere around the head with a hole in the front of it.
 *
 * A SPHERE AND NOT A PLANE, and the reason is the optics rather than taste. A
 * headset's per-eye frustum is OFF-AXIS and well over 100 degrees wide; a
 * quad in front of the camera sized to cover that is enormous, gets clipped by
 * the near plane at the corners, and is the wrong shape in the eye that is not
 * centred on it. A sphere at a fixed radius centred on the head is the same
 * angular mask in both eyes by construction, which is what the effect actually
 * is — a mask measured in DEGREES OFF FORWARD.
 *
 * `depthTest: false` and a large `renderOrder` because it must sit over the
 * whole world including anything the player has their face in.
 */
class Vignette {
  readonly mesh: THREE.Mesh;
  readonly #material: THREE.ShaderMaterial;
  readonly #comfort: XRComfort;
  /** 0 = wide open, 1 = fully closed. Eased toward the request. */
  #closed = 0;

  constructor(comfort: XRComfort) {
    this.#comfort = comfort;
    this.#material = new THREE.ShaderMaterial({
      uniforms: {
        // The half-angle of the clear circle, in radians, at the CURRENT amount
        // of closure. PI means "clear everywhere", which is what fully open is.
        uAperture: { value: Math.PI },
        // How wide the soft edge is. A hard edge is itself a shape the eye
        // tracks, which defeats the point of hiding the periphery.
        uFeather: { value: 0.35 },
      },
      vertexShader: `
        varying vec3 vLocal;
        void main() {
          vLocal = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        precision mediump float;
        varying vec3 vLocal;
        uniform float uAperture;
        uniform float uFeather;
        void main() {
          // Camera space forward is -Z. The angle of this fragment off forward
          // is what the mask is a function of, and nothing else — so it is the
          // same mask in an eye whose frustum is shifted sideways.
          float a = acos(clamp(-normalize(vLocal).z, -1.0, 1.0));
          float alpha = smoothstep(uAperture, uAperture + uFeather, a);
          if (alpha <= 0.002) discard;
          gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.BackSide,
      // Never let the mask itself be a thing the fog or the tone map acts on.
      fog: false,
      toneMapped: false,
    });
    // Radius 0.5 m: inside any sane near plane in these games (the starter
    // template's is 0.4, the shooter's 0.08), and far enough not to be inside
    // the eye. It is a mask, so its distance is irrelevant to what it looks
    // like — only its angular extent is, and that is the same at any radius.
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), this.#material);
    this.mesh.renderOrder = 10_000;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /**
   * @param want 0..1, how closed the movement says it should be
   * @param dt   seconds
   */
  step(want: number, dt: number): void {
    const ease = Math.max(0.016, this.#comfort.easeSeconds);
    // Exponential approach rather than a linear ramp, and framerate-independent
    // rather than a fixed per-frame fraction — a headset may be at 72, 90 or
    // 120 Hz and a per-frame lerp would make the effect a different speed on
    // each one.
    const k = 1 - Math.exp(-dt / ease);
    this.#closed += (want - this.#closed) * (Number.isFinite(k) ? k : 1);
    if (this.#closed < 0.002) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const open = Math.PI;
    const shut = (this.#comfort.apertureDeg * Math.PI) / 180;
    this.#material.uniforms.uAperture!.value = open + (shut - open) * this.#closed;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.#material.dispose();
  }
}

/** 0 below `from`, 1 above `to`, linear between. `to <= from` is treated as a step. */
function ramp(v: number, from: number, to: number): number {
  if (!Number.isFinite(v)) return 0;
  if (to <= from) return v >= to ? 1 : 0;
  return Math.min(1, Math.max(0, (v - from) / (to - from)));
}

// ─── the little of WebXR this file names ─────────────────────────────────────
/*
 * TYPED HERE RATHER THAN TAKEN FROM `lib.dom`, and it is a portability decision
 * rather than a preference. The WebXR types are in `@types/webxr` and in newer
 * `lib.dom` revisions, and this package is compiled by four different resolvers
 * (see package.json) plus every game's own tsconfig. A type that is present in
 * some of them and absent in others is a package that builds here and fails in
 * a game, which is the least useful moment to find out. Three interfaces, only
 * the members actually read.
 */
interface XRSystemLike {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, init?: { optionalFeatures?: string[] }): Promise<XRSessionLike>;
}
interface XRSessionLike {
  readonly inputSources: ArrayLike<XRInputSourceLike> & Iterable<XRInputSourceLike>;
  requestReferenceSpace(type: string): Promise<unknown>;
  addEventListener(type: string, fn: () => void): void;
  end(): Promise<void>;
}
interface XRInputSourceLike {
  readonly handedness: string;
  readonly gamepad?: { readonly buttons: ReadonlyArray<{ readonly pressed: boolean }>; readonly axes: ArrayLike<number> & Iterable<number> } | null;
}

/** The writable half of `XRPointer`. Nothing outside this file may move one. */
interface MutablePointer {
  handedness: string;
  connected: boolean;
  space: THREE.Group;
  buttons: readonly boolean[];
  axes: readonly number[];
}
