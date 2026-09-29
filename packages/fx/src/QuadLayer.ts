import * as THREE from 'three';

/*
 * ----------------------------------------------------------------------------
 *  A DECK-PROJECTED QUAD LAYER — rewritten in full every frame.
 * ----------------------------------------------------------------------------
 *  The other half of `Decals.ts`. A decal is a MARK: it is laid once, it ages,
 *  and the ring retires its own tail. This is the opposite — a quad here is
 *  where something IS right now, so nothing ages, nothing is retired, and the
 *  whole buffer is overwritten between `begin()` and `end()`.
 *
 *  Lifted out of a space racer's decal module, where the same buffer setup,
 *  the same quad index list, the same deck-plane projection, the same
 *  four-corner writer and the same upload dance were written out TWICE in one
 *  file — once for the mag-skirt footprint (two materials on one geometry) and
 *  once for the radiator bloom (one). Same interleaved layout as a decal, so it
 *  shares `DECAL_VERT` and the two layers cannot drift apart.
 *
 *  WHAT DID NOT MOVE, AND MUST NOT. Every fragment shader, every colour, every
 *  extent, every lift coefficient and every ride-height ramp is the game's and
 *  arrives as an argument. This file knows a point, a plane normal, a forward,
 *  two half-extents, two free floats and an RGBA. It has never heard of a ship.
 *
 * ----------------------------------------------------------------------------
 *  THE WINDING TRAP — read this before adding a layer or reordering a corner.
 * ----------------------------------------------------------------------------
 *  Every quad here is built as
 *
 *      seg  = fwd projected into the deck plane
 *      side = cross(seg, n)
 *      corners = p ∓ seg*hx ∓ side*hz,  indexed (0,1,2)(0,2,3)
 *
 *  and the face normal of triangle (0,1,2) is therefore
 *
 *      cross(2*seg*hx, 2*side*hz) ∝ cross(seg, cross(seg, n)) = -n
 *
 *  — ANTIPARALLEL to the plane normal, and antiparallel to it in BOTH
 *  orientations, because flipping `n` flips `side` and the sign cancels. So
 *  under three's default `FrontSide` these triangles are back-facing from every
 *  camera that can see the plate at all, and are culled by the rasteriser
 *  before they can draw a pixel — silently, while every counter, buffer upload
 *  and draw range reports that the layer is working. Callers therefore set
 *  `side: THREE.DoubleSide` on every material they hand in. It costs nothing:
 *  a flat quad only ever presents one face to any camera, so DoubleSide cannot
 *  double-draw it.
 * ----------------------------------------------------------------------------
 */

/** pos3 + uv2 + free2 + tint4 — `DECAL_VERT`'s layout, shared deliberately. */
export const QUAD_STRIDE = 11;

const _n = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _side = new THREE.Vector3();

/** One draw of the shared geometry. `renderOrder` and `name` are the game's. */
export interface QuadPass {
  material: THREE.Material;
  name: string;
  renderOrder: number;
}

export class QuadLayer {
  /** One per pass, all sharing `geometry` — so exactly one place can get the
   *  count wrong, and it is already written. */
  readonly meshes: THREE.Mesh[] = [];
  readonly geometry = new THREE.BufferGeometry();
  private readonly buffer: THREE.InterleavedBuffer;
  private readonly data: Float32Array;
  private n = 0;

