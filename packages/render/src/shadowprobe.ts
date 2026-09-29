/**
 * ============================================================================
 *  shadowprobe.ts — reading a cascade rig off the frame, rather than arguing
 *  about it.
 * ============================================================================
 *
 * ## What these answer
 *
 * A cascaded shadow rig has one question that no screenshot answers and no
 * code review answers either: **which cascade, if any, resolves the piece of
 * ground under a given pixel.** A box that looks generous in the table can miss
 * the whole visible plain, because the boxes are square in LIGHT space and the
 * visible ground is a trapezium in world space, and the two only line up when
 * the camera happens to be looking down the light.
 *
 * `cascade: -1` is the finding worth having: no shadow map covers that ground,
 * so nothing in the world can cast onto it, so it is lit by an unoccludable key
 * and is on average BRIGHTER than the modelled ground nearer the camera. That
 * is a distance-dependent brightening produced by a shadow budget — the inverse
 * of aerial perspective, arriving by the same route — and it is the kind of
 * thing that gets filed as "the distance looks washed out" for several reviews.
 *
 *   `lightBasis`     the two lateral axes a cascade box is measured on
 *   `marchToGround`  a screen ray dropped onto a heightfield
 *   `boxIndexAt`     the shader's own cascade selection test, on the CPU
 *   `screenPoint`    a world point in pixels, and whether it is in frame
 *
 * and the three READINGS those four primitives were written for, each of which
 * had exactly one copy inside one game's lighting file:
 *
 *   `cascadeScreenMap`  a grid over the frame -> which cascade owns each cell
 *   `cascadeColumn`     one column of the frame -> ground distance and cascade
 *   `casterShadowTrace` a named object -> where its shadow lands, on screen
 *
 * ## Why the march and not a plane intersection
 *
 * Intersecting the ray with `y = 0` is the reflex and it is wrong on any world
 * with relief: a point placed at world Y is not a point on that world, and on a
 * basin floor or a crater rim the error is tens of metres of ground distance —
 * which lands the sample in a different cascade and inverts the answer. The
 * march is a secant walk against the caller's own height function, which is the
 * same surface the renderer draws.
 *
 * ## Why every number is the caller's
 *
 * `steps` and `hitEpsilon` trade cost against precision and the right pair
 * depends entirely on the relief: a coarse dune field converges in a dozen
 * iterations, a fissured rim does not converge at all and needs the step
 * ceiling to stop it. `maxDistance` is the caller's world size. There are no
 * defaults, because a default here silently decides how accurate somebody
 * else's measurement is.
 *
 * These read the live rig and write nothing at all, so they are safe to call
 * between two arms of an ablation.
 */
import * as THREE from 'three';
import type { LightBasis } from './cascade.ts';

const UP = new THREE.Vector3(0, 1, 0);
const ALT_UP = new THREE.Vector3(0, 0, 1);

/**
 * The orthonormal basis a directional light's shadow boxes are measured in:
 * `z` along the light, `x` and `y` the two lateral axes.
 *
 * **`dir` is treated as already pointing along the light and is normalised into
 * `out.z`.** The `up` swap at |z.y| > 0.999 is not a nicety — a light straight
 * overhead makes `up × z` degenerate, and the symptom is not a NaN but a basis
 * that flips orientation as the light crosses the zenith, which slides every
 * shadow map sideways by half a box on one frame.
 *
 * Written once here because the same six lines appeared five times inside one
 * game's lighting file — in the snap, in the earth-shadow snap, and once in
 * each of three probes — and the CPU snap and the GLSL bias have to read the
 * SAME basis or the bias points the wrong way and the ground self-shadows.
 */
export function lightBasis(dir: THREE.Vector3, out: LightBasis): LightBasis {
  out.z.copy(dir).normalize();
  const up = Math.abs(out.z.y) > 0.999 ? ALT_UP : UP;
  out.x.copy(up).cross(out.z).normalize();
  out.y.copy(out.z).cross(out.x).normalize();
  return out;
}

/** Allocate a basis. Callers on a per-frame path should hold one and reuse it. */
export function makeLightBasis(): LightBasis {
  return { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() };
}

