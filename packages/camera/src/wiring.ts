/**
 * ============================================================================
 *  The chase rig's WIRING — the sixteen one-line methods, declared once.
 * ============================================================================
 *
 *  `rigstate.ts` moved the fifty field declarations and said, in bold, that it
 *  must never grow a method. It has not. **This is a different class and it is
 *  the other half of the same finding.**
 *
 *  Every heavy pass in both racers' `Camera.ts` already lives in `chase.ts`,
 *  `bearing.ts`, `rig.ts`, `lens.ts`, `cinematics.ts` and `scene.ts`. What was
 *  still sitting in two games, word for word, was the **wiring**: sixteen
 *  methods whose whole body is one call into one of those files with this
 *  game's constants in it, plus the paragraph explaining why. A duplicate-prose
 *  check measured it and named the price — 124 lines of identical prose across
 *  seven runs, the longest of them 49 lines, all of it description of code that
 *  lives here.
 *
 *  A wrapper is not free just because it is short. It is the place a constant
 *  gets passed to the wrong parameter, and both copies have to be edited when
 *  a package signature changes — which is how one gets missed.
 *
 *  ## What decides whether a method is in this file
 *
 *  **The body must be the same body.** Where the two rigs' wiring differs it
 *  differs by a NUMBER, and the number comes in through {@link
 *  RigWiringTuning}; that is `lens.ts`'s rule and it is unchanged here. Where
 *  it differs by a BEHAVIOUR, the method stayed in the game. The list of what
 *  stayed, and why, is at the bottom of this header, and it is a refusal list
 *  rather than a backlog.
 *
 *  ## `Ctx` STILL DOES NOT CROSS THE SEAM
 *
 *  Every method here used to take the games' `Ctx`, which carries the race, the
 *  track, the items and the match. {@link RigWorld}, {@link RigSubject} and
 *  {@link RigSample} name **exactly** the fields these sixteen bodies read —
 *  fifteen of them — and both games' types satisfy all three structurally. That
 *  is the technique `scene.ts` used for `PropWorld` and `chase.ts` for
 *  `ChaseRig`, and it is what let this land without editing a single call site
 *  in either game.
 *
 *  ## THE SCRATCH IS THE SEAM. READ `scratch.ts` BEFORE CHANGING ANYTHING HERE.
 *
 *  `poseIntro`, `poseFinish` and `poseOrbit` compose into `_eye`/`_aim` and the
 *  GAME's `lateUpdate` reads them. Those bindings are imported from
 *  `./scratch.ts` and both games import the same ones. Give this file its own
 *  pair and every cinematic silently stops moving the camera while every frame
 *  still renders — a deliberate fault in the package's tests does exactly that
 *  and the checks go red.
 *
 *  ## What did NOT move, and why not — each of these is a refusal
 *
 *  - **`lateUpdate`.** The two frames are not the same frame. The space racer
 *    measures the hull, solves the arm against it and drives a sky anchor;
 *    the kart racer does none of that. They also diverge DELIBERATELY on
 *    `dt === 0`, and that divergence is documented in both games at length.
 *  - **`updateUp`, `constrainEye`, `sweepArm`, `poseClose`.** One rig works in
 *    world Y and the other in depth along the deck normal — wrong by the whole
 *    bank angle and wrong in SIGN through an inversion. Refused when the rig
 *    was first extracted, and refused again here. **`poseWide`
 *    came off this list**: its solve is {@link ChaseRigWiring.solvePlateEye}
 *    now, and it could come off because the plate is the ONE shot both rigs
 *    already compose against the world's up rather than their own — a plate
 *    rolled with a banked deck is a plate of a 42-degree horizon. What each
 *    game does with the solved eye is still the game's, and the two disagree
 *    about all of it.
 *  - **`poseCinematic`.** Its body is one call into the racing GENRE package's
 *    `pickShot`, and this package may not import that one: the arrow points
 *    genre -> platform and never back. `rigstate.ts` spells out why that rule
 *    is checked by a grep for the specifier rather than by a module graph.
 *    Eleven lines in each game, and they stay there.
 *  - **`init`.** Both games' `init` is the same six lines of lens setup, then
 *    the same three lines of track binding, then a bus subscription whose four
 *    gains are each game's own. The two shared blocks are {@link initLens} and
 *    {@link bindTrack}; the subscription is not a wiring method, it is a
 *    statement about how hard a landing feels, and it stays.
 *  - **`frameSubject`, `frameX`, `frameY`, `poseChase`, `updateHeading`.** All
 *    five differ by more than a value: a hull centre against a fixed lift, a
 *    sky anchor against a constant zero, a settle hook, and a returned
 *    `lost` flag. Taking them would mean a flag that changes behaviour, and
 *    `bearing.ts` says in writing what that means.
 * ============================================================================
 */
