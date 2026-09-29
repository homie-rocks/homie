/**
 * ============================================================================
 *  lightpool — a FIXED pool of real dynamic lights, handed out by importance.
 * ============================================================================
 *  Every lit scene bigger than the light limit has this problem and there is
 *  one right answer to it, so it belongs here rather than in whichever game
 *  hit the limit first.
 *
 *  THE PROBLEM. `NUM_POINT_LIGHTS` is a program define. Adding a PointLight to
 *  a scene after the pre-warm has run recompiles EVERY material, on whatever
 *  frame the first fixture is placed — the "screen goes black and drops forty
 *  frames" mechanism `Prewarm.ts` in this same package exists to prevent. So
 *  the count can never move, and a base with four hundred emissive fixtures
 *  has to decide which twenty-six of them get a real light this frame.
 *
 *  THE ANSWER, and the three parts of it that are not obvious:
 *
 *   1. SCORE BY SCREEN AREA, NOT BY SUBJECT. The score is authored importance
 *      times an inverse-square relevance from the EYE, softened by a generous
 *      facing cone. Scoring from where the camera is LOOKING was tried in a
 *      base-building game and measured worse — it moved the pool onto the
 *      subject and unlit the foreground, and the foreground is the biggest lit
 *      area in the picture. A shadow cascade's value is texel density on the
 *      subject; a point light's value is how much lit surface it puts in the
 *      frame. Two budgets, two different right answers.
 *
 *   2. HYSTERESIS, OR THE POOL FLICKERS. A challenger has to beat an incumbent
 *      by a factor before it takes the slot, or two fixtures within a percent
 *      of each other trade the slot every re-score.
 *
 *   3. FADE WHERE THE FIXTURE WAS. A slot losing its ticket keeps the position
 *      and colour it held and dims in place from a REMEMBERED intensity. Both
 *      halves matter: slide it to the parking spot and the light streaks
 *      across the scene, and multiply the live intensity down each frame
 *      instead of recomputing it and the curve is much faster than the fade
 *      constant claims.
 *
 *  ── WHAT IS DELIBERATELY NOT IN HERE ────────────────────────────────────────
 *  No discovery. Something has to decide what a fixture IS — a mesh naming
 *  convention, a prop manifest, an emissive-vertex cluster — and that is a
 *  game's business. This owns the pool and the auction, nothing else.
 *
 *  No supply model. `gain` and `supply` are the two hooks a caller drives: a
 *  colony grid brownout, a ship losing power, a district blackout, a dimmer at
 *  dusk. `supply` is called with the ticket and returns 0..1; the default in
 *  every spec must be written by the caller, because a pool that silently
 *  supplies everything is a blackout feature that quietly does nothing.
 *
 *  Arrived from a base-building game's lighting module, which was its only
 *  implementation — a single implementation can still be 100% platform.
 * ============================================================================
 */
import * as THREE from 'three';

/**
 * A fixture's request for a real dynamic light.
 *
 * Mutate `position`, `intensity`, `color` and `importance` in place from your
 * own update; the pool reads them and never writes them. Read `granted` to
 * know whether you also need to draw your faked contribution this frame — you
 * almost always do, because a fixture that only looks lit when it wins a slot
 * pops.
 *
 * THE CONTRACT, STATED PLAINLY: you are expected to light your own
 * surroundings in-material whether or not you win. A real light is a bonus
 * that adds correct falloff onto OTHER objects, not the thing that makes your
 * strip glow. An emissive strip that lights nothing around it is the classic
 * amateur tell in a night scene — and a strip that only lights things when it
 * happens to hold a slot is the same tell, intermittently.
 */
