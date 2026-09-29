/**
 * ============================================================================
 *  Field.ts — a regular grid of heights, and the four questions asked of one.
 * ============================================================================
 *
 *  WHAT WAS HERE BEFORE, MEASURED 2026-08-21.
 *
 *  One game's terrain module contained the SAME EIGHT LINES OF BILINEAR FETCH
 *  five times — height, occlusion, ray, far-field occlusion and a coarse
 *  cache inside the occlusion bake — at four different grid pitches, plus two
 *  nearest-post fetches. Two other games had a sixth and a seventh copy. A
 *  file-level duplication check could not see them, because five of the seven
 *  are in one file. That is the argument for asking "does this belong in a
 *  game" rather than "is there a twin".
 *
 *  WHY THE COORDINATE IS CLAMPED AND NOT THE CELL, which is the one real
 *  decision in this file. Clamping `fx` to `[0, n - 1.001]` before truncating
 *  makes the edge post's value EXTEND outward forever. Clamping the CELL index
 *  instead and letting `tx` run past 1 makes the edge gradient EXTRAPOLATE, so
 *  a query a kilometre off the map returns a height a kilometre of slope away
 *  — which is a cliff nobody authored and, on a walkable field, a figure that
 *  falls through the world. Both forms were live in the games this was
 *  extracted from (two clamped the coordinate; one clamped the cell) and this
 *  package publishes exactly one of them. `1.001` rather than `1` because at
 *  exactly `n - 1` the truncation yields the last post and `r0 + 1` walks off
 *  the row into the next one.
 *
 *  THE ARITHMETIC IS BIT-EXACT WITH WHAT IT REPLACED, checked against the
 *  pre-move source with `Object.is`, no epsilon, and -0 distinct from 0.
 *  A heightfield is pure arithmetic over a seed, so anything softer than that
 *  would be a choice. Terrain that is NEARLY right puts a figure inside a
 *  hill.
 *
 *  NO `three` IMPORT ANYWHERE IN THIS MODULE. A height is a number and a grid
 *  is a typed array; the renderer belongs in `Mesh.ts`, which is a separate
 *  file so that a Node harness, a server or a probe can ask what is under a
 *  point without standing up a scene graph.
 * ============================================================================
 */

/**
 * The one question anything standing on terrain asks.
 *
 * DECLARED HERE AND NOWHERE ELSE. It used to live in `@homie-rocks/geom/route.ts`,
 * which is backwards — a route SAMPLES a terrain, it does not define what one
 * is — and `route.ts` now re-exports this declaration so that every existing
 * `import type { HeightField } from '@homie-rocks/geom/route.js'` is unchanged and
 * there is still exactly one declaration.
 */
export interface HeightField {
  heightAt(x: number, z: number): number;
}

/**
 * The level to found a footprint on: the LOWEST of a centre sample and a ring
 * of `samples` around it at `radius`.
 *
 * ── WHY THE LOWEST AND NOT THE MEAN, AND NOT THE CENTRE ─────────────────────
 * A rigid body positioned from ONE height sample leaves the surface by whatever
 * the relief does across its own footprint — measured in one game at 36.8 m
 * over a 272 m arc. The mean is worse than it sounds: it puts half the
 * footprint above ground, and a gap under a building is the failure a person
 * sees instantly while a buried plinth is one nobody notices. Every generator
 * that uses this carries a plinth or skirt below its own origin, so founding
 * LOW buries a little on the high side and never leaves daylight on the low
 * side. Nothing floats.
 *
 * ── WHAT THE CALLER OWNS ────────────────────────────────────────────────────
 * The radius and the sample count, and the radius is usually an INSET of the
 * real footprint rather than the footprint itself — probing on the exact
 * perimeter catches the lip of whatever grading pass just ran. How far inside
 * is a property of that grading pass, so it binds at the call.
 *
 * Twelve samples is not a default here for the same reason: a long thin
 * building wants more, and a mast wants none at all.
 */
export function footprintFloor(
  f: HeightField, x: number, z: number, radius: number, samples: number,
): number {
  let y = f.heightAt(x, z);
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    y = Math.min(y, f.heightAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius));
  }
  return y;
}

/**
 * Clamped bilinear fetch, in POST coordinates.
 *
 * `fx`/`fz` are grid-post units, not metres: the caller converts. That split
 * is deliberate and it is what makes this bit-exact for every consumer —
 * one game writes `(x + HALF) / STEP`, another writes `x / STEP + RES / 2`,
 * and those two expressions are NOT the same floating-point number even when
 * they describe the same grid. Owning the conversion here would have silently
 * moved the second game's floor by an ulp; owning the fetch moves nothing.
 *
 * `buf` is row-major, `n` posts per side, index `j * n + i`.
 */
