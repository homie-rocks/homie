import * as THREE from 'three';
import type { DragParticles } from './DragParticles.ts';
import { DECAL_SMUDGE, type Decals } from './Decals.ts';
import type { EffectLights } from './EffectLights.ts';
import type { MoteField } from './Motes.ts';
import type { Plumes } from './Plumes.ts';
import { Rings } from './Rings.ts';
import type { Shimmer } from './Shimmer.ts';
import { Trails } from './Trails.ts';
import { poolBudget, type PoolBudget } from './budget.ts';
import { ContextGuard, FrameFlush, OffScreenTest } from './system.ts';
import { DensityGovernor } from './energy.ts';
import * as signals from './signals.ts';
import * as blast from './blast.ts';
import * as drive from './drive.ts';
import * as wake from './wake.ts';
import type { RacerFx } from './state.ts';

/**
 * ============================================================================
 *  RacerSystem — the effects class both racers ARE.
 * ============================================================================
 *  The two racing games this package was extracted from each carried a
 *  `class Effects implements System`. The EMITTERS moved out first — the wake,
 *  the blasts, the drive loop, the governors, the pooled layers — and what was
 *  left behind in both files afterwards was the same class SKELETON, twice:
 *  the same fifteen fields in the same order, the same `state()`, the same
 *  seven-method public façade for items and projectiles, the same `resize`,
 *  the same five one-line blast delegates, the same `dispose`. Measured with a
 *  pairwise duplication scan on 2026-08-21, that skeleton was still the
 *  largest verbatim overlap left anywhere in the codebase.
 *
 *  WHY A BASE CLASS AND NOT ANOTHER HOST RECORD.
 *
 *  Every other seam in this package is a structural interface plus free
 *  functions, and that is the right shape when the moved thing is a BODY: the
 *  game keeps a name, the package keeps two hundred lines. It is the wrong
 *  shape here, and the arithmetic says so. `attachTrail` is one line of body
 *  behind one line of signature — routing it through a host record leaves the
 *  game holding a forwarding method exactly as long as the thing it forwards
 *  to, so nothing is saved and a hop is added. The skeleton is not a body. It
 *  is state plus the identity of the methods that carry it, and the only way
 *  to hold that in one place is for it to BE one place.
 *
 *  WHAT MAY LIVE HERE, AND WHAT MAY NOT.
 *
 *  Only members that were BYTE-IDENTICAL in the two games, comments included.
 *  Where the two disagreed the member stayed in the game — `updateGain` bills
 *  a radiator rack in one game and not the other, `updateSignals` reads a
 *  different top speed, `init` builds different pools out of the same budget,
 *  `onEvent` answers different events, `updateKart` has a mag-glow pass in one
 *  and nothing in the other. None of that is here and none of it should come
 *  here later without the same test: identical, or a VALUE the subclass
 *  supplies. A `mode` field on this class would be the failure.
 *
 *  THE FRAME SPINE, AND WHY A HOOK IS NOT A MODE FIELD.
 *
 *  `update` and `lateUpdate` are here now, and they are the reason the rule
 *  above is worth restating rather than quietly widening. Measured before they
 *  moved, the kart game's two methods were 93 lines and 86 of them were
 *  byte-identical to the ship game's — comments included. ONE line of
 *  executable code differed in the whole spine (`if (k.boostTime > 0)` in front
 *  of `placePlumes`), and the ship game's other 66 lines were pure INSERTIONS
 *  at five named points: a thermal baseline on a race reset, a camera-velocity
 *  difference, a mag-glow window, a combat pass, and the close of both windows.
 *
 *  That is not two mechanisms that rhyme. It is one frame order with holes in
 *  it, and the holes are what the four `protected` no-op hooks below are —
 *  `onFreshSurface`, `beforeFrame`, `beforeMachines`, `afterMachines`. The
 *  distinction the rule is protecting is intact: a `mode` field would put BOTH
 *  games' behaviour in this file behind a branch, so a change to one could
 *  reach the other. A hook puts NEITHER game's behaviour here — the kart game
 *  overrides none of the four and its subclass is 93 lines shorter; the ship
 *  game overrides all four and every line of what it does is still in its own
 *  file, where a reader looking for the mag-glow window finds it.
 *
 *  The hooks are separate rather than folded together for one reason: the
 *  sequence is observable. `beforeFrame` fires between `setLighting` and the
 *  off-screen build; `beforeMachines` after `lights.begin()`; `afterMachines`
 *  before `lights.end()`. That is exactly where the ship game's insertions sat,
 *  so the extraction reorders nothing, and a parity test grades the whole
 *  sequence — every pool call and every hook, in order — against a
 *  transcription of both games' bodies as they stood before this method
 *  existed.
 *
 *  `Ctx` DOES NOT CROSS THIS SEAM. Two methods used `this.ctx.time` and they
 *  take it from `nowTime()` instead — one abstract method per subclass, which
 *  is the whole of the game state this file can see.
 *
 *  The rest of the class is graded the same way, against a verbatim
 *  transcription of both games' bodies from before this file existed.
 * ============================================================================
 */

/**
 * The machine, as far as the skeleton can see it.
 *
 * The skeleton itself reads exactly two fields — `id`, to key per-machine state
 * by, and `position`, to seed a fresh state's ground plane — and it declares no
 * interface of its own for them, because the methods it forwards to already
 * name what they need. `DriveMachine & WakeMachine` is that list, and both
 * games' machine types satisfy it structurally with no call site changed. Inventing
 * a third, narrower interface here would let the two drift.
 */
export type RacerMachine = drive.DriveMachine & wake.WakeMachine;

/**
 * The context, as far as `initPools` can see it — and it is the whole list.
 *
 * Four fields, and `Ctx` is not one of them. Both games' `Ctx` satisfies this
 * structurally, so neither call site changed and neither game's contract had to
 * grow a member for the package's benefit. A god-object argument here would
 * make this package depend on every field either racer ever adds; naming the
 * four is the difference between a seam and a dependency.
 */
export interface PoolCtx {
  readonly settings: { readonly quality: number; readonly particleDensity: number };
  /** normalised direction TOWARD the key light, for the particle lighting */
  readonly sunDirection: THREE.Vector3;
  readonly width: number;
  readonly height: number;
}

/**
 * The six answers only the game has. See `RacerSystem.initPools`.
 *
 * THERE IS NO OPTIONAL FIELD HERE AND THERE MUST NEVER BE ONE. A game that
 * forgets its bounce colour should fail to compile; a game that silently gets
 * a default inherits the other racer's art direction — the kart game's bounce is
 * a warm `#c98f5a` off tarmac under a low sun and the ship game's is a cold
 * `#2c3947` off a steel deck with no sky at all, and either one standing in
 * for the other would look completely fine in a screenshot.
 */