export interface LightTicket {
  readonly id: number;
  /** World position of the fixture. Mutate in place. */
  readonly position: THREE.Vector3;
  /** Linear intensity you want if you get a real light. */
  intensity: number;
  /** Hex colour. */
  color: number;
  /** Cutoff distance in metres. Also drives the score. */
  range: number;
  /** 0..1 authored priority. */
  importance: number;
  /**
   * True if this fixture is wired to a supply that can be cut, i.e. if
   * `supply` is allowed to extinguish it. A vehicle's own headlight, an engine
   * glow or a welding arc is on its own power and is NOT switchable — dimming
   * it during a blackout says the wrong thing about why the frame went dark.
   */
  readonly switchable: boolean;
  /** True when the pool has given this fixture a real PointLight. */
  readonly granted: boolean;
  /** The light, or null. Do not reparent it and do not change its `distance` —
   *  the pool owns those and will overwrite them. */
  readonly light: THREE.PointLight | null;
  /** Give the slot back. Call from your dispose path. */
  release(): void;
}

/**
 * Everything a fixture must state to ask for a light.
 *
 * EVERY FIELD IS REQUIRED AND THERE ARE NO DEFAULTS. A default colour is
 * another game's palette; a default importance is a fixture that has not
 * decided whether it matters and will out-rank one that has. A caller that
 * forgets a field should fail to compile.
 */
export interface LightRequest {
  position: THREE.Vector3;
  color: number;
  intensity: number;
  range: number;
  importance: number;
  switchable: boolean;
}

/** The pool's fixed, boot-time shape. Every field required, same reason. */
export interface LightPoolSpec {
  /** How many real PointLights exist. Fixed for the lifetime of the page. */
  capacity: number;
  /** Frames between re-score/re-assign passes. */
  reallocInterval: number;
  /** Seconds a slot takes to fade fully in or out. */
  reallocFade: number;
  /** A challenger must beat an incumbent's score by this factor to evict it. */
  hysteresis: number;
  /**
   * World Y an unassigned light is parked at. Must be well OUTSIDE the scene's
   * bounding box: the origin is usually inside it, and an unassigned light
   * there with a live cutoff puts a stray glow on whatever is near spawn.
   */
  parkY: number;
  /** Name prefix for the pooled lights, so a scene walk can recognise them. */
  name: string;
}

export interface LightPool {
  /** How many real lights exist at all. Fixed for the lifetime of the page. */
  readonly capacity: number;
  /** How many are currently doing something. For a HUD and for a harness. */
  readonly active: number;
  readonly tickets: readonly LightTicket[];
  /**
   * Global multiplier applied to what a ticket ASKED for.
   *
   * It multiplies rather than being written into the ticket, because a ticket
   * belongs to its fixture, and a fixture that found its own intensity changed
   * underneath it would fight the pool for ownership of the number — a
   * two-owners bug, one frame at a time.
   */
  gain: number;
  /**
   * 1 if this fixture still has supply, 0 if it is out; anything between is a
   * dim. Called during scoring AND during the per-frame transform pass, so it
   * must be cheap and it must be STABLE — a hash that differs between two
   * calls in one frame makes fixtures strobe.
   */
  supply: (t: LightTicket) => number;
  request(spec: LightRequest): LightTicket;
  /**
   * Drive once per frame. Takes the camera rather than a host context because
   * the camera's world position and forward vector are the only two things the
   * auction reads about the world.
   */
  update(camera: THREE.Camera, dt: number): void;
}

interface Slot {
  light: THREE.PointLight;
  ticket: InternalTicket | null;
  /** 0..1 fade, so gaining and losing a slot is never a pop. */
  fade: number;
  /** Intensity the slot held when its ticket left, so the fade-out happens
   *  where the fixture was rather than snapping to the parking spot. */
  lastIntensity: number;
}

interface InternalTicket extends LightTicket {
  granted: boolean;
  light: THREE.PointLight | null;
  slot: number;
  score: number;
  dead: boolean;
}

const _scratch = new THREE.Vector3();
const _fwd = new THREE.Vector3();

