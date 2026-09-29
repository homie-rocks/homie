import * as THREE from 'three';
import type { DragParticles } from './DragParticles.ts';
import type { EffectLights } from './EffectLights.ts';
import type { Rings } from './Rings.ts';
import type { Trails } from './Trails.ts';
import {
  C_CHANNEL, C_FLAME_COOL, C_FLAME_MID, C_FLAME_ROOT, C_HOT, C_SMOKE, C_SMOKE_DARK,
  MODE_BILLBOARD, MODE_GROUND, MODE_STRETCH,
  TILE_CORE, TILE_GLOW, TILE_STAR, TILE_STREAK,
  trailLife,
  type Medium, type TierFx,
} from './racer.ts';

/**
 * ============================================================================
 *  THE DRIVE LOOP — everything a racing machine emits on a normal frame.
 * ============================================================================
 *  The drift signature, the rubber, the surface reaction, the boost flame and
 *  its lamp, the rush lines, the pad response, the idle exhaust, the roll dust,
 *  star power and the stun. One contiguous run of eleven emitters that both
 *  racers execute back to back, in this order, every frame, for every machine
 *  inside the cull radius.
 *
 *  WHY THIS IS SHARED.
 *
 *  The per-machine update was 547 lines in the kart game and 795 in the ship
 *  game, and it looked like "a giant dispatch/state method over race and track
 *  state". Measured instead: 530 of the kart game's 547 lines were
 *  BYTE-IDENTICAL to the ship game's, and the places they differed are
 *  values — a colour, a gravity, a stack index, an up vector, a squat impulse,
 *  two emitter choices and a surface predicate.
 *
 *  What is genuinely not shared is the HEAD of that method — the cull, the
 *  probe, and (in the ship game) a mag-glow decal, a plume light and a thermal
 *  step wedged between the probe and the drift block. That head stays in each
 *  game, and it is the dispatch. It is about forty lines in one game and three
 *  hundred in the other. The BODY under it is one thing, and this is it.
 *
 *  So: a switch whose arms are shared and whose selector is not is a shared arm
 *  and a game's selector.
 *
 *  NOTHING HERE BRANCHES ON WHICH GAME IS RUNNING and no host member is a
 *  boolean asking. Every one is an object this code emits into, a table the
 *  game authored, a predicate over the game's own `Surface` numbering, or a
 *  colour/vector/number for a tier. `igniteSquash` returning 0 is the identity,
 *  in the sense `updateHeading`'s kart-side 0 is: it is a number the game
 *  supplies, and one of the two supplies nothing.
 *
 *  SCRATCH, and the one real hazard in the move. The temps below are THIS
 *  module's. A function moved across a package seam stops clobbering — and
 *  stops being clobbered by — the caller's module temps, so both directions had
 *  to be read rather than assumed. Every write here is followed by its read
 *  with no game call in between except `mouthOf`, which writes only its `out`.
 *  The one place the old code depended on the ALIASING was the boost ribbon:
 *  it seeded `_fwd`/`_side` for `stackMouth`'s no-anchor fallback to read one
 *  line later, and that fallback lives in the game. See `mouthOf`, and the note
 *  at that call site.
 *
 *  A parity test re-reads both pre-extraction bodies at a pinned revision and
 *  asserts this file is those lines, statement for statement, plus exactly the
 *  substitutions named above.
 * ============================================================================
 */

const UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _side = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _r = new THREE.Vector3();
const _col = new THREE.Color();
const _col2 = new THREE.Color();

// ---------------------------------------------------------------------------
//  The seams. Exactly what is read, and nothing else.
// ---------------------------------------------------------------------------

/** The machine: the part of each game's own machine interface this reads, about a third of it. */
export interface DriveMachine {
  readonly id: number;
  readonly isPlayer: boolean;
  readonly position: THREE.Vector3;
  /** unit forward in world space */
  readonly forward: THREE.Vector3;
  /** metres per second along the machine's own forward axis */
  readonly forwardSpeed: number;
  /** world-space linear velocity, m/s */
  readonly velocity: THREE.Vector3;
  /** 0 = not sliding, otherwise -1 (left) or 1 (right) */
  readonly driftDir: number;
  /** 0 = none, up to 3 — the index into `DriveHost.tierFx` / `tierColour` */
  readonly driftTier: number;
  /** seconds of boost remaining */
  readonly boostTime: number;
  /** seconds of invulnerability remaining */
  readonly starTime: number;
  /** seconds remaining of a spin-out / attitude upset */
  readonly stunTime: number;
}

/**
 * Per-machine effect state, as both games already kept it — the accumulators, the
 * ground plane under the machine, and the latched boost tier.
 *
 * Every `*Acc` is a fractional emission counter: a rate times `dt` goes in and
 * whole particles come out, so an emitter running at 5/s still emits at 5/s on
 * a 240 Hz frame instead of five times too often.
 */
export interface DriveState {
  sparkAcc: number;
  jetAcc: number;
  /** tier-3 ground pulse; counts beats, not particles */
  beatAcc: number;
  poolAcc: number;
  scorchAcc: number;
  smokeAcc: number;
  gritAcc: number;
  dustAcc: number;
  flameAcc: number;
  rushAcc: number;
  padAcc: number;
  exhaustAcc: number;
  rollAcc: number;
  starAcc: number;
  sparkleAcc: number;
  /** seconds left of the drift-tier promotion flash, and what it was set to */
  tierFlash: number;
  tierFlashLen: number;
  /** seconds left of the ignition flash; drives the boost lamp's overshoot */
  igniteT: number;
  /** the tier the CURRENT boost was cashed from, latched on the event */
  boostTier: number;
  wasBoosting: boolean;
  lastTier: number;
  stunPhase: number;
  /** the trail slot this machine holds while boosting, or -1 */
  trail: number;
  skidding: boolean;
  skidStrength: number;
  /** the surface plane under the machine */
  groundY: number;
  readonly groundN: THREE.Vector3;
  /** the game's own `Surface` numbering — see `DriveHost.onRoad` */
  surface: number;
}

/** The half of each game's `Decals` this loop writes to. */
export interface DriveDecals {
  scorch(p: THREE.Vector3, n: THREE.Vector3, radius: number, col: THREE.Color,
         now: number, life: number, strength: number, tile: number): void;
}

/**
 * What changes every frame. One object per `Effects` instance, refilled before
 * each call — the numbers here are live per-frame governors on the class, and a
 * reference cannot be taken to a number.
 */
export interface DriveFrame {
  dt: number;
  /** seconds, the particle layer's clock */
  now: number;
  /** camera to machine, metres */
  dist: number;
  /** emission multiplier for range and off-screen thinning */
  lod: number;
  /** |forwardSpeed|, m/s */
  speed: number;
  grounded: boolean;
  /** `SURFACE_PROPS[surface].dustColor` — a reference, not a copy */
  dust: THREE.Color;
  /** the shared additive governor; see `settleGain` in `energy.ts` */
  gain: number;
  /** particle density asked for by the quality tier, after the load governor */
  emitScale: number;
  /** the speed signal that gates the rush lines */
  signalSpeed: number;
  /** 0..1, decaying, for the third of a second after a boost is cashed */
  igniteImpulse: number;
}

/**
 * What the drive loop emits into and draws with, plus the answers each game
 * gives that the other gives differently.
 *
 * Built once, in `Effects.init`, and held — every field is a reference to
 * something the class already owns or a closure over it, so nothing here is a
 * second copy of any state. Generic over the game's own machine and state types
 * so the emitter closures keep their real signatures (the game's own machine
 * and fx-record types) and no call site takes a cast.
 */
export interface DriveHost<M extends DriveMachine, S extends DriveState> {
  readonly particles: DragParticles;
  readonly decals: DriveDecals;
  readonly rings: Rings;
  readonly trails: Trails;
  readonly lights: EffectLights;
  /**
   * World-space rear contact patches, refreshed by `wake.rearPoints` before
   * this runs and read by the sparks, the smoke and the scorch. Two vectors the
   * host owns and this module reads THROUGH — a host wired to a copy of them
   * puts the whole drift signature at the world origin.
   */
  readonly skidL: THREE.Vector3;
  readonly skidR: THREE.Vector3;
  readonly medium: Medium;
  /** the game's four-row escalation table; see `TierFx` */
  readonly tierFx: readonly TierFx[];
  /** the colour of each drift tier, index 0..3 */
  readonly tierColour: readonly THREE.Color[];
  /**
   * What the finish throws, one burst per entry. Six party colours in one
   * game; in the other, six the deck is already painted and lit in, because
   * its art direction rules out four unreserved saturated hues fired into the
   * middle of the one frame the player screenshots.
   */
  readonly foil: readonly THREE.Color[];
  /** beats per second of the tier-3 ground pulse */
  readonly pulseHz: number;
  /** the game's `DecalTile.Scorch` ordinal */
  readonly scorchTile: number;

  // --- predicates over the game's own `Surface` enum ---
  //
  // The predicate rather than the numbers, for the reason `wake.ts` gives:
  // `Surface` is each game's own enum and grows on its own schedule. Both
  // games answer these four the same way, which is why they are a lookup and
  // not a difference.
  /** the track proper — the road and the boost strip */
  onRoad(surface: number): boolean;
  /** the boost strip alone */
  boostPad(surface: number): boolean;
  /** grains rather than cloud — sand, and whatever the other game calls sand */
  heavy(surface: number): boolean;
  /** the surface that takes no rubber and throws a spray; see `slickSpray` */
  slick(surface: number): boolean;

  // --- the emitters, each game's own ---
  emitSparks(at: THREE.Vector3, k: M, n: number, tier: number, side: number): void;
  groundPool(k: M, fx: S, tier: number): void;
  tyreSmoke(k: M, fx: S, at: THREE.Vector3, n: number, dust: THREE.Color, tier: number): void;
  driftGrit(k: M, fx: S, n: number, dust: THREE.Color, slip: number): void;
  layStrip(fx: S, now: number, strength: number, widthMul: number): void;
  surfaceDust(k: M, fx: S, n: number, dust: THREE.Color, heavy: boolean): void;
  /** what comes off an emitter crossing `slick` — a bow wave, or a cryogen mist */
  slickSpray(k: M, fx: S, n: number, dust: THREE.Color): void;
  boostPlume(k: M, n: number): void;
  slipstream(k: M, n: number, ramp: number, boosting: boolean): void;
  idleExhaust(k: M, fx: S, n: number): void;
  rollDust(k: M, fx: S, n: number, dust: THREE.Color, sr: number): void;
  /** the stun read — spun-out stars in one game, arcing mag faults in the other */
  stunFx(k: M, fx: S, n: number): void;
  addSquash(k: M, impulse: number): void;

