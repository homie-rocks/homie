/**
 * ============================================================================
 *  MeshBake — a height grid sampled off a triangle mesh, and the checksum that
 *  says which mesh it was sampled off.
 * ============================================================================
 *
 *  WHY THIS EXISTS. Importing a model gives a game something to DRAW. It does
 *  not give it something to stand on: a generated landmark arrives as a few
 *  thousand triangles with no collider, and the first figure that walks at it
 *  passes through a wing or hangs in the air beside it. The fix a game reaches
 *  for is always the same one, written again each time: sample the model's
 *  outside surface on a grid, keep the grid beside the model, and walk on the
 *  grid.
 *
 *  ── WHAT "EXTERIOR SURFACE" MEANS HERE, EXACTLY ────────────────────────────
 *  A post's height is where a vertical ray from above FIRST meets the mesh
 *  (`side: 'top'`), or where one from below first meets it (`side: 'under'`).
 *  So a top bake of an aircraft is what a figure standing ON it feels, and an
 *  under bake is the ceiling a figure standing BENEATH it has. One grid holds
 *  one height a post, which is the whole limit of the thing: a room inside the
 *  model is not in either bake. Rooms are `Levels.ts`.
 *
 *  ── WHY THE CHECKSUM IS NOT OPTIONAL ───────────────────────────────────────
 *  A bake is a file that outlives the mesh it came from. The model is
 *  optimised again, a wing moves 40 cm, and the old grid still loads and still
 *  looks plausible in every screenshot taken from far enough away. `source`
 *  records a checksum of the exact positions and indices the bake read, and
 *  `bakeStale` compares it: a game that calls it at load fails loudly on the
 *  day the mesh changes, instead of weeks later when somebody stands on air.
 *  It is FNV-1a in two 32-bit halves over the numbers' bit patterns: a change
 *  detector, not a signature, and it is not meant to resist anybody.
 *
 *  ── WHAT THE CALLER OWNS ───────────────────────────────────────────────────
 *  The cell size, and it has no default. 25 cm suits a walkway with a kerb;
 *  a hillside wants a metre; and the cost is the square of the choice. The
 *  mesh must already be in the space the game walks in (metres, y up, its
 *  node transforms applied): this file never guesses a scale.
 * ============================================================================
 */
import { bilinear, type HeightField } from './Field.ts';

/** Triangles in metres, y up. `indices` absent means every three vertices are one triangle. */
export interface TriMesh {
  positions: ArrayLike<number>;
  indices?: ArrayLike<number> | null;
}

export interface MeshBakeOptions {
  /** Metres between posts. Required: see the header. */
  cell: number;
  /** `'top'`: first surface met from above (the default). `'under'`: first met from below. */
  side?: 'top' | 'under';
  /** Posts added past the mesh's own bounds on every side (default 1), so an edge has a fall-off to sample. */
  pad?: number;
  /** The height a post gets where no triangle is over it. Default: the mesh's lowest y (highest, for `'under'`). */
  empty?: number;
  /** Ignore triangles wholly above this y (an antenna a walker should not be lifted onto). */
  maxY?: number;
  /** Ignore triangles wholly below this y. */
  minY?: number;
}

/** What a bake read, so a later mesh can be compared with it. */
export interface BakeSource {
  /** `meshChecksum` of the mesh that was baked: 16 hex digits. */
  checksum: string;
  vertices: number;
  triangles: number;
}

export interface MeshBake {
  v: 1;
  cell: number;
  side: 'top' | 'under';
  /** Posts along x and along z. */
  nx: number;
  nz: number;
  /** World x and z of post (0, 0). */
  x0: number;
  z0: number;
  /** Row-major, `j * nx + i`. An uncovered post holds `empty`. */
  heights: Float32Array;
  /** 1 where a triangle was over the post, 0 where the post holds `empty`. */
  covered: Uint8Array;
  empty: number;
  source: BakeSource;
}

const HEX = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);

/**
 * A checksum of a mesh's exact numbers: every position's 32-bit float pattern and every index, in order.
 * Welding, re-indexing or moving one vertex by one ulp of a float changes it, which is the point: a bake is valid
 * for the bytes it read and nothing else.
 */
export function meshChecksum(mesh: TriMesh): string {
  let a = 0x811c9dc5; let b = 0x01000193;
  const eat = (w: number): void => {
    for (let s = 0; s < 32; s += 8) {
      const byte = (w >>> s) & 0xff;
      a = Math.imul(a ^ byte, 0x01000193);
      b = Math.imul(b ^ byte, 0x85ebca6b) + 0x9e3779b9 | 0;
    }
  };
  const p = mesh.positions;
  eat(p.length);
  for (let i = 0; i < p.length; i += 1) { F32[0] = p[i] as number; eat(U32[0] as number); }
  const ix = mesh.indices;
  eat(ix ? ix.length : -1);
  if (ix) for (let i = 0; i < ix.length; i += 1) eat(ix[i] as number);
  return HEX(a) + HEX(b);
}