import * as THREE from 'three';

import { BoxField } from './blockers.ts';
import { type FovTuning, applyChaseFov } from './chase.ts';
import {
  type FinishShot, type IntroShot, type OrbitShot,
  captureFinishCut, chooseIntroBearing, poseFinish, poseIntro, poseOrbit,
} from './cinematics.ts';
import { type FovBounds, fitFov } from './lens.ts';
import { type SightlineTuning, subjectOccluded } from './rig.ts';
import { ChaseRigState } from './rigstate.ts';
import { type PropRules, buildBoreCeiling, buildWideBlockers } from './scene.ts';
import { _aim, _chaseAim, _chaseEye, _dir, _eye, _q, _right } from './scratch.ts';
import { Trauma } from './spring.ts';

// ===========================================================================
//  Exactly what the sixteen bodies read off a world
// ===========================================================================

/** The four fields of a track sample the wiring touches. Both games'
 *  `TrackSample` satisfies this and brings no lap with it. */
export interface RigSample {
  readonly pos: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly tangent: THREE.Vector3;
  readonly binormal: THREE.Vector3;
  readonly halfWidth: number;
}

/** The three questions the wiring asks a circuit, and the two bits it reads off
 *  a probe. `lateral` is which side of the racing line the machine is on, which
 *  is what `captureFinishCut` needs to stand on the outside; `y` is the ground
 *  height under a point, which is the floor {@link ChaseRigWiring.solvePlateEye}
 *  keeps the establishing lens above. Both games' probe answers both and always
 *  did — this interface named one of them because until the plate solve moved
 *  in, one was all that was read. */
export interface RigTrack<T extends RigSample> {
  /** Centreline length in metres. Read only to turn the plate's LEAD, which is
   *  a distance, into the `t` its sampler wants. */
  readonly length: number;
  sample(t: number, out?: T): T;
  probe(p: THREE.Vector3, hintT: number): { readonly lateral: number; readonly y: number };
  collideWalls(p: THREE.Vector3, radius: number, hintT: number): { readonly push: THREE.Vector3 } | null;
}

/**
 * Exactly the eight fields of a world these bodies read, and nothing else.
 *
 * `race` is optional and its two members are optional, because that is what
 * `PropWorld` in `scene.ts` already declared and a world is handed to both.
 * `standings` is read for `[0].position` — the winner the results ring turns
 * around — and for nothing else; what a standing IS remains entirely the
 * game's.
 */
export interface RigWorld<T extends RigSample> {
  readonly camera: THREE.PerspectiveCamera;
  readonly width: number;
  readonly height: number;
  readonly frame: number;
  readonly scene: THREE.Object3D;
  /** Normalised direction TOWARD the key light. The fly-in's only input. */
  readonly sunDirection: THREE.Vector3;
  /** Extra degrees of field the game's own boost is asking for. */
  readonly fovPunch: number;
  readonly track: RigTrack<T>;
  readonly race?: {
    readonly karts?: ArrayLike<{ readonly object: THREE.Object3D }>;
    readonly standings?: ArrayLike<{ readonly position: THREE.Vector3 }> | null;
  } | null;
}

/** The three fields of the machine the wiring reads. `t` is its station on the
 *  centreline, which is a hint for a probe and nothing more. */
export interface RigSubject {
  readonly position: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly t: number;
}

// ===========================================================================
//  The tuning — every number, and not one default
// ===========================================================================

