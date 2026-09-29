/**
 * ============================================================================
 *  weld — a list of finished geometries collapsed into one buffer.
 * ============================================================================
 *  `GeoAccum` (accum.ts) is the OTHER merge in this package and the two are not
 *  interchangeable. That one takes a geometry PLUS a matrix PLUS a tint and
 *  bakes contact AO into vertex colour as it goes: it is the village's
 *  accumulator, and its attribute set — position/normal/uv/color — is fixed
 *  because every consumer of it wants exactly those four.
 *
 *  This one takes geometries that are already where they belong and welds them
 *  over a DECLARED attribute schema. The schema is the whole point. A model
 *  built out of a hundred lathes, chamfers and greeble passes carries channels
 *  that no generic merge knows about — a per-part surface history, a per-panel
 *  age, a bake-time mask — and a merge that quietly drops them produces a mesh
 *  that renders, holds a frame, passes every gate, and has lost the one
 *  attribute the material reads.
 *
 *  THE DEFAULT FOR AN ABSENT ATTRIBUTE IS PART OF THE SCHEMA, and it is not
 *  always zero. A missing `color` must arrive as WHITE: the material multiplies
 *  by it, and a zero-filled buffer silently paints half the model black. That
 *  is a real bug that shipped, so `fill` is a required-shaped field rather than
 *  something a caller can forget.
 *
 *  Indices are ALWAYS 32-bit. 16-bit overflows silently at 65,536 vertices, and
 *  anything worth welding is past that; the memory saved is not worth a mesh
 *  that folds in on itself with no error.
 *
 *  Written against `three` directly rather than BufferGeometryUtils, for the
 *  reason the two games that wrote it both wrote in their comments: that is an
 *  `examples/jsm` path and it has moved twice in three release cycles.
 * ============================================================================
 */
import * as THREE from 'three';

/** One channel of a weld schema: its name, its width, and what an absent source contributes. */
export interface WeldAttr {
  name: string;
  size: number;
  /** Value written for every component when a source geometry lacks this attribute. */
  fill: number;
}

/**
 * position / normal / uv, the three every mesh has, with the benign zero fill.
 * A caller wanting vertex colour or its own channels spreads this and appends.
 */
export const WELD_BASE: WeldAttr[] = [
  { name: 'position', size: 3, fill: 0 },
  { name: 'normal', size: 3, fill: 0 },
  { name: 'uv', size: 2, fill: 0 },
];

/** Vertex colour, filled WHITE when absent — see the header. */
export const WELD_COLOR: WeldAttr = { name: 'color', size: 3, fill: 1 };

/**
 * Weld `geos` into one indexed geometry over `attrs`.
 *
 * `dispose` frees each source as it is consumed, which is the normal case: the
 * parts were built to be welded and nothing else holds them. Pass false when a
 * source is shared with another weld.
 */
export function weldGeos(
  geos: THREE.BufferGeometry[],
  attrs: WeldAttr[],
  dispose = true,
): THREE.BufferGeometry {
  let vTotal = 0;
  let iTotal = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    vTotal += p.count;
    iTotal += g.getIndex() ? g.getIndex()!.count : p.count;
  }
  const out = new THREE.BufferGeometry();
  const buffers: Record<string, Float32Array> = {};
  for (const a of attrs) buffers[a.name] = new Float32Array(vTotal * a.size);
  const index = new Uint32Array(iTotal);

  let vOff = 0;
  let iOff = 0;
  for (const g of geos) {
    const count = g.getAttribute('position').count;
    for (const a of attrs) {
      const src = g.getAttribute(a.name);
      const dst = buffers[a.name];
      if (src) {
        for (let i = 0; i < count; i++) {
          for (let c = 0; c < a.size; c++) dst[(vOff + i) * a.size + c] = src.getComponent(i, c);
        }
      } else if (a.fill !== 0) {
        for (let i = 0; i < count * a.size; i++) dst[vOff * a.size + i] = a.fill;
      }
      // fill 0 needs no pass: the buffer is already zeroed.
    }
    const gi = g.getIndex();
    if (gi) {
      for (let i = 0; i < gi.count; i++) index[iOff + i] = gi.getX(i) + vOff;
    } else {
      for (let i = 0; i < count; i++) index[iOff + i] = vOff + i;
    }
    iOff += gi ? gi.count : count;
    vOff += count;
    if (dispose) g.dispose();
  }

  for (const a of attrs) out.setAttribute(a.name, new THREE.BufferAttribute(buffers[a.name], a.size));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