/** Bake a mesh onto a grid. Throws on a cell that is not a positive number or a mesh with no triangle. */
export function bakeMesh(mesh: TriMesh, opts: MeshBakeOptions): MeshBake {
  const cell = opts.cell;
  if (!(cell > 0) || !Number.isFinite(cell)) throw new Error('bakeMesh: cell is metres between posts, a positive number');
  const side = opts.side ?? 'top';
  const pad = Math.max(0, Math.floor(opts.pad ?? 1));
  const p = mesh.positions;
  const ix = mesh.indices ?? null;
  const tris = Math.floor((ix ? ix.length : p.length / 3) / 3);
  if (tris < 1) throw new Error('bakeMesh: the mesh has no triangle');
  const at = (t: number, c: number): number => (ix ? (ix[t * 3 + c] as number) : t * 3 + c) * 3;

  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (let t = 0; t < tris; t += 1) for (let c = 0; c < 3; c += 1) {
    const o = at(t, c); const x = p[o] as number; const y = p[o + 1] as number; const z = p[o + 2] as number;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error('bakeMesh: the mesh has a position that is not a number');
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  // Posts sit on multiples of the cell, so two bakes of neighbouring models at one cell size share their posts.
  const i0 = Math.floor(minX / cell) - pad; const j0 = Math.floor(minZ / cell) - pad;
  const nx = Math.ceil(maxX / cell) + pad - i0 + 1; const nz = Math.ceil(maxZ / cell) + pad - j0 + 1;
  if (nx * nz > 16_000_000) throw new Error(`bakeMesh: ${nx} x ${nz} posts at a ${cell} m cell is too many; use a larger cell`);
  const top = side === 'top';
  const empty = opts.empty ?? (top ? minY : maxY);
  const heights = new Float32Array(nx * nz).fill(empty);
  const covered = new Uint8Array(nx * nz);
  const x0 = i0 * cell; const z0 = j0 * cell;
  const hi = opts.maxY ?? Infinity; const lo = opts.minY ?? -Infinity;

  for (let t = 0; t < tris; t += 1) {
    const a = at(t, 0); const b = at(t, 1); const c = at(t, 2);
    const ax = p[a] as number; const ay = p[a + 1] as number; const az = p[a + 2] as number;
    const bx = p[b] as number; const by = p[b + 1] as number; const bz = p[b + 2] as number;
    const cx = p[c] as number; const cy = p[c + 1] as number; const cz = p[c + 2] as number;
    if (Math.min(ay, by, cy) > hi || Math.max(ay, by, cy) < lo) continue;
    // Twice the signed area in the plan view. A triangle seen edge-on from above (a wall) covers no post.
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-12) continue;
    const ia = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) / cell)); const ib = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / cell));
    const ja = Math.max(0, Math.ceil((Math.min(az, bz, cz) - z0) / cell)); const jb = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - z0) / cell));
    for (let j = ja; j <= jb; j += 1) {
      const z = z0 + j * cell;
      for (let i = ia; i <= ib; i += 1) {
        const x = x0 + i * cell;
        const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
        const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
        const w = 1 - u - v;
        // A post exactly on a shared edge belongs to both triangles; the tolerance keeps it from belonging to neither.
        if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
        const y = u * ay + v * by + w * cy;
        const k = j * nx + i;
        if (!covered[k] || (top ? y > (heights[k] as number) : y < (heights[k] as number))) { heights[k] = y; covered[k] = 1; }
      }
    }
  }
  return { v: 1, cell, side, nx, nz, x0, z0, heights, covered, empty, source: { checksum: meshChecksum(mesh), vertices: Math.floor(p.length / 3), triangles: tris } };
}

/**
 * Why a bake no longer describes a mesh, or null when it still does. Call it where the game loads the model: a
 * string here is a build that should stop, not a warning to scroll past.
 */
export function bakeStale(bake: MeshBake, mesh: TriMesh, want: { cell?: number; side?: 'top' | 'under' } = {}): string | null {
  if (want.cell !== undefined && want.cell !== bake.cell) return `the bake's cell is ${bake.cell} m and ${want.cell} m is wanted`;
  if (want.side !== undefined && want.side !== bake.side) return `the bake is the ${bake.side} side and the ${want.side} side is wanted`;
  const sum = meshChecksum(mesh);
  if (sum !== bake.source.checksum) return `the mesh changed since the bake (checksum ${sum}, the bake read ${bake.source.checksum}): bake it again`;
  return null;
}

