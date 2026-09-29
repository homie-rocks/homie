/**
 * ============================================================================
 *  stripregistry — WHICH emissive line segments a line-light shader gets this
 *  frame, out of the several hundred a world registers.
 * ============================================================================
 *
 *  An analytic line light can afford a fixed handful of segments: the count is
 *  a compile-time array size, so it cannot move without a recompile. A world
 *  that puts an emissive strip on every kerb, rail, ring and door trim
 *  registers hundreds. Something has to pick, every frame, and picking badly is
 *  indistinguishable from the term not existing — which is what this file is a
 *  five-iteration record of.
 *
 *  ## The three things it has got wrong, kept in order
 *
 *  Every one of them made the term invisible at the framing the game was
 *  actually photographed at, and every one of them was the right fix at too
 *  narrow a scope. They are written out at `publish` and they are the reason
 *  this is 400 lines rather than a sort. In summary:
 *
 *    1. NEAREST IS NOT ENOUGH. The N nearest chords of a route are N
 *       consecutive chords of the SAME run, a metre apart, lighting one square
 *       of ground N times.
 *    2. THE FALLOFF IS A LENGTH AND LENGTHS DO NOT TRANSFER. A radius fitted
 *       against a camera 1.5 m off its strips delivers 1/(1+2500) of peak at
 *       120 m.
 *    3. BOTH WERE SIZED OFF ONE NUMBER — the distance to the single nearest
 *       strip, which at a three-quarter framing is behind and below the shot.
 *       Separation is per-pick pool width IN CLIP SPACE now, and the radius is
 *       per slot.
 *
 *  ## Nothing here is a colour and nothing here is a tuned constant
 *
 *  Every number the pick depends on is a field of `StripTuning`, supplied by
 *  the caller: the clip-space separation bounds, the pool width in falloff
 *  radii, the height band inside which two overlapping emitters count as one
 *  job, how many slots are reserved for elevated emitters and how high
 *  "elevated" is, the world separation for off-frame picks, the off-frame
 *  score penalty, and the three coefficients of the radius law. They are
 *  arguments because they were each MEASURED against one game's lens, one
 *  colony's size and one strip population, and a package that carried them
 *  would hand the next game a pick fitted to a place it has never been.
 *
 *  The published values go out through a `StripSink`, so this file never sees
 *  a uniform, a shader or a material. The caller owns those and knows how many
 *  slots it declared.
 *
 *  Arrived from a base-building game's structures module. A parity probe's
 *  `strips` battery drives the pre-move class and this one through the same
 *  camera poses and compares every published float, and separately proves that
 *  CHANGING a tuning field changes the pick — an extracted option welded shut
 *  passes a parity check for ever.
 */
import * as THREE from 'three';
import { workingColor } from './databake.js';

/** A one-member height field. Any terrain with `heightAt` satisfies it. */
export interface StripGround {
  heightAt(x: number, z: number): number;
}

/** One frame of a swept route. Structurally @homie-rocks/geom's `Frame`. */
export interface StripFrame {
  p: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  d: number;
}

/**
 * Where the pick is published. The caller owns the uniforms and therefore owns
 * how many slots exist; this file only ever writes through here.
 */
export interface StripSink {
  readonly slots: number;
  /** Slot `i` carries this segment, in world space, with this radiance colour. */
  set(i: number, a: THREE.Vector3, b: THREE.Vector3, col: THREE.Vector3): void;
  /**
   * Slot `i` has no candidate. An implementation must park it somewhere the
   * shader contributes exactly zero from — NOT leave the last segment lit, and
   * NOT the world origin, which renders as a mystery light in the middle of
   * everything and costs a review to trace.
   */
  park(i: number): void;
  /** Per-slot falloff radius, metres. */
  radius(i: number, r: number): void;
}