export interface PoolSpec {
  /** the game's `SURFACE_PROPS[Surface.Road].dustColor` */
  readonly roadDust: THREE.Color;
  /** key, sky and bounce, for `DragParticles.setLighting` */
  readonly sun: THREE.Color;
  readonly sky: THREE.Color;
  readonly bounce: THREE.Color;
  /**
   * The two pools whose CLASS is the game's own: both games subclass this
   * package's `DragParticles` and `Decals` to add their own emitters and their
   * own atlas tiles, so the base can SIZE them and cannot name them.
   */
  makeParticles(addCap: number, alphaCap: number, tile: number): DragParticles;
  makeDecals(decalCap: number, tile: number): Decals;
}

/**
 * The context, as far as the FRAME SPINE can see it — and it is the whole list.
 *
 * Same shape of seam as `PoolCtx` above and for the same reason: both games'
 * `Ctx` satisfies this structurally, so no call site changed and neither game's
 * contract grew a member for this package's benefit. Seven fields, and `Ctx`
 * is still not one of them.
 *
 * `race.state` is a `number` rather than either game's `RaceState`, because a
 * package that names one game's enum has taken sides. The subclass says which
 * ordinal means "the surface is fresh" through `freshPhase`, which is a VALUE
 * and not a mode flag — see `update`.
 *
 * `depthTexture` is OPTIONAL and both games' `Ctx` omits it. Both games read it
 * through a cast — `((ctx as { depthTexture?: THREE.Texture | null })…) ?? null`
 * — with a comment saying the cast was there because the game's `Ctx` is loosely
 * typed rather than because the argument is. Declaring it here is the same read
 * with the cast deleted: a pipeline that publishes the field is picked up, one
 * that does not yields `undefined` exactly as the cast did.
 */
export interface FrameCtx<K> {
  /** seconds since boot */
  readonly time: number;
  readonly camera: THREE.PerspectiveCamera;
  /** the key light, or null before the sky system has built one */
  readonly sun?: { readonly color: THREE.Color; readonly intensity: number } | null;
  /** normalised direction TOWARD the key light */
  readonly sunDirection: THREE.Vector3;
  readonly race?: {
    readonly state: number;
    readonly karts?: readonly K[];
    readonly player?: K | null;
  } | null;
  readonly depthTexture?: THREE.Texture | null;
}

/**
 * What the pooled layers turned away this frame, and how many machines were
 * asking. Every field is REQUIRED and none has a default: a census with a
 * silently-zero column is the same silence it exists to end. See
 * `RacerSystem.census` for what each pool's silence looks like without it.
 */
export interface FxCensus {
  /** how many machines the game had in play when this was read */
  readonly machines: number;
  readonly lights: {
    readonly capacity: number;
    readonly wanted: number;
    readonly granted: number;
    readonly denied: number;
    readonly heldByOwner: number;
    /** placements that took a slot off a machine already lit THIS frame */
    readonly evicted: number;
  };
  readonly trails: {
    readonly capacity: number;
    readonly claimed: number;
    readonly denied: number;
  };
  readonly plumes: {
    readonly capacity: number;
    readonly claimed: number;
    readonly dropped: number;
  };
  /**
   * THE LARGEST POOL, AND THE ONE THIS CENSUS WAS SILENT ABOUT.
   *
   * The particle rings are the largest of the pool sizes nobody varies at run
   * time: 1,200-4,200 additive and 850-3,000 alpha, chosen at boot from a
   * quality tier that device detection picked. They already counted what they
   * turned away — `ParticleRing.refused` existed well before this census, and a
   * third game publishes it — and NEITHER RACER READ IT. The census as first
   * written reported three pools and left out the one that thins the picture
   * first in a crowd.
   *
   * Split by ring rather than summed, because the two are sized independently
   * from two plain numbers handed positionally to one constructor: a summed
   * refusal cannot say which ring is short, and an additive ring refusing hard
   * against a capacity that is obviously the alpha ring's number is exactly the
   * reading that names a transposition.
   */
  readonly particles: {
    readonly capacityAdditive: number;
    readonly capacityAlpha: number;
    readonly refusedAdditive: number;
    readonly refusedAlpha: number;
  };
}

/**
 * The six bus events `racerEvent` answers, STRUCTURALLY.
 *
 * Neither game's `GameEvent` union is imported and neither could be: they are
 * different unions in different files with different members, and the whole
 * point of a structural type here is that this package never learns what else
 * is on either bus. `{ type: string }` is the catch-all arm, and it is what
 * makes `racerEvent` safe to hand an event it has never heard of.
 */
export type RacerEvent<M> =
  | { readonly type: 'drift-spark'; readonly kart: M; readonly tier: number }
  | { readonly type: 'boost'; readonly kart: M; readonly tier: number }
  | { readonly type: 'hop'; readonly kart: M }
  | { readonly type: 'land'; readonly kart: M; readonly impact: number }
  // The livery is asked for STRUCTURALLY on the arm that needs it rather than
  // by widening `RacerMachine`: a machine that never raises a pickup does not
  // have to publish a colour, and a game whose pickup is not a livery colour
  // simply does not route the event here.
  | { readonly type: 'item-pickup'; readonly kart: M & { readonly stats: { readonly color: THREE.Color } } }
  | { readonly type: 'coin'; readonly kart: M }
  | { readonly type: 'finish'; readonly kart: M & { readonly isPlayer: boolean } };

/** What the two sparkle arms look like. Every field required, none defaulted. */
export interface RacerEventInk {
  /** how many grains a pickup throws. The machine's own livery is the colour. */
  pickupGrains: number;
  /** a coin's colour AND its size. Both games call the colour `C_GOLD`. */
  coinColour: THREE.Color;
  coinGrains: number;
}

export abstract class RacerSystem<K extends RacerMachine, F extends RacerFx> {
  protected group = new THREE.Group();

  // NOT `private`, and that is the seam rather than an oversight.
  // TypeScript will not match a `private` field structurally, and
  // @homie-rocks/fx/system.js reads these four plus `fx` off `this` — so the
  // keyword comes off exactly the five seam fields and nothing else,
  // which beats renaming a hundred-odd call sites. Still nobody
  // else's business; see the header of `system.ts`.
  //
  // A subclass narrows these with `declare particles: Particles;` where its own
  // pool adds methods (the ship game's `Decals` paints a mag-skirt footprint).
  // `declare` re-emits nothing, so the field is still initialised exactly once,
  // by the subclass's own `init`.
  particles!: DragParticles;
  trails!: Trails;
  decals!: Decals;
  rings!: Rings;
  protected motes: MoteField | null = null;
  protected shimmer: Shimmer | null = null;
  protected plumes!: Plumes;
  protected lights!: EffectLights;
  protected unsubscribe: (() => void) | null = null;