/** A bake as a field: `heightAt` is the clamped bilinear fetch, so past the grid's edge the edge post extends. */
export interface BakedField extends HeightField {
  /** Whether the nearest post had mesh over it. Off the grid: false. */
  covered(x: number, z: number): boolean;
}

export function bakeField(bake: MeshBake): BakedField {
  const { nx, nz, x0, z0, cell, heights, covered } = bake;
  const clamp = (v: number, n: number): number => (v < 0 ? 0 : v > n - 1.001 ? n - 1.001 : v);
  return {
    heightAt(x, z) {
      if (nx === nz) return bilinear(heights, nx, (x - x0) / cell, (z - z0) / cell);
      // `bilinear` is for square grids; a mesh's bounds rarely are, so the rectangular fetch is spelt out here.
      const fx = clamp((x - x0) / cell, nx); const fz = clamp((z - z0) / cell, nz);
      const i = fx | 0; const j = fz | 0; const tx = fx - i; const tz = fz - j; const r = j * nx + i;
      const a = heights[r] as number; const b = heights[r + 1] as number; const c = heights[r + nx] as number; const d = heights[r + nx + 1] as number;
      return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    },
    covered(x, z) {
      const i = Math.round((x - x0) / cell); const j = Math.round((z - z0) / cell);
      return i >= 0 && j >= 0 && i < nx && j < nz && covered[j * nx + i] === 1;
    },
  };
}

/** A bake as plain JSON: heights in whole millimetres, `null` where no mesh was over the post. */
export interface PackedBake {
  v: 1; cell: number; side: 'top' | 'under'; nx: number; nz: number; x0: number; z0: number; empty: number;
  /** Millimetres. */
  heights: (number | null)[];
  source: BakeSource;
}

/** For a file kept beside the model. A millimetre is finer than any cell this is used at. */
export function packBake(b: MeshBake): PackedBake {
  const heights: (number | null)[] = new Array(b.heights.length);
  for (let k = 0; k < heights.length; k += 1) heights[k] = b.covered[k] ? Math.round((b.heights[k] as number) * 1000) : null;
  return { v: 1, cell: b.cell, side: b.side, nx: b.nx, nz: b.nz, x0: b.x0, z0: b.z0, empty: b.empty, heights, source: { ...b.source } };
}

/** The reverse of `packBake`. Throws when the file is not a bake this version reads. */
export function unpackBake(j: PackedBake): MeshBake {
  if (!j || j.v !== 1 || !Array.isArray(j.heights) || j.heights.length !== j.nx * j.nz || !(j.cell > 0)) throw new Error('unpackBake: not a version 1 mesh bake');
  const heights = new Float32Array(j.heights.length); const covered = new Uint8Array(j.heights.length);
  for (let k = 0; k < heights.length; k += 1) {
    const h = j.heights[k];
    if (h === null || h === undefined) heights[k] = j.empty; else { heights[k] = h / 1000; covered[k] = 1; }
  }
  return { v: 1, cell: j.cell, side: j.side === 'under' ? 'under' : 'top', nx: j.nx, nz: j.nz, x0: j.x0, z0: j.z0, heights, covered, empty: j.empty, source: { ...j.source } };
}

/**
 * The bake as line segments at true scale, for an overlay drawn over the model it came from: one segment between
 * every pair of neighbouring covered posts (every `stride`-th row and column). Six numbers a segment, metres, in
 * the space the mesh was baked in, so `new LineSegments(geometry)` at the model's own origin lies on its surface
 * wherever the collider agrees with the picture, and visibly does not where it disagrees.
 */
export function bakeWire(bake: MeshBake, stride = 1): Float32Array {
  const s = Math.max(1, Math.floor(stride));
  const { nx, nz, x0, z0, cell, heights, covered } = bake;
  const out: number[] = [];
  const seg = (i: number, j: number, i2: number, j2: number): void => {
    const a = j * nx + i; const b = j2 * nx + i2;
    if (!covered[a] || !covered[b]) return;
    out.push(x0 + i * cell, heights[a] as number, z0 + j * cell, x0 + i2 * cell, heights[b] as number, z0 + j2 * cell);
  };
  for (let j = 0; j < nz; j += s) for (let i = 0; i + 1 < nx; i += 1) seg(i, j, i + 1, j);
  for (let i = 0; i < nx; i += s) for (let j = 0; j + 1 < nz; j += 1) seg(i, j, i, j + 1);
  return new Float32Array(out);
}