export interface MarchSpec {
  /** Iteration ceiling. The walk is secant, so this bounds a non-convergence. */
  steps: number;
  /** Converged when |ray.y − height| is under this, world units. */
  hitEpsilon: number;
  /** Give up past this distance along the ray, world units. */
  maxDistance: number;
  /**
   * Fraction of the solved step to actually take. Under 1 damps the overshoot
   * a secant walk gets on concave ground; at 1 a rim can oscillate forever.
   */
  relaxation: number;
}

/**
 * March `dir` from `origin` down onto the surface `heightAt` describes and
 * return the DISTANCE along the ray, not the point — the caller usually wants
 * both the distance (as a reported number) and the point (recomputed into its
 * own scratch), and returning a shared vector invites the second read to be
 * taken after the vector has moved on.
 *
 * A ray that is level or rising returns `null`: there is no ground under it,
 * and a caller that treats "no answer" and "very far away" as the same number
 * is the reason `-1` cascades get reported as sky.
 *
 * A non-finite height ENDS the walk at the distance reached so far rather than
 * throwing or returning null. That is deliberate: a height function outside its
 * own domain has told you where its world stops, and the last position inside
 * it is the honest answer.
 */
export function marchToGround(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  heightAt: (x: number, z: number) => number,
  spec: MarchSpec,
  scratch: THREE.Vector3,
): number | null {
  if (dir.y >= -1e-3) return null;
  let dist = 1;
  for (let k = 0; k < spec.steps; k++) {
    scratch.copy(origin).addScaledVector(dir, dist);
    const h = heightAt(scratch.x, scratch.z);
    if (!Number.isFinite(h)) break;
    const gap = scratch.y - h;
    if (Math.abs(gap) < spec.hitEpsilon) break;
    dist += (gap / Math.max(1e-3, -dir.y)) * spec.relaxation;
    if (dist > spec.maxDistance) break;
  }
  return dist;
}

/** One box in the ladder: a centre in world space and a lateral half-extent. */
export interface ShadowBoxAt {
  centre: THREE.Vector3;
  extent: number;
}

/**
 * Index of the first box in `boxes` that contains `point`, or -1.
 *
 * **This is the shader's own selection test, on the CPU, and it must stay that
 * way.** It compares the point's offset from the box centre on the two LATERAL
 * axes only — not a distance, not a sphere, not a world-space AABB. A probe
 * that used a cheaper test would report coverage the shader does not have, and
 * the whole point of the probe is to be believed about exactly that.
 *
 * First match wins, so `boxes` must be handed over in the same order the shader
 * walks them: near to far.
 */
export function boxIndexAt(
  point: THREE.Vector3,
  boxes: ArrayLike<ShadowBoxAt>,
  basis: LightBasis,
  scratch: THREE.Vector3,
): number {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i] as ShadowBoxAt;
    scratch.copy(point).sub(b.centre);
    if (Math.abs(scratch.dot(basis.x)) <= b.extent
      && Math.abs(scratch.dot(basis.y)) <= b.extent) return i;
  }
  return -1;
}

/** A world point in device pixels, with whether it is actually on screen. */
export interface ScreenPoint { x: number; y: number; inFrame: boolean }

/**
 * Project `point` to pixels in a `width × height` frame.
 *
 * `inFrame` tests `z < 1` as well as the two lateral bounds, because a point
 * BEHIND the camera projects to a perfectly plausible pixel coordinate — often
 * a central one — and a probe that reported it as visible would put a caster's
 * shadow tip in the middle of a frame it is nowhere near.
 */