export function bilinear(buf: ArrayLike<number>, n: number, fx: number, fz: number): number {
  const cx = fx < 0 ? 0 : fx > n - 1.001 ? n - 1.001 : fx;
  const cz = fz < 0 ? 0 : fz > n - 1.001 ? n - 1.001 : fz;
  const i = cx | 0, j = cz | 0;
  const tx = cx - i, tz = cz - j;
  const r0 = j * n + i, r1 = r0 + n;
  const a = buf[r0]!, b = buf[r0 + 1]!, c = buf[r1]!, d = buf[r1 + 1]!;
  const p = a + (b - a) * tx;
  const q = c + (d - c) * tx;
  return p + (q - p) * tz;
}

/**
 * Clamped bilinear fetch over a RECTANGULAR `w x h` grid, in post coordinates.
 *
 * ── THIS IS A DIFFERENT FUNCTION FROM `bilinear`, NOT A GENERALISATION ─────
 *
 * `bilinear` clamps the COORDINATE to `n - 1.001`; this clamps the CELL to
 * `w - 2` and then clamps the fraction to [0, 1]. At the far edge they return
 * different numbers — `bilinear` gives 0.999 of the way from post `n-2` to
 * post `n-1`, this gives post `w-1` exactly — and past the edge this extends
 * the last post flat while `bilinear` extrapolates the last cell's slope by
 * one thousandth. Both are defensible; they are not interchangeable, and
 * swapping either for the other moves a world's far-field terrain.
 *
 * The file header enumerates the forms that were live — two games clamped the
 * coordinate, one clamped the cell. That survey MISSED A THIRD, in a racing
 * game's world code. This is that third form, published rather than
 * assimilated, so no existing consumer moves by a ulp to make one signature
 * do.
 *
 * `buf` is row-major, index `j * w + i`. `fx`/`fz` are post units; the caller
 * converts, for the reason `bilinear` states.
 */
export function bilinearRect(
  buf: ArrayLike<number>, w: number, h: number, fx: number, fz: number,
): number {
  let i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0) i = 0; else if (i > w - 2) i = w - 2;
  if (j < 0) j = 0; else if (j > h - 2) j = h - 2;
  const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
  const r0 = j * w + i, r1 = r0 + w;
  const top = buf[r0]! + (buf[r0 + 1]! - buf[r0]!) * u;
  const bot = buf[r1]! + (buf[r1 + 1]! - buf[r1]!) * u;
  return top + (bot - top) * v;
}

/**
 * Bake a square field by sampling every `step`th cell and HOLDING the answer
 * across the block it stands for.
 *
 * The reason this exists rather than a plain double loop is that the sampler is
 * the expensive half and its cost is not knowable here: one racing game's shore
 * field asks a bilinear table 83 k times when the track publishes one and a
 * full surface probe 9 k times when it does not, and the two want different
 * grids for the same field. Sub-sampling with a block hold is how one bake
 * serves both, and it is exactly the loop a caller writes wrong — the inner
 * fill has to clamp against `res` or the last row of blocks runs off the end.
 *
 * @param at    the value at cell `(i, j)`; the caller owns the world mapping,
 *              because where a grid's origin is is a fact about that world
 * @param out   `res * res`, row-major, index `j * res + i`
 */
export function blockBake(
  res: number, step: number, at: (i: number, j: number) => number, out: Float32Array,
): Float32Array {
  for (let j = 0; j < res; j += step) {
    for (let i = 0; i < res; i += step) {
      const y = at(i, j);
      for (let jj = j; jj < Math.min(res, j + step); jj++)
        for (let ii = i; ii < Math.min(res, i + step); ii++) out[jj * res + ii] = y;
    }
  }
  return out;
}

/**
 * Nearest-post index, clamped.
 *
 * Deliberately NOT bilinear, and the two callers that use it say why in their
 * own words: a per-cell CLASSIFICATION (what kind of ground is this, how much
 * blocky ejecta is here) has no meaningful value halfway between two cells,
 * and interpolating a category is how a cell gets a kind that is not in the
 * enum.
 */
export function nearestIndex(n: number, fx: number, fz: number): number {
  const i = Math.round(fx), j = Math.round(fz);
  const ci = i < 0 ? 0 : i > n - 1 ? n - 1 : i;
  const cj = j < 0 ? 0 : j > n - 1 ? n - 1 : j;
  return cj * n + ci;
}

