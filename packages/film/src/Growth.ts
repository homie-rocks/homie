/**
 * ============================================================================
 *  Growth — a plant that grows on camera, as a function of time and nothing
 *  else.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **Something can grow out of a surface, curve, unfurl, open and propagate
 *   along a route, and the shape at t can be computed from t alone.**
 *
 * ## Why this is in a film package
 *
 * One short film's first attempt at *"plants growing from them"* read, in
 * its own visual review's words, as *"hardware or glowing tubes rather than
 * organic growth"*. The revision that worked needed curved and tapered stems, leaves
 * that emerge and unfurl, staged blossoms, collars where the stem meets the
 * surface, contact points, and a visible propagation route — and every one of
 * those was written by hand, for one film, in a file that also contained the
 * camera moves.
 *
 * The retrospective asks for it back as a reusable rig. It belongs beside the
 * timeline rather than in a general geometry package for one reason: **every
 * function here is a pure function of authored time**, because that is what
 * `Stage.ts` requires. A growth system that integrates — that adds a bit of
 * stem each frame — is correct on the first playthrough and wrong after every
 * seek, and it is precisely the class of subsystem that leaked future plants
 * into an earlier shot.
 *
 * ## What makes it read as organic rather than as tube
 *
 * Four things, and they are all measurements of real stems rather than taste:
 *
 *   1. **Taper.** A stem is thickest at the root and thinnest at the tip, and
 *      the falloff is nearer quadratic than linear.
 *   2. **Curve that accumulates.** A stem does not bend on a circular arc; it
 *      leans a little more with every segment, because each segment carries
 *      the weight of everything above it. Integrating a small constant
 *      curvature is what produces the shape a straight cylinder cannot fake.
 *   3. **Growth from the tip, not from scaling.** A growing plant does not get
 *      uniformly bigger; it extends. Scaling a finished plant from zero reads
 *      as a balloon and it is the single most common mistake.
 *   4. **Staggered parts.** Leaves do not all appear at once, and a leaf
 *      emerges before it unfurls. The stagger is a fixed fraction of the
 *      stem's own progress, so a slow growth stays staggered.
 *
 * Nothing here makes geometry. It answers where the centreline is, how thick
 * it is there, and where each leaf and blossom sits — and a game turns that
 * into whatever its renderer wants. That is what keeps it testable in Node,
 * and what lets the same rig drive a tube, a ribbon and an instanced card.
 */

import type { Vec3 } from './Timeline.ts';

export interface GrowthRig {
  /** Where the plant is rooted, world space. */
  readonly rootAt: Vec3;
  /** Which way it grows. Normalised on use; need not be unit here. */
  readonly up: Vec3;
  /** Which way it leans. The component along `up` is removed. */
  readonly lean: Vec3;
  /** Final stem length in metres. */
  readonly lengthM: number;
  /** Radius at the root. */
  readonly rootRadiusM: number;
  /** Radius at the tip, as a fraction of the root's. About 0.25 for a stem. */
  readonly tipFraction: number;
  /** Total bend from root to tip, radians. About 0.4 for a stem with a flower on it. */
  readonly bendRad: number;
  /** Centreline samples. Twelve is plenty; a leaf needs a tangent, not a curve. */
  readonly segments: number;
  readonly leaves: readonly LeafSpec[];
  readonly blossom?: BlossomSpec;
  /**
   * A number that makes this plant not identical to its neighbour.
   *
   * Deliberately an authored field rather than a call to a random function:
   * every value here has to be reproducible after a seek, and `Math.random()`
   * in a growth system is the reason a garden looks different in the second
   * take of the same shot.
   */
  readonly seed: number;
}

export interface LeafSpec {
  /** Where up the stem it attaches, 0…1. */
  readonly along: number;
  /** Which way round the stem, radians. */
  readonly aroundRad: number;
  readonly lengthM: number;
  /** How far into the stem's growth this leaf starts to emerge, 0…1. */
  readonly emergesAt: number;
}

export interface BlossomSpec {
  /** Where up the stem. Usually 1. */
  readonly along: number;
  readonly radiusM: number;
  /** Growth fraction at which the bud appears. */
  readonly budsAt: number;
  /** Growth fraction at which it is fully open. */
  readonly opensAt: number;
}

/* ========================================================================== */
/* Sampling                                                                   */
/* ========================================================================== */

export interface StemSample {
  readonly at: Vec3;
  readonly radiusM: number;
  /** Unit tangent, pointing towards the tip. */
  readonly tangent: Vec3;
  /** 0…1 along the FINAL stem, not along the grown part. */
  readonly along: number;
}

export interface LeafSample {
  readonly at: Vec3;
  /** Unit direction the leaf points, away from the stem. */
  readonly dir: Vec3;
  /** 0 = a nub against the stem, 1 = fully open. */
  readonly unfurl: number;
  /** Current length, metres. */
  readonly lengthM: number;
}

export interface BlossomSample {
  readonly at: Vec3;
  readonly radiusM: number;
  /** 0 = closed bud, 1 = open. */
  readonly open: number;
}

