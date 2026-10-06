/**
 * ============================================================================
 *  The chase rig's STATE, declared once.
 * ============================================================================
 *
 *  `bearing.ts`, `rig.ts` and `chase.ts` each declare a structural interface
 *  naming exactly the fields one pass reads — `BearingState`, `DriveRig`,
 *  `TeleportRig`, `ChaseRig`, `FovRig`, `FrameRig`. Six interfaces, and both
 *  racers satisfied all six by DECLARING THE SAME FIFTY FIELDS BY HAND, in the
 *  same order, with the same initialisers, in two files. The interfaces made
 *  the two copies typecheck; nothing made them stay equal.
 *
 *  That is why the declarations are shared: **one copy is a property a test
 *  has to hold.** A field initialised to `1` in one game and `0` in the other
 *  satisfies every one of
 *  those six interfaces, compiles in both, boots in both, and is a rig that
 *  starts its first frame with a different arm. So the declarations live here,
 *  once, and each game extends this.
 *
 *  **THIS CLASS IS STATE AND NOTHING ELSE — no methods, no constructor
 *  arguments, no behaviour.** Which pass writes which field is still entirely
 *  the game's business, and the six interfaces above are still what the
 *  package functions take. This is not a base class in the "share the
 *  algorithm" sense and must not become one: the moment it grows a method, it
 *  has started deciding something, and the two rigs diverge deliberately in
 *  several places (`updateUp`, `constrainEye`, the comfort ceiling, and the
 *  held-frame `dt === 0` handling each game documents at its own site).
 *
 *  **WHAT IS NOT HERE, AND WHY NOT.** Every field whose initialiser reads a
 *  GAME's constant stayed in the game: `aspect = REF_ASPECT`, `introT =
 *  INTRO_DUR`, `trauma = new Trauma(3.3, 0.6, 6)`, `field = new
 *  BoxField(PROP_ESCAPE_MAX)`, and the space racer's whole hull block off
 *  `HULL_*_DEF`. Same rule `lens.ts` and `blockers.ts` state at length and for
 *  the same reason: a package that ships a number two games happen to agree on
 *  has picked one game's feel for every game that ever calls it. A default
 *  here would be exactly that, one indirection further back — an initialiser
 *  is a number.
 *
 *  So is `prevState`, which is typed as each game's own `RaceState`; and so is
 *  every field only one of the two has (`shipRoll`, `subjMinRange`,
 *  `wideSide`, `magLost`), because a field one game never reads is a field the
 *  other game's reader has to be told to ignore.
 *
 *  **PUBLIC VERSUS PROTECTED IS THE SAME STATEMENT THE GAMES WERE MAKING.**
 *  The comment this file inherited said it plainly and it is repeated here
 *  because it is the reason the keywords look inconsistent:
 *
 *  > PUBLIC, and NOT AS AN ACCIDENT. These are the structural seams the
 *  > @homie-rocks/camera packages advance. TypeScript will not match a `private`
 *  > field structurally, so the choice is between dropping the keyword on the
 *  > fields a package names and copying them into a side object and back every
 *  > frame — or renaming forty call sites, which is how one gets missed
 *  > silently.
 *
 *  `protected` will not match structurally EITHER, so the split is exact and
 *  it is load-bearing documentation: **every `public` field below is named by
 *  one of the six interfaces and crosses the seam; every `protected` field is
 *  the rig's own and no package function can see it.** That is a stronger
 *  statement than the games could make on their own, because here it is
 *  checked — a field promoted to public for convenience is a field that has
 *  silently joined the contract, and `protected` refuses it.
 * ============================================================================
 */
import * as THREE from 'three';
import { BoreCeiling } from './blockers.ts';
import { PropBuilder } from './scene.ts';
import { Osc, type Vel } from './spring.ts';

/**
 * Everything both chase rigs carry, and nothing either one carries alone.
 *
 * Deliberately not `abstract`: there is nothing to implement. A game extends
 * it, adds its own fields and its own methods, and keeps `implements System`
 * — which this class says nothing about, because a rig's lifecycle is the
 * game's.
 */
export class ChaseRigState {
  // =========================================================================
  //  PUBLIC — the seam. Named by BearingState / DriveRig / TeleportRig /
  //  ChaseRig / FovRig / FrameRig, and readable by package functions.
  // =========================================================================