  /**
   * World-space mouth of exhaust stack `s`, written into `out`.
   *
   * THE IMPLEMENTATION MUST SEED WHATEVER BASIS ITS OWN FALLBACK READS. Both
   * games' `stackMouth` falls back to a chassis basis held in their module
   * temps, and both relied on the caller seeding it one line earlier. That
   * caller is now in this file and its temps are not theirs, so the requirement
   * is stated here rather than left as an ordering across a package seam.
   */
  mouthOf(k: M, s: number, out: THREE.Vector3): void;
  /** index of the LAST stack — 1 for a two-pipe kart, `stackCount - 1` for a ship */
  lastStack(fx: S): number;
  /** the machine's own up: world up for a kart, `k.up` for a ship that inverts */
  up(k: M): THREE.Vector3;

  // --- colours for a tier, written into `out` ---
  /** the boost ribbon's heat spine */
  ribbonColour(out: THREE.Color, tier: number): void;
  /** the lamp the flame casts on the rear bodywork */
  flameLampColour(out: THREE.Color, tier: number): void;
  /**
   * Fraction of the machine's velocity the DRIFT JET inherits, given speed.
   * The third member of the `showerKeep` / `burstKeep` family and there for
   * the same reason: two thirds is a slip of 8 m/s at 25 m/s and a slip of
   * 48 m/s at 142, and it is the SLIP that was authored.
   */
  jetKeep(speed: number): number;
  /** the star-power lamp; must agree with whatever `starSparkle` emits */
  starLampColour(out: THREE.Color, now: number, id: number): void;
  /**
   * The two colours the star-power shimmer is drawn in, written into `a`
   * and `b`. A hue cycle in one game and a mag-to-shield lerp in the other;
   * three lines out of thirty-nine, and the only three that differed.
   *
   * SEPARATE FROM `starLampColour` on purpose. The lamp is one colour and
   * the shimmer is two, and both games' lamp is a DIFFERENT expression from
   * their own shimmer's first colour — the kart game's lamp is lightness 0.60
   * against the shimmer's 0.62, the ship game's lamp beats at 10.7 rad/s
   * against the shimmer's 3.4 π. Deriving one from the other would retune
   * both games, which is exactly what an extraction may not do.
   */
  starColours(a: THREE.Color, b: THREE.Color, now: number, id: number): void;
  /**
   * The squat impulse an ignition is worth, given the latched boost tier.
   * NEGATIVE is a squat. Zero is a legitimate answer and the kart game gives it —
   * see the call site.
   */
  igniteSquash(fx: S): number;
}

/**
 * Everything a machine emits on a normal frame, in the order both games emit
 * it. Called once per machine per frame, after the game's own head has done the
 * cull, the ground probe and `wake.rearPoints`.
 */