export function screenPoint(
  point: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number,
  scratch: THREE.Vector3,
): ScreenPoint {
  scratch.copy(point).project(camera);
  return {
    x: Math.round((scratch.x + 1) * 0.5 * width),
    y: Math.round((1 - scratch.y) * 0.5 * height),
    inFrame: Math.abs(scratch.x) <= 1 && Math.abs(scratch.y) <= 1 && scratch.z < 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The three readings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything a reading needs, gathered once by the caller.
 *
 * `basis` is passed in rather than derived from a light because a probe called
 * mid-frame must not move the axes the live snap owns — the caller holds a
 * SECOND basis for this and fills it with `lightBasis` before calling.
 *
 * `boxes` must be near-to-far, the order the shader walks them; `heightAt` and
 * `march` are the caller's surface and its convergence budget, for the reason
 * the header gives.
 */
export interface ProbeView {
  camera: THREE.Camera;
  scene: THREE.Object3D;
  /** Frame size in device pixels. */
  width: number;
  height: number;
  boxes: ArrayLike<ShadowBoxAt>;
  basis: LightBasis;
  heightAt: (x: number, z: number) => number;
  march: MarchSpec;
}

export interface CascadeScreenMap {
  /** One entry per cell, row-major from the top-left. A cascade index, or 's'. */
  rows: (number | string)[][];
  /** Cell counts keyed by cascade index, plus `sky`. */
  hist: Record<string, number>;
  /** Share of the GROUND-BEARING cells each cascade resolves, 3 decimal places. */
  frac: Record<string, number>;
  groundCells: number;
}

/**
 * Which cascade owns which part of the picture, as a histogram over a grid.
 *
 * A single column (`cascadeColumn` below) is enough to find "the far plain is
 * past every cascade" and is NOT enough to find how much of the frame a given
 * map resolves, because the boxes are square in LIGHT space and are not centred
 * on the camera: one column can sit in the strip that happens to be covered
 * while the rest of the frame is two cascades coarser.
 *
 * `frac` is the number that decides whether a metre-scale caster can throw a
 * readable shadow anywhere a reviewer is looking, because the shadow's width on
 * the ground has to beat that cascade's texel plus its PCF radius.
 *
 * Reads the live rig and writes nothing, so it is safe between two arms of an
 * ablation.
 */
export function cascadeScreenMap(view: ProbeView, nx: number, ny: number): CascadeScreenMap {
  const cam = view.camera;
  const dir = new THREE.Vector3();
  const p = new THREE.Vector3();
  const d = new THREE.Vector3();
  const rows: (number | string)[][] = [];
  const hist: Record<string, number> = {};
  let ground = 0;
  for (let j = 0; j < ny; j++) {
    const row: (number | string)[] = [];
    for (let i = 0; i < nx; i++) {
      dir.set(-1 + (2 * (i + 0.5)) / nx, 1 - (2 * (j + 0.5)) / ny, 0.5)
        .unproject(cam).sub(cam.position).normalize();
      const dist = marchToGround(cam.position, dir, view.heightAt, view.march, p);
      if (dist === null) { row.push('s'); hist.sky = (hist.sky ?? 0) + 1; continue; }
      p.copy(cam.position).addScaledVector(dir, dist);
      const c = boxIndexAt(p, view.boxes, view.basis, d);
      row.push(c);
      ground++;
      hist[String(c)] = (hist[String(c)] ?? 0) + 1;
    }
    rows.push(row);
  }
  const frac: Record<string, number> = {};
  for (const k of Object.keys(hist)) {
    // `hist[k]` is defined by construction — `k` came out of `Object.keys(hist)`.
    if (k !== 'sky') frac[k] = +((hist[k] as number) / Math.max(1, ground)).toFixed(3);
  }
  return { rows, hist, frac, groundCells: ground };
}

/** One sample down the column. `ground: null` means the ray never hit. */
export interface ColumnSample {
  ndcY: number;
  ground?: null;
  screenY?: number;
  distM?: number;
  cascade?: number;
}

/**
 * How far into the picture cast shadows reach at all.
 *
 * Walks a column of screen points, drops each onto the surface, and reports the
 * ground distance and WHICH cascade contains it. `cascade: -1` is the finding —
 * see the header.
 *
 * `ndcLo`/`ndcHi` are the caller's, because where the horizon sits in the frame
 * is a composition fact about that game and a default here would silently
 * decide which part of somebody else's picture got measured.
 */
export function cascadeColumn(
  view: ProbeView, samples: number, ndcLo: number, ndcHi: number,
): ColumnSample[] {
  const cam = view.camera;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const rows: ColumnSample[] = [];
  for (let i = 0; i < samples; i++) {
    const ndcY = ndcLo + ((ndcHi - ndcLo) * i) / (samples - 1);
    const dir = new THREE.Vector3(0, ndcY, 0.5).unproject(cam).sub(cam.position).normalize();
    const dist = marchToGround(cam.position, dir, view.heightAt, view.march, a);
    if (dist === null) { rows.push({ ndcY: +ndcY.toFixed(2), ground: null }); continue; }
    a.copy(cam.position).addScaledVector(dir, dist);
    rows.push({
      ndcY: +ndcY.toFixed(2),
      screenY: Math.round((1 - ndcY) * 0.5 * view.height),
      distM: +dist.toFixed(0),
      cascade: boxIndexAt(a, view.boxes, view.basis, b),
    });
  }
  return rows;
}

/** One traced caster. See `casterShadowTrace` for why `casting` is not enough. */
export interface ShadowTraceRow {
  name: string;
  heightM: number;
  meshes: number;
  casting: number;
  flagged: number;
  runOutM: number;
  base: ScreenPoint;
  mid: ScreenPoint & { cascade: number };
  tip: ScreenPoint & { cascade: number };
  cascadeAtCaster: number;
}

/**
 * WHERE DOES THIS THING'S SHADOW ACTUALLY GO?
 *
 * Substring match on object names, one row per match: the shadow's run-out on
 * flat ground, where its base, midpoint and tip project on screen, whether each
 * is in frame, and which cascade resolves each. `onScreen: false` on the tip is
 * a COMPOSITION finding, not a bug.
 *
 * THIS EXISTS BECAUSE ONE WRONG BUG REPORT COST THREE REVIEWS. "The two 50 m
 * ships cast no shadow at all in the hero frame" was written by one review,
 * repeated by the next, and carried into a third as an open bug with
 * four hypotheses attached, all four about the CASTER. Every one was wrong: the
 * shadow was there and 33 counts deep, and at that framing the sun's azimuth
 * threw its tip to screen x 3373 of a 1920-wide frame. A reviewer reading the
 * picture called two thousand pixels of a 210 m shadow zero — reasonably. The
 * answer to "why can't I see X's shadow" is a geometry question; this returns
 * the geometry.
 *
 * BOTH COUNTS ARE RETURNED AND THAT IS THE POINT. `casting` requires
 * `castShadow && visible`; a static-batch merger that rewrites `.visible` on
 * the source meshes every frame therefore reports `casting: 0` for a group
 * whose shadow is in the picture, and a reviewer read exactly that number and
 * filed "not one dome has a cast shadow". `flagged` is the same count WITHOUT
 * the visibility term — the question the caller meant. `flagged > 0, casting
 * === 0` is the batcher holding the source mesh, not a missing flag.
 *
 * `lightDir` points ALONG the light. `view.basis` must already have been filled
 * from it.
 */
export function casterShadowTrace(
  view: ProbeView, lightDir: THREE.Vector3, match: string,
): ShadowTraceRow[] {
  const sun = new THREE.Vector3().copy(lightDir).normalize();
  // Run-out per metre of caster height, on flat ground.
  const cot = Math.sqrt(Math.max(0, 1 - sun.y * sun.y)) / Math.max(sun.y, 1e-4);
  const flat = new THREE.Vector3(-sun.x, 0, -sun.z).normalize();
  const cam = view.camera;
  const scratch = new THREE.Vector3();
  const cascadeAt = (p: THREE.Vector3) => boxIndexAt(p, view.boxes, view.basis, scratch);
  const screen = (p: THREE.Vector3) => screenPoint(p, cam, view.width, view.height, scratch);
  const rows: ShadowTraceRow[] = [];
  view.scene.traverse((o) => {
    if (typeof o.name !== 'string' || o.name.length === 0) return;
    if (o.name.indexOf(match) < 0) return;
    const box = new THREE.Box3().setFromObject(o);
    if (box.isEmpty()) return;
    let meshes = 0;
    let casting = 0;
    let flagged = 0;
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh !== true) return;
      meshes++;
      if (m.castShadow) flagged++;
      if (m.castShadow && m.visible) casting++;
    });
    const base = new THREE.Vector3(
      (box.min.x + box.max.x) * 0.5, box.min.y, (box.min.z + box.max.z) * 0.5);
    const height = box.max.y - box.min.y;
    const tip = new THREE.Vector3().copy(base).addScaledVector(flat, height * cot);
    const mid = new THREE.Vector3().copy(base).addScaledVector(flat, height * cot * 0.5);
    rows.push({
      name: o.name,
      heightM: +height.toFixed(1),
      meshes,
      casting,
      flagged,
      runOutM: +(height * cot).toFixed(1),
      base: screen(base),
      mid: { ...screen(mid), cascade: cascadeAt(mid) },
      tip: { ...screen(tip), cascade: cascadeAt(tip) },
      cascadeAtCaster: cascadeAt(base),
    });
  });
  return rows;
}