  fx: F[] = [];
  protected gain = 1;
  /**
   * The frame scaffolding that is not an effect: the emission-density
   * governor, the GL context guard, the off-screen thinning test and the
   * pooled-layer flush. All four were byte-identical in both racers and
   * live once in @homie-rocks/fx/system.js and @homie-rocks/fx/energy.js, with the
   * measurements that sized them.
   */
  readonly density = new DensityGovernor();
  readonly gl = new ContextGuard();
  readonly screen = new OffScreenTest();
  readonly frame = new FrameFlush();
  protected blastLoad = 0;
  protected shimmerAmount = 0;
  protected shimmerTimer = 0;
  protected readonly shimmerPos = new THREE.Vector3();

  /** the three records @homie-rocks/fx reads this class through */
  protected wake!: wake.WakeHost;
  protected blast!: blast.BlastHost;
  protected drive!: drive.DriveEventHost<K, F>;
  /**
   * The per-frame half of the drive loop's seam, refilled once per machine in
   * `updateKart`. One object for the whole class rather than a literal per
   * call: this runs eight times a frame and the fields are live governors on
   * `this`, which a reference cannot be taken to.
   *
   * `dust` is a placeholder here and is overwritten by the subclass's `init`
   * with its own `SURFACE_PROPS[Surface.Road].dustColor`, which is the value
   * both games declared it with. It is then reassigned every frame before
   * `emitDrive` reads it, so the initial value is never drawn — but it is set
   * anyway, because "never read" is a claim about today's call order.
   */
  protected readonly driveFrame: drive.DriveFrame = {
    dt: 0, now: 0, dist: 0, lod: 0, speed: 0, grounded: false,
    dust: new THREE.Color(0xffffff),
    gain: 1, emitScale: 1, signalSpeed: 0, igniteImpulse: 0,
  };

  protected readonly signals = new signals.SignalState();

  /** TEST HOOK. See `DensityGovernor.step` for what it is for. */
  pinDensity: number | null = null;

  /** Which side of the LOD ladder this machine is on; see `lodOf`. */
  protected mobileLod = false;

  protected readonly skidLRef = new THREE.Vector3();
  protected readonly skidRRef = new THREE.Vector3();

  /**
   * THE THREE LIGHTS EVERY PARTICLE IS SHADED BY.
   *
   * These were three `private readonly` fields in each game, and `initPools`'s
   * own note argued for keeping them there: "it also keeps the two lighting
   * colours out of the base's field list, where they would have had to be
   * `protected` in two games for a package's convenience." That was right while
   * nothing here read them. The frame spine does — it OVERWRITES `sunColor`
   * from `ctx.sun` every frame and hands all three to `setLighting` — so they
   * are this class's own working state now, not a convenience.
   *
   * They are still the game's VALUES: `initPools` copies them out of `PoolSpec`,
   * which has no defaults and never will, for the reason stated there. What is
   * white here is white for one call, between construction and `init`.
   *
   * `sunColor` is handed out live — the kart game's wake host holds it as
   * `sun:` and both games' emitters lerp toward it — so it is COPIED INTO
   * rather than reassigned. A `this.sunColor = spec.sun` here would leave every
   * holder pointing at the object the game happened to pass and the per-frame
   * key update writing somewhere nobody reads.
   */
  protected readonly sunColor = new THREE.Color(0xffffff);
  protected readonly skyColor = new THREE.Color(0xffffff);
  protected readonly bounceColor = new THREE.Color(0xffffff);

  /**
   * The frame's clock, latched by `update` and `lateUpdate` before anything
   * else runs. `nowTime()` is the subclass's answer and stays the seam; this is
   * the same number cached for the methods that run BETWEEN frames' worth of
   * game state — the ship game's `resolveStacks` retry budget reads it, and
   * asking the subclass again mid-frame would let the two disagree.
   */
  protected clock = 0;

  /**
   * The race phase this class last saw, so `update` can spot the edge.
   *
   * -1, not either game's `RaceState.Menu`. Both games initialised their own
   * copy of this to `Menu` and `Menu` is 0, which is a legal phase — so the
   * very first frame of a game that boots straight into `Menu` did not count as
   * an edge and one that boots into `Countdown` did. -1 is not a phase in
   * either game, so the first frame is always an edge and the branch below then
   * decides on `freshPhase` alone. Same outcome in both games for every phase
   * either of them can start in; the difference is that the rule no longer
   * depends on a coincidence between two enums this file cannot see.
   */
  protected lastPhase = -1;

  /**
   * WHICH PHASE ORDINAL MEANS "the surface is fresh".
   *
   * `RaceState.Countdown` in both games, and it is abstract rather than
   * defaulted to 1 for the reason `PoolSpec` has no optional field: a game that
   * forgets to say should fail to compile, not silently inherit the other
   * racer's numbering and clear its decals on the wrong frame — or never.
   */
  protected abstract readonly freshPhase: number;

  // -------------------------------------------------------------------------
  //  The two things a subclass has to answer, and the whole of what this class
  //  knows about the game it is in.
  // -------------------------------------------------------------------------

  /** A fresh per-machine effect state; each game constructs its own. */
  protected abstract makeFx(): F;

  /**
   * The game clock, in seconds. `this.ctx.time` in both games — read through a
   * method so the contract itself does not cross the package seam.
   */
  protected abstract nowTime(): number;

  /**
   * BUILD THE POOLS. The whole of `Effects.init` up to the first line the two
   * racers disagreed about, which is the plume stack count.
   *
   * `poolBudget` was already shared and the arithmetic is not what
   * was left over — the WIRING was. Six numbers come out of that call and this
   * is the only place any of them is consumed, and it was written out twice.
   * `addCap` and `alphaCap` are the failure that shape has: two `number`s of
   * the same type handed positionally to one constructor, five lines below a
   * `dens` that goes to three different places. Transpose them in one game and
   * the additive ring gets the alpha-ring's capacity and the alpha ring gets
   * the additive one's — nothing throws, nothing fails to compile, both pools
   * are still plausible sizes, and the only symptom is that in ONE game the
   * boost sparks start evicting each other in a pack while the smoke has
   * headroom it never uses. A parity test injects exactly that transposition
   * as a fault, and it is the reason this is one function.
   *
   * WHY A SPEC RECORD AND NOT SIX ABSTRACT MEMBERS. Every field of `PoolSpec`
   * is something the game answers, and answering it through a record rather
   * than through the class means this method adds NOTHING to the base's
   * contract — it can land with zero consumers and both games still
   * compile, which is the whole shape of a safe extraction here. It also keeps
   * the two lighting colours out of the base's field list, where they would
   * have had to be `protected` in two games for a package's convenience.
   *
   * Returns the budget so a caller that needs a capacity of its own can size
   * against the same six numbers instead of recomputing them.
   */
  protected initPools(ctx: PoolCtx, spec: PoolSpec): PoolBudget {
    // The base declares `driveFrame` with a placeholder colour because it has
    // no surface table; this is the value both games wrote there, restored.
    this.driveFrame.dust = spec.roadDust;
    // WHAT THE TIER BUYS is `budget.ts` — the density curve, the two ring
    // capacities, the atlas tile and the decal capacity, with the mobile
    // fill-rate measurement that sized each of them.
    const budget = poolBudget(ctx.settings.quality, ctx.settings.particleDensity);
    const { dens, mobile } = budget;
    this.density.base = dens;
    this.density.emit = dens;
    this.mobileLod = mobile;

    // The game's three lighting colours become this class's, by VALUE. See the
    // field note: the frame spine overwrites `sunColor` every frame and holders
    // keep the reference, so a copy is the only shape that works.
    this.sunColor.copy(spec.sun);
    this.skyColor.copy(spec.sky);
    this.bounceColor.copy(spec.bounce);

    this.particles = spec.makeParticles(budget.addCap, budget.alphaCap, budget.tile);
    this.particles.density = dens;
    this.particles.setLighting(ctx.sunDirection, this.sunColor, this.skyColor, this.bounceColor);
    this.particles.resize(ctx.width, ctx.height);

    this.trails = new Trails(16, true);
    this.decals = spec.makeDecals(budget.decalCap, budget.tile);
    // 96 segments: the shockwave is now a 5%-thick annulus out at 7 m, and at
    // 64 segments a band that thin is visibly a chain of straight quads.
    // 40, up from 28. The tier-3 drift pulse spawns a ring 6.5 times a second
    // per machine holding the top tier, and three staggered fronts go up on
    // every boost ignition; at 28 a pack fight could evict a boost shockwave
    // before it had finished expanding. A dead instance costs one early-out
    // vertex shader invocation and no fill, and the whole pool is still a
    // single draw.
    this.rings = new Rings(40, 96);
    return budget;
  }

