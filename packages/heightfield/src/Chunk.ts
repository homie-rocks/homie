/**
 * ============================================================================
 *  Chunk — filling terrain grids, and hanging their skirts.
 * ============================================================================
 *
 *  ── THE HALO IS THE WHOLE FILE ─────────────────────────────────────────────
 *
 *  A chunked LOD terrain has, at every level, a grid of posts whose heights are
 *  the field BAND-LIMITED TO THAT LEVEL'S OWN SPACING. The obvious way to get
 *  the normals is to differentiate the full-resolution field. It is wrong, and
 *  the failure is one every outdoor game meets once: shading that describes a
 *  surface the triangles do not have. On a coarse level that renders as
 *  striping — light and dark bands running across ground that is visibly
 *  smooth — because the normal is carrying detail the mesh threw away.
 *
 *  The right gradient is a difference of the LEVEL'S OWN low-passed heights
 *  over the LEVEL'S OWN spacing, which is exactly the surface the triangles
 *  have. That needs one post of context outside the chunk on every side, and
 *  fetching it from a neighbour chunk means a second filter pass and a
 *  dependency between tiles. A ONE-POST HALO is what makes it a local
 *  operation: sample `(q + 3)^2` posts, use the inner `(q + 1)^2`.
 *
 *  NO HEMISPHERE FORCING AND NO WORLD-Y FLOOR on the normal. A terrain normal
 *  that has been clamped to point up is a normal that lies about an overhanging
 *  crater wall, and the clamp is invisible until something is lit from below.
 *
 *  ── AND THE SKIRT'S ADDRESSING LIVES BESIDE THE INDEX THAT USES IT ─────────
 *
 *  `Mesh.ts` writes the index buffer and `skirtVertex` says where a skirt post
 *  lives. A caller that writes `base + edge * row + k` itself is the seam two
 *  sides written apart silently disagreeing about — both individually correct,
 *  and a diagonal band of garbage geometry where they meet. So the copy is
 *  here, next to the addressing.
 *
 *  A SKIRT INHERITS ITS NEIGHBOUR'S EVERY OTHER CHANNEL, not just its normal.
 *  The sliver that shows through a crack has to shade like the ground beside
 *  it, and a channel that got a hard-coded default instead hangs a band of that
 *  default down every chunk edge — which is what happens when a padding channel
 *  quietly becomes a real one.
 *
 *  No `three`: typed arrays and a sampler, so a Node harness can fill a chunk.
 * ============================================================================
 */

import { centralNormal, type HeightField } from './Field.js';
import { skirtVertex } from './Mesh.js';

/** One caller-owned channel written alongside a static grid's position. */
export interface StaticGridPost {
  (k: number, i: number, j: number, x: number, z: number): void;
}

/** Height stored at one surface post; distinct from the interpolated field. */
export interface StaticGridHeight {
  (k: number, i: number, j: number, x: number, z: number): number;
}

/**
 * Fill the surface posts of one non-LOD heightfield grid.
 *
 * Positions are world-relative because a single-grid film has no chunk centre
 * to subtract. UVs, colours and every other material channel remain in
 * `post`: this function owns only the repeated position/normal walk.
 */
export function fillStaticGrid(
  pos: Float32Array, nor: Float32Array,
  q: number, step: number, ox: number, oz: number,
  height: StaticGridHeight, field: HeightField, post: StaticGridPost,
): void {
  const normal = { x: 0, y: 0, z: 0 };
  const row = q + 1;
  for (let j = 0; j <= q; j++) {
    const z = oz + j * step;
    for (let i = 0; i <= q; i++) {
      const x = ox + i * step;
      const k = j * row + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = height(k, i, j, x, z);
      pos[k * 3 + 2] = z;
      centralNormal(field, x, z, step, normal);
      nor[k * 3] = normal.x;
      nor[k * 3 + 1] = normal.y;
      nor[k * 3 + 2] = normal.z;
      post(k, i, j, x, z);
    }
  }
}

/**
 * Fill one chunk level's positions and normals.
 *
 * @param pos    3 floats per post, `(q + 1)^2` posts, CHUNK-RELATIVE.
 * @param nor    3 floats per post.
 * @param q      quads per side. Posts per row is `q + 1`.
 * @param step   world units between posts at this level.
 * @param ox,oz  world position of post (0, 0).
 * @param cx,cz  the chunk's centre. Geometry is authored relative to it so a
 *               LOD selector can measure a real distance to the chunk instead
 *               of to the world origin.
 * @param halo   scratch of at least `(q + 3)^2`. The caller owns it because
 *               this runs a couple of hundred times at boot and again on every
 *               edit, and a per-call allocation there is a hundred needless
 *               collections.
 * @param sample the BAND-LIMITED height at this level's spacing.
 * @param post   called once per post with its index and world position, for
 *               whatever else a vertex carries — uv, vertex colour, a shade
 *               channel. Those are the caller's, always.
 */