  // --- the bearing, and everything hanging off it --------------------------
  /** World yaw the lens sits behind, radians: 0 faces +Z, positive turns toward +X (`heading.ts`). */
  armYaw = 0;
  armVel: Vel = { v: 0 };
  /** Unit-vector form of {@link armYaw}. */
  arm = new THREE.Vector3(0, 0, 1);
  /** Lagged copy of the travel heading, for differentiation. */
  lagYaw = 0;
  lagVel: Vel = { v: 0 };
  /** Camera up, rolled with the surface by the game's own `updateUp`. */
  up = new THREE.Vector3(0, 1, 0);
  ready = false;

  // --- smoothed state ------------------------------------------------------
  driftSigned = 0;   // -1..1
  driftAmt = 0;
  driftVel: Vel = { v: 0 };
  tierAmt = 0;
  tierVel: Vel = { v: 0 };
  boostAmt = 0;
  boostVel: Vel = { v: 0 };
  brakeAmt = 0;
  brakeVel: Vel = { v: 0 };
  airAmt = 0;
  airVel: Vel = { v: 0 };
  calm = 0;          // 0 = parked/spun, 1 = driving
  calmVel: Vel = { v: 0 };
  corner = 0;        // -1..1, + = turning right
  cornerVel: Vel = { v: 0 };
  bend = 0;
  bendVel: Vel = { v: 0 };
  bankAmt = 0;       // |surface tilt|, 0..1
  bankVel: Vel = { v: 0 };
  lookAmt = 0;
  lookVel: Vel = { v: 0 };
  lookHold = 0;
  armFrac = 1;
  armFracVel: Vel = { v: 0 };
  faceYaw = 0;       // chassis heading, flattened
  compAng = 0;       // composition, as a camera yaw offset in radians

  // --- transients ----------------------------------------------------------
  //
  // The lens's own spring and the three that are not composition. `Trauma` is
  // NOT here: its three constructor arguments are a measured bleed-off rate
  // and a pair of bounds, all of them the game's, and a shared default would
  // be one game's shake for every game that ever called it.
  fovOsc = new Osc();
  dip = new Osc();     // landing bob
  kick = new Osc();    // impact punch along the view axis
  surge = new Osc();   // boost arm pull

  /** Where the machine was last frame. Read by `trackTeleport`. */
  prevKart = new THREE.Vector3();

  /** Where the LENS was last frame, and whether that is a real answer.
   *
   *  Both named by `EyeRig` in `constrain.ts`, which is the only reason they
   *  are on this side of the line — the eye-speed limiter is the one hard
   *  constraint both rigs share exactly.
   *
   *  `hasPrevEye` false means the lens teleported and the limiter must not try
   *  to smooth the jump. Deliberately a separate flag from {@link
   *  hasPrevQuat}: a respawn moves the lens but must not spin it, and treating
   *  the two as one event is what turns an ordinary off-track recovery into a
   *  1800 deg/s whip. */
  prevEye = new THREE.Vector3();
  hasPrevEye = false;

  /** Orientation continuity: false means the FRAME is cut — a different shot,
   *  not a camera move — and the slew ceiling does not apply. Public because a
   *  cut is something `trackTeleport` declares. */
  hasPrevQuat = false;

  /** Which pose built the last frame, and which harness plate it was built
   *  for. Both named by `ShotRig` / `CutRig` in `rig.ts`.
   *
   *  THESE TWO WERE `protected` UNTIL `cutToMode` AND `shotChanged` MOVED, AND
   *  THE COMPILER IS WHAT MOVED THEM. That is the split in the header doing its
   *  job rather than describing itself: a field cannot quietly join the
   *  contract, because `protected` does not match structurally and the call
   *  site does not build until somebody has decided, in this file, that the
   *  field is now part of the seam.
   *
   *  `prevMode` is `'chase' | 'wide' | 'close'` in both games and is widened to
   *  `string` here so this file does not become the place a fourth plate has to
   *  be declared. `poseKind` is an ordinal whose meaning is entirely the
   *  game's — `rig.ts` only ever compares it. */
  poseKind = 0;
  prevMode: string | null = null;