/**
 * Everything the wiring needs from a game, all of it a value.
 *
 * **NO FIELD BELOW HAS A DEFAULT AND NONE MAY GET ONE.** `lens.ts`,
 * `blockers.ts`, `scene.ts` and `rigstate.ts` each make this argument at
 * length and it is the same argument: a package that ships a number two racers
 * happen to agree on has quietly picked one game's feel for every game that
 * ever calls it, and the frames look completely fine while it does. Three of
 * these are identical in both racers today — `traumaDecay`, `near`, `far` —
 * and all three are passed anyway, because "two copies agree" is not
 * "somebody decided".
 *
 * The fourteen lengths in the three shot structs are the whole of what the
 * cinematics diverge by, and every one of them is a length in metres off the
 * machine: a kart is 1.5 m and a ship 8.8.
 */
export interface RigWiringTuning {
  /** The world's up. An ARGUMENT and not an export, so a game cannot tilt every
   *  other game by writing into a shared `Vector3`. */
  readonly worldUp: THREE.Vector3;

  // --- the lens ------------------------------------------------------------
  /** Aspect used before the first `resize`, and the fallback when a panel
   *  reports a zero dimension. */
  readonly refAspect: number;
  readonly near: number;
  readonly far: number;
  /** Resting field, in degrees. Seeds the lens spring at `init`. */
  readonly fovBase: number;
  readonly fovBounds: FovBounds;
  readonly lens: FovTuning;

  // --- the scene walks -----------------------------------------------------
  /** Collision probe radius for walls, in metres. */
  readonly camRadius: number;
  readonly boreStations: number;
  readonly boreClear: number;
  readonly propRules: PropRules;
  /** Furthest the last-resort furniture push moves the lens in one frame. */
  readonly propEscapeMax: number;
  readonly wideMaxInstances: number;
  readonly wideMaxRadius: number;
  readonly sightline: SightlineTuning;

  // --- the shake -----------------------------------------------------------
  /** Bleed-off rate per second, and the bounds on a requested duration. */
  readonly traumaDecay: number;
  readonly traumaMin: number;
  readonly traumaMax: number;

  // --- the three shots that are not the chase ------------------------------
  /** Countdown fly-in length, seconds. */
  readonly introDur: number;
  readonly introShot: IntroShot;
  readonly finishShot: FinishShot;
  /** Seconds the finish cut holds trackside before rising. */
  readonly finishHold: number;
  readonly orbitShot: OrbitShot;
}

/**
 * The establishing plate's eight numbers, and NOT ONE DEFAULT.
 *
 * Passed to {@link ChaseRigWiring.solvePlateEye} rather than folded into
 * {@link RigWiringTuning} for one reason and it is a build reason: a required
 * field added there breaks both racers the instant it lands, and a change that
 * cannot leave the tree green between two game commits cannot be half-undone.
 *
 * **EVERY FIELD IS REQUIRED AND NONE MAY GROW A DEFAULT.** This is the same
 * argument `RigWiringTuning`, `blockers.ts`, `lens.ts` and `rigstate.ts` each
 * make, and the plate is the shot that proves it: seven of the eight below are
 * the *entire* divergence between two plates that were otherwise the same twenty
 * lines, and every one of those seven is a length or an angle scaled off the
 * machine. The eighth, `sideDead`, is the one that is not, and its own docblock
 * says why and shows the derivative.
 * A kart is 1.5 m and a ship 8.8, so the ship is framed from 95 m at 23 degrees
 * where the kart is framed from 42 at 31 — and a game that forgot to say which
 * it was would silently be photographed like the other one.
 */
