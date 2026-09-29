import * as THREE from 'three';

/**
 * ============================================================================
 *  The vocabulary both racers emit in.
 * ============================================================================
 *  The two racing games this was extracted from are forks of one another, and
 *  their effects files still share about two thousand substantive lines. The
 *  blocker on moving any of it was always the same: the methods take the
 *  game's context, its vehicle and its per-vehicle effect state — three types
 *  that carry race/track/items/match/combat state and must never cross a
 *  package seam.
 *
 *  They do not have to. `wake.ts` and `blast.ts` declare STRUCTURAL interfaces
 *  of exactly the fields the moved code reads, and each game's own types
 *  satisfy them without a cast and without one call site changing. This file
 *  holds what those two need in common: the palette, the tile indices, the
 *  life budget, and — the thing that actually separates the two games —
 *  THE MEDIUM.
 *
 *  WHAT THE MEDIUM IS FOR.
 *
 *  Nearly every remaining difference between the two files' emitters is one of
 *  two numbers: a gravity and a drag. The kart game throws grit at -9 m/s² and
 *  drags it at 0.9; the ship game throws the same grit at -0.31 — a tidal
 *  gradient, not a planet — and drags it at 0.05, because there is nothing for
 *  it to push against. The shapes, the sizes, the lives, the colour ramps and
 *  the emission loops are identical, line for line.
 *
 *  So the medium is a VALUE the game supplies, in the sense this extraction
 *  uses the word: an exposure, a curve, a segment count. It is emphatically
 *  NOT a flag that changes behaviour inside a shared function — nothing here
 *  branches on which game is running, and no emitter asks.
 *
 *  `buoyancy` is a multiplier rather than a table because every buoyant
 *  gravity in both files maps the same way: whatever a puff of gas does in
 *  air, it does nothing in vacuum. 0.7 × 1 is 0.7 and 0.7 × 0 is 0, so the
 *  authored number stays visible at the emitter that authored it.
 *
 *  Solid matter needs a table instead, and it is worth saying why rather than
 *  leaving the asymmetry looking like an oversight: vacuum does not scale
 *  air's drag by any constant. 0.9 became 0.05 in one emitter and 0.03 in
 *  another; 1.4 became 0.05 and 0.55 became 0.02. Those numbers were tuned by
 *  eye against two different pictures and there is no function joining them.
 *  Inventing one would change what both games render, which is the one thing
 *  an extraction may not do.
 *
 *  A parity test is the gate on all of that: it runs every moved emitter
 *  through both media and compares the gravity, drag, tile and mode of all 24
 *  emissions against the numbers read off the games as they stood before a
 *  line of this moved.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
//  Palette — the entries both games author against, byte-identical in each
//  before this file existed.
// ---------------------------------------------------------------------------

export const C_HOT = new THREE.Color(0xfff2d4);
export const C_FLAME_MID = new THREE.Color(0xff9a2e);
export const C_FLAME_COOL = new THREE.Color(0xc4331a);
/** blue-white root of a boost flame — hotter and cooler-hued than C_HOT */
export const C_FLAME_ROOT = new THREE.Color(0xdcefff);
export const C_SMOKE = new THREE.Color(0xb9b4ac);
/**
 * Smoke torn off a tyre on TARMAC. Vaporised rubber and road binder is a cool
 * light grey; `C_SMOKE` is a warm grey authored for dust, and warming it a
 * further 42% toward the key put the drift cloud on exactly the hue of dry dirt
 * — the review reads it as "driving through a dust cloud, not tyres tearing at
 * tarmac". The sun side is warmed by the wrap-lighting term in Particles, which
 * is where that warmth belongs: in the LIGHT, not in the albedo.
 */
export const C_SMOKE_TARMAC = new THREE.Color(0xc4c6cf);
/**
 * Old, cooled smoke. Nudged off the warm grey it used to be: a puff that has
 * stopped being lit by the exhaust is lit by the sky, and the art direction puts the shadow
 * end of the grade on the cool side. It is the far end of the birth→death ramp,
 * so this is what gives a drift column a warm head and a cool tail.
 */
export const C_SMOKE_DARK = new THREE.Color(0x64656e);
export const C_SPARK_WHITE = new THREE.Color(0xfff4e0);
export const C_DEBRIS = new THREE.Color(0x3a3530);

/**
 * Authoring colour for anything emitted on a live tier CHANNEL. The particle
 * stores only its intensity; `DragParticles.setChannelColor` supplies the hue
 * every frame from the machine's current drift tier, so a promotion recolours
 * the shower already in the air. See `EmitParams.channel`.
 */