/**
 * A regular grid centred on the world origin: `n` posts, `step` metres apart,
 * post 0 at `-half`.
 *
 * The four grids of the game this came from (2 m heights, 4 m rays, 8 m rubble,
 * 16 m occlusion) and its 96 m far-field grid are all this shape, so
 * `(x + half) / step` is the conversion five call sites wrote out by hand. A
 * grid whose origin is NOT the world origin does its own conversion and calls
 * `bilinear` directly; that is one line and it is the game's business where its
 * world starts.
 */
export class CentredGrid {
  constructor(readonly n: number, readonly step: number, readonly half: number) {}

  /** World metres -> post coordinate, unclamped. */
  post(v: number): number { return (v + this.half) / this.step; }

  /** Post index -> world metres. */
  world(i: number): number { return i * this.step - this.half; }

  /** Clamped bilinear height at a world point. */
  sample(buf: ArrayLike<number>, x: number, z: number): number {
    return bilinear(buf, this.n, this.post(x), this.post(z));
  }

  /** Clamped nearest-post index at a world point. */
  cell(x: number, z: number): number {
    return nearestIndex(this.n, this.post(x), this.post(z));
  }

  /**
   * Index bounds of the smallest post rectangle covering a world rectangle,
   * clamped to the grid. Written into `out` so a stamping loop allocates
   * nothing; returns false when the rectangle collapses, which every caller
   * must treat as "nothing to do" rather than as an empty loop that still
   * writes one row.
   */
  rect(x0: number, z0: number, x1: number, z1: number, out: GridRect): boolean {
    const n = this.n;
    const lo = (v: number) => { const k = Math.floor(this.post(v)); return k < 0 ? 0 : k > n - 1 ? n - 1 : k; };
    const hi = (v: number) => { const k = Math.ceil(this.post(v)); return k < 0 ? 0 : k > n - 1 ? n - 1 : k; };
    out.i0 = lo(x0); out.i1 = hi(x1);
    out.j0 = lo(z0); out.j1 = hi(z1);
    return out.i1 > out.i0 && out.j1 > out.j0;
  }
}

/** Index bounds of a rectangle of posts, inclusive on all four sides. */
export interface GridRect { i0: number; i1: number; j0: number; j1: number; }

/** A fresh, zeroed rectangle. */
export const gridRect = (): GridRect => ({ i0: 0, i1: 0, j0: 0, j1: 0 });

/** The three numbers a contact point wants: `y` is on the field, `nx`/`nz` are
 *  the surface gradient's horizontal components as a UNIT normal's x and z. */
export interface FieldNormal { x: number; y: number; z: number; }

/**
 * Surface normal by central difference of the height function itself, at
 * stencil `e` metres.
 *
 * OF THE FUNCTION, NOT OF THE MESH, and that is the point. A figure standing
 * between two grid posts must not read a normal from one of them: the slope
 * limit is a comparison against that normal, so a discontinuous normal is a
 * figure that starts and stops sliding on an invisible grid. Both games that
 * had written this said so in their own comments.
 *
 * NO HEMISPHERE FORCING AND NO WORLD-Y FLOOR. Both
 * make overhangs and crater undersides impossible, and both are the kind of
 * "safety" clamp that silently deletes geometry the art direction asked for.
 */
export function centralNormal(f: HeightField, x: number, z: number, e: number, out: FieldNormal): FieldNormal {
  const hx = f.heightAt(x + e, z) - f.heightAt(x - e, z);
  const hz = f.heightAt(x, z + e) - f.heightAt(x, z - e);
  const l = Math.sqrt(hx * hx + 4 * e * e + hz * hz);
  out.x = -hx / l; out.y = (2 * e) / l; out.z = -hz / l;
  return out;
}

/**
 * Slope ANGLE in radians at stencil `e`, from the same central difference.
 *
 * `atan(hypot / 2e)` rather than `acos(normal.y)`: algebraically identical,
 * one transcendental instead of a normalise plus an acos, and it cannot
 * produce NaN from a normal that rounded to 1.0000000000000002. The stencil is
 * an argument because the two questions are different — the honest gradient a
 * wheel or a foot feels is one field cell, and "can a 20 m foundation sit
 * here" is 20 m. One base-building game measured that asking the second
 * question at the first stencil painted 34.5% of its playfield unbuildable,
 * including the landing site.
 */
export function slopeAngle(f: HeightField, x: number, z: number, e: number): number {
  const hx = f.heightAt(x + e, z) - f.heightAt(x - e, z);
  const hz = f.heightAt(x, z + e) - f.heightAt(x, z - e);
  return Math.atan(Math.hypot(hx, hz) / (2 * e));
}
