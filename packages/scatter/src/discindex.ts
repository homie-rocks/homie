/**
 * ============================================================================
 *  DiscIndex — a uniform-grid broadphase over discs that have a REACH.
 * ============================================================================
 *  The generator problem this solves, in every game that has one: N features
 *  are scattered over a plane, each influences the ground out to some radius,
 *  and then a few hundred thousand sample points each need "which features
 *  reach me". The naive answer is N tests per point, and it is the boot time.
 *  Measured at one base-building game's population — 1700 features against 158 000 vertices
 *  — that is 270 million rejections, several seconds of a cold start spent
 *  proving that almost nothing touches almost anything.
 *
 *  So: build once, insert each item into every cell its own reach box covers,
 *  and a point query reads ONE cell in which every candidate genuinely might
 *  touch the point. Same population: ~35 candidates per query.
 *
 *  ── TWO PROPERTIES CALLERS DEPEND ON, STATED BECAUSE THEY ARE FREE ─────────
 *
 *  ORDER IS PRESERVED. Items inside a cell are stored in ascending source
 *  index, so a walk over one cell is a walk in the caller's own list order.
 *  A generator that applies its features oldest-first — and most do, because
 *  a young feature must overwrite an old one — gets that for nothing, and
 *  `idx()` hands back the ordinal so "younger than me" is a comparison.
 *
 *  ZERO REACH IS EXCLUDED ENTIRELY. An item whose `reachOf` is 0 or less does
 *  not extend the bounds and is in no cell. That is what lets a caller index
 *  one population twice under two different reach rules — a body radius and a
 *  much longer ejecta radius, say — and have the second index simply not
 *  contain the items that have no ejecta.
 *
 *  ── WHAT IT IS NOT ─────────────────────────────────────────────────────────
 *
 *  Not a keep-out register: `keepout.ts` answers "may I put a thing here",
 *  which is a mutable question asked during placement. This is immutable and
 *  answers "what is already here", asked hundreds of thousands of times after
 *  placement is over. Building one from the other would make both worse.
 *
 *  Storage is CSR — one prefix-sum array and one flat item array, no per-cell
 *  objects and no arrays of arrays, because at these counts the allocation is
 *  the cost. Nothing here imports `three`: the item type only has to say where
 *  it is, so a Node script can build and query an index with no scene.
 * ============================================================================
 */

/** The only thing an indexed item must state: where it is, on the ground plane. */
export interface Placed {
  x: number;
  z: number;
}

export class DiscIndex<T extends Placed> {
  private readonly cell: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly minX: number;
  private readonly minZ: number;
  /** CSR: start[k]..start[k+1] indexes into items for cell k. */
  private readonly start: Int32Array;
  private readonly items: Int32Array;

  /**
   * @param all     the population, in the caller's own order — preserved.
   * @param reachOf how far this item influences the ground. <= 0 excludes it.
   * @param cell    grid pitch. Around the median reach is the usual answer:
   *                much smaller and one item lands in hundreds of cells, much
   *                larger and a query hands back the whole population again.
   */
  constructor(readonly all: readonly T[], reachOf: (t: T) => number, cell: number) {
    this.cell = cell;
    const reach = new Float64Array(all.length);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < all.length; i++) {
      const c = all[i]!;
      const r = reachOf(c);
      reach[i] = r;
      if (r <= 0) continue;
      if (c.x - r < x0) x0 = c.x - r;
      if (c.x + r > x1) x1 = c.x + r;
      if (c.z - r < z0) z0 = c.z - r;
      if (c.z + r > z1) z1 = c.z + r;
    }
    // An empty population — or one where every reach is zero — still has to
    // produce an index that answers "nothing here" rather than NaN cells.
    if (!Number.isFinite(x0)) { x0 = z0 = -1; x1 = z1 = 1; }
    this.minX = x0; this.minZ = z0;
    this.nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1);
    this.nz = Math.max(1, Math.ceil((z1 - z0) / cell) + 1);

    const nCells = this.nx * this.nz;
    const count = new Int32Array(nCells + 1);
    const box = (i: number) => {
      const c = all[i]!, r = reach[i]!;
      return {
        i0: Math.max(0, Math.floor((c.x - r - x0) / cell)),
        i1: Math.min(this.nx - 1, Math.floor((c.x + r - x0) / cell)),
        j0: Math.max(0, Math.floor((c.z - r - z0) / cell)),
        j1: Math.min(this.nz - 1, Math.floor((c.z + r - z0) / cell)),
      };
    };
    let total = 0;
    for (let i = 0; i < all.length; i++) {
      if (reach[i]! <= 0) continue;
      const b = box(i);
      for (let j = b.j0; j <= b.j1; j++) {
        for (let k = b.i0; k <= b.i1; k++) {
          const c1 = j * this.nx + k + 1;
          count[c1] = count[c1]! + 1;
        }
      }
      total += (b.i1 - b.i0 + 1) * (b.j1 - b.j0 + 1);
    }
    for (let k = 0; k < nCells; k++) count[k + 1] = count[k + 1]! + count[k]!;
    this.start = count;
    this.items = new Int32Array(total);
    const cursor = new Int32Array(nCells);
    for (let i = 0; i < all.length; i++) {
      if (reach[i]! <= 0) continue;
      const b = box(i);
      for (let j = b.j0; j <= b.j1; j++) {
        for (let k = b.i0; k <= b.i1; k++) {
          const cellIdx = j * this.nx + k;
          this.items[this.start[cellIdx]! + cursor[cellIdx]!] = i;
          cursor[cellIdx]!++;
        }
      }
    }
  }

  /** Candidate range for the cell containing (x, z). Empty when out of bounds. */
  range(x: number, z: number): [number, number] {
    const i = Math.floor((x - this.minX) / this.cell);
    const j = Math.floor((z - this.minZ) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return [0, 0];
    const k = j * this.nx + i;
    return [this.start[k]!, this.start[k + 1]!];
  }

  /** The nth candidate itself. */
  at(n: number): T { return this.all[this.items[n]!]!; }

  /** The nth candidate's position in the ORIGINAL list — see the header. */
  idx(n: number): number { return this.items[n]!; }
}