export function emitDrive<M extends DriveMachine, S extends DriveState>(
  h: DriveHost<M, S>, k: M, fx: S, f: DriveFrame,
) {
  const { dt, now, dist, lod, speed, grounded } = f;
    // --- drift: sparks, smoke, skid marks ---------------------------------
    const drifting = k.driftDir !== 0 && grounded && speed > 4;
    // SPARKS DO NOT STOP WHEN THE TYRES LEAVE THE ROAD FOR A FRAME.
    //
    // The drift signature used to be gated on `grounded`, which sounds right
    // and is the reason the reviewed tier-2 frame contains no sparks at all:
    // the shot was taken with the kart skipping a kerb, `airborne` was true for
    // that frame, and every emitter that says "tier 2" switched off together.
    // A drift is a two-second state and the read has to survive the hops in the
    // middle of it. Contact-derived effects (smoke, rubber, scorch) stay gated;
    // the sparks and the colour do not, they just thin out.
    const sparking = k.driftDir !== 0 && speed > 4;
    const airFade = grounded ? 1 : 0.5;
    if (sparking && k.driftTier > 0) {
      const tier = Math.min(3, k.driftTier);
      const col = h.tierColour[tier]!;
      // Publish the live tier hue on this kart's colour channel. Every drift
      // particle it has in the air reads it this frame, so the shower can never
      // be one tier behind the HUD again — which was the blocker in the drift
      // review frame (orange arc, blue sparks, same image).
      h.particles.setChannelColor(k.id + 1, col);
      // 60 + 30/tier, up from 30 + 12. The review is blunt — a tier-2 shower
      // read as "dust motes" — and the shower has to be dense enough that the
      // eye integrates it into a continuous jet rather than resolving the
      // individual grains. At tier 2 this is ~120 emission units/s per wheel,
      // each spawning three cores and three halos.
      const prof = h.tierFx[tier]!;
      fx.sparkAcc += dt * prof.rate * lod * airFade;
      const n = Math.floor(fx.sparkAcc);
      if (n > 0) {
        fx.sparkAcc -= n;
        h.emitSparks(h.skidL, k, n, tier, -1);
        h.emitSparks(h.skidR, k, n, tier, 1);
      }

      // --- the rising ember jet, tier 2 and up ------------------------------
      // The first thing in the escalation that leaves the ground plane. A
      // drift's whole read up to tier 1 is horizontal — a shower thrown
      // backwards and a glow on the tarmac — so it grows only in brightness,
      // and brightness alone is what the eye is worst at ranking. A column of
      // embers climbing out of each contact patch changes the SHAPE of the
      // effect, and a shape change is what "a genuine escalation the player
      // feels building" means. Long-lived, low-drag, ballistic: they rise a
      // metre and a half and fall back through the shower.
      if (prof.jet > 0) {
        fx.jetAcc += dt * 30 * prof.jet * lod * airFade * f.emitScale;
        const nj = Math.floor(fx.jetAcc);
        if (nj > 0) { fx.jetAcc -= nj; driftJet(h, k, fx, nj, tier); }
      } else {
        fx.jetAcc = 0;
      }

      // --- the tier-3 pulse -------------------------------------------------
      // Nothing else in either game beats. A thin front — violet off a kart's
      // contact patches, blue-white off a ship's mag corners; `tierColour` is
      // what differs — leaving them six and a half times a second is legible at
      // fifteen pixels tall, through motion blur, and at viewing distance.
      // Restricted to the near field: it is a ring draw per beat out of a
      // 28-slot pool, and a whole field at tier 3 forty metres away would churn
      // it for nothing anyone can see.
      if (prof.pulse > 0 && dist < 42) {
        fx.beatAcc += dt * h.pulseHz;
        if (fx.beatAcc >= 1) {
          fx.beatAcc -= Math.floor(fx.beatAcc);
          _q.copy(k.position); _q.y = fx.groundY + 0.20;
          // No `f.gain` here: the whole ring pool is multiplied by it once
          // per frame in `lateUpdate` (`h.rings.gain = f.gain`), so
          // folding it in at spawn would apply it twice and the pulse would
          // vanish in exactly the crowded frame it exists to be legible in.
          h.rings.spawn(_q, fx.groundN, 0.35, 3.1, 0.30, 0.05, col,
            0.95, now, k.velocity, 1.8);
        }
      } else {
        fx.beatAcc = 0;
      }

      // Coloured light pool on the road under the sparks. Sparks that light
      // nothing float in front of the world; this is the single change that
      // makes the tier read at a glance in a moving frame. Two cheap ground
      // quads carry it on every kart...
      // Rate carries the density (see `emitScale`): `groundPool` loops two
      // count-1 emits, and a count of one is immune to a density multiplier.
      fx.poolAcc += dt * 26 * lod * airFade * f.emitScale;
      const np = Math.floor(fx.poolAcc);
      if (np > 0) {
        fx.poolAcc -= np;
        h.groundPool(k, fx, tier);
      }
      // ...and the nearest few karts additionally get a real point light, so
      // the tarmac, the kerb and the kart's own underbody all pick the tier up.
      if (dist < 45) {
        _p.copy(k.position).addScaledVector(k.forward, -0.7);
        _p.y = fx.groundY + 0.55;
        // Candela: three is physically-correct, so this is divided by r^2 at the
        // shading point. The pool sits ~0.55 m off the tarmac, so 0.6 lands
        // around 2 lx under a tier-1 drift against a 4.2 key — a clear coloured
        // wash, not a blowout.
        //
        // `tierFlash` doubles it for a fifth of a second on promotion: the tier
        // change has to be an event on the BODYWORK and the road, not only in
        // the particle layer, and a lamp that punches and settles is what the
        // eye reads as "something just happened" from a distance.
        const flash = 1 + 2.1 * (fx.tierFlash / Math.max(0.05, fx.tierFlashLen));
        // Nonlinear in the tier, like everything else in the escalation: 0.72 /
        // 1.30 / 2.10 candela rather than a flat 0.42 per step. The lamp is the
        // only part of the drift signature that lands on the BODYWORK and the
        // kerb, so it is what makes the tier visible on a still of the car
        // rather than only on a still of the shower.
        h.lights.request(
          k.id, (k.isPlayer ? 100 : 10) + tier - dist * 0.05, _p, col,
          (0.36 + 0.30 * tier + 0.12 * tier * tier) * flash * (1 - dist / 45) * f.gain,
          5.6 + 0.7 * tier);
      }

      // Ground scorch under the tyres, TINTED TO THE TIER, as the art direction
      // asks. It was previously a neutral grey smudge, which on a grey road is a
      // mark you have to be told is there — the review counted it as missing. The
      // decal layer multiplies, so the tier colour becomes the *hue of the
      // darkening* rather than a coloured stain: see Decals.scorch. Laid twice
      // as often and a shade stronger, because this is the only part of the
      // drift that persists after the sparks have gone and it is what gives the
      // corner a history.
      // Twice the radius, twice the strength, on BOTH contact patches, and on
      // the eroded Scorch disc rather than the small Smudge kiss. The review
      // counted this as producing nothing visible on the road at tier 2, and it
      // was right: a 0.46 m Smudge at 0.58 strength is a 40 cm mark that the
      // drift smoke sits directly on top of. A drift has to leave a history on
      // the tarmac or the corner has no memory of what happened in it.
      fx.scorchAcc += grounded ? dt * (7 + 3 * tier) : 0;
      if (fx.scorchAcc >= 1) {
        fx.scorchAcc -= 1;
        for (let s = 0; s < 2; s++) {
          h.decals.scorch(s === 0 ? h.skidL : h.skidR, fx.groundN,
            0.62 + 0.14 * tier, col, now, 9.0, 0.50 + 0.16 * tier, h.scorchTile);
        }
      }
    } else {
      fx.sparkAcc = 0;
      fx.poolAcc = 0;
      fx.jetAcc = 0;
      fx.beatAcc = 0;
    }

    // Lateral slip, 0..1, from the actual velocity rather than the drift flag.
    // The drift button is not the only way to end up sideways, and more to the
    // point a kart that has just released a drift is still sliding — gating the
    // rubber on `driftDir` is why the hero corner had a kart mid-slide over
    // perfectly clean tarmac with no trace of the line it took.
    let slip = 0;
    if (grounded && speed > 3) {
      _side.crossVectors(UP, k.forward).normalize();
      const lat = Math.abs(k.velocity.dot(_side));
      slip = THREE.MathUtils.clamp((lat / Math.max(speed, 1) - 0.10) / 0.30, 0, 1);
    }

    if (drifting) {
      // Smoke is the only thing that gives a drift mass. It has to scale with
      // the charge, or a tier-3 drift looks exactly like a tier-0 one.
      //
      // AND WITH THE SLIP, which is the half that was missing. A tyre smokes
      // because it is being dragged sideways; keying the volume off the tier
      // alone means a kart that has snapped into a deep slide and one that is
      // barely sideways make identical clouds, so the smoke says nothing about
      // how hard the player is actually committing. The tier sets the floor
      // (the charge is real and should be visible even in a tidy drift) and the
      // slip is what makes a greedy angle look expensive.
      const tier = Math.min(3, k.driftTier);
      fx.smokeAcc += dt * (20 + 12 * tier) * (0.55 + 0.95 * slip) * lod;
      const n = Math.floor(fx.smokeAcc);
      if (n > 0) {
        fx.smokeAcc -= n;
        h.tyreSmoke(k, fx, h.skidL, n, f.dust, tier);
        h.tyreSmoke(k, fx, h.skidR, n, f.dust, tier);
      }

      // GRIT OFF THE CONTACT PATCH. The art direction names dust *and* grit; the
      // grit only ever existed in `rollDust`, which is explicitly gated on NOT
      // drifting — so the one moment in the game where a tyre is genuinely
      // tearing at the road was the one moment nothing hard came off it. The
      // smoke is low-frequency and reads as air; this is the high-frequency
      // layer that reads as the surface itself being removed, and it is what
      // gives the slide texture at the resolution the chase camera sees.
      fx.gritAcc += dt * (14 + 22 * slip) * lod * f.emitScale;
      const ng = Math.floor(fx.gritAcc);
      if (ng > 0) { fx.gritAcc -= ng; h.driftGrit(k, fx, ng, f.dust, slip); }
    } else {
      fx.smokeAcc = 0;
      fx.gritAcc = 0;
    }

    // Rubber. Laid for anything actually sliding, drifting or not, and out to
    // 95 m so the pack in front of you leaves a readable line too. Clean tarmac
    // behind a drifting kart costs the frame its whole sense of history; the
    // decal ring is 3200 quads and a segment is 0.55 m, so a kart can lay ~40 m
    // of continuous mark before it starts recycling its own oldest slot.
    const marking = grounded && speed > 5 && dist < 95 &&
      (drifting || slip > 0.25) &&
      !h.slick(fx.surface);
    if (marking) {
      // The floor rises with the charge, so the line a tier-3 slide leaves on
      // the tarmac is visibly heavier than a tier-1 one — the art direction wants
      // the drift to leave a history, and the history should record how hard
      // the corner was taken, not merely that it was.
      const dTier = drifting ? Math.min(3, k.driftTier) : 0;
      h.layStrip(fx, now, THREE.MathUtils.clamp(
        Math.max(slip, drifting ? 0.52 + 0.10 * dTier : 0) * Math.min(1, speed / 14), 0.25, 1),
        1 + 0.10 * dTier);
    } else if (fx.skidding) {
      fx.skidding = false; fx.skidStrength = 0;
    }

    // --- surface reaction: dust, spray, sand ------------------------------
    if (grounded && speed > 5) {
      const s = fx.surface;
      // `slick` and `slickSpray`, not "water": both games number this surface
      // the same and mean different matter by it — standing water under a tyre
      // in one, a cryogen slick on a plate in the other, and what comes off an
      // emitter crossing it is a bow wave or a fine mist accordingly. The
      // ORDINAL is shared, the meaning is the game's, so both are asked for.
      if (h.slick(s)) {
        fx.dustAcc += dt * 30 * lod * (speed / 20);
        const n = Math.floor(fx.dustAcc);
        if (n > 0) { fx.dustAcc -= n; h.slickSpray(k, fx, n, f.dust); }
      } else if (!h.onRoad(s)) {
        const heavy = h.heavy(s);
        fx.dustAcc += dt * (heavy ? 26 : 18) * lod * (speed / 20);
        const n = Math.floor(fx.dustAcc);
        if (n > 0) { fx.dustAcc -= n; h.surfaceDust(k, fx, n, f.dust, heavy); }
      } else {
        fx.dustAcc = 0;
      }
    }

    // --- boost: plume, trail, glow ----------------------------------------
    const boosting = k.boostTime > 0;
    fx.igniteT = Math.max(0, fx.igniteT - dt);
    if (boosting) {
      // The tier the boost was CASHED FROM, latched on the event — not
      // `k.driftTier`, which the game's drift release has already zeroed by the
      // time any of this runs. See `DriveState.boostTier`.
      const btier = fx.boostTier;
      // Down from 105: the flame BODY is the ribbon now (see Plumes), so this
      // only has to supply the root kiss, the tier sheath and the tail embers.
      fx.flameAcc += dt * 46 * lod;
      const n = Math.floor(fx.flameAcc);
      if (n > 0) { fx.flameAcc -= n; h.boostPlume(k, n); }
      if (fx.trail < 0 && dist < 90) {
        // A FIXED PALETTE, NOT THE LIVERY — `DriveHost.ribbonColour`.
        //
        // Deriving the ribbon colour from the machine's paint is why the hero
        // boost frame trailed a rust-brown streak that read as a mud smear: a
        // red kart lerped toward cream lands on exactly the hue of dried dirt.
        // Both games fixed it and they landed in different places, which is why
        // this is a host call and not an expression: the kart game's art
        // direction fixes boost at #4fc3ff / #ff9d2e / #c05cff and the ribbon has
        // to be one of the three; the ship game found that quoting the KART ramp
        // put a saturated cyan ribbon down the middle of an amber flame, and uses
        // the thrust colour pulled toward the blue-white root instead. Both are a
        // colour for a tier. Neither is a branch in here.
        h.ribbonColour(_col, btier);
        // Narrow and short. This is a heat ribbon threading the plume together,
        // not the effect itself.
        //
        // Cut hard from 0.54 m / 2.1x / 5.0 m. In the reviewed boost frame this
        // ribbon is the flat cyan band lying across the road behind the kart —
        // a half-metre-wide strip of saturated additive colour seen almost
        // edge-on, which perspective smears into a painted stripe, and which
        // sums into exactly the same pixels as the plume it is supposed to be
        // threading. The plume is now a properly structured flame and does not
        // need a second ribbon to carry it; this is reduced to a heat spine
        // behind the stacks that you notice only when it is missing.
        //
        // Given some of it back, and scaled with the tier. 0.24 m was tuned
        // against a plume that was itself clamped down to a wisp; with the
        // plume budget reopened (see placePlumes) the spine has to keep pace or
        // the flame has no thread through it. A tier-3 boost gets a 0.40 m
        // ribbon at 1.6x, a mushroom keeps essentially what it had.
        fx.trail = h.trails.acquire(
          0.20 + 0.068 * btier, _col, 0.95 + 0.22 * btier, 0.48, 0.16, 0.20, 3.4);
      }
      if (fx.trail >= 0) {
        // Between the two stacks, at stack height — not at the chassis centre
        // 35 cm below them, which is why the boost review frame shows the
        // ribbon as "a two-pixel blue sliver under the rear axle" instead of as
        // the spine of the flame it is supposed to thread.
        // NO `_fwd`/`_side` SEED HERE ANY MORE, AND THE REASON IS THIS FILE.
        //
        // Both games' `stackMouth` falls back to a chassis basis held in their
        // OWN module temps, and both relied on this call site having seeded
        // them one line earlier. Move the caller across a package seam and
        // `_fwd`/`_side` here are a different pair of vectors from the ones the
        // fallback reads — the ship keeps the PREVIOUS machine's basis, silently
        // and only on models that publish no engine anchors. `DriveHost.mouthOf`
        // is defined to seed whatever basis its own fallback needs, so the
        // coupling is stated on the seam instead of being an ordering the caller
        // has to remember.
        h.mouthOf(k, 0, _p);
        h.mouthOf(k, h.lastStack(fx), _q);
        _p.addVectors(_p, _q).multiplyScalar(0.5);
        h.trails.push(fx.trail, _p.x, _p.y, _p.z);
      }
      // The flame has to light the rear bodywork or it floats on top of it.
      // Ignition overshoots hard for a third of a second, then settles.
      if (dist < 55) {
        // 0.55 ALONG THE MACHINE'S OWN UP, not world +Y — `DriveHost.up`. A
        // kart's answer is world up and this is the same arithmetic it always
        // had; a ship's is its own up, because the ship game's deck inverts twice
        // a lap and "a bit above the machine" is a bit INTO the deck there.
        _p.copy(k.position).addScaledVector(k.forward, -1.0).addScaledVector(h.up(k), 0.55);
        h.flameLampColour(_col, btier);
        // 0.42, down from 0.70 (so 1.09 rather than 1.82 at full ignition
        // overshoot). This lamp is inside the same volume as the plume, the
        // ribbon and the root kiss, and every one of them was authored as if it
        // were the only thing there. The flame reads at the right brightness
        // when the SUM does, not when each layer does.
        const kick = 1 + 1.6 * (fx.igniteT / 0.30);
        // 0.48 + 0.09/tier. The tier has to be legible on the BODYWORK during a
        // boost, not only in the flame: a purple mini-turbo throws violet light
        // up the rear deck and the driver's back, which is the read that
        // survives the flame being foreshortened to a disc by the chase camera.
        h.lights.request(
          k.id, (k.isPlayer ? 200 : 60) - dist * 0.05, _p, _col,
          (0.48 + 0.09 * btier) * kick * (1 - dist / 55) * f.gain, 7.4);
      }
    } else {
      // The latch is per-boost, not per-race: without this a kart that once
      // cashed a purple mini-turbo would light a mushroom violet for the rest
      // of the lap, because `boostFlash` only ever takes the max (so that a
      // pad taken DURING a mini-turbo cannot demote the flame mid-burn).
      fx.boostTier = 1;
      if (fx.trail >= 0) {
        h.trails.release(fx.trail);
        fx.trail = -1;
      }
    }
    // THE IGNITION SQUAT — a number, and zero is a legitimate one.
    //
    // The ship game's art direction asks for "a 0.11 s squat-and-release on
    // boost ignition", and it matters more there than the line makes it sound:
    // there are no wheels to spin and no engine note to hear in vacuum, so the
    // chassis moving is the ONLY way an ignition reads as mechanical rather than
    // merely luminous. `applySquash`'s spring runs at stiffness 420 — a quarter
    // period of 0.077 s, a full squat-and-release inside 0.16 s. NEGATIVE is the
    // squat; the release is the spring's own rebound, so there is nothing to
    // schedule.
    //
    // The kart game returns 0 and the `if` below is the identity: a kart already
    // has wheels, an engine note and a wheelspin to say the same thing, and
    // adding a squat here would change what that game renders.
    if (boosting && !fx.wasBoosting) {
      const imp = h.igniteSquash(fx);
      if (imp !== 0) h.addSquash(k, imp);
    }
    fx.wasBoosting = boosting;

    // --- slipstream rush ---------------------------------------------------
    // The boost review frame is the worst failure in the set: at 33.6 m/s with
    // the HUD reading 120 it is visually identical to a 56 km/h cruise. Cover
    // the number and nothing in the image says "fast".
    //
    // A screen-space speed-line wipe in the post stack, even when it works, is
    // a filter over the frame; this is speed happening *in the world*, with real
    // perspective, real occlusion behind the kart and real parallax against the
    // road. Both belong in a shipped arcade racer and they do not fight.
    //
    // The art direction: "Speed lines only above ~70% top speed, and subtle —
    // they frame, they don't obscure." Gated on exactly the ramp that drives
    // ctx.speedIntensity, seeded ahead of the kart near the axis so they are
    // small and central at birth, and flaring out past the lens as perspective
    // takes them — which is what makes them frame rather than cover.
    // Not gated on `grounded`: a jump at speed is the last moment you want the
    // sense of speed to blink out, and the ramp already fades it in and out.
    if (k.isPlayer && f.signalSpeed > 0.045) {
      // RENORMALISED. `signalSpeed` is not a fraction of top speed — the 70%
      // gate is already applied above, so the whole no-boost range of this
      // signal is 0..0.42 and a boost floors it at 0.52. Dividing by 0.55 was
      // reading it as if it were 0..1: the 101 km/h review frame sat at
      // signalSpeed 0.24, i.e. ramp 0.345, so it got a third of the
      // authored density at a third of the authored size — which is why there is
      // not one streak in that image. Against 0.255 the same frame lands at 0.77
      // and flat out is 1.0, which is what the curve was always tuned for.
      const ramp = THREE.MathUtils.clamp((f.signalSpeed - 0.045) / 0.255, 0, 1);
      // Density is applied to the RATE, not left to Particles.emit(): that
      // clamps a single-particle emit up to one so the readability cue survives
      // a low setting, which is right for a drift spark and wrong for a
      // decorative rush line the player is meant to get fewer of.
      // The ignition term triples the rate for the third of a second after a
      // release, so the boost arrives as a WALL of air passing the lens and
      // then settles to the sustained rush. Same reasoning as the lens spike in
      // `updateSignals`: the eye reads onsets, not plateaus.
      fx.rushAcc += dt * (18 + 130 * ramp) * (boosting ? 2.1 : 1)
        * (1 + 2.4 * f.igniteImpulse) * f.emitScale;
      const n = Math.floor(fx.rushAcc);
      if (n > 0) { fx.rushAcc -= n; h.slipstream(k, n, ramp, boosting); }
    } else {
      fx.rushAcc = 0;
    }

    // --- boost pad contact -------------------------------------------------
    // The pad is the brightest surface on the circuit and it lit nothing at
    // all: a kart crossing it was graded exactly as it was a metre earlier.
    // The pad's own material belongs to the track, but the response of a kart
    // standing on it is ours, and it is most of what sells the pad.
    if (grounded && h.boostPad(fx.surface) && speed > 6) {
      const padCol = h.tierColour[1]!;
      if (dist < 50) {
        _p.copy(k.position); _p.y = fx.groundY + 0.7;
        h.lights.request(
          // Keys must stay clear of the pool's "unowned" sentinel (-1) and of
          // the drift/boost keys, which are raw kart ids.
          1000 + k.id, (k.isPlayer ? 150 : 40) - dist * 0.05, _p, padCol,
          0.55 * (1 - dist / 50) * f.gain, 6.5);
      }
      fx.padAcc += dt * 24 * lod * f.emitScale;
      const np = Math.floor(fx.padAcc);
      if (np > 0) {
        fx.padAcc -= np;
        // Rising heat off the strip plus a wash of pad-blue under the kart.
        //
        // Cut hard from an earlier tuning. The pad's own material is already the
        // brightest surface on the circuit and it sits in the tunnel where the
        // exit bloom is at its strongest; laying a 4 m additive disc at 0.55
        // alpha on top of it is how the tunnel frame ended up with a boost pad
        // clipped to featureless white. The kart's response should read as the
        // kart picking the pad up, not as more pad.
        const p = h.particles.reset();
        p.tile = TILE_GLOW; p.mode = MODE_GROUND;
        p.life = 0.35; p.lifeJitter = 0.3;
        p.size0 = 1.1; p.size1 = 2.6; p.sizeJitter = 0.3;
        p.drag = 1.2; p.count = 1; p.camBias = 0.07; p.fadeIn = 0.15;
        h.particles.at(k.position.x, fx.groundY + 0.04, k.position.z);
        h.particles.vel(k.velocity.x * 0.5, 0, k.velocity.z * 0.5);
        h.particles.colorA(padCol, 0.34, 0.30);
        h.particles.colorB(padCol, 0.09, 0);
        h.particles.emitExact(true);

        p.mode = MODE_BILLBOARD; p.tile = TILE_CORE;
        p.life = 0.3; p.size0 = 0.055; p.size1 = 0.012; p.sizeJitter = 0.5;
        p.gravity = 1.6 * h.medium.buoyancy; p.drag = 2.0; p.velJitter = 1.4; p.posJitter = 0.5;
        p.count = Math.max(1, np); p.fadeIn = 0.05;
        h.particles.ground(fx.groundY, fx.groundN, 0.25, 0.08);
        h.particles.at(k.position.x, fx.groundY + 0.12, k.position.z);
        h.particles.vel(k.velocity.x * 0.3, 2.6, k.velocity.z * 0.3);
        h.particles.colorA(padCol, 1.8, 1);
        h.particles.colorB(padCol, 0.5, 0);
        h.particles.emitExact(true);
      }
    } else {
      fx.padAcc = 0;
    }

    // --- idle exhaust ------------------------------------------------------
    // A pack shot has to look like eight running engines. Every other emitter
    // in this file is conditional on drifting, boosting, being stunned or
    // leaving the road, so a rival holding a clean line at 25 m/s emits
    // literally nothing and reads as a static prop. This is the baseline: a
    // thin, warm, sun-lit wisp off the stacks, cheap enough to run on the whole
    // field (~9 puffs/s/kart before LOD).
    if (!boosting && grounded && speed > 6 && dist < 70) {
      // 5/s, down from 9. See idleExhaust for the arithmetic on why eighteen
      // puffs a second behind a cruising kart is an opaque column.
      fx.exhaustAcc += dt * 5 * lod * Math.min(1, speed / 14);
      const n = Math.floor(fx.exhaustAcc);
      if (n > 0) { fx.exhaustAcc -= n; h.idleExhaust(k, fx, n); }
    } else {
      fx.exhaustAcc = 0;
    }

    // --- tyre contact at speed --------------------------------------------
    // Separate from the exhaust and from the off-road dust: this is the thin
    // veil a hot tyre throws off tarmac. Without it the hero kart at 92 km/h
    // emitted *nothing at all* and was indistinguishable from a parked one
    // while the rival two car-lengths away threw sparks and smoke. Speed-scaled
    // so it disappears at a crawl and never fights the drift smoke.
    if (grounded && !drifting && dist < 75) {
      // Knee moved from 9 m/s to 13. The closeup frame is a 15.4 m/s cruise and
      // at the old knee that already evaluated to 0.4 — nearly half strength for
      // a kart that is not doing anything. This is a wake for a car that is
      // genuinely travelling, not a permanent haze; it now only really arrives
      // above about 60 km/h.
      const sr = THREE.MathUtils.clamp((speed - 13) / 16, 0, 1);
      if (sr > 0) {
        // 12/s, down from 21. This and idleExhaust are the two emitters that run
        // on a clean lap, and together they were the grey column standing behind
        // the kart in the closeup — on a shot that exists to show the bodywork.
        fx.rollAcc += dt * 12 * sr * lod;
        const n = Math.floor(fx.rollAcc);
        if (n > 0) { fx.rollAcc -= n; h.rollDust(k, fx, n, f.dust, sr); }
      } else {
        fx.rollAcc = 0;
      }
    } else {
      fx.rollAcc = 0;
    }

    // --- star power --------------------------------------------------------
    // No husk. A rainbow fresnel ellipsoid scaled to enclose the chassis is
    // geometrically INSIDE the kart for its whole life: it passes over the
    // helmet, through the roll bar and out in front of the wheels, and a
    // fresnel term draws its silhouette as a hard bright ring. That is the
    // "opaque plastic hula-hoop clipping through the chassis" the review
    // called a blocker, and no amount of tuning fixes an object whose shape is
    // wrong. Invincibility is now carried entirely by light: a shimmering
    // orbit of sparks with no rigid boundary, a hue-cycling pool on the road,
    // and a coloured lamp that puts the cycle onto the kart's own bodywork.
    if (k.starTime > 0) {
      fx.starAcc += dt * 58 * lod * f.emitScale;
      const n = Math.floor(fx.starAcc);
      if (n > 0) { fx.starAcc -= n; starSparkle(h, k, fx, n, now); }
      // The lamp has to agree with whatever `starSparkle` is emitting or the
      // light on the bodywork and the sparks around it are two different
      // abilities — a hue cycle in one game, mag cyan in the other.
      h.starLampColour(_col, now, k.id);
      if (dist < 50) {
        _p.copy(k.position); _p.y = fx.groundY + 0.75;
        h.lights.request(
          2000 + k.id, (k.isPlayer ? 170 : 50) - dist * 0.05, _p, _col,
          0.85 * (1 - dist / 50) * f.gain, 7.0);
      }
    } else {
      fx.starAcc = 0;
    }

    // --- the stun read: spun-out stars, or a mag fault ----------------------
    if (k.stunTime > 0) {
      fx.stunPhase += dt * 5.4;
      fx.sparkleAcc += dt * 26 * lod * f.emitScale;
      const n = Math.floor(fx.sparkleAcc);
      if (n > 0) { fx.sparkleAcc -= n; h.stunFx(k, fx, n); }
    } else {
      fx.sparkleAcc = 0;
    }

    // tier bookkeeping for the burst on promotion is handled by the bus event
    fx.lastTier = k.driftTier;
}

