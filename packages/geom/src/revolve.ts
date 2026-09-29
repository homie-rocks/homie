/**
 * ============================================================================
 *  revolve — a row/column strip swept about +Y, with apertures and extra
 *  per-vertex channels.
 * ============================================================================
 *
 *  THIS IS NOT `latheGeo`, AND THE DIFFERENCE IS THE REASON IT EXISTS.
 *  `chamfer.ts`'s lathe takes a profile and hands back a closed body of
 *  revolution with three's own normals and uvs. It cannot do any of the four
 *  things a hull-scale surface needs:
 *
 *   1. AN ANALYTIC NORMAL. On a body whose radius law is a curve, a normal
 *      averaged from the emitted triangles facets the silhouette at exactly
 *      the distance the silhouette is the whole read. The caller knows the
 *      derivative of its own radius law; nothing else does.
 *   2. AUTHORED UVs. A hull's uvs are in METRES of arc and metres of height,
 *      not in [0,1]², because the material's texel density is a property of
 *      the mill rather than of the mesh.
 *   3. APERTURES. A door, a hatch or a bay is a hole in the strip. Emitting
 *      the quad and hiding it later costs a draw and still writes depth;
 *      subtracting it afterwards is a CSG problem nobody wants. Skipping the
 *      quad whose MIDPOINT falls inside the opening is the whole of it, and
 *      the midpoint is the right test: a corner test drops the quads that
 *      merely touch the opening and leaves a ragged edge one row wide.
 *   4. EXTRA CHANNELS. A surface with a history — weld heat, plate scatter,
 *      per-tile tone — carries it as vertex data, and the merge that follows
 *      has to see it as an attribute rather than as a colour.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS NOT ──────────────────────────────────────
 *
 *   · MECHANISM — the row/column layout, the vertex order (row outer, column
 *     inner), the two triangles per quad and their winding, the typed-array
 *     allocation, and the midpoint aperture test.
 *   · CONTENT — every callback. `ys` IS the tessellation, `radius` IS the
 *     silhouette, `normal` IS the shading, `theta` IS whether this is a full
 *     revolve or a band, and the attribute writers ARE the surface's history.
 *     None of them has a default here and none of them ever should.
 *
 *  ROWS ARE NOT RESAMPLED. A caller that wants rows bracketing a feature —
 *  a weld, a chine, a step — passes them, and a helpful uniform resample here
 *  would smear exactly the feature the caller went to the trouble of placing.
 * ============================================================================
 */
import * as THREE from 'three';

/** One extra per-vertex channel, written in place. */
export interface RevolveAttr {
  name: string;
  size: number;
  /**
   * Write `size` floats into `out` starting at `at`.
   * @param y   this row's height
   * @param th  this column's azimuth, radians
   * @param r   row index
   * @param c   column index
   */
  write(out: Float32Array, at: number, y: number, th: number, r: number, c: number): void;
}

export interface RevolveOpts {
  /** Row heights, ascending. Their COUNT is the tessellation up the axis. */
  ys: number[];
  /** Quads around; there are `segs + 1` vertices per row. */
  segs: number;
  /** Azimuth of column `c`. A full revolve and a restricted band are one code path. */
  theta(c: number, segs: number, y: number): number;
  radius(y: number): number;
  /** Analytic, into `out`. See §1 above for why this is not derived. */
  normal(y: number, th: number, out: THREE.Vector3): void;
  /**
   * Write u then v into `out` at `at`. In whatever units the material wants.
   *
   * `r` and `rows` are the ROW INDEX and the row count, and they are here for
   * the commonest v there is: a decal patch wants v to run 0..1 across its own
   * rows, and deriving that from `y` instead — `(y - y0) / (y1 - y0)` — is only
   * exactly `r / (rows - 1)` in real arithmetic. A hull's uvs are in metres and
   * do not care; a patch whose top row lands at 0.9999999999 has its last texel
   * row of a letter sheared, which is the kind of difference that survives
   * review because it looks like anti-aliasing.
   */
  uv(out: Float32Array, at: number, y: number, th: number, c: number, segs: number,
    r: number, rows: number): void;
  attrs?: RevolveAttr[];
  /**
   * A quad whose MIDPOINT answers true is not emitted. See §3.
   *
   * It is handed the column INDEX rather than a midpoint azimuth, and that is
   * deliberate: `(theta(c) + theta(c+1)) / 2` and `theta(c + 0.5)` are the same
   * number in exact arithmetic and not always the same double, and a caller
   * whose opening is authored against one of them should get that one.
   */
  skip?(yMid: number, c: number, segs: number): boolean;
}

/** A rectangular opening in (height, azimuth). `t0`/`t1` in radians, ascending. */
export interface Aperture {
  y0: number;
  y1: number;
  t0: number;
  t1: number;
}

/**
 * Is (y, th) inside any of these openings?
 *
 * The commonest `skip` there is, and it is also the commonest keep-out: a
 * caller that cuts a door out of a hull nearly always has to keep something
 * else off the same rectangle — tiles, panel lines, a decal field — and the two
 * MUST use one predicate or the hole and the field disagree by a row.
 *
 * THE AZIMUTH TEST IS WRAPPED AND THAT IS THE WHOLE OF IT. Comparing `th`
 * against `t0` and `t1` directly is correct for an opening that does not
 * straddle the seam and silently empty for one that does — a door authored
 * across 350..10 degrees compares as `th >= 350 && th <= 10`, which nothing
 * satisfies, so the hole simply does not appear and there is no error. Folding
 * the offset from the opening's CENTRE into (-pi, pi] and comparing against the
 * half-width has no seam to straddle.
 */
export function inAperture(y: number, th: number, aps: readonly Aperture[]): boolean {
  for (const a of aps) {
    if (y < a.y0 || y > a.y1) continue;
    let d = th - (a.t0 + a.t1) * 0.5;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) <= (a.t1 - a.t0) * 0.5) return true;
  }
  return false;
}

const _n = new THREE.Vector3();

export function revolveStrip(o: RevolveOpts): THREE.BufferGeometry {
  const { ys, segs } = o;
  const rows = ys.length;
  const cols = segs + 1;
  const pos = new Float32Array(rows * cols * 3);
  const nrm = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const extra = (o.attrs ?? []).map((a) => new Float32Array(rows * cols * a.size));
  const idx: number[] = [];

  for (let r = 0; r < rows; r++) {
    const y = ys[r]!;
    const rad = o.radius(y);
    for (let c = 0; c < cols; c++) {
      const th = o.theta(c, segs, y);
      const i3 = (r * cols + c) * 3;
      const i2 = (r * cols + c) * 2;
      pos[i3] = Math.cos(th) * rad;
      pos[i3 + 1] = y;
      pos[i3 + 2] = Math.sin(th) * rad;
      o.normal(y, th, _n);
      nrm[i3] = _n.x;
      nrm[i3 + 1] = _n.y;
      nrm[i3 + 2] = _n.z;
      o.uv(uv, i2, y, th, c, segs, r, rows);
      const attrs = o.attrs;
      if (attrs) {
        for (let k = 0; k < attrs.length; k++) {
          attrs[k]!.write(extra[k]!, (r * cols + c) * attrs[k]!.size, y, th, r, c);
        }
      }
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    const yMid = (ys[r]! + ys[r + 1]!) * 0.5;
    for (let c = 0; c < segs; c++) {
      if (o.skip && o.skip(yMid, c, segs)) continue;
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  (o.attrs ?? []).forEach((a, k) => {
    g.setAttribute(a.name, new THREE.BufferAttribute(extra[k]!, a.size));
  });
  g.setIndex(idx);
  return g;
}