  // ===========================================================================
  //  THE FRAME
  // ===========================================================================
  //  The five methods below are the game's half of the spine. Every one of them
  //  was a `private` method of the SAME NAME and the SAME SIGNATURE in both
  //  racers, and every one of them disagreed between the two — which is exactly
  //  the condition for an abstract member rather than a moved body. What is
  //  shared is the ORDER they run in, and that is what `update` is.
  // ---------------------------------------------------------------------------

  /** The additive budget for this frame. Bills what this game calls bright. */
  protected abstract updateGain(ctx: FrameCtx<K>, dt: number): void;

  /** The three numbers the post chain and the camera read off this layer. */
  protected abstract updateSignals(ctx: FrameCtx<K>, dt: number): void;

  /** Everything one machine emits on a normal frame. */
  protected abstract updateKart(ctx: FrameCtx<K>, k: K, dt: number, now: number): void;

  /** Weather, motes, shimmer — what the world emits with nobody driving. */
  protected abstract updateAmbient(ctx: FrameCtx<K>, dt: number, now: number): void;

  /**
   * Submit this machine's flame, in `lateUpdate`, after physics.
   *
   * CALLED UNCONDITIONALLY, once per machine per frame, and any gate belongs
   * inside the override. The kart game's spine read `if (k.boostTime > 0)` at
   * the call and the ship game's did not, because in one game the plume IS the boost
   * and in the other the engine is always lit — that is a sentence about what a
   * plume means in that game, so it moved into that game's method rather than
   * becoming a predicate on this class.
   */
  protected abstract placePlumes(ctx: FrameCtx<K>, k: K, fx: F, dt: number): void;

  // --- the four holes in the order ------------------------------------------
  //  Empty here on purpose, and empty in the kart game, which overrides none of
  //  them. See the header on why these are hooks and not a mode field.

  /**
   * The race just entered `freshPhase` and the decal layer has been cleared.
   * Anything else that is a DERIVATIVE of per-machine state and would read a
   * step change as an event belongs here — the ship game drops every ship's
   * thermal baseline, because `Race` zeroes `heat` on reset and the radiator
   * bloom differences it.
   */
  protected onFreshSurface(): void {}

  /** Between the lighting update and the off-screen build. */
  protected beforeFrame(_ctx: FrameCtx<K>, _dt: number): void {}

  /** Inside the light window, before any machine has emitted. */
  protected beforeMachines(_ctx: FrameCtx<K>, _dt: number): void {}

  /** Inside the light window, after every machine has emitted. */
  protected afterMachines(_ctx: FrameCtx<K>, _dt: number, _now: number): void {}

  update(ctx: FrameCtx<K>, dt: number) {
    // Nothing this file produces can reach a screen while the context is gone,
    // and emitting into a ring whose GPU mirror does not exist only guarantees
    // that the restore frame has a full buffer's worth of upload to do.
    if (this.gl.lost) return;
    const race = ctx.race;
    const machines = race?.karts;
    const now = ctx.time;
    this.clock = now;
    // Everything emitted this frame is born now, not at last frame's flush.
    this.particles.setTime(now);

    if (race && race.state !== this.lastPhase) {
      // A fresh countdown means a fresh track surface.
      if (race.state === this.freshPhase) {
        this.decals.clear();
        this.onFreshSurface();
      }
      this.lastPhase = race.state;
    }

    if (dt > 0) this.particles.density = this.density.step(dt, this.pinDensity);
    this.updateGain(ctx, dt);
    // Smoke and dust must live in whatever light the sky system is actually
    // producing — including going flat and cool inside the tunnel — so track
    // the key light rather than baking the golden-hour values in.
    if (ctx.sun) {
      this.sunColor.copy(ctx.sun.color).multiplyScalar(Math.min(1.2, ctx.sun.intensity * 0.26));
    }
    this.particles.setLighting(ctx.sunDirection, this.sunColor, this.skyColor, this.bounceColor);
    this.beforeFrame(ctx, dt);

    // Off-screen rivals are thinned on the mobile tiers; see OffScreenTest.
    if (this.mobileLod) this.screen.build(ctx.camera);

    this.lights.begin();
    this.beforeMachines(ctx, dt);
    if (machines) {
      // THE PLAYER SPENDS THE FRAME'S PARTICLE BUDGET FIRST.
      //
      // Both particle layers enforce a hard per-frame spawn ceiling, and it is
      // reached: measured on an emulated phone with the whole field pinned at
      // drift tier 3 and items firing — the worst case the art direction names — the
      // additive layer peaks at 75 spawns against a ceiling of 75 and averages
      // 46. Once the ceiling is spent the layer refuses the rest of the frame,
      // and it was being spent in `karts` order, which is grid order. So under
      // exactly the load where readability matters most, whether the player's
      // own drift shower survived depended on where they happened to be
      // starting from. Emitting the player before the field costs one compare
      // per kart and makes the capped case degrade in the only acceptable
      // direction: the seven rivals thin out, the car you are driving does not.
      const player = race?.player;
      if (player) this.updateKart(ctx, player, dt, now);
      for (let i = 0; i < machines.length; i++) {
        // `!` rather than a skip: this package compiles under
        // `noUncheckedIndexedAccess` and the games do not, so the index is
        // `K | undefined` here and was plain `K` in both bodies this replaces.
        // A hole in the grid is not a state either game can be in, and if one
        // ever were, the old code threw inside `updateKart` on the frame it
        // happened. `if (m)` would turn that into a machine that silently stops
        // emitting — a failure that hides itself.
        const m = machines[i]!;
        if (m !== player) this.updateKart(ctx, m, dt, now);
      }
    }
    this.afterMachines(ctx, dt, now);
    this.lights.end(dt);

    this.updateAmbient(ctx, dt, now);
    this.updateSignals(ctx, dt);
  }

