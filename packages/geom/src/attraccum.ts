/**
 * ============================================================================
 *  AttrAccum — a merge accumulator that carries a per-vertex FLOAT colour and
 *  a four-component `aVar` attribute alongside the triangles.
 * ============================================================================
 *  Extracted from a base-building game's structure builder, byte-for-byte
 *  apart from the class name and its own scratch vectors.
 *
 *  ── THIS PACKAGE NOW HAS TWO ACCUMULATORS AND THEY ARE NOT ALTERNATIVES ─────
 *
 *  `accum.ts`'s `GeoAccum` emits an INDEXED geometry, folds a baked-AO
 *  function and a UV offset in, and multiplies an incoming vertex colour so a
 *  sub-assembly's tint survives being folded into a bigger one. It is the
 *  racers' batcher.
 *
 *  `AttrAccum` emits a NON-INDEXED one, caches `toNonIndexed()` on the source
 *  geometry because a rib loop hands it the same source twenty-four times, and
 *  writes a fourth attribute. Its colour attribute is Float32 and the comment
 *  below says why in numbers: the emissive tiers are HDR (2.4 for structural)
 *  and a normalised byte attribute would clamp every strip to 1.0, under the
 *  bloom threshold — a bug that would present as "the strips just do not
 *  bloom" and be blamed on the post chain.
 *
 *  Neither is a better version of the other and merging them would move
 *  vertices in every game at once. Two names, one package, this paragraph.
 *
 *  ── WHAT IT DOES NOT KNOW ───────────────────────────────────────────────────
 *  What the four `aVar` channels MEAN is the caller's business and is not
 *  written down here. In the game it came from they are (phase, grime, emissive, mode) for
 *  the glow material and (roughness delta, grime, 0, 0) for everything else;
 *  in the next game they will be something else, and a package that named them
 *  would be a package that knew what a colony was.
 */
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

const _nm3 = new THREE.Matrix3();

export class AttrAccum {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  vars: number[] = [];

  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, c: THREE.Color, vx: number, vy: number, vz: number, vw: number) {
    // toNonIndexed allocates a whole new geometry, and a rib loop calls this
    // twenty-four times with the same source. Cache it on the source.
    // A degenerate source (a sweep given fewer than two frames, a dashed
    // ribbon that fell entirely in a gap) has no position attribute at all.
    // Reading .count off it throws inside a build loop, which surfaces as the
    // whole colony failing to appear rather than as one missing kerb.
    if (!geo.attributes.position) return;
    let g = geo;
    if (geo.index) {
      const cached = (geo.userData as any).__geomNonIndexed as THREE.BufferGeometry | undefined;
      g = cached || ((geo.userData as any).__geomNonIndexed = geo.toNonIndexed());
    }
    const p = g.attributes.position.array as ArrayLike<number>;
    const n = g.attributes.normal ? (g.attributes.normal.array as ArrayLike<number>) : null;
    const u = g.attributes.uv ? (g.attributes.uv.array as ArrayLike<number>) : null;
    const count = g.attributes.position.count;
    _nm3.getNormalMatrix(m);
    for (let i = 0; i < count; i++) {
      _v.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).applyMatrix4(m);
      this.pos.push(_v.x, _v.y, _v.z);
      if (n) {
        _v2.set(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]).applyMatrix3(_nm3).normalize();
        this.nor.push(_v2.x, _v2.y, _v2.z);
      } else this.nor.push(0, 1, 0);
      if (u) this.uv.push(u[i * 2], u[i * 2 + 1]); else this.uv.push(0, 0);
      this.col.push(c.r, c.g, c.b);
      this.vars.push(vx, vy, vz, vw);
    }
  }

  get empty() { return this.pos.length === 0; }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    // FLOAT colour, not a normalised byte one: the emissive tiers are HDR
    // (structural is 2.4) and a Uint8 attribute would clamp every strip in the
    // game to 1.0, which is under the bloom threshold. The bug would look like
    // "the strips just do not bloom" and would be blamed on the post chain.
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aVar', new THREE.Float32BufferAttribute(this.vars, 4));
    g.computeBoundingSphere();
    return g;
  }
}