export interface PlateTuning {
  /** Metres of centreline AHEAD of the machine the anchor is sampled at. */
  readonly lead: number;
  /** How far the anchor is pulled off the machine toward that sample, 0..1.
   *  Every metre it moves is a metre the composition pushes the machine the
   *  other way, because the axis is then rotated to put the machine back at
   *  `WIDE_FRAME_X` — which is why this is a length decision and not a taste. */
  readonly anchor: number;
  /** Metres the anchor is lifted along the world up. */
  readonly lift: number;
  /** Radians the plate's bearing is swung off the chase arm. */
  readonly azimuth: number;
  /** Starting depression, radians. The lens looks ALONG the ribbon at a small
   *  angle and DOWN ONTO it at a large one, which decides whether the shot has
   *  depth planes or is a map. */
  readonly elevation: number;
  /** Metres the lens is kept above the ground under it, as a hard floor. */
  readonly clearance: number;
  /** Metres from the anchor. The plate's whole scale. */
  readonly range: number;
  /**
   * Hysteresis on the left/right choice, as a dot product and NOT a length.
   *
   * The side comes from `sign(tangent . right)`, and that dot passes through
   * zero whenever the chase bearing lags the travel heading by the plate's own
   * azimuth — so on a corner entry the composition MIRRORS ACROSS THE FRAME
   * between adjacent frames with nothing to stop it. An early `wide` shot
   * reported the subject at NDC -0.318 while the pixels had it at +0.30: the
   * measurement read one frame and the capture recorded the other, which is why
   * a report said `onScreen: true` about a frame that visibly had no machine in
   * it at all.
   *
   * **THIS IS THE ONE FIELD HERE THAT IS NOT SCALED OFF THE MACHINE, and that
   * is a measured claim rather than a convenience.** `tangent . right` is
   * `sin(azimuth + phi)` where `phi` is the signed bearing lag, so at the zero
   * crossing its derivative with respect to `phi` is `cos(0) = 1` — exactly 1,
   * in every game, whatever the azimuth. A dead band of 0.25 is therefore 14.3
   * degrees of bearing lag on a kart and 14.3 degrees on a ship. It is still
   * REQUIRED and still passed, because "two copies agree" is not "somebody
   * decided" and a game with a differently-behaved bearing may want a different
   * angle — but a game copying this number is copying an angle, not inheriting
   * another game's art direction.
   */
  readonly sideDead: number;
}

// ===========================================================================
//  The lens report — the measurement neither racer had
// ===========================================================================

/**
 * What the panel did to the lens this frame.
 *
 * **THE UPGRADE THIS FILE MADE LANDABLE, AND IT LANDS IN BOTH RACERS AT ONCE.**
 * The space racer published a framing record and the other games had no
 * instrument at all, so in the kart racer "the composition was wrong" and "the
 * composition was right and something else moved the lens" were the same
 * observation. The other half: `fitFov` clamps **silently** in both games, and
 * the claim that the horizontal bound *"does not bind on the measured panel"*
 * had never been measured in a running game by anything. There was nowhere to
 * put the counter that would not have been two counters.
 *
 * There is now. Six numbers, written unconditionally on the frame path —
 * cheaper than the branch that would skip them, and a diagnostic that is only
 * present when somebody remembered to ask for it is a diagnostic that is absent
 * on the frame that needed it. That is the space racer's own rule for
 * `framing` and this is the shared half of it.
 *
 * **IT MOVES NO PIXELS.** Every field is read off values the lens had already
 * computed. The package's tests check it against arithmetic they do
 * independently, because a gate grading its own homework is not a gate.
 */
export interface LensReport {
  /** Live panel aspect the fit was solved at. */
  aspect: number;
  /** Degrees of vertical field the chase solve ASKED for, before the panel had
   *  its say — i.e. `applyChaseFov`'s target. */
  asked: number;
  /** ...and what it got back. */
  fitted: number;
  /** `fitted - asked`. **Non-zero means the PANEL decided the field this
   *  frame**, not the drive state, and that is the reading nothing had. */
  bound: number;
  /** Frames since boot on which it was non-zero. A portrait phone drives this
   *  every frame; the measured 1920x1080 panel leaves it at 0, which is that
   *  claim finally being checkable rather than asserted. */
  boundFrames: number;
  /** Live vertical field after the spring, and the HORIZONTAL field the player
   *  is actually looking through — which is the number both bounds exist to
   *  govern and neither game ever wrote down. */
  fov: number;
  hFov: number;
  /** Which shot last composed `_eye`/`_aim`. Empty while the game's own chase
   *  pose owns the frame, which is the distinction the kart racer could not make. */
  shot: '' | 'intro' | 'finish' | 'orbit';
  /** 0..1 through the countdown fly-in, or -1 once it is done. */
  introFrac: number;
}

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

// ===========================================================================