export interface StripTuning {
  /** Clip-space separation bounds between two picks. */
  sepNdcMin: number;
  sepNdcMax: number;
  /**
   * How many falloff radii across the part of a pool that READS as lit. Not the
   * four radii the window ends at: attenuation is already down to 0.11 at two,
   * and the tail is not what the eye reads as "the lit patch".
   */
  poolRadii: number;
  /** Height difference below which two overlapping emitters count as one job. */
  liftSame: number;
  /** Slots at the end of the list reserved for emitters mounted on something. */
  liftSlots: number;
  /** Metres above the ground at which an emitter counts as mounted. */
  liftMin: number;
  /** World separation, used only between picks the frustum test could not place. */
  sepWorld: number;
  /** Score multiplier for an off-frame segment. It can still win a slot — it
   *  lights ground that IS in frame — but never ahead of something visible. */
  offFramePenalty: number;
  /** radius = clamp( radiusMin, radiusMax, radiusMin + range * radiusPerMetre ) */
  radiusMin: number;
  radiusPerMetre: number;
  radiusMax: number;
  /** Divisor that turns an emitter's authored weight into a colour scale. */
  weightNorm: number;
  /** Cap on the arc correction. A degenerate triple must not be able to fling a
   *  segment across the world, and no real fixture stands more than a few
   *  metres off the surface it is bolted to. */
  maxSag: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _col = new THREE.Color();
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ─────────────────────────────────────────────────────────────────────────────

interface Strip {
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** `a`/`b` pushed back out onto the arc they were cut from — see `relax`. */
  pa: THREE.Vector3;
  pb: THREE.Vector3;
  col: THREE.Vector3;
  /** Radiance scale, so a tier-1 trim strip does not light like a tier-2 rail. */
  w: number;
  /** Metres above the terrain under it. Decides which slots it may compete for. */
  lift: number;
}

const _lineCam = new THREE.Vector3();
const _arc1 = new THREE.Vector3();
const _arc2 = new THREE.Vector3();

/**
 * Every emissive line in the world, in world space.
 *
 * Road edge strips, tube rails and habitat base skirts all register here, and
 * the two nearest to the camera are published to the shader each frame. One
 * registry rather than one per subsystem is what lets a habitat skirt light the
 * regolith beside it using exactly the code the road uses.
 */
export class StripRegistry {
  private strips: Strip[] = [];
  private lastPick = -1;
  private sink: StripSink;
  private t: StripTuning;
  private terrain: StripGround | null;

  /**
   * `LEGACY_PICK` — the A/B CONTROL ARM, and it is a public field on purpose.
   *
   * Two readings may only be compared when one thing differs between them, and
   * two page loads differ in every PRNG-seeded bake. Setting this reproduces
   * the PREVIOUS selection (world separation off the first pick's distance, one
   * shared falloff radius) inside the SAME page load, so before and after are
   * one write apart on one frozen frame instead of two builds apart.
   *
   * It is deliberately a data flag routed through the same loop rather than a
   * second copy of it: a control arm with its own code path stops being a
   * control the first time only one of them is edited.
   */
  legacy = false;

  /** `terrain` is for the one-off lift sample in `add`. Null before it exists. */
  constructor(terrain: StripGround | null, sink: StripSink, tuning: StripTuning) {
    this.terrain = terrain;
    this.sink = sink;
    this.t = tuning;
  }

  add(a: THREE.Vector3, b: THREE.Vector3, colorHex: number, weight: number) {
    workingColor(colorHex, _col);
    // Height above the ground under the chord's midpoint, sampled ONCE here
    // rather than per frame in `publish`: it is a property of the fixture, the
    // terrain under a placed building does not move, and 900 heightAt calls at
    // seed time is nothing against 900 per frame.
    const my = (a.y + b.y) * 0.5;
    let lift = 0;
    if (this.terrain) {
      const g = this.terrain.heightAt((a.x + b.x) * 0.5, (a.z + b.z) * 0.5);
      if (Number.isFinite(g)) lift = my - g;
    }
    this.strips.push({
      a: a.clone(), b: b.clone(), pa: a.clone(), pb: b.clone(),
      col: new THREE.Vector3(_col.r, _col.g, _col.b).multiplyScalar(weight / this.t.weightNorm),
      w: weight, lift,
    });
    // The arc correction is a function of the whole run, so a new chord
    // invalidates its neighbours' as well. Cleared rather than recomputed: the
    // next `publish` is the only place that needs it and it re-derives in O(n).
    this.arcFor = -1;
  }