  lateUpdate(ctx: FrameCtx<K>, dt: number) {
    if (this.gl.lost) return;
    const machines = ctx.race?.karts;
    const now = ctx.time;
    this.clock = now;

    // Plumes and the squash pulse are applied after physics has finished
    // writing the chassis for the frame, so the flame is welded to where the
    // exhaust actually ended up rather than to where it was last frame.
    this.plumes.begin();
    if (machines) {
      for (let i = 0; i < machines.length; i++) {
        const k = machines[i]!;   // see the `!` note in `update`
        const fx = this.state(k);
        this.placePlumes(ctx, k, fx, dt);
        this.applySquash(k, fx, dt);
      }
    }
    this.plumes.end(now, this.gain);

    // The five pooled layers, in the one order that works, plus the
    // opportunistic depth-texture pickup. See @homie-rocks/fx/system.js.
    this.frame.run(
      this, now, dt, this.gain,
      ctx.depthTexture ?? null,
      ctx.camera.near, ctx.camera.far);
  }

  // -------------------------------------------------------------------------

  protected state(k: K): F {
    let s = this.fx[k.id];
    if (!s) {
      s = this.makeFx();
      // Seed the ground plane so an event fired before this machine's first
      // update() still puts its sparks somewhere sane.
      s.groundY = k.position.y;
      this.fx[k.id] = s;
    }
    return s;
  }

  resize(w: number, h: number) {
    this.particles?.resize(w, h);
    this.rings?.resize(w, h);
  }

  // -------------------------------------------------------------------------
  // Public API for other systems (projectiles have no transform in the shared
  // contract, so items/AI can drive these directly if they want trails/blasts)
  // -------------------------------------------------------------------------

  /** Attach a ribbon trail. Returns a handle, or -1 if the pool is full. */
  attachTrail(color: THREE.Color, intensity = 1.4, width = 0.5, maxLen = 7): number {
    return this.trails.acquire(width, color, intensity, 0.85, 0.28, 0.3, maxLen);
  }
  moveTrail(h: number, p: THREE.Vector3) { this.trails.push(h, p.x, p.y, p.z); }
  detachTrail(h: number) { this.trails.release(h); }

  /**
   * Soft contact shadow under a dropped pickup, so items read as sitting on the
   * road rather than pasted over it. Cheap: one decal quad. Items own their
   * own transforms, so they must call this — re-lay it when the item moves, or
   * once with a long `life` for something that has settled.
   */
  blobShadow(p: THREE.Vector3, normal: THREE.Vector3, radius = 0.42, life = 1e6) {
    this.decals.blot(p, normal, radius, DECAL_SMUDGE, this.nowTime(), life, 0.55,
      0.05, 0.045, 0.05);
  }

  /** Full explosion at a world point: fireball, smoke, debris, scorch, shake. */
  explodeAt(p: THREE.Vector3, normal: THREE.Vector3, groundY: number, scale = 1) {
    this.explode(p, normal, groundY, scale, this.nowTime());
  }

  /**
   * Hand the smoke layer a scene depth texture to enable true soft particles.
   * Optional: without one we fall back to the analytic ground-plane fade, which
   * already removes the hard intersection line against the road. Pass null to
   * turn the depth comparison back off (e.g. when the target is recreated).
   *
   * The pipeline can also simply publish `depthTexture` on the shared context
   * and we will pick it up automatically each frame.
   */
  setDepthTexture(tex: THREE.Texture | null, near: number, far: number) {
    this.frame.latch(tex);
    this.particles.setDepthTexture(tex, near, far);
    this.rings.setDepthTexture(tex, near, far);
  }

  /**
   * The world-space mouth of engine anchor `s`, and TRUE when there was one.
   *
   * `resolveStacks` — finding the model's own exhaust anchors — was already
   * this class's. Reading the anchor it found was not: both racers wrote
   * out the same twelve lines to turn `fx.stackNode[s]` into a position and an
   * axis, which is a resolver in a package with its only consumer in a game,
   * twice.
   *
   * RESOLVED THROUGH THE LIVE WORLD MATRIX rather than from a cached local
   * offset, and that is the whole reason it is twelve lines and not two: the
   * anchors are children of the BODY, which rolls into corners and pitches
   * under power, and a flame that ignores that detaches from the pipe in
   * exactly the frames the machine is most animated. The anchor's +Z is the
   * exit vector, which is why the axis is the third column of that matrix.
   *
   * IT RETURNS FALSE RATHER THAN FALLING BACK, and the fallback is the reason
   * this is a boolean and not a void. The two games' no-anchor fallbacks are
   * NOT the same and must never become the same: the kart game's is its model's
   * own stack tips on a 2.2 m chassis, and the ship game's note records what
   * happens when a hull 7.6 to 10.2 m long inherits them — the root lands in
   * the middle of the bodywork and the flame is depth-tested out of the frame
   * entirely. The ship game's also offsets along the MACHINE'S OWN UP rather
   * than world +Y, because its deck is over your head twice a lap. One shared
   * fallback is one of those two games with no flame.
   */
  protected anchorMouth(k: K, s: number, out: THREE.Vector3,
                        outAxis?: THREE.Vector3): boolean {
    const fx = this.state(k);
    this.resolveStacks(k, fx);
    const node = fx.stackNode[s];
    if (!node) return false;
    node.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(node.matrixWorld);
    if (outAxis) {
      outAxis.set(
        node.matrixWorld.elements[8], node.matrixWorld.elements[9], node.matrixWorld.elements[10],
      ).normalize();
    }
    return true;
  }

  // ----------------------------------------------------------------- events