class Pool implements LightPool {
  readonly capacity: number;
  active = 0;
  readonly tickets: InternalTicket[] = [];
  gain = 1;
  supply: (t: LightTicket) => number = () => 1;
  private slots: Slot[] = [];
  private nextId = 1;
  private frame = 0;
  private spec: LightPoolSpec;

  constructor(scene: THREE.Scene, spec: LightPoolSpec) {
    this.spec = spec;
    this.capacity = spec.capacity;
    for (let i = 0; i < spec.capacity; i++) {
      // CREATED HERE, AT BOOT, ALL OF THEM, AND NEVER ADDED OR REMOVED LATER.
      // See the header: the light count is a program define.
      const l = new THREE.PointLight(0xffffff, 0, 1, 2);
      l.name = spec.name + i;
      l.castShadow = false;
      l.position.set(0, spec.parkY, 0);
      scene.add(l);
      this.slots.push({ light: l, ticket: null, fade: 0, lastIntensity: 0 });
    }
  }

  request(spec: LightRequest): LightTicket {
    const self = this;
    const t: InternalTicket = {
      id: this.nextId++,
      position: spec.position,
      intensity: spec.intensity,
      color: spec.color,
      range: spec.range,
      importance: spec.importance,
      switchable: spec.switchable,
      granted: false,
      light: null,
      slot: -1,
      score: 0,
      dead: false,
      release() {
        this.dead = true;
        if (this.slot >= 0) {
          const s = self.slots[this.slot]!;
          s.ticket = null;
          s.fade = 0;
          s.light.intensity = 0;
          this.slot = -1;
        }
        this.granted = false;
        this.light = null;
      },
    };
    this.tickets.push(t);
    return t;
  }

  update(camera: THREE.Camera, dt: number): void {
    // Compact released tickets lazily — splicing inside a fixture's own update
    // would invalidate the iteration it was called from.
    if (this.frame % this.spec.reallocInterval === 0) {
      for (let i = this.tickets.length - 1; i >= 0; i--) {
        if (this.tickets[i]!.dead) this.tickets.splice(i, 1);
      }
      this.score(camera);
      this.assign();
    }
    this.frame++;

    // Fades and transforms run EVERY frame, not on the re-score interval: a
    // fixture that moves must track its own light, or the light lags a whole
    // interval behind the thing it belongs to and reads as attached to nothing.
    let active = 0;
    const k = dt > 0 ? Math.min(1, dt / this.spec.reallocFade) : 1;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      const want = s.ticket && !s.ticket.dead ? 1 : 0;
      s.fade += (want - s.fade) * k;
      if (s.ticket) {
        s.light.position.copy(s.ticket.position);
        s.light.color.setHex(s.ticket.color);
        s.light.distance = s.ticket.range;
        s.lastIntensity = s.ticket.intensity * this.gain * this.supply(s.ticket);
        s.light.intensity = s.lastIntensity * s.fade;
        if (s.light.intensity > 1e-4) active++;
      } else if (s.fade > 1e-3) {
        // Fading OUT — see the header's point 3.
        s.light.intensity = s.lastIntensity * s.fade;
      } else {
        s.light.intensity = 0;
        s.lastIntensity = 0;
      }
    }
    this.active = active;
  }

  private score(camera: THREE.Camera): void {
    camera.getWorldDirection(_fwd);
    for (const t of this.tickets) {
      // A fixture with no supply cannot win a slot. Scoring it would rank a
      // light about to be multiplied by zero above a lit one that is not, so
      // the outage would cost the frame TWICE — once where it went dark and
      // once where a slot was lost to it.
      if (t.dead || t.intensity <= 0 || this.supply(t) === 0) { t.score = 0; continue; }
      _scratch.copy(t.position).sub(camera.position);
      const d = _scratch.length();
      // Past the point where the fixture's own cutoff sphere is a few pixels
      // across, a real light is worthless and the faked in-material
      // contribution is indistinguishable at that size anyway.
      const relevance = 1 / (1 + (d / Math.max(4, t.range * 3)) ** 2);
      // Behind the camera is not free: three still evaluates the light for
      // every fragment. A generous cone rather than a strict frustum test,
      // because a light just off-screen is still lighting things that are on it.
      _scratch.divideScalar(Math.max(d, 1e-4));
      const facing = _scratch.dot(_fwd);
      const arc = THREE.MathUtils.smoothstep(facing, -0.45, 0.1);
      t.score = t.importance * relevance * (0.12 + 0.88 * arc) * Math.min(1, t.intensity);
    }
  }

  private assign(): void {
    // Rank. A plain sort is fine: fixture counts are in the hundreds, this runs
    // once per interval, and the alternative (a partial selection) saves
    // microseconds and costs a reader an hour.
    const ranked = this.tickets.filter((t) => !t.dead && t.score > 0);
    ranked.sort((a, b) => b.score - a.score);

    const winners = ranked.slice(0, this.capacity);
    const winnerSet = new Set(winners);

    // Evict incumbents that lost, but only to a clearly better challenger.
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      const t = s.ticket;
      if (!t) continue;
      if (t.dead) { s.ticket = null; t.slot = -1; t.granted = false; t.light = null; continue; }
      if (winnerSet.has(t)) continue;
      const challenger = winners.find((w) => w.slot < 0);
      if (challenger && challenger.score > t.score * this.spec.hysteresis) {
        s.ticket = null; t.slot = -1; t.granted = false; t.light = null;
      } else {
        // Kept on hysteresis. Put it back in the winners so the fill pass below
        // does not hand its slot to someone else.
        winnerSet.add(t);
      }
    }

    for (const w of winners) {
      if (w.slot >= 0) continue;
      const free = this.slots.findIndex((s) => s.ticket === null);
      if (free < 0) break;
      const s = this.slots[free]!;
      s.ticket = w;
      w.slot = free;
      w.granted = true;
      w.light = s.light;
      // Seed the position immediately so the fade-in happens in the right place.
      s.light.position.copy(w.position);
    }
  }
}