// ---------------------------------------------------------------------------
//  THE EVENT ARMS BOTH GAMES SHARE
// ---------------------------------------------------------------------------
//  `Effects.onEvent` is a switch, and the switch itself is each game's: one
//  answers `item-use` and `hit`, the other answers `weapon-fire`, `bleed`,
//  `thermal-trip`, `shield-break`, `hull-damage` and `mag-lost` and leaves the
//  first two deliberately empty. That selector stays in the game.
//
//  These three arms did not differ. `drift-spark` is 139 lines and ONE of them
//  is not the same in both games — a gravity, which is the medium, which is
//  `racer.ts`'s whole subject. `hop` and `land` are identical outright.
//
//  A switch whose arms are shared and whose selector is not is a shared arm and
//  a game's selector.
// ---------------------------------------------------------------------------

/**
 * What the shared event arms need on top of `DriveHost`. Same object in both
 * games — `Effects.init` builds one literal and it satisfies both interfaces.
 */
export interface DriveEventHost<M extends DriveMachine, S extends DriveState>
  extends DriveHost<M, S> {
  /** the per-machine effect record, allocated on demand */
  state(k: M): S;
  /** refresh `skidL`/`skidR` for this machine before an emitter reads them */
  rearPoints(k: M, fx: S): void;
  burstSparks(at: THREE.Vector3, n: number, intensity: number, channel: number,
              fx: S, k: M): void;
  groundPuff(k: M, fx: S, n: number, size: number): void;
  tyreSmokePuff(k: M, fx: S, n: number, size: number): void;
  /** `ctx.shake` — amount, then seconds */
  shake(amount: number, seconds: number): void;
  /**
   * How many exhaust stacks this machine actually has, with the model's anchors
   * resolved first. Two in the kart game, always; one to three in the ship
   * game, per hull.
   */
  stackCount(k: M, fx: S): number;
  /**
   * Raise the boost-ignition spike to at least `v`. A MAX, not a set — the same
   * shape as `BlastHost.load`, and for the same reason: a second ignition
   * inside the first must not shorten it.
   */
  ignite(v: number): void;
  /** raise the blast-load governor to at least `v` */
  load(v: number): void;
  /** the plume's own colour for a boost tier — not the livery, not the slide */
  plumeColour(out: THREE.Color, tier: number): void;
  /**
   * The root kiss's birth→death ramp: two colours and their intensity/alpha.
   *
   * SIX VALUES RATHER THAN A CALL, so that neither game's ramp is a branch in
   * shared code. One machine burns fuel and its root opens blue-white; the
   * other is ionised propellant and opens amber.
   */
  readonly plumeRoot: {
    readonly a: THREE.Color; readonly ai: number; readonly aa: number;
    readonly b: THREE.Color; readonly bi: number; readonly ba: number;
  };
  /**
   * The albedo of the wake off a sliding contact patch, given whether the
   * machine is on the track proper and what the surface under it is made of.
   * Hot rubber on tarmac in one game; ionised plate vapour in the other.
   */
  washColour(out: THREE.Color, onRoad: boolean, dust: THREE.Color): void;
}