  /** Seconds since the flag, and the results orbit's accumulated angle.
   *
   *  PUBLIC, AND THE COMPILER IS WHAT MOVED THEM — the fourth time, and the
   *  same mechanism as `poseKind` / `prevMode` above. `ShotState` in
   *  `ShotState`, in the racing genre package's `shots.js`, names both;
   *  `protected` does not match structurally, and neither call site built
   *  until somebody decided HERE that these two are part of the seam.
   *
   *  Note WHICH package named them. `@homie-rocks/camera` still refuses to know what
   *  a race phase is — `shotChanged` says so in writing and that refusal did
   *  not move. What reads these is the GENRE package, one layer out, and the
   *  arrow points the only direction it may: the racing genre package may
   *  depend on this file, and this file may never depend on it.
   *
   *  THE GENRE PACKAGE IS NAMED IN PROSE AND NOT AS A SPECIFIER, ON PURPOSE.
   *  The dependency-direction check is a `grep` for the literal import
   *  specifier across every platform directory, and the bluntness is
   *  deliberate: `import type` leaves no runtime edge, so a
   *  module graph would miss a type-only dependency that is exactly as wrong
   *  as a value one. A grep cannot tell a docblock from a dependency, so
   *  spelling the specifier out HERE turns that gate red while nothing
   *  actually depends on anything — this file's imports are `three`,
   *  `./blockers.ts`, `./scene.ts` and `./spring.ts`, and that is the whole
   *  list. Do not "fix" this sentence by putting the specifier back.
   *
   *  `pickShot` only ever
   *  zeroes `orbit` on an edge and integrates `finishT` by `dt`; what either
   *  number MEANS to a frame is still entirely the game's, decided in its own
   *  `poseFinish` and `poseOrbit`. */
  finishT = 0;
  orbit = 0;

  /**
   * Which side of the establishing plate the machine sits on. -1, +1, or 0 for
   * "not chosen yet", which is what makes the first plate of a session pick
   * outright instead of inheriting a side from nothing.
   *
   * PUBLIC because `solvePlateEye` writes it and both games read it back to
   * compose the frame. It lives here — not in one game and not as a local —
   * because it is the whole of the hysteresis: a side chosen per frame is a
   * side that can flip per frame, and a plate that mirrors across the frame
   * between two adjacent captures is what once made a report and its own
   * pixels disagree about which half of the frame the ship was in.
   */
  wideSide = 0;

  // =========================================================================
  //  PROTECTED — the rig's own. No package function can see any of these, and
  //  `protected` is what enforces that rather than describing it.
  // =========================================================================

  // --- cinematics ----------------------------------------------------------
  protected cutPos = new THREE.Vector3();
  protected cutTangent = new THREE.Vector3();

  // --- bookkeeping ---------------------------------------------------------
  /** The camera's own track station, and whether the surface floor has a real
   *  answer yet.
   *
   *  PUBLIC, AND THE COMPILER IS WHAT MOVED THEM — the third time, and the
   *  same mechanism as `poseKind` / `prevMode` above. `reseedRig` in `rig.ts`
   *  names both, and `protected` does not match structurally, so the call site
   *  did not build until somebody decided HERE that these two are part of the
   *  seam. They are, and narrowly: `reseedRig` is the only package function
   *  that reads either, and all it does is put them back to the values three
   *  lines down. What each one MEANS to a frame — which station to hint a
   *  probe with, whether to adopt a surface height or rate-limit toward it —
   *  is still entirely the game's, and both games' `constrainEye` is where it
   *  is decided. */
  camT = -1;
  groundInit = false;
  /** NOT public, and not reset by `reseedRig` either: `groundInit = false` is
   *  already the whole statement that the next frame must adopt rather than
   *  rate-limit, so this is never read while it is stale. Two statements of
   *  one fact is two statements that can disagree. */
  protected groundY = 0;
  protected prevQuat = new THREE.Quaternion();

  // --- the blocker stores, and the one ray either rig ever casts -----------
  //
  // Every one of these is EMPTY at construction, which is the whole reason
  // they can live here: there is no number to pick and no game constant to
  // read. What FILLS them is entirely the game's — only a game can name the
  // meshes a roof is made of, or say which scenery is solid — and both walks
  // stayed in the games for exactly that reason.
  //
  // `field = new BoxField(PROP_ESCAPE_MAX)` is the one that did NOT come with
  // them, and it is the illustration: its constructor takes a number, and the
  // number is the game's.

  /** The tunnel bore is the one occluder that needs a real ray, and it only
   *  needs it once: the roof height at every station goes into `roof` at init
   *  and the frame path does an array lookup. */
  protected ray = new THREE.Raycaster();
  protected hits: THREE.Intersection[] = [];
  protected bore: THREE.Mesh[] = [];
  protected boreBox = new THREE.Box3();
  /** The bore-roof table. Built by the GAME — only it can name the meshes a
   *  roof is made of — and READ by `blockers.ts`. */
  protected roof = new BoreCeiling();

  /** Trackside furniture, and the establishing plate's occluder list. BUILT by
   *  `scene.ts` off the three fields of `ctx` its `PropWorld` names — the whole
   *  `Ctx` still does not cross the seam — and QUERIED through `blockers.ts`. */
  protected props = new PropBuilder();
  protected wideBlockers: THREE.Object3D[] | null = null;
}