  /**
   * The six bus events a RACER answers the same way whatever it is racing.
   *
   * A slide spark, a boost, a hop, a landing, a pickup, a coin and a finish.
   * Each arm is one line and the bodies are already `drive.ts`'s or this
   * class's; what was duplicated is the DISPATCH, and it stood byte-identically
   * in both racers along with the comment above it saying so.
   *
   * `lap` is NOT among them, and the reason is the one this package exists to
   * hold on to. Both games spawn the same ring at the same eight numbers, and
   * the kart game puts it on WORLD UP at `groundY + 0.35` while the ship game
   * puts it on the DECK's own normal — because the ship game already had to fix
   * that exact line once, and on an inverted section, where the deck's normal
   * is world -Y, the world-up version puts the ring 35 cm INSIDE the structure. Merging them
   * either breaks one game's ring or hands the other an argument it has no use
   * for; two lines is not worth either.
   *
   * Returns TRUE when it answered, so the game's own switch runs only on what
   * is left. That shape rather than a shared switch with game hooks in it,
   * because the two games' remaining arms have nothing in common at all: one
   * answers `item-use` and `hit`, the other answers six weapon and thermal
   * events and leaves those two DELIBERATELY EMPTY.
   *
   * `collide` is NOT here, and it is the interesting refusal. Both games draw
   * the same spark burst from the same impulse, but the ship game opens a
   * contact window BEFORE the impulse gate and the kart game resolves its state
   * AFTER it — and the ship game's note says why in terms: a long grinding
   * door-to-door fight is a sequence of very small impulses and is exactly the
   * case the arcs exist for, so gating it would light the shunts and leave the
   * scrape silent. Two orderings that are each correct for their own game is
   * not one arm with a flag.
   *
   * `ink` IS AN ARGUMENT, ALL THREE FIELDS OF IT, and the grain counts are the
   * half that is easy to miss. The colour is obvious — both games name it
   * `C_GOLD` and one of them is cyan — but 18 grains and 12 grains are a LOOK
   * too, and a package that kept them because both games happen to pass the
   * same pair would be handing the third one this package's idea of how big a
   * sparkle is, with parity perfectly green.
   */
  protected racerEvent(e: { readonly type: string }, now: number,
                       ink: RacerEventInk): boolean {
    // ONE cast, here, and the parameter is deliberately the widest thing a bus
    // can hand over. A game's own event union has members this package has
    // never heard of and must never learn; narrowing happens on `type` below,
    // and an event that is not one of the six falls through to `false`.
    const ev = e as RacerEvent<K>;
    switch (ev.type) {
      case 'drift-spark':
        drive.onDriftSpark(this.drive, ev.kart, ev.tier, now);
        return true;
      case 'boost':
        this.boostFlash(ev.kart, ev.tier, now);
        return true;
      case 'hop':
        drive.onHop(this.drive, ev.kart);
        return true;
      case 'land':
        drive.onLand(this.drive, ev.kart, ev.impact, now);
        return true;
      case 'item-pickup':
        this.sparkleBurst(ev.kart.position, ev.kart.stats.color, ink.pickupGrains);
        return true;
      case 'coin':
        this.sparkleBurst(ev.kart.position, ink.coinColour, ink.coinGrains);
        return true;
      case 'finish':
        if (ev.kart.isPlayer) drive.confetti(this.drive, ev.kart.position);
        return true;
      default:
        return false;
    }
  }

  /**
   * What every bus handler has to do before it looks at the event, or null
   * when it must not look at all.
   *
   * NOTHING EMITTED WHILE THE CONTEXT IS GONE CAN EVER REACH A SCREEN. `update`
   * and `lateUpdate` already bail on a lost context, which means `flush` is not
   * running either — so without this the bus kept walking the ring write heads
   * and inflating `frameWrote` for the whole outage, and the first frame back
   * paid for every spawn made during it ON TOP OF the full re-upload the
   * restore already owes.
   *
   * And the clock is re-stamped, because events are raised during the gameplay
   * update, which runs before ours: a burst has to be born NOW rather than at
   * last frame's flush.
   */
  protected beginEvent(): number | null {
    if (this.gl.lost) return null;
    const now = this.nowTime();
    this.particles.setTime(now);
    return now;
  }

  // ---------------------------------------------------------------- wiring

  /**
   * ==========================================================================
   *  THE WIRING OF THE THREE HOST LITERALS, WHICH IS NOT THE SAME THING AS
   *  THEIR CONTENT.
   * ==========================================================================
   *
   * `drive.ts`, `wake.ts` and `blast.ts` are each driven through a host struct,
   * and the struct has two halves that read identically and are not identical
   * at all:
   *
   *   THE ANSWERS — which medium, which tier table, which ordinal is the road,
   *   what colour a plume is, how much slip a shower keeps. Every one of those
   *   is the game's, several of them wear the SAME NAME in both racers with
   *   different values behind it, and hoisting any of them is how one game
   *   inherits the other's look with nothing going red. None of them is here.
   *
   *   THE WIRING — `particles: this.particles`, and twenty arrows whose whole
   *   body is `wake.thing(this.wake, ...the same arguments)`. That half names
   *   nothing, decides nothing, and was written out BYTE-IDENTICALLY in both
   *   racers: 55 of the 71 lines of the ship game's `drive` literal also stood
   *   in the kart game's, and the pool references and the delegations are most of
   *   that. A fix to one had a second place to miss, in a struct nothing
   *   compares.
   *
   * So the three base methods below return the wiring and NOTHING ELSE, and
   * each game spreads its own answers over the top:
   *
   *     this.drive = { ...this.driveBase(), medium: MEDIUM, tierFx: TIER_FX, … };
   *
   * They are deliberately NOT complete hosts, and the return types say so: each
   * is a `Pick`, so TypeScript still demands every remaining field at the call
   * site and a game that forgot its own `plumeColour` does not compile. A base
   * that returned a whole host with defaults would be this package choosing
   * what a plume looks like.
   *
   * `tierFx` is read back off `this.drive` rather than taken as an argument,
   * because the table IS the game's and this method must not hold a copy of it.
   *
   * WHAT IS NOT IN THEM, AND WHY EACH ONE IS NOT:
   *
   *   `shake`      reaches the game's own `ctx`, which this class does not
   *                have. An abstract member would make it this class's problem
   *                and a no-op default would be a plausible default — a silent
   *                fallback that hides a missing answer.
   *   `mouthOf`    reads the CALLING FILE's module-scope scratch vectors, on
   *                purpose: the ship game's note says the no-anchor fallback
   *                needs that file's own `_fwd` and `_side` seeded per call,
   *                and in here they would be a different pair.
   *   `idleExhaust`, `stunFx`
   *                one line each, and each calls a method only that game has.
   *   `slickSpray` the two games are asked separately and `drive.ts` says why.
   *
   * TWO MORE ARE SIZED AND NOT TAKEN, so a later change can start from here. Both are
   * in `updateKart`, which is the per-machine hot path:
   *
   *   the FAR CULL — the range test, the trail release and the three timer
   *   decrements, 8 code lines under 7 lines of trap note, byte-identical in
   *   both racers. Wants `cullFar(k, fx, dt, dist, beyond)` returning true,
   *   with the two range numbers passed rather than inlined and the ship game's
   *   two extra thermal resets staying at the call site.
   *
   *   the DRIVE FRAME fill — 8 lines, byte-identical, and four of the fields it
   *   writes (`gain`, `emitScale`, `signalSpeed`, `igniteImpulse`) are read off
   *   THIS class, which is the tell. Wants `submitDrive(k, fx, frame)`.
   *
   * Twenty lines between them, and they are not taken because proving them
   * means driving a 280-line method whose every local is a marker: the near
   * path needs a real ground query, a real camera distance and a real surface
   * table before it will run at all. The wiring parity test has the machinery;
   * extend its shape rather than start another.
   */
  protected driveBase(): Pick<drive.DriveEventHost<K, F>,
  'particles' | 'decals' | 'rings' | 'trails' | 'lights' | 'skidL' | 'skidR'
  | 'emitSparks' | 'groundPool' | 'tyreSmoke' | 'driftGrit' | 'layStrip'
  | 'surfaceDust' | 'boostPlume' | 'slipstream' | 'rollDust' | 'addSquash'
  | 'tyreSmokePuff' | 'stackCount' | 'ignite' | 'load' | 'state' | 'rearPoints'
  | 'burstSparks' | 'groundPuff' | 'lastStack'> {
    return {
      particles: this.particles,
      decals: this.decals,
      rings: this.rings,
      trails: this.trails,
      lights: this.lights,
      skidL: this.skidLRef,
      skidR: this.skidRRef,
      emitSparks: (at, k, n, tier, side) =>
        wake.emitSparks(this.wake, at, k, this.state(k), n, tier,
          this.drive.tierFx[tier]!, side),
      groundPool: (k, fx, tier) => wake.groundPool(this.wake, k, fx, this.drive.tierFx[tier]!),
      tyreSmoke: (k, fx, at, n, dust, tier) =>
        drive.tyreSmoke(this.drive, k, fx, at, n, dust, tier),
      driftGrit: (k, fx, n, dust, slip) => wake.driftGrit(this.wake, k, fx, n, dust, slip),
      layStrip: (fx, now, strength, widthMul) =>
        wake.layStrip(this.wake, fx, now, strength, widthMul),
      surfaceDust: (k, fx, n, dust, heavy) =>
        wake.surfaceDust(this.wake, k, fx, n, dust, heavy),
      boostPlume: (k, n) => drive.boostPlume(this.drive, k, n),
      slipstream: (k, n, ramp, boosting) =>
        wake.slipstream(this.wake, k, this.state(k), n, ramp, boosting),
      rollDust: (k, fx, n, dust, sr) => wake.rollDust(this.wake, k, fx, n, dust, sr),
      addSquash: (k, impulse) => this.addSquash(k, impulse),
      tyreSmokePuff: (k, fx, n, size) => wake.tyreSmokePuff(this.wake, k, fx, n, size),
      // However many the model published, resolved off the model before
      // answering. A hard-coded pair is how a single-drive machine grew a
      // phantom stack and a triple lost its spine drive.
      stackCount: (k, fx) => { this.resolveStacks(k, fx); return fx.stackCount; },
      ignite: (v) => { this.signals.igniteImpulse = Math.max(this.signals.igniteImpulse, v); },
      load: (v) => { this.blastLoad = Math.max(this.blastLoad, v); },
      state: (k) => this.state(k),
      rearPoints: (k, fx) => this.rearPoints(k, fx),
      burstSparks: (at, n, intensity, channel, fx, k) =>
        blast.burstSparks(this.blast, at, n, intensity, channel, fx, k),
      groundPuff: (k, fx, n, size) => wake.groundPuff(this.wake, k, fx, n, size),
      lastStack: (fx) => Math.max(0, fx.stackCount - 1),
    };
  }