  /** Register a whole swept route as chords, one every `every` metres. */
  addRoute(frames: StripFrame[], offset: number, lift: number, colorHex: number, weight: number, every = 9) {
    let last = 0;
    let prev: THREE.Vector3 | null = null;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]!;
      if (i > 0 && f.d - last < every && i !== frames.length - 1) continue;
      last = f.d;
      const p = f.p.clone().addScaledVector(f.right, offset).addScaledVector(f.up, lift);
      if (prev) this.add(prev, p, colorHex, weight);
      prev = p;
    }
  }

  get count() { return this.strips.length; }

  /** Drop every chord. `__seed` must call this or ghost routes from the
   *  previous scenario punch holes in the next boulevard (seen once: a street
   *  scenario seeded after a night one photographed a crater through a 14 m
   *  survey hole). */
  clear() {
    this.strips.length = 0;
    this.arcFor = -1;
    this.lastPick = -1;
  }

  /**
   * Publish the `LINE_N` best segments, and size the falloff to the camera.
   *
   * Nearest by true point-segment distance, not by midpoint: a 9 m chord judged
   * on its midpoint loses to a shorter one further away, and the road under the
   * camera would flicker between strips as it drove.
   *
   * THREE THINGS THIS FUNCTION HAS GOT WRONG IN SUCCESSIVE VERSIONS, all of
   * which made the term invisible at the framing the game is actually
   * photographed at. Kept in order because each fix was right and each was too
   * narrow:
   *
   * 1. NEAREST IS NOT ENOUGH. The six nearest chords of a 440-strip
   *    registry are, essentially always, six consecutive chords of the same run
   *    — a metre apart, lighting the same square of ground six times and
   *    everything else not at all. A minimum separation between picks fixed it.
   *
   * 2. THE FALLOFF IS A LENGTH AND LENGTHS DO NOT TRANSFER. The inherited
   *    1/(1+(d/2.4)^2) was fitted against a camera that lives
   *    1.5 m off its strips; at 120 m it delivers 0.0004 of peak. So the radius
   *    grows with range and the lit pool holds a constant share of the SCREEN.
   *
   * 3. AND BOTH OF THOSE WERE SIZED OFF ONE NUMBER: the distance from the EYE to
   *    the single nearest strip. At the hero pose that strip is 24 m away,
   *    under and behind the framing rather than in it, so the separation came
   *    out at 7.2 m and the radius at 4.94 m — and all ten slots landed in one
   *    55 x 37 m box in the near-foreground corner with a 19.8 m reach each,
   *    across a 400 m colony. Measured: the term was bit-identical at gain 0,
   *    gain 1 and gain 12 on the regolith beside the boulevard AND on the hub
   *    dome shell. Separation is now each pick's own pool width IN CLIP SPACE
   *    and the radius is per slot; see the two blocks inside.
   */
  publish(camera: THREE.Camera) {
    const n = this.strips.length;
    const t = this.t;
    const LINE_N = this.sink.slots;
    camera.getWorldPosition(_lineCam);
    const cam = _lineCam;
    if (n === 0) {
      for (let k = 0; k < LINE_N; k++) this.put(k, -1);
      return;
    }
    if (n !== this.arcFor) this.relax();
    // World -> clip, so the spread test below can be run in SCREEN space. Built
    // from the camera's own matrices rather than from `projectionMatrix *
    // matrixWorldInverse` captured elsewhere: a pose tool writes the camera
    // directly and a stale copy would spread the picks across last frame's
    // view.
    _m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const e = _m4.elements as unknown as number[];

    // Closest approach of every segment, computed once and reused by the
    // separation test. Reallocated only when the registry itself grows, so
    // there is no per-frame allocation in this path.
    if (!this.near || this.near.length < n * 3) this.near = new Float32Array(n * 3);
    if (!this.score || this.score.length < n) this.score = new Float64Array(n);
    if (!this.ndc || this.ndc.length < n * 2) this.ndc = new Float32Array(n * 2);
    if (!this.onScreen || this.onScreen.length < n) this.onScreen = new Uint8Array(n);
    if (!this.pool || this.pool.length < n) this.pool = new Float32Array(n);
    const near = this.near, score = this.score, ndc = this.ndc, onScreen = this.onScreen;
    const pool = this.pool;
    // Half-height of the frustum at unit depth, read off the projection itself:
    // for a perspective matrix element [5] is 1 / tan( fov / 2 ). Taken from
    // the matrix and not from `camera.fov` so a photo-mode FOV change, an
    // orthographic camera or a custom projection cannot leave this silently
    // fitted to 50 degrees — which is the shape of a "test knob wired to
    // nothing", one level down.
    const tanHalf = e[5]! > 1e-6 ? 1 / e[5]! : 0.36;
    for (let i = 0; i < n; i++) {
      const s = this.strips[i]!;
      _v.subVectors(s.pb, s.pa);
      const l2 = _v.lengthSq() || 1e-6;
      _v2.subVectors(cam, s.pa);
      const tt = clamp01(_v2.dot(_v) / l2);
      _v3.copy(s.pa).addScaledVector(_v, tt);
      near[i * 3] = _v3.x; near[i * 3 + 1] = _v3.y; near[i * 3 + 2] = _v3.z;
      // Weighted by radiance so a tier-2 rail outranks a tier-1 trim strip at
      // the same distance — the brighter emitter is the one whose missing pool
      // of light the eye would notice.
      const d2 = _v3.distanceToSquared(cam);
      let sc = d2 / Math.max(0.25, s.w);
      // How big a pool this candidate would draw, in NDC. Same radius law the
      // slot will get if it wins, so the separation test and the falloff can
      // never disagree about how much screen this pick is about to own.
      const dd = Math.sqrt(d2);
      const rr = Math.max(t.radiusMin, Math.min(t.radiusMax, t.radiusMin + dd * t.radiusPerMetre));
      pool[i] = Math.max(t.sepNdcMin, Math.min(t.sepNdcMax,
        (t.poolRadii * rr) / Math.max(1, dd) / tanHalf));

      // Project the closest point by hand rather than through
      // Vector3.applyMatrix4, which divides by w and throws the SIGN away: a
      // segment behind the camera comes back mirrored into the frame and reads
      // as perfectly well framed. The clip w is the only thing that separates
      // "in front" from "behind", so it has to be kept.
      const cw = e[3]! * _v3.x + e[7]! * _v3.y + e[11]! * _v3.z + e[15]!;
      let sx = 9, sy = 9;
      let vis = 0;
      if (cw > 1e-4) {
        sx = (e[0]! * _v3.x + e[4]! * _v3.y + e[8]! * _v3.z + e[12]!) / cw;
        sy = (e[1]! * _v3.x + e[5]! * _v3.y + e[9]! * _v3.z + e[13]!) / cw;
        // A little past the frame edge still counts: a strip just outside the
        // frustum lights ground that is inside it, and the pool is what the
        // frame sees, not the emitter.
        if (sx > -1.25 && sx < 1.25 && sy > -1.25 && sy < 1.25) vis = 1;
      }
      // `__linePick('legacy')` marks every segment off-frame, which routes the
      // whole pick down the world-separation path below and reproduces the
      // previous selection exactly. See that handle for why it is worth
      // carrying.
      if (this.legacy) vis = 0;
      ndc[i * 2] = sx; ndc[i * 2 + 1] = sy;
      onScreen[i] = vis;
      if (!vis) sc *= t.offFramePenalty;
      score[i] = sc;
    }

    // ── THE PICK IS SPREAD ACROSS THE FRAME, NOT ACROSS THE WORLD ─────────────
    //
    // THIS IS THE FIX FOR "THE CYAN STRIPS LIGHT NOTHING AT ANY DISTANCE IN ANY
    // FRAME" — a finding five reviews old.
    //
    // The old separation was a WORLD radius derived from the first pick's
    // distance: sep = clamp( 3, 90, d0 * 0.30 ). At the hero pose the nearest
    // registered strip is 24 m from the eye — it is under and behind the
    // framing, on the apron the camera is standing over, not in the picture — so
    // sep came out at 7.2 m and the ten winners landed inside one 55 x 37 m box
    // in the near-foreground corner. Measured, night/reference: all ten picks in
    // x [-70,-15], z [-75,-38], out of 528 registered segments. The hub dome —
    // the frame's subject, carrying 32 registered ring chords — got none, in any
    // frame, ever.
    //
    // World separation cannot fix that, because "far apart in metres" and "far
    // apart in the picture" are different things under a 190 m three-quarter
    // lens: the whole colony is 400 m across and the ten nearest strips to the
    // eye are always the ones under it.
    //
    // So each pick after the first must stand its own POOL WIDTH away in clip
    // space from every pick already made, at a height that gives it a different
    // job. Ten such discs do not fit inside the 2x2 NDC square, so the ten
    // slots are forced to cover the frame — the foreground kerb, the mid-ground
    // boulevard, the junction, the dome shell — which is exactly the "pool on
    // several different structures" the old comment claimed and the old code
    // could not deliver.
    //
    // Segments that project OFF the frame keep the world test instead, because
    // their NDC is meaningless once they leave the frustum.
    const picked: number[] = this.pickBuf;
    picked.length = 0;
    let sepW = t.sepWorld;
    for (let slot = 0; slot < LINE_N; slot++) {
      // The last t.liftSlots only accept emitters mounted on something — see the
      // note on the constant. `pass` is the fallback: a reserved slot that finds
      // nothing elevated in frame re-runs unrestricted rather than parking dark.
      const reserved = !this.legacy && slot >= LINE_N - t.liftSlots;
      let best = -1, bestS = Infinity;
      for (let pass = 0; pass < (reserved ? 2 : 1) && best < 0; pass++) {
        const wantLift = reserved && pass === 0;
        bestS = Infinity;
        for (let i = 0; i < n; i++) {
          if (score[i]! >= bestS) continue;
          if (wantLift && this.strips[i]!.lift < t.liftMin) continue;
          let ok = true;
          for (let k = 0; k < picked.length; k++) {
            const j = picked[k]!;
            if (onScreen[i] && onScreen[j]) {
              const ex = ndc[i * 2]! - ndc[j * 2]!;
              const ey = ndc[i * 2 + 1]! - ndc[j * 2 + 1]!;
              const sp = 0.5 * (pool[i]! + pool[j]!);
              // AND IN THE SAME HEIGHT BAND. Two emitters that overlap on screen
              // are only redundant if they are doing the same JOB, and height is
              // what separates the jobs: a kerb at ground level lights the
              // ground, a dome ring 14 m up lights the shell, and the two
              // overlap in the picture while lighting entirely different
              // surfaces. Without this the hub dome's apron kerb — one 33.7 m
              // circle at y = 0.17 — sat 0.14 NDC from the ring chords above it
              // and blocked every one of them, so the subject of the frame got a
              // slot at its foot and none on the shell. Raw world Y rather than
              // height-above-terrain: within one overlapping screen
              // neighbourhood the ground under both picks is the same ground.
              const eyH = Math.abs(near[i * 3 + 1]! - near[j * 3 + 1]!);
              if (ex * ex + ey * ey < sp * sp && eyH < t.liftSame) { ok = false; break; }
            } else {
              const dx = near[i * 3]! - near[j * 3]!;
              const dy = near[i * 3 + 1]! - near[j * 3 + 1]!;
              const dz = near[i * 3 + 2]! - near[j * 3 + 2]!;
              if (dx * dx + dy * dy + dz * dz < sepW * sepW) { ok = false; break; }
            }
          }
          if (!ok) continue;
          bestS = score[i]!; best = i;
        }
      }
      if (best < 0) { this.put(slot, -1); continue; }
      if (slot === 0) {
        this.lastPick = best;
        if (this.legacy) {
          // The previous world separation, reproduced exactly for the A/B.
          const dx = near[best * 3]! - cam.x, dy = near[best * 3 + 1]! - cam.y, dz = near[best * 3 + 2]! - cam.z;
          sepW = Math.max(3, Math.min(90, Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.30));
        }
      }
      picked.push(best);
      this.put(slot, best);

      // ── AND THE FALLOFF RADIUS IS NOW PER SLOT ───────────────────────────────
      //
      // The history of this number is worth keeping because every version of it
      // was solving the right problem at the wrong scope. The first shipped a
      // flat 2.4 m, the inherited value, fitted against a camera that lives 1.5
      // m off its strips; at the hero framing that delivers 1/(1+2500) of peak
      // and the term is off. A later one made the radius scale with the camera
      // so the pool holds a constant share of the SCREEN, which is the right
      // idea. Another tightened the ceiling 34 -> 22 m because the reach (four
      // radii, 136 m) was washing the plain.
      //
      // What none of them fixed is that ONE radius was derived from ONE
      // distance: the nearest pick's. Every other slot inherited it. At the hero
      // pose that is 4.94 m — a 19.8 m reach on a slot whose strip is 250 m
      // away, i.e. a pool that lands entirely on ground the frame cannot see.
      // Measured on the shipping build, `__lineGain` 0 / 1 / 12: regolith beside
      // the boulevard 44.63 / 44.63 / 44.64, hub dome shell 37.22 / 37.22 /
      // 37.22. Bit-identical at twelve times the gain.
      //
      // Each slot now sizes its own radius off its own range, with the scaling
      // coefficient and the tightened ceiling unchanged, so the near foreground
      // is numerically identical to the shipping build and only the slots that
      // were contributing nothing change.
      const dx = near[best * 3]! - cam.x, dy = near[best * 3 + 1]! - cam.y, dz = near[best * 3 + 2]! - cam.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const r = Math.max(t.radiusMin, Math.min(t.radiusMax, t.radiusMin + d * t.radiusPerMetre));
      this.sink.radius(slot, r);
      if (slot === 0) this.firstRadius = r;
    }
    // A slot that found no candidate is parked; its radius must be parked too or
    // the next frame's `put` writes a live segment against a stale radius.
    for (let slot = picked.length; slot < LINE_N; slot++) this.sink.radius(slot, t.radiusMin);
    // The previous version gave every slot the first pick's radius. Reproduced
    // here rather than in a second copy of the loop, so the A/B arm cannot
    // drift away from the arm it is supposed to be a control for.
    if (this.legacy) for (let slot = 1; slot < LINE_N; slot++) this.sink.radius(slot, this.firstRadius);
  }

  private near: Float32Array | null = null;
  private score: Float64Array | null = null;
  private ndc: Float32Array | null = null;
  private onScreen: Uint8Array | null = null;
  private pool: Float32Array | null = null;
  private pickBuf: number[] = [];
  /** `strips.length` the arc correction below was last computed for. */
  private arcFor = -1;

  /**
   * ── A CHORD OF A RING IS NOT ON THE RING, AND ON THE HUB DOME THAT IS 2 m ───
   *
   * The hub dome's builder registers each cyan ring as eight chords of a
   * circle, which is the only sane way to feed a segment light from a curve.
   * But a chord cuts INSIDE its arc: for eight chords the midpoint sits r(1 -
   * cos(pi/8)) = 0.076 r below the surface, which on the 26 m hub ring is 2.0 m
   * INSIDE the shell it is supposed to be lighting. Under a convex receiver
   * that is not a small error, it is a sign error — the light ends up behind
   * the surface and contributes exactly zero, which is what the hub shell
   * measured.
   *
   * So every chord is pushed back out onto its own arc. The curvature is
   * recovered from the registry itself: a run is registered as chords that share
   * endpoints, so the circumcircle of (a, b, b-of-the-next-chord) is the arc the
   * chord was cut from, and `sag` is exactly how far it was cut. A straight run
   * gives a circumradius in the thousands and a sagitta in millimetres, so roads
   * and rails pass through this untouched — it is not a special case for domes,
   * it is the general correction with a zero for the straight case.
   *
   * O(n) with a hash of quantised endpoints, run once per registry growth
   * (a scenario seed is one growth, not one per building), never per frame.
   */
  private relax() {
    this.arcFor = this.strips.length;
    const key = (v: THREE.Vector3) =>
      `${Math.round(v.x * 50)},${Math.round(v.y * 50)},${Math.round(v.z * 50)}`;
    const startsAt = new Map<string, number>();
    for (let i = 0; i < this.strips.length; i++) {
      const k = key(this.strips[i]!.a);
      if (!startsAt.has(k)) startsAt.set(k, i);
    }
    for (const s of this.strips) {
      s.pa.copy(s.a); s.pb.copy(s.b);
      const j = startsAt.get(key(s.b));
      if (j === undefined) continue;
      const C = this.strips[j]!.b;
      // Circumcentre of A, B, C in 3D. `ab x ac` is zero for a collinear triple,
      // which is the straight-run case and is guarded by the magnitude test.
      _v.subVectors(s.b, s.a);            // ab
      _v2.subVectors(C, s.a);             // ac
      _v3.crossVectors(_v, _v2);          // abXac
      const den = 2 * _v3.lengthSq();
      if (den < 1e-9) continue;
      _arc1.crossVectors(_v3, _v).multiplyScalar(_v2.lengthSq());
      _arc2.crossVectors(_v2, _v3).multiplyScalar(_v.lengthSq());
      _arc1.add(_arc2).divideScalar(den);         // A -> centre
      _arc2.copy(s.a).add(_arc1);                 // centre
      const R = _arc1.length();
      if (!Number.isFinite(R) || R < 1e-3) continue;
      _arc1.copy(s.a).add(s.b).multiplyScalar(0.5).sub(_arc2);   // centre -> chord mid
      const m = _arc1.length();
      if (m < 1e-4) continue;
      // Capped: a degenerate triple must not be able to fling a segment across
      // the colony, and no real fixture stands more than a few metres off the
      // surface it is bolted to.
      const sag = Math.min(R - m, 4);
      if (sag <= 1e-3) continue;
      _arc1.multiplyScalar(sag / m);
      s.pa.add(_arc1); s.pb.add(_arc1);
    }
  }

  /** The radius slot 0 got. Reported, and reused by the legacy arm. */
  firstRadius = 0;

  private put(slot: number, idx: number) {
    if (idx < 0) {
      this.sink.park(slot);
      return;
    }
    const s = this.strips[idx]!;
    this.sink.set(slot, s.pa, s.pb, s.col);
  }

  /**
   * Everything the REGISTRY knows, for a test. The uniform side belongs to
   * whoever owns the sink and is composed on top of this.
   *
   * A coefficient nobody can read back is a coefficient nobody can check, which
   * is why the arc correction and the elevated count are in here at all.
   */
  stats() {
    return {
      registered: this.strips.length,
      nearest: this.lastPick,
      segments: this.sink.slots,
      /** Largest arc correction in the registry, metres. 0 = every run straight. */
      maxSag: +this.strips.reduce((m, s) => Math.max(m, s.pa.distanceTo(s.a)), 0).toFixed(3),
      /** How many registered strips are mounted on something, i.e. can compete
       *  for the reserved slots. Zero means the reservation is doing nothing and
       *  every slot fell back — which is a fact worth reading, not inferring. */
      elevated: this.strips.reduce((k, s) => k + (s.lift >= this.t.liftMin ? 1 : 0), 0),
      /** Lift of each published slot, so "did a building's own trim win a slot"
       *  is answerable from a test instead of by looking at coordinates. */
      liftOf: this.pickBuf.map((i) => +this.strips[i]!.lift.toFixed(1)),
    };
  }
}