export const C_CHANNEL = new THREE.Color(1, 1, 1);

// ---------------------------------------------------------------------------
//  Atlas indices.
//
//  These are not a guess at how a game numbered its tiles: `coreTiles()` in
//  ParticleTiles.ts builds the eight shapes IN THIS ORDER and both games'
//  atlases open with it. A game that has tiles of its own appends them at 8 and
//  up — the ship game's Ion/Plasma/Spall/Vapour — and its own `PTile` enum stays
//  the thing its own code reads. These exist so that code living HERE can name
//  a shape without importing a game.
// ---------------------------------------------------------------------------

export const TILE_GLOW = 0;
export const TILE_CORE = 1;
export const TILE_SMOKE = 2;
export const TILE_FLAME = 3;
export const TILE_STAR = 4;
export const TILE_STREAK = 5;
export const TILE_RING = 6;
export const TILE_SPLASH = 7;

/** `EmitParams.mode`: camera-facing billboard. */
export const MODE_BILLBOARD = 0;
/** `EmitParams.mode`: quad lying in the world XZ plane. */
export const MODE_GROUND = 1;
/** `EmitParams.mode`: billboard elongated along its screen-space velocity. */
export const MODE_STRETCH = 2;

// ---------------------------------------------------------------------------
//  The medium
// ---------------------------------------------------------------------------

/** What a medium does to one family of matter thrown into it. */
export interface Ballistic {
  /** m/s², negative falls */
  readonly gravity: number;
  /** linear drag coefficient, 1/s. Higher = stops sooner. */
  readonly drag: number;
}

/**
 * The medium an emitter throws into. One constant per game; see the note at
 * the top of this file for why it is a value and not a flag.
 */
export interface Medium {
  /**
   * Multiplies every buoyant gravity an emitter authors — smoke, dust, vapour,
   * flame. 1 in air. 0 in vacuum, where a puff neither rises nor settles.
   */
  readonly buoyancy: number;
  /** grit a rolling wheel tears off the surface — `rollDust` */
  readonly rollGrit: Ballistic;
  /** grit a sliding wheel tears off the surface — `driftGrit` */
  readonly slideGrit: Ballistic;
  /** the atlas tile `slideGrit` is drawn with — a splash of chips, or a chip */
  readonly slideGritTile: number;
  /** and its draw mode: a grain has no direction in air and has one in vacuum */
  readonly slideGritMode: number;
  /**
   * The wake off a sliding contact patch — `tyreSmoke`. Same reason as
   * `slideGritTile`: a puff expanding into AIR is a round billboard of eroded
   * smoke, and a wash being dragged through vacuum has a direction and is drawn
   * with a head and a tail.
   */
  readonly washTile: number;
  readonly washMode: number;
  /** velocity stretch of that wake. 0 in air, which `reset()` already leaves. */
  readonly washStretch: number;
  /** the heavy half of `surfaceDust` — grains, not cloud */
  readonly heavyDust: Ballistic;
  /** the steady spark shower off a sliding contact patch — `emitSparks` */
  readonly driftSparks: Ballistic;
  /** the long-lived stragglers arcing clear of it — `emitSparks` */
  readonly driftStragglers: Ballistic;
  /**
   * The rush lines — `slipstream`. The one entry that is not "air holds it up
   * and vacuum does not": a streak is authored WEIGHTLESS in air (it is meant
   * to be air, and air does not fall past a lens) and takes the void's tidal
   * gradient in vacuum, which is the opposite way round from every gas above.
   * That is why it is a `Ballistic` and not another `buoyancy` multiply.
   */
  readonly streak: Ballistic;
  /** the spark shower of a wall impact — `impactBurst` */
  readonly impactSparks: Ballistic;
  /** the spark shower of a detonation — `explode` */
  readonly blastSparks: Ballistic;
  /** torn plate thrown by a detonation — `explode` */
  readonly shrapnel: Ballistic;
  /** the drift-promotion burst — `burstSparks` */
  readonly promoSparks: Ballistic;
  /**
   * The debris a boost ignition throws off the surface — `onBoostIgnite`.
   *
   * A TABLE ENTRY AND NOT A MULTIPLIER, and it is the clearest example of the
   * asymmetry the header argues for. Nothing already here has this pair: air
   * throws it at -7 m/s² and drags it at 1.2, vacuum answers -0.31 and 0.05,
   * and the two numbers were tuned by eye against two different pictures. There
   * is no function joining them and inventing one would change what both games
   * render.
   */
  readonly igniteSparks: Ballistic;
  /** the pickup sparkle — `sparkleBurst` */
  readonly sparkle: Ballistic;
  /**
   * What the finish throws — `confetti`.
   *
   * A TABLE ENTRY, for the same reason `igniteSparks` is one. Air throws
   * paper at -4.2 m/s² and drags it at 1.5, so it tumbles and settles;
   * vacuum answers -0.31 and 0.04, so foil leaves the podium in a straight
   * line and never comes back. Neither number is derivable from the other
   * and the two pictures were tuned separately.
   */
  readonly foil: Ballistic;
  /**
   * The column of embers a top-tier drift throws out of the contact patch —
   * `driftJet`. Long-lived and low-drag in air so it rises a metre and a half
   * and falls back through the shower; in vacuum it simply leaves.
   */
  readonly driftJet: Ballistic;
}