/**
 * DRIFT-TIER PROMOTION — "the single most important read in the whole game",
 * and the same eight cues in both: the shower recoloured in flight, a burst off
 * each contact patch, a shockwave, a ground pool, a hot kiss under each rear
 * wheel, two billboard flares, a scorch and a shake.
 *
 * `rawTier` is the event's, clamped here rather than at each call site.
 */
export function onDriftSpark<M extends DriveMachine, S extends DriveState>(
  h: DriveEventHost<M, S>, m: M, rawTier: number, now: number,
) {
      // Tier promotion: the single most important read in the whole game.
      const fx = h.state(m);
      const tier = Math.min(3, Math.max(1, rawTier));
      const col = h.tierColour[tier]!;
      h.rearPoints(m, fx);

      // THE PROMOTION RECOLOURS THE SHOWER IN FLIGHT. No purge.
      //
      // What used to be here was `retireRecent(true, 700, 0.06)` — kill the
      // newest 700 additive slots so the outgoing tier could not be on screen
      // beside the incoming one. It never worked and it could not have: a
      // tier-1 drift spawns roughly 1400 additive particles a second, the
      // long-lived ricochets outlive any window worth calling "recent", and
      // the shot harness fires its shutter on the *frame* the tier flips —
      // which is why the reviewed tier-2 frame is a screen full of tier-1
      // blue with an orange HUD arc over it. Killing more of them harder only
      // trades a wrong colour for a hole in the shower.
      //
      // Drift particles now carry a colour CHANNEL rather than a colour (see
      // EmitParams.channel). Pointing this kart's channel at the new tier
      // repaints every grain already in the air, this frame, for the cost of
      // three floats.
      h.particles.setChannelColor(m.id + 1, col);

      const prof = h.tierFx[tier]!;
      fx.tierFlashLen = prof.flash;
      fx.tierFlash = prof.flash;
      // 48/96/168 rather than 72/92/112. A promotion has to be an EVENT, and
      // three events that differ by 20 grains are three of the same event.
      // The count triples across the escalation, and so does the shake, the
      // ring, the scorch and the lamp punch below — every channel moves
      // together, which is what the eye reads as "something bigger just
      // happened" rather than "something happened again".
      const n = Math.round(24 * tier * tier);
      const boost = 1.35 + tier * 0.22;
      h.burstSparks(h.skidL, n, boost, m.id + 1, fx, m);
      h.burstSparks(h.skidR, n, boost, m.id + 1, fx, m);

      // THE PROMOTION SHOCKWAVE.
      //
      // The ban this file keeps is on rigid additive geometry *near the
      // chassis*, and it is a ban on shapes the camera sees face-on. A ring
      // lying in the road plane, seen from a rig two metres up, is an ellipse
      // with no enclosed area that races past the lens in a quarter of a
      // second — the same object boost ignition already uses, and the reason
      // that ignition reads as an event while the drift promotion did not.
      // Tier 1 gets a small one, tier 3 gets one twice the radius and nearly
      // twice as bright, so the escalation is legible from the ring alone.
      _q.copy(m.position); _q.y = fx.groundY + 0.26;
      h.rings.spawn(_q, fx.groundN, 0.6, 2.6 + 2.0 * tier, 0.22 + 0.04 * tier,
        0.06, col, 0.75 + 0.42 * tier, now, m.velocity, 1.6);

      // NO ANNULUS. A 1.7 m-radius vertical torus spawned inside the chassis
      // is geometrically *inside* the kart for its whole life: it cuts through
      // the rear wheels, exits the far side of the bodywork and reads as a
      // plastic hoop welded to the car. The comment this replaces warned that
      // a ground-plane ring reads as a dropped hula hoop and then shipped the
      // same object rotated ninety degrees. Per the art direction the drift
      // signature is *emitted sparks plus a soft ground glow* — no ring at
      // all. Rings are kept for boost ignition and impacts, where they are
      // punched clear of the body along the direction of travel.
      //
      // The flash is a ground-projected radial pool instead: it has area, no
      // silhouette of its own, cannot intersect anything, and it puts the tier
      // colour on the tarmac where the sparks are actually landing.
      _q.copy(m.position); _q.y = fx.groundY + 0.05;
      const p = h.particles.reset();
      p.tile = TILE_GLOW; p.mode = MODE_GROUND;
      p.life = 0.34; p.lifeJitter = 0.1;
      // 3.4 m, not 6.2. At six metres the flash was wider than the road and
      // it landed as a flat coloured stain over the kerb rather than as light
      // thrown by the sparks.
      p.size0 = 1.4; p.size1 = 2.6 + 0.9 * tier; p.sizeJitter = 0.1;
      // Carries the kart's velocity, otherwise a 0.4 s flash on a kart doing
      // 25 m/s is stranded eight metres back down the road by the time it
      // fades.
      // `fadeIn` used to be 0.05 s — three frames at 60 Hz to reach full
      // value. The HUD punch was separately measured arriving two to five
      // frames after the same trigger, and a promotion whose three channels
      // peak on three different frames is the "mush rather than an event"
      // failure however loud each channel is on its own. Every cue on this
      // event now peaks on the frame it is raised; a single frame of fade is
      // still enough to keep a 3.4 m ground disc from popping in hard.
      p.fadeIn = 0.016; p.drag = 0.6; p.count = 1; p.camBias = 0.08;
      h.particles.at(_q.x, _q.y, _q.z);
      h.particles.vel(m.velocity.x, 0, m.velocity.z);
      h.particles.colorA(col, 1.05 + 0.42 * tier, 0.78);
      h.particles.colorB(col, 0.28, 0);
      h.particles.emit(true);

      // A tight hot kiss under each rear wheel on top of the wide pool, so
      // the promotion has a point of origin rather than a vague wash.
      p.life = 0.24; p.size0 = 0.5; p.size1 = 1.5; p.count = 1;
      for (let s = 0; s < 2; s++) {
        const at = s === 0 ? h.skidL : h.skidR;
        h.particles.at(at.x, fx.groundY + 0.06, at.z);
        h.particles.colorA(C_HOT, 1.5, 0.85);
        h.particles.colorB(col, 0.45, 0);
        h.particles.emit(true);
      }

      // A billboard flare on the tier colour, at rear-axle height and just
      // clear of the bodywork on each side. The pool puts the promotion on
      // the ROAD; this puts it in the AIR, where the chase camera is actually
      // looking, and it is the layer that makes a tier-2 change readable in a
      // thumbnail. Still a particle, still no silhouette — the file's ban on
      // rigid additive geometry near the chassis stands.
      _fwd.copy(m.forward);
      _side.crossVectors(UP, _fwd).normalize();
      p.mode = MODE_BILLBOARD; p.tile = TILE_GLOW;
      p.life = 0.26 + 0.05 * tier; p.lifeJitter = 0.2;
      p.size0 = 0.45 + 0.30 * tier; p.size1 = 1.7 + 0.95 * tier; p.sizeJitter = 0.2;
      // Same-frame attack as the pool and the sparks above. See there.
      p.drag = 4.5; p.gravity = 1.2 * h.medium.buoyancy; p.count = 1; p.fadeIn = 0.012;
      // Two metres of camera-facing disc 42 cm off the deck: it needs a real
      // soft fade and a real bias, or the road slices it in half.
      h.particles.ground(fx.groundY, fx.groundN, 0.55, 0.45);
      for (let s = 0; s < 2; s++) {
        _r.copy(m.position)
          .addScaledVector(_fwd, -0.95)
          .addScaledVector(_side, s === 0 ? -0.72 : 0.72);
        _r.y = fx.groundY + 0.42;
        h.particles.at(_r.x, _r.y, _r.z);
        h.particles.vel(m.velocity.x * 0.9, 1.4, m.velocity.z * 0.9);
        h.particles.colorA(col, 1.30 + 0.30 * tier, 0.60);
        h.particles.colorB(col, 0.30, 0);
        h.particles.emit(true);
      }

      // Scorch under the burst, so the tier change leaves a mark on the road.
      // A real eroded Scorch disc rather than the small Smudge kiss, and
      // keyed to the tier colour — a promotion is the loudest moment of the
      // drift and it should be the one that burns the tarmac.
      h.decals.scorch(_q, fx.groundN, 0.85 + 0.28 * tier, col, now, 8, 0.45 + 0.10 * tier, h.scorchTile);
      if (m.isPlayer) h.shake(0.05 + 0.045 * tier * tier * 0.5, 0.14);
}

/** A hop: a puff off the surface and nothing else. */
export function onHop<M extends DriveMachine, S extends DriveState>(
  h: DriveEventHost<M, S>, m: M,
) {
      const fx = h.state(m);
      h.groundPuff(m, fx, 6, 0.5);
}

/**
 * A landing. Scaled by the impact all the way through — under 0.06 it is a
 * kerb and draws nothing, and above that the puff, the ring, the chassis squat
 * and the shake all grow together.
 */