  protected wakeBase(): Pick<wake.WakeHost,
  'particles' | 'decals' | 'skidL' | 'skidR'> {
    return {
      particles: this.particles,
      decals: this.decals,
      skidL: this.skidLRef,
      skidR: this.skidRRef,
    };
  }

  protected blastBase(): Pick<blast.BlastHost,
  'particles' | 'decals' | 'rings' | 'load'> {
    return {
      particles: this.particles,
      decals: this.decals,
      rings: this.rings,
      load: (v) => { this.blastLoad = Math.max(this.blastLoad, v); },
    };
  }

  // -------------------------------------------------------------------------

  protected boostFlash(k: K, tier: number, now: number) {
    drive.onBoostIgnite(this.drive, k, tier, now);
  }

  /** World-space rear contact patches, projected onto the local ground plane. */
  protected rearPoints(k: K, fx: F) { wake.rearPoints(this.wake, k, fx); }

  protected sparkleBurst(at: THREE.Vector3, col: THREE.Color, n: number) {
    blast.sparkleBurst(this.blast, at, col, n);
  }

  protected impactBurst(at: THREE.Vector3, n: THREE.Vector3, now: number, scale: number) {
    blast.impactBurst(this.blast, at, n, now, scale);
  }

  protected explode(at: THREE.Vector3, n: THREE.Vector3, groundY: number, scale: number,
                    now: number) {
    blast.explode(this.blast, at, n, groundY, scale, now);
  }

  /**
   * The default nozzle throat radius, metres, for an anchor whose model does
   * not publish one. The ship game's number; the kart game never reads
   * `stackRadius` at all, so this is a value with one consumer today and it is
   * still a value rather than a constant, because the second consumer will not
   * want a ship's throat.
   */
  protected stackRadiusDefault = 0.26;