/** Allocate the pool. Call once, at boot, before the pre-warm. */
export function createLightPool(scene: THREE.Scene, spec: LightPoolSpec): LightPool {
  return new Pool(scene, spec);
}

/**
 * The district-hash outage every "part of the base went dark" effect wants.
 *
 * A uniform dim is not an outage, and a per-fixture random one salt-and-peppers
 * the scene, which reads as a rendering bug rather than as a shed load. Quantise
 * to a cell so a whole dome's ring or a whole run of road goes together, and
 * hash the CELL rather than the allocation index so the same districts are out
 * every frame, after a rescan, and in two runs of a capture harness.
 *
 * Integer hash — the usual xorshift-multiply mix — so it is exact and identical
 * on every machine. A float hash built out of `sin()` is neither.
 */
export function districtSupply(cell: number, fractionOut: () => number): (t: LightTicket) => number {
  return (t: LightTicket) => {
    const fraction = fractionOut();
    if (fraction <= 0 || !t.switchable) return 1;
    const p = t.position;
    let h = (Math.round(p.x / cell) * 73856093) ^ (Math.round(p.z / cell) * 19349663);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return ((h >>> 8) & 0xffff) / 65536 < fraction ? 0 : 1;
  };
}

// ---------------------------------------------------------------------------
// PriorityLightPool — the SECOND allocator, and why both are in this file
// ---------------------------------------------------------------------------
//
// `LightPool` above scores by screen relevance, keeps a challenger out until it
// beats the incumbent by a factor, and fades a losing slot in place. All three
// of those exist because its tickets are peers: a hundred street fixtures, none
// of which is more important than any other, and the flicker between two of
// them within a percent is the whole problem.
//
// This one is the other shape. Its requests carry an AUTHORED priority and the
// score is priority-major — a landing-pad flood at 400 m beats a doorway lamp
// at 20 m, on purpose, because the pad is the subject. Once a request outranks
// another by construction there is nothing for hysteresis to damp and nothing
// for a fade to hide, and adding them would make an authored ordering
// negotiable. Two different questions, two right answers, and merging them
// compiles and quietly re-lights whichever scene loses.
//
// WHAT IS THE SAME IN BOTH, and is the reason either exists: THE POOL IS
// ALLOCATED ONCE AND NEVER GROWS OR SHRINKS. Light count is part of three's
// program cache key, so adding a light at runtime recompiles every shader in
// the scene and hitches for a second. Unused lights sit at intensity zero,
// parked below the datum. Re-pointing one is free.
//
// Arrived from a base-building game's structures module.
// ---------------------------------------------------------------------------