export function onLand<M extends DriveMachine, S extends DriveState>(
  h: DriveEventHost<M, S>, m: M, impact: number, now: number,
) {
      const fx = h.state(m);
      const k = THREE.MathUtils.clamp(impact, 0, 1);
      if (k < 0.06) return;
      h.groundPuff(m, fx, 6 + 22 * k, 0.6 + 1.1 * k);
      _p.copy(m.position); _p.y = fx.groundY + 0.08;
      h.rings.spawn(_p, fx.groundN, 0.3, 2.0 + 3.4 * k, 0.34, 0.08, C_SMOKE, 0.30 + 0.3 * k, now);
      h.addSquash(m, -0.30 * k - 0.08);
      if (m.isPlayer) h.shake(0.10 + 0.5 * k, 0.2);
}

/**
 * BOOST IGNITION — a shockwave, an exhaust bloom, a debris spray, a ground
 * flash, a lens spike and a tyre chirp, and it is the same six in both games.
 *
 * 160 lines, of which THREE were not identical: how many stacks the machine
 * has, and two ballistics — the bloom's buoyancy and the debris spray's
 * gravity/drag pair. All three are values (`DriveEventHost.stackCount`,
 * `Medium.buoyancy`, `Medium.igniteSparks`).
 *
 * This block was once judged unshareable, on the grounds that `resolveStacks`
 * is 11 lines in one game and 57 in the other. That is true and it does not
 * follow: this function does not need to BE `resolveStacks`, it needs to know
 * how many stacks there are and where their mouths sit, and both are questions
 * the host answers. A function that CALLS a divergent method is not a
 * divergent function.
 */
export function onBoostIgnite<M extends DriveMachine, S extends DriveState>(
  h: DriveEventHost<M, S>, k: M, tier: number, now: number,
) {
    const fx = h.state(k);
    const bt = Math.min(3, Math.max(1, tier));
    // Latch the tier for the WHOLE boost. The game's drift release zeroes
    // driftTier in the same call that applies the boost, so anything reading it
    // downstream sees 0 and falls back to blue. See `DriveState.boostTier`.
    fx.boostTier = Math.max(fx.boostTier, bt);
    // ONE IGNITION PER IGNITION. A mushroom raises both `item-use` and `boost`
    // on the same frame, so this used to run twice and lay two of everything on
    // exactly the same pixels — which was survivable when the ignition was two
    // dim rings and is not now that it is three fronts, a debris spray and a
    // lens spike. The window is a fifth of the ignition's own life, so a genuine
    // second boost (a pad taken during a mini-turbo) still reads as one.
    if (fx.igniteT > 0.24) return;
    const col = h.tierColour[bt]!;
    _fwd.copy(k.forward);
    _side.crossVectors(UP, _fwd).normalize();

    // THE SHOCKWAVE.
    //
    // It used to be two annuli whose normal was the direction of travel. From a
    // chase camera that is *face on*: you see the full circle, and a circle
    // 4 metres across sitting in the middle of the frame with a saturated
    // primary in it is a dinner plate, whatever its alpha profile says. The
    // shape was never the problem — the viewing angle was.
    //
    // A ring in the plane of the road, seen from a rig 2 m up and 6 m back, is
    // foreshortened to a hard ellipse: nearly edge-on, no enclosed area, and it
    // races outward past the lens in a third of a second. Thin (5% of radius),
    // dim, fast, gone. Two of them, staggered, so it reads as a wave front
    // rather than a hoop.
    // Held 30-50 cm off the tarmac, not laid on it: a 7 m disc pinned to the
    // local tangent plane sinks through a crest or a 20-degree bank and the
    // depth test then chops it into hard arcs.
    //
    // THREE staggered fronts now, not two, and the third is the one that makes
    // the release read as an EVENT rather than as a state change: a wide, fast,
    // very thin ring that overtakes the camera. The player's eye is inside it
    // for two frames. That is the entire trick behind a boost that "hits" in a
    // shipped arcade racer, and it costs one instanced draw the pool already
    // pays for.
    _q.copy(k.position); _q.y = fx.groundY + 0.30;
    h.rings.spawn(_q, fx.groundN, 0.9, 7.5 + 2.2 * bt, 0.34, 0.055,
      col, 1.55 + 0.45 * bt, now, k.velocity, 1.6);
    _q.y = fx.groundY + 0.52;
    h.rings.spawn(_q, fx.groundN, 0.5, 4.8, 0.24, 0.075, C_HOT, 1.25, now, k.velocity, 1.6);
    // The overtaking front: 14 m in a fifth of a second, 3.5% thick, on the
    // tier colour, held high enough to sweep the lens rather than the tarmac.
    // This is the ring the player's eye ends up INSIDE, so it is the one that
    // most has to differ between a blue and a purple cash-out: 15.5 m against
    // 11.5 m, and half again the intensity.
    _q.y = fx.groundY + 1.05;
    h.rings.spawn(_q, fx.groundN, 2.2, 9.5 + 2.0 * bt, 0.20, 0.035,
      col, 0.95 + 0.42 * bt, now, k.velocity, 1.2);

    // Ignition bloom at the stacks: a short violent scatter of hot gas that
    // seeds the ribbon before it has grown to length.
    //
      // PER STACK, NOT PER PAIR. A kart has two pipes and always did; a ship's
      // hull can carry one or three, which is the reason this is `h.stackCount`
      // and not a 2. The host resolves the anchors off the model before
      // answering.
    const stacks = h.stackCount(k, fx);
    for (let s = 0; s < stacks; s++) {
      h.mouthOf(k, s, _p);
      const p = h.particles.reset();
      p.tile = TILE_GLOW; p.mode = MODE_BILLBOARD;
      p.life = 0.20; p.lifeJitter = 0.35;
      p.size0 = 0.34; p.size1 = 0.10; p.sizeJitter = 0.35;
      p.drag = 6; p.gravity = 2.2 * h.medium.buoyancy; p.velJitter = 2.2; p.posJitter = 0.08;
      // 5 at 1.9x, down from 7 at 2.6x. This lands on the same pixels as the
      // plume, the ribbon, the root kiss and the boost lamp, all within the
      // 0.3 s the ignition overshoot is also multiplying everything else.
      //
      // THE RELEASE HAS TO ESCALATE, BECAUSE THE PROMOTION DOES.
      // Counted off the authored constants, a tier-3 PROMOTION spawns nine
      // times the sparks of a tier-1 promotion, throws a ring twice the radius
      // and shakes the camera five times as hard. The RELEASE — the thing the
      // whole ladder exists to buy — scaled by 1.1 per tier on a couple of
      // radii and by nothing at all on every particle count: a purple mini
      // turbo cashed out about 25% louder than a blue one. That is the wrong
      // way round. The counts below now grow with the tier so that cashing a
      // tier 3 is visibly the biggest thing that happens in a lap.
      p.fadeIn = 0.04; p.count = 5 + 3 * bt;
      h.particles.ground(fx.groundY, fx.groundN, 0.5, 0.2);
      h.particles.at(_p.x, _p.y, _p.z);
      // Carries most of the kart's velocity so the burst stays with the car
      // instead of being stranded on the tarmac (see boostPlume for why).
      h.particles.vel(
        k.velocity.x * 0.88 - _fwd.x * 3.0 + _side.x * (s === 0 ? -1.6 : 1.6),
        k.velocity.y * 0.88 + 2.2,
        k.velocity.z * 0.88 - _fwd.z * 3.0 + _side.z * (s === 0 ? -1.6 : 1.6));
      h.particles.colorA(C_FLAME_ROOT, 2.2, 0.85);
      h.particles.colorB(C_FLAME_MID, 0.6, 0);
      h.particles.emit(true);

      // A hard spray of hot debris thrown backwards out of each stack. Cores,
      // stretched, short-lived: this is the layer that reads as the exhaust
      // spitting on ignition, and it survives motion blur because it is
      // travelling with the streak rather than across it.
      p.tile = TILE_CORE; p.mode = MODE_STRETCH; p.stretch = 5.0;
      p.life = 0.26; p.lifeJitter = 0.5;
      p.size0 = 0.10; p.size1 = 0.014; p.sizeJitter = 0.55;
      // A NEW `Medium` ENTRY, and it had to be one: nothing already in the
      // table has this pair. Air throws ignition debris at -7 and drags it at
      // 1.2; vacuum answers -0.31 and 0.05. `racer.ts` says why solid matter
      // needs a table rather than a multiplier — vacuum does not scale air's
      // drag by any constant, and inventing the function that would join
      // these two would change what both games render.
      p.gravity = h.medium.igniteSparks.gravity; p.drag = h.medium.igniteSparks.drag;
      p.velJitter = 3.4; p.posJitter = 0.06;
      p.count = 5 + 5 * bt;
      h.particles.ground(fx.groundY, fx.groundN, 0, 0.14);
      h.particles.vel(
        k.velocity.x * 0.70 - _fwd.x * 9.0 + _side.x * (s === 0 ? -2.4 : 2.4),
        k.velocity.y * 0.70 + 2.6,
        k.velocity.z * 0.70 - _fwd.z * 9.0 + _side.z * (s === 0 ? -2.4 : 2.4));
      h.particles.colorA(C_HOT, 2.5, 1);
      h.particles.colorB(col, 0.85, 0);
      h.particles.emit(true);
    }

    // Ground flash under the ignition — the thing that makes the boost read as
    // an event that happened *on the road* rather than a sprite over it.
    // Halved in radius and brightness from an earlier tuning: at 6.5 m and 1.6x
    // a saturated primary this alone was a coloured stain wider than the road.
    const g = h.particles.reset();
    g.tile = TILE_GLOW; g.mode = MODE_GROUND;
    g.life = 0.28; g.size0 = 1.4; g.size1 = 3.6 + 0.5 * bt; g.sizeJitter = 0.1;
    // Same-frame attack: the ignition is one event and every channel of it has
    // to be at value on the frame the boost is applied. See the drift-spark
    // case for the measurement.
    g.drag = 0.7; g.count = 1; g.camBias = 0.08; g.fadeIn = 0.018;
    h.particles.at(k.position.x, fx.groundY + 0.05, k.position.z);
    h.particles.vel(k.velocity.x, 0, k.velocity.z);
    h.particles.colorA(col, 0.9 + 0.16 * bt, 0.6);
    h.particles.colorB(col, 0.2, 0);
    h.particles.emit(true);

    fx.igniteT = 0.30;
    // THE IGNITION IMPULSE — the half of "the release must be an EVENT" that
    // lives in the LENS rather than in the world.
    //
    // Everything above is a particle or a ring, and every one of them is
    // behind or beside the kart. The screen-space half of the payoff (radial
    // smear, speed lines, chromatic ramp, FOV) was driven purely off
    // `boostTime > 0`, which is a STEP: it goes from nothing to a sustained
    // value and holds it. A step is a state, not an event, and the eye reads
    // the onset of a cue, not its plateau — which is most of why the boost is
    // reported as "barely visible" despite every term being present in the
    // frame. This is a spike on top of the plateau, decaying over ~0.35 s, and
    // it is what makes the first three frames of a boost different from the
    // twentieth. See `updateSignals`.
    // 0.70 / 0.95 / 1.20 rather than 0.70 / 0.85 / 1.00. This is the term that
    // owns the FOV punch and the radial smear, i.e. the half of the payoff that
    // is felt rather than seen, and it is the cheapest place to make a purple
    // release outrank a blue one. `speedIntensity` is clamped downstream; the
    // FOV punch is not, and 1.20 buys about 4.1 degrees against 2.4.
    if (k.isPlayer) h.ignite(0.45 + 0.25 * bt);
    // 6 puffs at 1.15, down from 8 at 1.4. Mini-turbo ignition is corner exit —
    // the moment the chase camera is closest to the rear axle and pointing
    // along it — and sixteen 2.1 m puffs arriving at once two metres from the
    // lens is the other half of "the boost effect deletes the subject".
    // NOT escalated by tier, deliberately. Everything else on this event is
    // behind or beside the kart; this is the one layer that lands between the
    // chase lens and the subject, and the note above records that it was cut
    // from 8 at 1.4x to 6 at 1.15x precisely because it was deleting the car it
    // was supposed to be celebrating. A louder tier 3 must not buy that back.
    h.tyreSmokePuff(k, fx, 6, 1.15);
    // 0.20 + 0.07 was a 1.35x spread across the whole ladder. The promotion's
    // own shake spreads 5x across the same three tiers, so the release used to
    // feel SMALLER than the promotion that preceded it by a second.
    if (k.isPlayer) h.shake(0.16 + 0.13 * bt, 0.24);
    h.load(0.5);
}