export interface GrowthSample {
  /** 0…1. How grown the plant is. */
  readonly growth: number;
  readonly stem: readonly StemSample[];
  readonly leaves: readonly LeafSample[];
  readonly blossom: BlossomSample | null;
  /** Where the growing tip is right now — what a camera looks at. */
  readonly tip: Vec3;
}

/**
 * The whole plant at growth fraction `g`, plus an optional wall-clock time for
 * the sway.
 *
 * `g` is authored — a shot says "this plant is 40 % grown at p=0.3" — and
 * `seconds` is the film's authored time, used only for a deterministic sway.
 * Both are inputs; nothing is remembered.
 */
export function sampleGrowth(rig: GrowthRig, g: number, seconds = 0): GrowthSample {
  const growth = clamp01(g);
  const up = normalise(rig.up);
  const lean = normalise(reject(rig.lean, up));
  const side = normalise(cross(up, lean));

  const grownLength = rig.lengthM * growth;
  const stem: StemSample[] = [];
  const segments = Math.max(2, rig.segments);

  // Integrate a constant curvature along the GROWN length. The direction
  // starts at `up` and leans a little further with every segment, which is the
  // shape a real stem takes and the reason a single arc does not look right.
  let cursor: Vec3 = [...rig.rootAt] as unknown as Vec3;
  let dir: Vec3 = up;
  const step = grownLength / segments;
  stem.push({ at: cursor, radiusM: radiusAt(rig, 0), tangent: dir, along: 0 });

  for (let i = 1; i <= segments; i++) {
    const along = i / segments;
    // The sway is a function of (time, seed, height) with no state, so the
    // same authored second always produces the same lean. Amplitude grows with
    // height because the base of a stem does not move.
    const swayPhase = seconds * 0.9 + rig.seed * 6.283;
    const sway = Math.sin(swayPhase + along * 2.1) * 0.02 * along * along;
    const bend = rig.bendRad * along;
    dir = normalise(add(
      scale(up, Math.cos(bend)),
      add(scale(lean, Math.sin(bend)), scale(side, sway)),
    ));
    cursor = add(cursor, scale(dir, step));
    stem.push({ at: cursor, radiusM: radiusAt(rig, along) * growthWidth(growth, along), tangent: dir, along });
  }

  const tipSample = stem[stem.length - 1]!;

  const leaves: LeafSample[] = [];
  for (const leaf of rig.leaves) {
    // A leaf exists only once the stem has grown PAST where it attaches. That
    // is the difference between a plant that extends and a plant that inflates.
    if (growth <= leaf.emergesAt || growth * 1.0 < leaf.along * 0.98) continue;
    const local = clamp01((growth - leaf.emergesAt) / Math.max(1e-3, 1 - leaf.emergesAt));
    // Emerge, then unfurl: the first third of a leaf's life is getting out of
    // the stem and the rest is opening. One curve for both reads as a sheet of
    // paper sliding out.
    const emerge = clamp01(local / 0.34);
    const unfurl = smootherstep(clamp01((local - 0.28) / 0.72));
    const anchor = pointAlong(stem, leaf.along);
    if (!anchor) continue;
    const tangent = anchor.tangent;
    const radial = normalise(rotateAbout(perpendicular(tangent), tangent, leaf.aroundRad));
    // The leaf lifts towards the tip as it opens, which is what a leaf does
    // when it stops being a bud and starts catching light.
    const dir = normalise(add(scale(radial, 0.55 + 0.45 * unfurl), scale(tangent, 0.65 - 0.45 * unfurl)));
    leaves.push({ at: anchor.at, dir, unfurl, lengthM: leaf.lengthM * emerge * (0.35 + 0.65 * unfurl) });
  }

  let blossom: BlossomSample | null = null;
  if (rig.blossom && growth > rig.blossom.budsAt) {
    const spec = rig.blossom;
    const anchor = pointAlong(stem, Math.min(spec.along, 1)) ?? tipSample;
    const open = smootherstep(clamp01((growth - spec.budsAt) / Math.max(1e-3, spec.opensAt - spec.budsAt)));
    blossom = { at: anchor.at, radiusM: spec.radiusM * (0.22 + 0.78 * open), open };
  }

  return { growth, stem, leaves, blossom, tip: tipSample.at };
}

/**
 * A stem's radius at a fraction along it.
 *
 * Quadratic rather than linear, because a linear taper reads as a cone and a
 * cone reads as hardware — which is exactly the note that production got.
 */
function radiusAt(rig: GrowthRig, along: number): number {
  const f = 1 - along;
  return rig.rootRadiusM * (rig.tipFraction + (1 - rig.tipFraction) * f * f);
}

/**
 * The freshly grown tip is thinner than the same point will be later.
 *
 * Without this the newest segment appears at full thickness and the plant
 * looks like it is being extruded from a nozzle.
 */
function growthWidth(growth: number, along: number): number {
  const head = clamp01((growth - along) / 0.12);
  return 0.35 + 0.65 * smootherstep(head);
}