export function fillChunkGrid(
  pos: Float32Array, nor: Float32Array,
  q: number, step: number, ox: number, oz: number, cx: number, cz: number,
  halo: Float32Array,
  sample: (x: number, z: number) => number,
  post: (k: number, wx: number, wz: number) => void,
): void {
  const row = q + 1;
  const hrow = row + 2;
  for (let j = -1; j <= q + 1; j++) {
    const wz = oz + j * step;
    for (let i = -1; i <= q + 1; i++) {
      halo[(j + 1) * hrow + (i + 1)] = sample(ox + i * step, wz);
    }
  }

  const inv = 1 / (2 * step);
  for (let j = 0; j <= q; j++) {
    const wz = oz + j * step;
    for (let i = 0; i <= q; i++) {
      const wx = ox + i * step;
      const k = j * row + i;
      const hc = (j + 1) * hrow + (i + 1);
      pos[k * 3] = wx - cx;
      pos[k * 3 + 1] = halo[hc]!;
      pos[k * 3 + 2] = wz - cz;
      const gx = (halo[hc + 1]! - halo[hc - 1]!) * inv;
      const gz = (halo[hc + hrow]! - halo[hc - hrow]!) * inv;
      const il = 1 / Math.sqrt(gx * gx + gz * gz + 1);
      nor[k * 3] = -gx * il;
      nor[k * 3 + 1] = il;
      nor[k * 3 + 2] = -gz * il;
      post(k, wx, wz);
    }
  }
}

/** One attribute a skirt post inherits verbatim from the edge post above it. */
export interface SkirtAttr {
  arr: Float32Array | Uint8Array | Uint16Array;
  /** components per post. */
  size: number;
}

/** A static-grid skirt channel, optionally transformed by caller-owned style. */
export interface StaticSkirtAttr extends SkirtAttr {
  map?: (value: number, component: number) => number;
}

/**
 * Copy a single static grid's four edge rows to one absolute Y.
 *
 * Unlike a chunk LOD skirt, a film-wide floor often ends at a world datum
 * rather than a fixed drop below each edge post. The caller supplies that Y
 * and any per-channel transform (for example darkening a colour below grade).
 */
export function copyStaticGridSkirt(
  q: number, y: number, pos: Float32Array, others: readonly StaticSkirtAttr[],
): void {
  const row = q + 1;
  const copy = (edge: number, k: number, src: number) => {
    const d = skirtVertex(q, edge, k);
    pos[d * 3] = pos[src * 3]!;
    pos[d * 3 + 1] = y;
    pos[d * 3 + 2] = pos[src * 3 + 2]!;
    for (const a of others) {
      for (let c = 0; c < a.size; c++) {
        const value = a.arr[src * a.size + c]!;
        a.arr[d * a.size + c] = a.map ? a.map(value, c) : value;
      }
    }
  };
  for (let k = 0; k <= q; k++) {
    copy(0, k, k);
    copy(1, k, q * row + k);
    copy(2, k, k * row);
    copy(3, k, k * row + q);
  }
}

/**
 * Copy the four edge rows down into the skirt ring: same XZ, dropped by
 * `drop`, every other channel inherited. See `skirtVertex` for the addressing
 * and the header for why it is not the caller's to write.
 */
export function copyChunkSkirt(
  q: number, drop: number, pos: Float32Array, others: readonly SkirtAttr[],
  skirtVertex: (q: number, edge: number, k: number) => number,
): void {
  const row = q + 1;
  const copy = (edge: number, k: number, src: number) => {
    const d = skirtVertex(q, edge, k);
    pos[d * 3] = pos[src * 3]!;
    pos[d * 3 + 1] = pos[src * 3 + 1]! - drop;
    pos[d * 3 + 2] = pos[src * 3 + 2]!;
    for (const a of others) {
      for (let c = 0; c < a.size; c++) a.arr[d * a.size + c] = a.arr[src * a.size + c]!;
    }
  };
  for (let k = 0; k <= q; k++) {
    copy(0, k, k);                 // south, j = 0
    copy(1, k, q * row + k);       // north, j = q
    copy(2, k, k * row);           // west,  i = 0
    copy(3, k, k * row + q);       // east,  i = q
  }
}