/**
 * The wiring, extending the state.
 *
 * `abstract` because it is not a rig: it has no `lateUpdate`, no `init` and no
 * opinion about a frame's order. A game extends it, adds the passes that are
 * its own, and keeps `implements System` — which this class says nothing
 * about, for the reason `rigstate.ts` gives.
 */
export abstract class ChaseRigWiring<
  W extends RigWorld<T>,
  S extends RigSubject,
  T extends RigSample,
> extends ChaseRigState {
  /** Every number this class was given. Read on the frame path; never written. */
  protected readonly tune: RigWiringTuning;

  /** Seconds left in the countdown fly-in. PUBLIC because `ShotState` in the
   *  racing genre package names it; `rigstate.ts` documents that mechanism. */
  introT: number;

  /** Radians off head-on the fly-in swings, chosen once against the sun. */
  protected introAng = 0.5;

  /** Live panel aspect, kept by {@link resize} so `fitFov` can bind. */
  protected aspect: number;

  /** Screen shake. Its three numbers are the game's — see the tuning above for
   *  why they are passed rather than defaulted — and the class is here because
   *  `addShake` and `reseed` are the same two lines in both racers. */
  protected readonly trauma: Trauma;

  /** Trackside furniture, queried by each game's own arm sweep and eye
   *  constraint. The one blocker store with a number in its constructor, which
   *  is why `rigstate.ts` could not hold it and this class can: the number
   *  arrives as tuning. */
  protected readonly field: BoxField;

  /** The circuit's sampler, bound once, and the two scratch samples both games
   *  keep so the frame path allocates nothing. Filled by {@link bindTrack}. */
  protected sampleFn: ((t: number, out?: T) => T) | null = null;
  protected smp: T | null = null;
  protected smpB: T | null = null;

  /** The bus subscription taken out by each game's own `init`. Held here
   *  because {@link dispose} is the same line in both. */
  protected unsub: (() => void) | null = null;

  /** The aspect-aware bound, bound ONCE: the frame path allocates nothing, and
   *  a closure per frame is still a closure per frame. */
  protected readonly fitFovBound = (v: number) => this.fitFov(v);

  /** {@link LensReport}. PUBLIC and mutable on purpose, and the same object
   *  every frame so a reader gets the live value rather than a snapshot —
   *  the space racer's `framing` makes the same choice for the same reason. */
  readonly lens: LensReport = {
    aspect: 0, asked: 0, fitted: 0, bound: 0, boundFrames: 0,
    fov: 0, hFov: 0, shot: '', introFrac: -1,
  };

  constructor(tune: RigWiringTuning) {
    super();
    this.tune = tune;
    this.aspect = tune.refAspect;
    this.introT = tune.introDur;
    this.trauma = new Trauma(tune.traumaDecay, tune.traumaMin, tune.traumaMax);
    this.field = new BoxField(tune.propEscapeMax);
  }

  // =========================================================================
  //  Lifecycle
  // =========================================================================

  /** Clip planes, the resting field, and the first aspect. The first six lines
   *  of both games' `init`, character for character. */
  initLens(world: W): void {
    world.camera.near = this.tune.near;
    world.camera.far = this.tune.far;
    this.fovOsc.v = this.tune.fovBase;
    world.camera.fov = this.tune.fovBase;
    world.camera.updateProjectionMatrix();
    this.resize(world.width, world.height);
  }

  /**
   * Bind the circuit's sampler and take the two scratch samples.
   *
   * The cast in each game reached `Track`'s scratch-target overload, which
   * `ITrack` omits; {@link RigTrack} declares the overload directly, so the
   * cast is gone rather than moved. An implementation without it still returns
   * a correct sample, it just costs one allocation.
   */
  bindTrack(world: W): void {
    const track = world.track;
    this.sampleFn = (t: number, out?: T) => track.sample(t, out);
    this.smp = track.sample(0);
    this.smpB = track.sample(0);
  }

  dispose(): void { this.unsub?.(); this.unsub = null; }

  resize(w: number, h: number): void {
    this.aspect = h > 0 && w > 0 ? w / h : this.tune.refAspect;
  }

  /** A longer requested duration means a slower bleed-off, not a timer, so
   *  overlapping requests compose instead of the last one winning. */
  addShake(a: number, s = 0.3): void { this.trauma.add(a, s); }

  // =========================================================================
  //  The lens
  // =========================================================================

  /**
   * `lens.ts`, wired to this game's bounds — and the one place the panel's
   * verdict is visible.
   *
   * `applyChaseFov` calls this on the TARGET, once a frame, before the spring.
   * So `asked` is what the drive state wanted and `fitted` is what the panel
   * allowed, and their difference is the whole of {@link LensReport.bound}. The
   * arithmetic is not repeated here — `bound` is a subtraction of two values
   * `fitFov` produced, which is why a change to the fit cannot make this report
   * agree with a stale copy of itself.
   */
  protected fitFov(v: number): number {
    const fitted = fitFov(v, this.aspect, this.tune.fovBounds);
    const L = this.lens;
    L.aspect = this.aspect;
    L.asked = v;
    L.fitted = fitted;
    L.bound = fitted - v;
    if (L.bound !== 0) L.boundFrames++;
    return fitted;
  }

  /**
   * Hang the report where a harness can find it, under the game's own handle.
   *
   * Explicit rather than automatic: a package that writes to `window` on import
   * has a side effect a Node harness has to work around, and the handle is the
   * game's to name. One line in each `init`.
   */
  publishLens(handle: string): void {
    const w = globalThis as unknown as Record<string, unknown>;
    w[handle] = this.lens;
  }

  /**
   * `chase.ts`'s `applyChaseFov`, wired to this game's `FovTuning`.
   *
   * `settled` and `fovSpeed` come in as values rather than being derived here,
   * and that is the seam working: "the race is over" is a different enum in
   * each game and `feel.fovSpeed` is a LIVE knob one game scales and the other
   * does not. The package asks *is this a settled shot* and *how many degrees
   * per unit speed*, which is what it was ever consulted about.
   */
  protected applyChaseLens(
    world: W, mode: 'chase' | 'wide' | 'close', sp: number,
    settled: boolean, fovSpeed: number, dt: number,
  ): void {
    _lens.mode = mode;
    _lens.settled = settled;
    _lens.introFrac = this.introT < this.tune.introDur ? this.introT / this.tune.introDur : null;
    _lens.sp = sp;
    _lens.fovSpeed = fovSpeed;
    _lens.punch = world.fovPunch;
    applyChaseFov(this, this.tune.lens, _lens, world.camera, dt, this.fitFovBound);
    // Read off the camera rather than off `fovOsc`, because the 0.015-degree
    // deadband in `applyChaseFov` means those two are deliberately not the same
    // number and the one the player looks through is the camera's.
    const L = this.lens;
    L.fov = world.camera.fov;
    L.hFov = 2 * Math.atan(Math.tan(L.fov * 0.5 * DEG) * (this.aspect > 0 ? this.aspect : this.tune.refAspect)) * RAD;
    L.introFrac = _lens.introFrac === null ? -1 : _lens.introFrac;
    // The chase owns the frame until a cinematic says otherwise; each of the
    // three stamps its own name below, and this clears it every frame so a
    // stale name cannot outlive the shot that set it.
    L.shot = '';
  }

  // =========================================================================
  //  The scene walks
  // =========================================================================

  /** One ray straight up from the road at every station, once, at init. The
   *  walk is `scene.ts`'s; naming the meshes a roof is made of is the game's,
   *  and that is the whole seam — which is why `collectBores` is called by each
   *  game's own `init` and only the table build is here. */
  protected buildBoreCeiling(): void {
    this.roof.boreY = buildBoreCeiling(
      (t) => this.sampleFn!(t, this.smp!),
      this.boreBox, this.bore, this.ray, this.hits,
      this.tune.boreStations, this.tune.boreClear,
    );
  }

  /** Flatten every solid, ground-planted, camera-sized piece of scenery into a
   *  flat `Float32Array` of world AABBs, and hand it to the `BoxField` the arm
   *  sweep queries. The walk lives in `scene.ts`; `propRules` — and in
   *  particular each circuit's skip list, which one arm cannot survive without
   *  — is the game's. */
  protected buildProps(world: W): void {
    this.props.build(world, this.tune.propRules, this.field);
  }

  /** Everything a ray from the establishing plate could plausibly hit. Built
   *  once, lazily: this runs on a harness plate and never on a gameplay frame. */
  protected ensureWideBlockers(world: W): void {
    if (this.wideBlockers) return;
    this.wideBlockers = buildWideBlockers(world.scene, this.tune.wideMaxInstances, this.tune.wideMaxRadius);
  }

  /**
   * Three rays spanning the machine's box, cast outward from it so the near
   * clip skips its own geometry and the far clip stops short of the lens.
   *
   * `up` is the CALLER's and never a world constant: through the space racer's
   * inversion the deck normal is what "above the hull" means, and probing along
   * world Y there samples the vacuum. The kart racer passes its `WORLD_UP` at
   * both call sites, which is the same call it was making.
   */
  protected subjectOccluded(k: S, up: THREE.Vector3): boolean {
    return subjectOccluded(_eye, k.position, k.forward, up, this.tune.sightline,
      this.wideBlockers, this.ray, this.hits);
  }

  /**
   * The establishing plate's eye, and the bearing it was solved along.
   *
   * Writes `_aim` (the anchor the lens is placed away from), `_dir` (the
   * flattened bearing), `_eye` (the solved lens) and `_right` (the bearing's
   * lateral, for whichever side of frame the caller wants the machine on), and
   * returns the track sample it took, because both callers read its `tangent`
   * to answer exactly that. NOTHING IS ALLOCATED: `smpB` is the caller's own
   * scratch sample and the four vectors are `scratch.ts`'s.
   *
   * `_aim` AND NOT `_pt`, and the reason CHANGED under the arrangement. It used
   * to be "`subjectOccluded` writes `_pt`"; since that probe became `rig.ts`'s
   * it writes THAT file's `_pt` and leaves this one alone. The arrangement
   * stays because the escalation loop re-reads the anchor on every iteration
   * and `_aim` is the vector nothing in the loop touches — which is now the
   * whole of the reason rather than half of it. Written down rather than
   * silently corrected: a value that SURVIVES where it used to be destroyed is
   * the exact failure mode moving code into a package has to be careful about.
   *
   * THE ESCALATION IS THE POINT AND IT IS WHY THE PLATE IS NOT A CONSTANT SHOT.
   * A fixed depression is a picture of whatever is standing between the lens
   * and the machine — a village roofline on one circuit, a gantry truss on the
   * other. So the shot climbs 0.115 rad at a time until the sightline is clear,
   * and gives up at 1.25 rad because 72 degrees is already a map rather than a
   * plate. Seven tries, and the cap is checked AFTER the increment so the last
   * attempt is composed rather than abandoned.
   *
   * `up` is `tune.worldUp` and not the caller's, deliberately: both racers
   * compose this plate against the world's up even where their chase rigs do
   * not, because a plate rolled with a banked deck is a plate of a horizon at
   * 42 degrees. What each game does with the RESULT — which side of frame, what
   * hysteresis, whether the shot counts as a cut — stays entirely the game's,
   * and the two disagree about all three.
   *
   * **AND `up` IS NOT AS GENERAL AS IT LOOKS. Two lines below say +Y out loud:**
   * `_dir.y = 0` flattens the bearing against the world's XZ plane, and the
   * clearance floor compares `_eye.y` against the probe's `y`. Both racers ship
   * `worldUp = (0, 1, 0)` and both wrote these two lines exactly this way, so
   * this is what they do today and it is a parity move, not a generalisation. A
   * third game whose world up is not +Y would get a plate flattened against the
   * wrong plane and a floor measured along the wrong axis, and it would look
   * completely fine in a still. That is a real limit and it is written here
   * rather than discovered — the fix, when somebody needs it, is a projection
   * against `up` and a clearance measured along it, and it is a BEHAVIOUR
   * change to both racers on any circuit that is not level.
   */
  protected solvePlateEye(world: W, k: S, plate: PlateTuning): T {
    const up = this.tune.worldUp;
    const s = this.sampleFn!(k.t + plate.lead / Math.max(1, world.track.length), this.smpB!);
    _aim.copy(k.position).lerp(s.pos, plate.anchor).addScaledVector(up, plate.lift);

    _q.setFromAxisAngle(up, plate.azimuth);
    _dir.copy(this.arm).applyQuaternion(_q);
    _dir.y = 0;
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1); else _dir.normalize();

    let elev = plate.elevation;
    for (let i = 0; i < 7; i++) {
      _eye.copy(_aim)
        .addScaledVector(_dir, -plate.range * Math.cos(elev))
        .addScaledVector(up, plate.range * Math.sin(elev));
      const pr = world.track.probe(_eye, k.t);
      if (_eye.y < pr.y + plate.clearance) _eye.y = pr.y + plate.clearance;
      if (!this.subjectOccluded(k, up)) break;
      elev += 0.115;
      if (elev > 1.25) break;                     // 72 degrees is already a map
    }

    // The side of frame, WITH HYSTERESIS. The machine goes on the side it is
    // driving AWAY from, so the racing line occupies the two thirds it is
    // heading into; `sideDead` is what stops that decision strobing on a corner
    // entry, and its docblock is where the argument lives.
    _right.crossVectors(_dir, up);
    if (_right.lengthSq() > 1e-6) _right.normalize(); else _right.set(1, 0, 0);
    const swing = s.tangent.dot(_right);
    if (this.wideSide === 0 || Math.abs(swing) > plate.sideDead) this.wideSide = swing >= 0 ? -1 : 1;
    return s;
  }

  // =========================================================================
  //  Cinematics — countdown, finish, results
  // =========================================================================
  //
  // Four shots, one call each into `cinematics.ts`. The bodies were
  // line-for-line identical in both racers and the entire divergence was the
  // fourteen lengths in `introShot` / `finishShot` / `orbitShot`.

  /** `chooseIntroBearing` reads the sun direction and nothing else, so it is
   *  given the vector rather than the world. */
  chooseIntroBearing(world: W): void {
    this.introAng = chooseIntroBearing(world.sunDirection, this.arm, this.tune.worldUp);
  }

  poseIntro(world: W, k: S, p: number): void {
    poseIntro(
      _eye, _aim, k.position, this.arm, this.tune.worldUp, this.introAng, p, this.tune.introShot,
      // A low lens swung well off the racing axis can end up behind a barrier;
      // there is no arm sweep out here to catch it, so one analytic wall query
      // puts it back over the road. Only the game's own track can answer it, so
      // it goes across as a callback — and only during the countdown, which is
      // the one place an allocation per frame is free.
      (eye) => {
        const wall = world.track.collideWalls(eye, this.tune.camRadius, k.t);
        if (wall) eye.add(wall.push);
      },
      _chaseEye, _chaseAim,
    );
    this.lens.shot = 'intro';
  }

  captureFinishCut(world: W, k: S): void {
    const s = this.sampleFn!(k.t + 0.004, this.smpB!);
    captureFinishCut(this.cutPos, this.cutTangent, s, world.track.probe(k.position, k.t).lateral, this.tune.finishShot);
    // The finish is a real cut to a trackside camera: both position and
    // orientation change outright, because it is a different shot.
    this.hasPrevEye = false;
    this.hasPrevQuat = false;
  }

  poseFinish(k: S): void {
    poseFinish(_eye, _aim, k.position, this.arm, this.tune.worldUp,
      this.cutPos, this.cutTangent, this.finishT, this.tune.finishHold, this.tune.finishShot);
    this.lens.shot = 'finish';
  }

  poseOrbit(world: W, player: S, wide: boolean, dt: number): void {
    const standings = world.race?.standings;
    const winner = (standings && standings[0]) || player;
    this.orbit = poseOrbit(_eye, _aim, winner.position, this.tune.worldUp, this.orbit, wide, dt, this.tune.orbitShot);
    this.lens.shot = 'orbit';
  }
}

/** The lens pass's per-frame half, mutated in place rather than built each
 *  frame: the frame path allocates nothing, and `feel.fovSpeed` is a live knob
 *  a struct built once would freeze. */
const _lens: {
  mode: 'chase' | 'wide' | 'close';
  settled: boolean;
  introFrac: number | null;
  sp: number;
  fovSpeed: number;
  punch: number;
} = { mode: 'chase', settled: false, introFrac: null, sp: 0, fovSpeed: 0, punch: 0 };