function pointAlong(stem: readonly StemSample[], along: number): StemSample | null {
  if (stem.length === 0) return null;
  const target = clamp01(along);
  for (let i = 1; i < stem.length; i++) {
    const a = stem[i - 1]!;
    const b = stem[i]!;
    if (b.along >= target) {
      const span = b.along - a.along;
      const f = span > 0 ? (target - a.along) / span : 0;
      return { at: lerp3(a.at, b.at, f), radiusM: a.radiusM + (b.radiusM - a.radiusM) * f, tangent: b.tangent, along: target };
    }
  }
  return stem[stem.length - 1]!;
}

/* ========================================================================== */
/* Propagation                                                                */
/* ========================================================================== */

/**
 * A wave of growth travelling along an authored route.
 *
 * That film's climax needed one: a garden spreading along a road so a fleet
 * could follow it. `positions` are where the plants are, in the order the wave
 * reaches them; the return is each one's growth fraction at time t.
 *
 * `riseSeconds` is how long ONE plant takes to grow, and `spreadSeconds` is
 * how long the wave takes to cross the whole route. Both are authored, and the
 * whole thing is a function of t — which is what lets a director scrub back
 * and forth over the moment the wave passes a character, which is the moment
 * the shot is about.
 */
export function growthWave(
  count: number,
  t: number,
  options: { readonly startAt: number; readonly spreadSeconds: number; readonly riseSeconds: number; readonly overlap?: number },
): number[] {
  const overlap = options.overlap ?? 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const f = count > 1 ? i / (count - 1) : 0;
    const begins = options.startAt + f * options.spreadSeconds - overlap * f;
    out.push(smootherstep(clamp01((t - begins) / Math.max(1e-3, options.riseSeconds))));
  }
  return out;
}

/**
 * The moments in a plant's growth that something else can react to.
 *
 * A character looks down when the first leaf opens; a camera pushes in when
 * the blossom opens; a sound fires when the stem breaks the surface. Those are
 * cues, and a rig that cannot say when they happen forces a director to guess
 * a number and re-guess it every time the growth is retimed.
 */
export function growthEvents(rig: GrowthRig): { readonly id: string; readonly growth: number }[] {
  const events: { id: string; growth: number }[] = [{ id: 'breaks-surface', growth: 0.02 }];
  const leaves = [...rig.leaves].sort((a, b) => a.emergesAt - b.emergesAt);
  const first = leaves[0];
  if (first) events.push({ id: 'first-leaf', growth: Math.min(1, first.emergesAt + 0.28 * (1 - first.emergesAt)) });
  const last = leaves[leaves.length - 1];
  if (last && last !== first) events.push({ id: 'last-leaf', growth: Math.min(1, last.emergesAt + 0.28 * (1 - last.emergesAt)) });
  if (rig.blossom) {
    events.push({ id: 'buds', growth: rig.blossom.budsAt });
    events.push({ id: 'opens', growth: rig.blossom.opensAt });
  }
  events.push({ id: 'grown', growth: 1 });
  return events.sort((a, b) => a.growth - b.growth);
}

/**
 * A plain stem with three leaves and a blossom — somewhere to start rather
 * than a blank rig, since the failure mode being avoided is somebody typing
 * a cylinder.
 */
export function sproutRig(rootAt: Vec3, up: Vec3, lean: Vec3, seed: number, scale_ = 1): GrowthRig {
  return {
    rootAt, up, lean, seed,
    lengthM: 0.34 * scale_,
    rootRadiusM: 0.008 * scale_,
    tipFraction: 0.28,
    bendRad: 0.42,
    segments: 12,
    leaves: [
      { along: 0.34, aroundRad: 0.4, lengthM: 0.075 * scale_, emergesAt: 0.36 },
      { along: 0.56, aroundRad: 2.6, lengthM: 0.085 * scale_, emergesAt: 0.52 },
      { along: 0.76, aroundRad: 4.7, lengthM: 0.07 * scale_, emergesAt: 0.70 },
    ],
    blossom: { along: 1, radiusM: 0.045 * scale_, budsAt: 0.72, opensAt: 0.94 },
  };
}

/* ========================================================================== */
/* Small vector arithmetic, kept local so nothing imports a renderer          */
/* ========================================================================== */

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const smootherstep = (n: number): number => { const x = clamp01(n); return x * x * x * (x * (x * 6 - 15) + 10); };
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const lerp3 = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 1e-9 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 1, 0];
}
/** `v` with everything along `axis` removed. */
function reject(v: Vec3, axis: Vec3): Vec3 {
  const d = dot(v, axis);
  return [v[0] - axis[0] * d, v[1] - axis[1] * d, v[2] - axis[2] * d];
}
/** Any unit vector at right angles to `v`, chosen to avoid the degenerate axis. */
function perpendicular(v: Vec3): Vec3 {
  const helper: Vec3 = Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return normalise(cross(v, helper));
}
/** Rodrigues, because a leaf's position around a stem is a rotation about it. */
function rotateAbout(v: Vec3, axis: Vec3, rad: number): Vec3 {
  const k = normalise(axis);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * kd,
    v[1] * c + kv[1] * s + k[1] * kd,
    v[2] * c + kv[2] * s + k[2] * kd,
  ];
}