/**
 * THE BOOST PLUME'S PARTICLE HALF — the root kiss, the tier sheath and the
 * tail embers. The flame BODY is `Plumes`, which is geometry; this is what
 * makes it look like it is coming out of something.
 *
 * 76 lines, four of them not the same in both games, and all four are values:
 * the flame's colour for a tier, how many stacks the machine has (and where
 * they sit laterally, which is one expression covering both rather than a
 * branch), the six numbers of the root ramp, and one buoyant gravity.
 *
 * EVERYTHING HERE INHERITS MOST OF THE MACHINE'S VELOCITY. Particles are
 * simulated in world space, so a plume emitted with a purely local velocity is
 * in world terms STATIONARY: each ember is stranded where it was born and the
 * "plume" smears down the road behind a machine that has already left.
 */
export function boostPlume<M extends DriveMachine, S extends DriveState>(
  h: DriveEventHost<M, S>, k: M, n: number,
) {
    const fx = h.state(k);
    _fwd.copy(k.forward);
    _side.crossVectors(UP, _fwd).normalize();
    const tier = fx.boostTier;
    h.plumeColour(_col, tier);
    const burn = THREE.MathUtils.clamp(k.boostTime / 0.9, 0.35, 1);

    const vx = k.velocity.x, vy = k.velocity.y, vz = k.velocity.z;

    // PER STACK, and the lateral offset generalises rather than branching.
    // A kart has two pipes at -0.34 and +0.34; the expression below is
    // BIT-IDENTICAL for two (checked: (0/1-0.5)*0.68 is exactly -0.34 and
    // (1/1-0.5)*0.68 is exactly 0.34 in doubles) and spreads one, three or six
    // evenly across the same span. It is a formula that covers both, not a flag.
    const stacks = h.stackCount(k, fx);
    for (let s = 0; s < stacks; s++) {
      const sx = stacks > 1 ? (s / (stacks - 1) - 0.5) * 0.68 : 0;
      h.mouthOf(k, s, _p);

      // Hot kiss at the stack mouth: the thing that welds the ribbon's root to
      // the bodywork. Deliberately NOT the brightest layer — an offline energy
      // model showed two of these stacking to 2.3 linear on their own, more than
      // the flame itself, which drove the core of the plume to flat achromatic
      // white in the exact frame the art direction says must not white out. One
      // per emission, 2.2x, 0.85 alpha.
      const p = h.particles.reset();
      p.tile = TILE_GLOW; p.mode = MODE_BILLBOARD;
      p.life = 0.10; p.lifeJitter = 0.3;
      // 1.35, down from 2.2. Two of these plus the ribbon's own root kiss plus
      // the trail spine all land on the same handful of pixels; the sum is what
      // the frame sees, and the sum was three times over white.
      p.size0 = 0.11 + 0.06 * burn; p.size1 = 0.04; p.sizeJitter = 0.25;
      p.drag = 5; p.velJitter = 0.35; p.posJitter = 0.04; p.fadeIn = 0.05;
      p.count = Math.max(1, n >> 2);
      h.particles.ground(fx.groundY, fx.groundN, 0.5, 0.18);
      h.particles.at(_p.x, _p.y, _p.z);
      h.particles.vel(vx, vy + 0.6, vz);
      // The root ramp is a game's, and it is six values rather than two calls
      // so that neither game's ramp is a branch in here. One burns fuel and
      // opens blue-white; the other is ionised propellant and opens amber.
      const r = h.plumeRoot;
      h.particles.colorA(r.a, r.ai, r.aa);
      h.particles.colorB(r.b, r.bi, r.ba);
      h.particles.emit(true);

      // Tier sheath. BORN SMALL AND GROWS — this is the note, verbatim: a puff
      // that is born at its terminal size has no expansion in it and reads as
      // fog rather than as gas leaving a pipe under pressure. It also has to
      // start small because it starts AT the stack mouth, where anything wide
      // is already overlapping the bodywork.
      p.tile = TILE_GLOW; p.life = 0.26;
      // Back to n>>2 and a tamer terminal size. At n>>1 and 0.91 m these
      // overlapped hard enough that the sum of a dozen tier-coloured discs and
      // the plume's own spine landed on white — the sheath is meant to be the
      // low-frequency CARRIER of the tier hue, and a carrier that saturates is
      // just another white cloud.
      p.size0 = 0.10; p.size1 = (0.46 * burn + 0.22) * (0.94 + 0.06 * tier); p.sizeJitter = 0.3;
      p.count = Math.max(1, n >> 2); p.drag = 4; p.fadeIn = 0.12;
      h.particles.vel(vx * 0.92 - _fwd.x * 2.4, vy * 0.92 + 0.8, vz * 0.92 - _fwd.z * 2.4);
      // 0.95, not 0.62, and scaling with the tier. The sheath is the widest
      // low-frequency shape in the boost and therefore the one that survives
      // bloom and motion blur — it is what carries the tier hue at chase
      // distance when the tongue itself is foreshortened to a bright disc.
      h.particles.colorA(_col, 0.70 + 0.12 * tier, 0.42);
      h.particles.colorB(_col, 0.15, 0);
      h.particles.emit(true);

      // Cooling embers shed off the tip, so the plume dissipates into the
      // slipstream instead of ending on the ribbon's clean edge. Thrown further
      // back and given the ember hue at both ends of the ramp: these are the
      // sparse C_FLAME_COOL tail the review asked for, and they are the only
      // part of the effect allowed past the tongue's own length.
      p.tile = TILE_STREAK; p.mode = MODE_STRETCH; p.stretch = 3.0;
      p.life = 0.24; p.lifeJitter = 0.5;
      p.size0 = 0.035; p.size1 = 0.010; p.sizeJitter = 0.5;
      p.gravity = -3.0 * h.medium.buoyancy; p.drag = 1.6; p.velJitter = 1.6; p.velScatter = 0.4;
      p.fadeIn = 0.03;
      p.count = Math.max(1, n >> 2);
      h.particles.vel(
        vx * 0.70 - _fwd.x * 4.2 + _side.x * sx * 1.4,
        vy * 0.70 + 0.8,
        vz * 0.70 - _fwd.z * 4.2 + _side.z * sx * 1.4);
      h.particles.colorA(C_FLAME_MID, 1.55, 1);
      h.particles.colorB(C_FLAME_COOL, 0.55, 0);
      h.particles.emit(true);
    }
}

/**
 * THE WAKE OFF A SLIDING CONTACT PATCH — 26 lines, four of them values.
 *
 * One game is tearing hot rubber off tarmac and the other is shearing ionised
 * plate vapour off a ferrous deck, and the emitter is the same emitter: the
 * same life budget in metres, the same sizes, the same jitter, the same
 * lateral-slip velocity, the same two-stop colour ramp. What differs is the
 * albedo (`washColour`), the shape (`Medium.washTile`/`washMode`/`washStretch`,
 * exactly as `slideGritTile` already is) and one buoyant gravity.
 *
 * `at` is a contact patch — `DriveHost.skidL`/`skidR`, refreshed by
 * `wake.rearPoints` before this is called.
 */