  /**
   * FIND THE MODEL'S OWN EXHAUST / ENGINE ANCHORS. Retry, do not latch.
   *
   * Both racers had one of these and they were the same mechanism with one
   * difference that matters: one had been fixed and the other had not, and the
   * note explaining the fix never travelled. The unfixed one
   * set `stacksResolved = true` on its FIRST line and only then went looking,
   * so both failure paths — `k.object` not populated yet, the anchors not
   * published yet — recorded a MISS as an ANSWER, permanently. A kart whose
   * model happens not to be assembled on the frame its effects first run
   * spends the whole race on `stackMouth`'s no-anchor fallback, which is a
   * fixed offset from the chassis origin; that game's own comment records the
   * fallback as "27 cm too far forward and 28 cm too LOW, i.e. inside the rear
   * bodywork" and says it is why a review frame had no flame in it. Silent,
   * per-machine, and able to hit the player and not the rivals on the same run.
   *
   * So the flag is set at the BOTTOM, on success only, and a miss costs one
   * scene-graph walk every half second rather than one per frame per call site.
   *
   * THE LOOKUP IS THE SHIP GAME'S, WHICH IS A SUPERSET. It walks for a published
   * anchor array (`userData.engines`, then the older alias
   * `userData.exhausts`) rather than assuming a depth, falls back to
   * `engine0..3` by name, and falls back again to the `exhaustL` / `exhaustR`
   * pair — which is the whole of what the kart game used to do and is the last
   * link in the chain, so an outside model that only has the names still works.
   * The kart game's model publishes BOTH (`root.userData.exhausts` is the
   * same two `exhaustL`/`exhaustR` anchors), so the nodes it resolves are the
   * nodes it always resolved.
   *
   * The COUNT is the model's. The kart game hard-coded two and its model has two,
   * so nothing about that game changes while its model is intact; a ship
   * may carry one drive or three, and a hard-coded pair
   * invented a phantom stack on the first and dropped the spine drive on the
   * second.
   *
   * Graded by a parity test that drives it against each game's real anchor
   * publication and against a model that is not there yet.
   */
  protected resolveStacks(k: K, fx: F) {
    if (fx.stacksResolved) return;
    if (this.clock < fx.stackTry) return;
    fx.stackTry = this.clock + 0.5;
    fx.stackNode.length = 0;
    fx.stackRadius.length = 0;
    fx.stackCount = 2;
    // `RacerMachine` types `object` non-null and both games still guarded it,
    // because it is populated during boot and this runs from the first frame.
    // The guard stays: it is the failure path the latch used to record as an
    // answer, and typing it away would delete the bug's own evidence.
    const root: THREE.Object3D | null | undefined = k.object;
    if (!root) return;
    // `object` is the physics group; the model root that carries the published
    // array is two levels down inside it, so find it by traversal rather than
    // assuming a depth. One walk, once per machine, at first plume.
    let anchors: THREE.Object3D[] | null = null;
    root.traverse((o) => {
      if (anchors) return;
      const ud = o.userData as { engines?: unknown; exhausts?: unknown };
      const a = (ud.engines ?? ud.exhausts) as THREE.Object3D[] | undefined;
      if (Array.isArray(a) && a.length > 0) anchors = a;
    });
    // Name lookup as the backstop, in the model's own numbering, so a machine
    // assembled without the userData handle still lights its engines.
    if (!anchors) {
      const found: THREE.Object3D[] = [];
      for (let i = 0; i < 4; i++) {
        const n = root.getObjectByName(`engine${i}`);
        if (n) found.push(n);
      }
      if (found.length === 0) {
        const l = root.getObjectByName('exhaustL'), r = root.getObjectByName('exhaustR');
        if (l) found.push(l);
        if (r) found.push(r);
      }
      if (found.length > 0) anchors = found;
    }
    if (!anchors) return;
    const list = anchors as THREE.Object3D[];
    for (let i = 0; i < list.length; i++) {
      const node = list[i]!;
      fx.stackNode.push(node);
      // The model already knows each throat's radius, and using it is what
      // makes a single 0.30 m drive read differently from a pair of
      // 0.26 m ones instead of every ship in the field carrying the same flame.
      const r = (node.userData as { radius?: number }).radius;
      fx.stackRadius.push(typeof r === 'number' && r > 0.02 ? r : this.stackRadiusDefault);
    }
    fx.stackCount = fx.stackNode.length;
    // Only here. A machine that published no anchors keeps `stackCount = 2` and
    // the caller's fallback, and gets asked again in half a second.
    if (fx.stackCount > 0) fx.stacksResolved = true;
  }

  // --- squash & stretch ----------------------------------------------------

  protected addSquash(k: K, impulse: number) {
    const fx = this.state(k);
    fx.squashV += impulse * 26;
  }

  /**
   * Damped spring on a single scalar: negative squashes (flat and wide),
   * positive stretches. We only ever touch `object.scale`, we restore it to
   * exactly identity when the pulse dies, and we never take it over unless we
   * put it there — so a model animator writing scale wins by default.
   */
  protected applySquash(k: K, fx: F, dt: number) { wake.applySquash(k, fx, dt); }

  /**
   * THE OCCUPANCY CENSUS — what the pools turned away, this frame.
   *
   * Every art-direction constant in the picture stack was fitted on one
   * scenario with a fixed cast. This pool is three lights at High and two at
   * Medium "regardless of how many entities want one"; the ribbon pool is
   * sixteen slots; the plume pool is two instances per machine in one racer
   * and three in the other. With every phone a controller, eight players is
   * eight boosting machines contending for three lights, eight ribbons and
   * sixteen-plus flames — and NOT ONE OF THOSE NUMBERS WAS FITTED AGAINST THAT.
   *
   * Every one of those pools loses SILENTLY and correctly. `EffectLights.request`
   * returns without a word; `Trails.acquire` returns -1 and every call site
   * handles it; `Plumes.add` drops the instance rather than resize mid-frame.
   * All three are the right behaviour and all three are unreportable, so the
   * amount of picture a busy scene loses has never been a number anywhere.
   *
   * The same shape of defect was found once before, one layer up: a join
   * screen whose QR code was fine at one person and 1637 points off the bottom
   * at thirty-two, and nothing caught it because every test put at most one
   * person in the scene. A parity test drives these three pools at
   * 1, 2, 4, 8 and 16 claimants and asserts each one REPORTS what it refused.
   *
   * It lives on the base rather than in either game because the base is what
   * owns the pools — which is the whole return on the move: one place to add it
   * and both racers have it, rather than two chances to add it and one to be
   * missed. A game publishes it on its own debug handle; nothing here decides
   * anything from it, and no claim is granted differently because it is read.
   */
  census(machines: number): FxCensus {
    return {
      machines,
      lights: {
        capacity: this.lights ? this.lights.capacity : 0,
        wanted: this.lights ? this.lights.wanted : 0,
        granted: this.lights ? this.lights.granted : 0,
        denied: this.lights ? this.lights.denied : 0,
        heldByOwner: this.lights ? this.lights.heldByOwner : 0,
        evicted: this.lights ? this.lights.evicted : 0,
      },
      trails: {
        capacity: this.trails ? this.trails.capacity : 0,
        claimed: this.trails ? this.trails.claimed : 0,
        denied: this.trails ? this.trails.denied : 0,
      },
      plumes: {
        capacity: this.plumes ? this.plumes.capacity : 0,
        claimed: this.plumes ? this.plumes.claimed : 0,
        dropped: this.plumes ? this.plumes.dropped : 0,
      },
      particles: {
        capacityAdditive: this.particles ? this.particles.additiveCapacity : 0,
        capacityAlpha: this.particles ? this.particles.alphaCapacity : 0,
        refusedAdditive: this.particles ? this.particles.refusedAdditiveLastFrame : 0,
        refusedAlpha: this.particles ? this.particles.refusedAlphaLastFrame : 0,
      },
    };
  }

  /**
   * ORDER, AND THE ONE PLACE IT MOVED.
   *
   * Every call below frees a GPU resource that nothing else here holds, so the
   * order between them is not observable — but a transcription of each game's
   * own `dispose` records what it did, and the test asserts the SET is
   * complete and each member is freed exactly once rather than asserting a
   * sequence that does not matter.
   * A subclass with a pool of its own overrides this, frees it, and calls
   * `super.dispose()`; that is why the kart game's gulls and the ship game's
   * shields now go first instead of in the middle.
   */
  dispose() {
    this.unsubscribe?.();
    this.gl.detach();
    this.particles?.dispose();
    this.trails?.dispose();
    this.decals?.dispose();
    this.rings?.dispose();
    this.motes?.dispose();
    this.shimmer?.dispose();
    this.plumes?.dispose();
    this.lights?.dispose();
    this.group.removeFromParent();
  }
}