/** Bake a transform into a geometry, in place, and hand it back for chaining. */
export function bakeXform(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  g.applyMatrix4(m);
  return g;
}

/**
 * Give every vertex of `g` the same value on one attribute, so a part carries
 * its own constant into a weld that has already forgotten which part it was.
 *
 * This is the counterpart to the schema above: the schema says the channel
 * exists, this is how a part fills it. Written per part at build time, read per
 * fragment at draw time, and it costs one float per vertex against the
 * alternative — a separate material, and therefore a separate draw call, for
 * every part that differs by a number.
 */
export function constAttr(
  g: THREE.BufferGeometry,
  name: string,
  values: number[],
): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const size = values.length;
  const a = new Float32Array(n * size);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < size; c++) a[i * size + c] = values[c];
  }
  g.setAttribute(name, new THREE.BufferAttribute(a, size));
  return g;
}


/**
 * ============================================================================
 *  AND THE OTHER WELD IN THIS FILE — read this before reaching for either.
 * ============================================================================
 *  Two welds were extracted into this file from two different games, and they
 *  did NOT merge, because they answer different questions:
 *
 *    · `weldGeos` above is SCHEMA-DRIVEN and INDEXED. It takes a list of
 *      channels, fills an absent one from the schema rather than leaving a
 *      zeroed buffer to multiply through, renumbers indices, and DISPOSES each
 *      source as it consumes it. It does not transform anything: its callers
 *      have already baked their matrices (`bakeXform`).
 *    · `weldParts` below TRANSFORMS. A part arrives as a geometry plus a
 *      matrix, position goes through the model matrix and normal through the
 *      NORMAL matrix, and what comes out is non-indexed position+normal and
 *      nothing else.
 *
 *  Collapsing them would mean either giving the transforming one an index and
 *  a schema it has no use for, or taking the schema off the one whose whole
 *  point is the absent-channel fill. Both are behaviour changes to a caller,
 *  and the fill in particular is a known trap: a zeroed colour buffer
 *  multiplies through and paints half a model black with no error.
 * ============================================================================
 */

/**
 * ============================================================================
 *  weldParts — transform a handful of geometries and concatenate them. Nothing
 *  else at all.
 * ============================================================================
 *
 *  THIS PACKAGE ALREADY HAS TWO MERGERS AND THIS IS DELIBERATELY THE THIRD,
 *  because the three are not spellings of one thing:
 *
 *    · `merge.ts`'s `mergeStaticSets` buckets InstSet instances by material and
 *      by a world grid cell and emits indexed geometry with five extra
 *      per-vertex channels. It is a DRAW-CALL POLICY.
 *    · `accum.ts`'s `GeoAccum` collects into an INDEXED buffer carrying uv and
 *      vertex colour, with a tint and a baked-AO callback per part. It is what
 *      a building or a vehicle is assembled with.
 *    · this takes position and normal, non-indexed, no uv, no colour, no index,
 *      no buckets.
 *
 *  The third exists because a sub-assembly of a dozen chamfered primitives that
 *  will be drawn with ONE untextured material does not want a uv buffer it
 *  never samples, a colour buffer that is all ones, or an index that maps every
 *  vertex to itself — and, more to the point, a caller that already has that
 *  shape cannot adopt `GeoAccum` as a de-duplication. It is a BEHAVIOUR change:
 *  the vertex count, the attribute set and the draw all move. Publishing the
 *  small one is the honest way to have both.
 *
 *  NORMALS GO THROUGH THE NORMAL MATRIX, not the model matrix, which is the one
 *  thing that is easy to get wrong here and invisible until something is
 *  non-uniformly scaled — at which point its shading is lit from a direction
 *  the geometry does not face. A part with no normals contributes +Y, which is
 *  wrong for a wall and right for the flat plates this is usually handed.
 * ============================================================================
 */

/** One part: a geometry and where to put it. */
export interface WeldPart {
  geo: THREE.BufferGeometry;
  m: THREE.Matrix4;
}

export function weldParts(parts: readonly WeldPart[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const nmat = new THREE.Matrix3();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const part of parts) {
    nmat.getNormalMatrix(part.m);
    const pa = part.geo.getAttribute('position');
    const na = part.geo.getAttribute('normal');
    for (let i = 0; i < pa.count; i++) {
      p.fromBufferAttribute(pa, i).applyMatrix4(part.m);
      pos.push(p.x, p.y, p.z);
      if (na) {
        n.fromBufferAttribute(na, i).applyMatrix3(nmat).normalize();
        nor.push(n.x, n.y, n.z);
      } else {
        nor.push(0, 1, 0);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