export function tyreSmoke<M extends DriveMachine, S extends DriveState>(
  h: DriveEventHost<M, S>, k: M, fx: S, at: THREE.Vector3, n: number,
  dust: THREE.Color, tier: number,
) {
    // SURFACE-KEYED, AND THE KEYED HALF IS SHARED.
    //
    // Tarmac gets the cool rubber grey; everything else gets the surface's own
    // dust colour from SURFACE_PROPS. The old 0.42 lerp toward the key light was
    // trying to do the lighting's job in the albedo and landed the whole cloud
    // on #d5c4a8 — dry dirt — whatever it was actually driving on. 0.14 is a
    // hint of ambient warmth; the sun side is now carried by the wrap/backscatter
    // term in the particle shader, which varies across the puff the way real
    // light does.
    const onRoad = h.onRoad(fx.surface);
    h.washColour(_col, onRoad, dust);
    // 18% toward the live tier, so a tier-3 drift smokes faintly violet and the
    // charge is legible even in the smoke — the art direction wants the tier
    // readable at a glance, and the smoke is the largest thing a drift puts on
    // screen.
    if (tier > 0) _col.lerp(h.tierColour[Math.min(3, tier)]!, 0.18);
    _col2.copy(_col).lerp(C_SMOKE_DARK, 0.5);
    const speed = Math.abs(k.forwardSpeed);
    const p = h.particles.reset();
    // THE SHAPE IS THE MEDIUM'S, exactly as `slideGritTile` already is. A puff
    // expanding into air is a round billboard of eroded smoke; a wash being
    // dragged through vacuum has a direction, and its tile is authored with a
    // head and a tail to match. `washStretch` is 0 in air, which is what
    // `reset()` already leaves it at — the line is the identity there.
    p.tile = h.medium.washTile; p.mode = h.medium.washMode;
    p.stretch = h.medium.washStretch;
    // Budgeted at 17 m behind the tyre — see trailLife. At a 25 m/s drift that
    // is 0.68 s rather than the 1.25 s (up to 1.8 s with jitter) that stranded
    // puffs forty metres back with no kart under them.
    p.life = trailLife(speed, 17, 0.42, 1.25); p.lifeJitter = 0.32;
    // Wide per-particle scale and rotation spread: a cloud of identically sized
    // puffs turning at the same rate has no internal structure and reads as one
    // flat decal, which is exactly how the drift smoke was landing. Grows
    // faster to compensate for the shorter life, so the cloud has the same
    // volume packed into a tighter, kart-attached column.
    p.size0 = 0.55; p.size1 = 2.9; p.sizeJitter = 0.65;
    p.gravity = 1.1 * h.medium.buoyancy; p.drag = 1.7; p.spin = 1.5;
    p.posJitter = 0.30; p.velJitter = 1.5; p.velScatter = 0.35; p.fadeIn = 0.10;
    // Deeper soft fade so the puff dissolves into the tarmac over a metre
    // instead of terminating on the intersection line, plus a generous
    // camera-ward bias — a 2.9 m puff has a lot of quad to get caught on.
    h.particles.ground(fx.groundY, fx.groundN, 1.15, 0.40);
    p.count = n;
    _fwd.copy(k.forward);
    // STRICTLY BEHIND THE CONTACT PATCH. The review has the drift smoke sitting
    // beside and slightly *ahead* of the kart, which is what an emitter seeded
    // on the patch itself does once the puff's own outward jitter is added: half
    // of the cloud is born forward of where the rubber is. Backing the seed off
    // 45 cm along -forward puts every puff in the wake at birth.
    h.particles.at(
      at.x - _fwd.x * 0.45, at.y + 0.26, at.z - _fwd.z * 0.45);
    // The kart's velocity MINUS the slip vector: the smoke leaves with the car
    // but not with the part of the car's motion that is sideways, which is the
    // component the tyre is fighting. That difference is what makes a cloud read
    // as being torn off rubber rather than as being carried along by it.
    _side.crossVectors(UP, _fwd).normalize();
    const latv = k.velocity.x * _side.x + k.velocity.z * _side.z;
    h.particles.vel(
      k.velocity.x * 0.50 - _side.x * latv * 0.30 - _fwd.x * 2.0,
      1.5,
      k.velocity.z * 0.50 - _side.z * latv * 0.30 - _fwd.z * 2.0);
    // 0.55, not 0.85. Individually opaque puffs read as popcorn; the cloud has
    // to be built out of many translucent ones or the lighting model in
    // Particles has nothing to shade through — and the two-lobe warm/cool split
    // the art direction asks for only exists in the overlap of translucent layers.
    h.particles.colorA(_col, 1.0, 0.55);
    h.particles.colorB(_col2, 0.85, 0);
    h.particles.emit(false);
}

/**
 * STAR POWER — the shimmering orbit, and the pool it lays on the surface.
 *
 * Thirty-nine lines, and THREE of them were not the same in both games: the two
 * colours the shimmer is drawn in, and the star's gravity. The colours are a
 * host call because one game cycles hue and the other walks mag to shield; the
 * gravity is `-1.2 x buoyancy`, i.e. the medium, exactly as `racer.ts` argues.
 * Everything else — the helix, the rise, the radius wobble, the two-part
 * emission and the ground-aligned pool — was byte-identical.
 *
 * SCRATCH, AND A CLOBBER THAT MOVED. This writes `_col` and `_col2`, which are
 * now THIS module's rather than each game's. `emitDrive` calls it and then
 * writes `_col` on the very next statement (`starLampColour`), and `_col2` is
 * live only inside `tyreSmoke`, which cannot be on the stack here. Checked in
 * code, not assumed. The reverse direction — the games no longer having their
 * own `_col` clobbered — is safe by construction: this only ever ran when
 * `starTime > 0`, so nothing could have depended on the clobber happening.
 */
export function starSparkle<M extends DriveMachine, S extends DriveState>(
  h: DriveHost<M, S>, k: M, fx: S, n: number, now: number,
) {
    h.starColours(_col, _col2, now, k.id);

    const p = h.particles.reset();
    p.tile = TILE_STAR; p.mode = MODE_BILLBOARD;
    p.life = 0.55; p.lifeJitter = 0.4;
    p.size0 = 0.22; p.size1 = 0.03; p.sizeJitter = 0.45;
    p.gravity = -1.2 * h.medium.buoyancy; p.drag = 2.6; p.spin = 2.4;
    p.velJitter = 1.1; p.fadeIn = 0.05; p.count = 1;
    h.particles.ground(fx.groundY, fx.groundN, 0.3, 0.14);
    h.particles.colorA(_col, 1.9, 1);
    h.particles.colorB(C_HOT, 0.7, 0);
    // Emission points ride a helix around the chassis. The particles barely
    // move; the *source* orbits, which is what reads as a shimmering husk.
    for (let i = 0; i < n; i++) {
      const a = now * 6.5 + (i / Math.max(1, n)) * Math.PI * 2 + k.id;
      const rise = ((now * 1.3 + i * 0.37) % 1);
      const r = 0.62 + 0.16 * Math.sin(a * 2.0);
      h.particles.at(
        k.position.x + Math.cos(a) * r,
        k.position.y - 0.12 + rise * 1.05,
        k.position.z + Math.sin(a) * r);
      h.particles.vel(k.velocity.x * 0.6, k.velocity.y * 0.6 + 0.5, k.velocity.z * 0.6);
      h.particles.emitExact(true);
    }

    // The pool on the road. Ground-aligned, so it has area and no edge.
    p.tile = TILE_GLOW; p.mode = MODE_GROUND; p.spin = 1.2;
    p.life = 0.26; p.size0 = 1.0; p.size1 = 2.1; p.sizeJitter = 0.2;
    p.gravity = 0; p.drag = 1.1; p.velJitter = 0; p.count = 1;
    p.camBias = 0.07; p.softness = 0; p.fadeIn = 0.12;
    h.particles.at(k.position.x, fx.groundY + 0.05, k.position.z);
    h.particles.vel(k.velocity.x * 0.8, 0, k.velocity.z * 0.8);
    h.particles.colorA(_col2, 0.55, 0.45);
    h.particles.colorB(_col, 0.14, 0);
    h.particles.emitExact(true);
}

/**
 * THE FINISH. One burst per entry in the game's own foil table.
 *
 * Sixteen lines, and TWO of them differed: the colour table, and a gravity with
 * its drag. The second is a `Medium` entry rather than a `buoyancy` multiply
 * for the reason `racer.ts` spells out — vacuum does not scale air's drag by
 * any constant, and -4.2/1.5 against -0.31/0.04 were tuned against two
 * different pictures.
 *
 * What the table CONTAINS is emphatically each game's: one throws six party
 * colours, the other throws the deck's own marker foil, because its art
 * direction rules out four unreserved saturated hues fired into the middle of
 * the one frame the player screenshots. That is a decision about a game, made
 * in the game.
 *
 * No module scratch. Nothing here can alias anything.
 */
export function confetti<M extends DriveMachine, S extends DriveState>(
  h: DriveHost<M, S>, at: THREE.Vector3,
) {
    for (let i = 0; i < h.foil.length; i++) {
      const p = h.particles.reset();
      p.tile = TILE_STREAK; p.mode = MODE_BILLBOARD;
      p.life = 2.6; p.lifeJitter = 0.35;
      p.size0 = 0.16; p.size1 = 0.16; p.sizeJitter = 0.4;
      p.gravity = h.medium.foil.gravity; p.drag = h.medium.foil.drag; p.spin = 6;
      p.posJitter = 0.9; p.velJitter = 5.5; p.fadeIn = 0.03; p.count = 14;
      p.softness = 0;
      h.particles.at(at.x, at.y + 2.4, at.z);
      h.particles.vel(0, 5.5, 0);
      h.particles.colorA(h.foil[i]!, 1.0, 1);
      h.particles.colorB(h.foil[i]!, 0.9, 0.9);
      h.particles.emit(false);
    }
}

/**
 * THE DRIFT JET — the column of embers that climbs out of each contact patch on
 * the upper tiers, and the thing that makes a tier promotion a SHAPE change
 * rather than a brightness change.
 *
 * Thirty lines in one game and thirty-four in the other, and both extra lines
 * were a comment. TWO divergences:
 *
 *  · a gravity and a drag — `medium.driftJet`, which is what `racer.ts` says a
 *    gravity and a drag are. -11/0.55 in air, -0.31/0.04 in vacuum.
 *  · the velocity the jet inherits. The kart game keeps a flat two thirds;
 *    the ship game keeps whatever leaves a bounded SLIP, because two thirds of
 *    142 m/s is 48 m/s of slip — thirty-four metres of drift over the jet's own
 *    life. Same rule as `showerKeep` and `burstKeep`, and the third member of
 *    that family: a fraction fitted at 25 m/s is not a fraction anywhere else.
 *
 * SCRATCH. This writes `_fwd` and `_side`, which are now this module's. Checked
 * in code rather than assumed: inside `emitDrive` the next touch of either is
 * the `_side.crossVectors` that begins the slipstream block, which WRITES
 * before it reads. The games losing the clobber is safe by construction — this
 * only ever ran on `prof.jet > 0`, i.e. the top two tiers, so nothing on the
 * other frames could have depended on it happening.
 */
export function driftJet<M extends DriveMachine, S extends DriveState>(
  h: DriveHost<M, S>, k: M, fx: S, n: number, tier: number,
) {
    const col = C_CHANNEL;
    _fwd.copy(k.forward);
    _side.crossVectors(UP, _fwd).normalize();
    const prof = h.tierFx[tier]!;
    const p = h.particles.reset();
    p.channel = k.id + 1;
    p.tile = TILE_STREAK; p.mode = MODE_STRETCH; p.stretch = 3.4;
    p.life = 0.70; p.lifeJitter = 0.35;
    p.size0 = 0.075 + 0.030 * tier; p.size1 = 0.014; p.sizeJitter = 0.5;
    p.gravity = h.medium.driftJet.gravity; p.drag = h.medium.driftJet.drag;
    p.posJitter = 0.10; p.velJitter = 1.5; p.velScatter = 0.30; p.fadeIn = 0.05;
    p.count = Math.max(1, n);
    // Pinpoints: no ground fade (they are light, not volume), small bias so the
    // tyre that threw them cannot depth-reject them.
    h.particles.ground(fx.groundY, fx.groundN, 0, 0.16);
    h.particles.colorA(col, 2.0 + 0.30 * tier, 1);
    h.particles.colorB(col, 0.55, 0);
    const keep = h.jetKeep(Math.abs(k.forwardSpeed));
    for (let s = 0; s < 2; s++) {
      const at = s === 0 ? h.skidL : h.skidR;
      h.particles.at(at.x, at.y + 0.05, at.z);
      // A hard vertical component and a slight outward splay off each emitter,
      // on top of whatever fraction of the machine's own velocity `jetKeep`
      // says the column should carry.
      h.particles.vel(
        k.velocity.x * keep + _side.x * (s === 0 ? -1.5 : 1.5) - _fwd.x * 1.2,
        k.velocity.y * keep + 6.2 + 0.9 * prof.jet,
        k.velocity.z * keep + _side.z * (s === 0 ? -1.5 : 1.5) - _fwd.z * 1.2);
      h.particles.emitExact(true);
    }
}
