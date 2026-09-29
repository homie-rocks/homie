/**
 * ============================================================================
 *  GeoAccum — many geometries in, one buffer out.
 * ============================================================================
 *  Collects transformed geometries into a single indexed BufferGeometry with
 *  vertex colours carrying tint and baked AO. This is the merge half of a
 *  draw-call budget: the per-frame POLICY (which groups collapse, when, and
 *  which cascade sees them) belongs to the caller, and depends on this for the
 *  accumulation itself.
 *
 *  Byte-identical in the two racing games it was extracted from.
 *
 *  It knows a matrix, a tint and a triangle. It does not know what was merged.
 */
import * as THREE from 'three';

const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();

/** Collects transformed geometries into one buffer. Vertex colours carry tint + baked AO. */
export class GeoAccum {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private vcount = 0;
  count = 0;

  /** `aoFn(localY)` bakes contact darkening at the foot of every wall. */
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, color?: THREE.Color, aoFn?: (x: number, y: number, z: number) => number, uvOff?: THREE.Vector2) {
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    const n = geo.getAttribute('normal') as THREE.BufferAttribute;
    const u = geo.getAttribute('uv') as THREE.BufferAttribute;
    // Sub-assemblies are built in their own accumulator and folded into a
    // bigger one; their baked tint has to survive that.
    const c0 = geo.getAttribute('color') as THREE.BufferAttribute;
    const index = geo.getIndex();
    _nm.getNormalMatrix(m);
    const base = this.vcount;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i);
      const lx = _v.x,
        ly = _v.y,
        lz = _v.z;
      _v.applyMatrix4(m);
      this.pos.push(_v.x, _v.y, _v.z);
      if (n) {
        _v.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
        this.nrm.push(_v.x, _v.y, _v.z);
      } else this.nrm.push(0, 1, 0);
      if (u) this.uv.push(u.getX(i) + (uvOff ? uvOff.x : 0), u.getY(i) + (uvOff ? uvOff.y : 0));
      else this.uv.push(0, 0);
      const ao = aoFn ? aoFn(lx, ly, lz) : 1;
      const br = c0 ? c0.getX(i) : 1;
      const bg = c0 ? c0.getY(i) : 1;
      const bb = c0 ? c0.getZ(i) : 1;
      if (color) this.col.push(color.r * br * ao, color.g * bg * ao, color.b * bb * ao);
      else this.col.push(br * ao, bg * ao, bb * ao);
    }
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    this.vcount += p.count;
    this.count++;
  }

  build(): THREE.BufferGeometry | null {
    if (!this.vcount) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    // free the JS-side scratch; these arrays are megabytes for the village
    this.pos = this.nrm = this.uv = this.col = this.idx = [];
    return g;
  }
}