/**
 * A request to `PriorityLightPool`. Deliberately NOT `LightRequest` above: two
 * interfaces of the same name in one module MERGE in TypeScript rather than
 * collide, so the mistake is a type that silently demands the union of both
 * shapes and reports the error at every unrelated call site.
 */
export interface PriorityRequest {
  pos: THREE.Vector3;
  color: number;
  intensity: number;
  distance: number;
  /** Higher wins when more emitters want a light than the budget allows. */
  priority: number;
}

export class PriorityLightPool {
  readonly group = new THREE.Group();
  private lights: THREE.PointLight[] = [];
  private reqs: PriorityRequest[] = [];
  private cool = 0;

  /**
   * `n` is the pool size and it is AN ARGUMENT, not a quality-tier lookup.
   *
   * The tier→count table is a game's answer (the one this came from uses 8 on
   * High and Ultra, 5 on Medium, 2 on Low, because a scene with 200 point
   * lights runs at 4 fps and looks worse than 8 placed well). Which counts
   * belong to which tier is a budget that differs per game and per panel, and
   * baking one game's table in here is how the next one inherits it.
   */
  constructor(n: number, groupName = 'priority-lights') {
    this.group.name = groupName;
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 60, 2);
      l.position.set(0, -1000, 0);
      l.castShadow = false;   // a shadow-casting point light is six render passes
      this.lights.push(l);
      this.group.add(l);
    }
  }

  request(r: PriorityRequest) { this.reqs.push(r); }

  /** Re-point, at 4 Hz. Nothing is added or removed, ever. */
  update(cam: THREE.Vector3, dt: number) {
    this.cool -= dt;
    if (this.cool > 0 || this.lights.length === 0) return;
    this.cool = 0.25;
    // Score: priority first, then proximity — the 1000 is the separation
    // between the two terms and it is what makes the ordering authored rather
    // than negotiated. See the header on why there is no hysteresis here.
    const scored = this.reqs.map((r) => ({ r, s: r.priority * 1000 - Math.sqrt(r.pos.distanceToSquared(cam)) }));
    scored.sort((a, b) => b.s - a.s);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i]!;
      const pick = scored[i];
      if (!pick) { l.intensity = 0; l.position.set(0, -1000, 0); continue; }
      l.position.copy(pick.r.pos);
      l.color.set(pick.r.color);
      l.distance = pick.r.distance;
      l.intensity = pick.r.intensity;
    }
  }

  /**
   * Drop every pending request and park every real light.
   *
   * WHOEVER RE-SEEDS A WORLD MUST CALL THIS, and it shipped without one.
   * `request()` only appends, so seeding a night scenario and then a daytime
   * one kept the night's pad-flood specs in the list; those win on priority, so
   * the daytime street inherited a 220 m landing wash and its mean luma went
   * 71 → 105. A stale request in a priority-major pool is not a small error.
   */
  reset() {
    this.reqs.length = 0;
    this.cool = 0;
    for (const l of this.lights) {
      l.intensity = 0;
      l.position.set(0, -1000, 0);
    }
  }

  get budget() { return this.lights.length; }
  get requested() { return this.reqs.length; }
  dispose() { this.lights.forEach((l) => l.dispose?.()); }
}