  constructor(readonly capacity: number, passes: readonly QuadPass[]) {
    this.data = new Float32Array(capacity * 4 * QUAD_STRIDE);
    this.buffer = new THREE.InterleavedBuffer(this.data, QUAD_STRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    const g = this.geometry;
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    g.setAttribute('uv', new THREE.InterleavedBufferAttribute(this.buffer, 2, 3));
    g.setAttribute('aLife', new THREE.InterleavedBufferAttribute(this.buffer, 2, 5));
    g.setAttribute('aTint', new THREE.InterleavedBufferAttribute(this.buffer, 4, 7));
    const idx: number[] = [];
    for (let q = 0; q < capacity; q++) {
      const b = q * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    for (const p of passes) {
      const m = new THREE.Mesh(g, p.material);
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.name = p.name;
      m.renderOrder = p.renderOrder;
      this.meshes.push(m);
    }
  }

  /** Everything written last frame is discarded. */
  begin() { this.n = 0; }

  /** How many quads are live this frame. */
  get count() { return this.n; }

  /**
   * Project one quad onto the plane through `p` with normal `n`, oriented by
   * `fwd`, and fill all four corners with the same free pair and tint.
   *
   * `lift` is along `n` and is the caller's: a flat quad spanning several
   * metres of a surface that banks and carries its own crown will otherwise
   * sink its far corners into that surface and be depth-rejected, which reads
   * as a pool with a bite taken out of it.
   *
   * `uvO*`/`uvScale` address a tile in an atlas; a layer that samples no atlas
   * passes 0, 0, 1 and gets the quad's own 0..1.
   *
   * False if the layer is full or `fwd` is parallel to `n` — in which case
   * nothing was written and the count did not move.
   */
  quad(p: THREE.Vector3, n: THREE.Vector3, fwd: THREE.Vector3,
       hx: number, hz: number, lift: number,
       uvOx: number, uvOy: number, uvScale: number,
       f0: number, f1: number,
       r: number, g: number, b: number, a: number): boolean {
    if (this.n >= this.capacity) return false;
    _n.copy(n).normalize();
    // project forward into the plane; a body pitched 4° must not skew its own
    // footprint
    _seg.copy(fwd).addScaledVector(_n, -fwd.dot(_n));
    if (_seg.lengthSq() < 1e-8) return false;
    _seg.normalize();
    _side.crossVectors(_seg, _n).normalize();

    const px = p.x + _n.x * lift, py = p.y + _n.y * lift, pz = p.z + _n.z * lift;
    const ex = _seg.x * hx, ey = _seg.y * hx, ez = _seg.z * hx;
    const fx = _side.x * hz, fy = _side.y * hz, fz = _side.z * hz;

    const b0 = this.n++ * 4 * QUAD_STRIDE;
    this.vert(b0, px - ex - fx, py - ey - fy, pz - ez - fz, 0, 0,
      uvOx, uvOy, uvScale, f0, f1, r, g, b, a);
    this.vert(b0 + QUAD_STRIDE, px + ex - fx, py + ey - fy, pz + ez - fz, 1, 0,
      uvOx, uvOy, uvScale, f0, f1, r, g, b, a);
    this.vert(b0 + QUAD_STRIDE * 2, px + ex + fx, py + ey + fy, pz + ez + fz, 1, 1,
      uvOx, uvOy, uvScale, f0, f1, r, g, b, a);
    this.vert(b0 + QUAD_STRIDE * 3, px - ex + fx, py - ey + fy, pz - ez + fz, 0, 1,
      uvOx, uvOy, uvScale, f0, f1, r, g, b, a);
    return true;
  }

  private vert(o: number, x: number, y: number, z: number, u: number, v: number,
    ox: number, oy: number, us: number, f0: number, f1: number,
    r: number, g: number, b: number, a: number) {
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = ox + u * us; d[o + 4] = oy + v * us;
    d[o + 5] = f0; d[o + 6] = f1;
    d[o + 7] = r; d[o + 8] = g; d[o + 9] = b; d[o + 10] = a;
  }

  /** Upload and set the draw range. Call once, after the last `quad`. */
  end() {
    this.geometry.setDrawRange(0, this.n * 6);
    if (this.n > 0) {
      this.buffer.clearUpdateRanges();
      this.buffer.addUpdateRange(0, this.n * 4 * QUAD_STRIDE);
      this.buffer.needsUpdate = true;
    }
  }

  /** Geometry and every pass material. Shared resources (an atlas) are the
   *  caller's — this layer never made one. */
  dispose() {
    this.geometry.dispose();
    for (const m of this.meshes) (m.material as THREE.Material).dispose();
  }
}