// ---------------------------------------------------------------------------
//  Shared arithmetic
// ---------------------------------------------------------------------------

/**
 * ORPHANED SMOKE — the lifetime rule.
 *
 * Particles are integrated in the WORLD frame, and every smoke emitter drags to
 * a stop within a few tenths of a second. That is physically right and visually
 * catastrophic above about 15 m/s: the puff parks in the air while the machine
 * keeps going, so a 1.25 s tyre-smoke puff behind a kart at 25 m/s ends its
 * life a little over THIRTY METRES back down the road, still at chase-visible
 * opacity, with nothing underneath it. That is exactly the review note — three
 * detached cotton-wool blobs clear of the pack in the pack frame, and one lone
 * puff on an empty village street in the wide.
 *
 * Velocity inheritance alone cannot fix it (the drag term still eats the
 * inherited component), so the lifetime is budgeted in METRES instead of in
 * seconds: a puff is allowed to fall `metres` behind whatever made it and no
 * further, whatever the speed. Standing still, it gets the full `hi` and hangs
 * as it should.
 */
export function trailLife(speed: number, metres: number, lo: number, hi: number) {
  return THREE.MathUtils.clamp(metres / Math.max(speed, 4), lo, hi);
}

/**
 * VELOCITY INHERITANCE, BOUNDED AS A SLIP IN METRES PER SECOND.
 *
 * `trailLife`'s problem in the other direction, and the same root cause: a
 * fraction fitted at one top speed is not a fraction at another.
 *
 * Every spark emitter in a racer inherits some of the emitting machine's
 * velocity — 0.68 for a steady shower, 0.34 for a promotion burst are the
 * numbers a 25-30 m/s kart was authored with, and they mean a slip of 8-16 m/s,
 * i.e. a shower that trails a metre or two behind the corner that struck it.
 * Put the same fractions on a 142 m/s machine and the slip is 45 and 94 m/s:
 * over a 0.4-0.6 s life the "shower" is strung out 18 to 58 metres behind,
 * ALONG THE MACHINE'S OWN PATH — which on a section that turns is a long,
 * smooth, beaded CURVE hanging in the frame, and reads as debris arcing under
 * gravity whatever the gravity actually is.
 *
 * Bounding the slip in m/s reproduces the authored look exactly at the speed it
 * was authored at and keeps the shower welded to its origin at any other. It is
 * also what a grain torn off a moving surface actually does: it leaves with
 * that surface's velocity plus a few metres a second of ejection, not with two
 * thirds of it.
 *
 * The 0.36 ceiling is the floor on `keep`: below about two thirds inheritance
 * the emitter stops reading as attached at all, whatever the speed.
 */
export function velKeep(speed: number, slip: number) {
  return 1 - Math.min(0.36, slip / Math.max(speed, 8));
}

/**
 * The escalation table's shape. Both games author four rows of it — the values
 * differ and belong to each game's art direction; the columns do not.
 *
 * `rate` is emission units/s per wheel; `core`/`halo` are metres; `poolS` and
 * `poolI` scale the ground glow's size and radiance; `jet` and `pulse` are the
 * two layers above tier 1, 0 = absent.
 */
export interface TierFx {
  rate: number; core: number; halo: number;
  poolS: number; poolI: number; jet: number; pulse: number;
  /** additive intensity of the spark cores — a purple spark is a hotter spark */
  spark: number;
  /** seconds the promotion flash runs for */
  flash: number;
}
