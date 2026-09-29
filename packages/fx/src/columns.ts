/**
 * ============================================================================
 *  columns — a pool of straight, hard-edged tubes of lit gas
 * ============================================================================
 *  One instanced draw for every column in the air, count 0 for most of a lap,
 *  fourteen triangles an instance. A column is either BOUND — something is
 *  still moving, so the head tracks it and the tail pays out behind — or
 *  ABANDONED, in which case it does not move at all and cools where it is.
 *
 *  That second state is the whole reason this is not a mesh hanging off the
 *  thing that laid the column down: the two have different lifetimes. A caller
 *  that wants a trail which vanishes with its emitter can have one by abandoning
 *  with `cool` at 0; a caller in vacuum, where nothing disperses a plume, gets a
 *  column that outlives the round by whatever it asks for.
 *
 * ----------------------------------------------------------------------------
 *  A TAPERED OPEN TUBE, NOT A BILLBOARD
 * ----------------------------------------------------------------------------
 *  A flat card seen edge-on has no projected area and vanishes, and a trail that
 *  disappears when the camera lines up behind the shot is a trail that is
 *  missing from precisely the frame a chase camera produces. A tube has the same
 *  silhouette from every direction and needs no camera to orient it.
 *
 *  `DoubleSide` means the far wall draws too, so the additive sum is brightest
 *  along the column's axis and thins at its silhouette — which is what a
 *  cylinder of luminous gas actually does, for free, with no shader.
 *
 * ----------------------------------------------------------------------------
 *  NO LOOK LIVES HERE
 * ----------------------------------------------------------------------------
 *  The colour, both radii, the side count, the two curves and every lifetime are
 *  the caller's, with no defaults. `ColumnSpec.ramp` is baked once into a vertex
 *  colour rather than sampled from a map, because it is a pure function of
 *  position along the column: a 1-D gradient texture would be a whole extra
 *  sampler and its mip chain would smear the head into the tail at range.
 *  `instanceColor` multiplies on top of it, and that is where per-column
 *  intensity and the post-abandonment fade live.
 */
import * as THREE from 'three';

/** One column: a live trail, the cooling ghost of one, or a static shard. */
export interface Column {
  /** caller's handle on whatever this is following, or -1 once abandoned */
  bound: number;
  /** the caller's generation counter for that handle, so a recycled slot cannot
   *  be mistaken for the thing it used to follow */
  serial: number;
  /** the hot end, in world space */
  head: THREE.Vector3;
  /** unit direction of travel; the column runs back along -dir from `head` */
  dir: THREE.Vector3;
  len: number;
  /** how long this column is allowed to grow to, world units */
  maxLen: number;
  /** radial scale on the authored head radius */
  rad: number;
  /** scene-linear value at the head before the cooling ramp */
  hdr: number;
  /** seconds this takes to cool once unbound */
  cool: number;
  /** seconds of cooling left once unbound; <= 0 with `bound` -1 means free */
  fade: number;
}

/** What a bound column is following. Anything with a position and a velocity. */
export interface ColumnSource {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
}

export interface ColumnSpec {
  /** pool size, and the instance cap of the single draw */
  count: number;
  /** head and tail radius of the tube, world units */
  r0: number;
  r1: number;
  /** radial segments. Seven is enough at 2-3 px across. */
  sides: number;
  /** the material's base colour */
  colour: THREE.ColorRepresentation;
  /** the local axis the tube is modelled along and oriented to */
  forward: THREE.Vector3;
  /** vertex ramp along the column, u = 0 at the tail and 1 at the head */
  ramp: (u: number) => number;
  /** per-instance intensity as an abandoned column cools, k = 1 -> 0 */
  fade: (k: number) => number;
  /** whether the head's value is authored in scene-linear units (so it has to
   *  survive the tonemap to seed a bloom) or straight in display units */
  toneMapped: boolean;
  renderOrder: number;
  /** material and mesh name, for a prewarm register and for a capture to find */
  label: string;
}

const _mtx = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _col = new THREE.Color();
const _scl = new THREE.Vector3();

export class ColumnPool {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly columns: Column[] = [];
  private readonly forward: THREE.Vector3;
  private readonly fadeCurve: (k: number) => number;

  constructor(spec: ColumnSpec) {
    this.forward = spec.forward.clone().normalize();
    this.fadeCurve = spec.fade;

    const geo = new THREE.CylinderGeometry(spec.r0, spec.r1, 1, spec.sides, 1, true);
    geo.rotateX(Math.PI / 2);      // modelled along +Y -> runs along +Z
    geo.translate(0, 0, -0.5);     // head at the origin, tail at z = -1
    {
      const p = geo.attributes.position as THREE.BufferAttribute;
      const col: number[] = [];
      for (let i = 0; i < p.count; i++) {
        // z runs 0 at the head to -1 at the tail.
        const u = Math.max(0, Math.min(1, 1 + p.getZ(i)));
        const w = spec.ramp(u);
        col.push(w, w, w);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    }

    this.material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(spec.colour),
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      // Depth-TESTED so real geometry occludes the column — one that draws
      // through a structure is the loudest amateur tell available — but never
      // depth-writing, because overlapping columns must sum rather than z-fight.
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: spec.toneMapped,
    });
    this.material.name = spec.label;

    this.mesh = new THREE.InstancedMesh(geo, this.material, spec.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = spec.renderOrder;
    this.mesh.name = spec.label;
    // `setColorAt` is what allocates `instanceColor`; without one call before a
    // prewarm the program compiles WITHOUT the instancing-colour define and
    // recompiles mid-play on the first column lit.
    this.mesh.setColorAt(0, _col.setScalar(0));

    for (let i = 0; i < spec.count; i++) {
      this.columns.push({
        bound: -1, serial: 0, head: new THREE.Vector3(),
        dir: this.forward.clone(), len: 0, maxLen: 0, fade: 0,
        rad: 1, hdr: 0, cool: 0,
      });
    }
  }

  /**
   * A slot to draw into, in strict order of preference:
   *
   *   1. genuinely free,
   *   2. the abandoned ghost NEAREST death (smallest positive `fade`),
   *   3. only if every slot is bound, the OLDEST binding, by `serial`.
   *
   * @param steal false to refuse rules 2 and 3 — a caller that only wants a
   *              spare slot, so a secondary effect on the far side of the field
   *              can never cost something in front of the camera its trail.
   */
  take(steal: boolean): Column | null {
    for (const t of this.columns) {
      if (t.bound < 0 && t.fade <= 0) return t;
    }
    if (!steal) return null;
    let ghost: Column | null = null;
    let oldest: Column | null = null;
    for (const t of this.columns) {
      if (t.bound < 0) {
        if (!ghost || t.fade < ghost.fade) ghost = t;
      } else if (!oldest || t.serial < oldest.serial) oldest = t;
    }
    return ghost ?? oldest;
  }

  /** Free every slot and empty the draw. */
  clear() {
    for (const t of this.columns) { t.bound = -1; t.fade = 0; t.len = 0; }
    this.mesh.count = 0;
  }

  /**
   * Advance every column and submit the ones that are still warm.
   *
   * `follow` is asked, once per bound column, for the thing it is following;
   * returning null means that thing is gone — or that its handle has already
   * been recycled into something else, which is what `serial` is for — and the
   * column is abandoned to cool where it is.
   */
  update(dt: number, follow: (c: Column) => ColumnSource | null) {
    let n = 0;
    for (const t of this.columns) {
      if (t.bound >= 0) {
        const src = follow(t);
        if (!src) {
          t.bound = -1;
          t.fade = t.cool;
        } else {
          t.head.copy(src.pos);
          const sp = src.vel.length();
          if (sp > 1e-4) t.dir.copy(src.vel).multiplyScalar(1 / sp);
          t.len = Math.min(t.maxLen, t.len + sp * dt);
        }
      } else if (t.fade > 0) {
        t.fade -= dt;
        if (t.fade <= 0) { t.fade = 0; continue; }
      } else continue;

      if (n >= this.columns.length) break;
      const i = n++;
      _quat.setFromUnitVectors(this.forward, t.dir);
      // z is the length; x and y are the section, so a column keeps its authored
      // head radius at every length — one just lit is a short thick stub and one
      // at full reach is a long one, rather than the whole thing growing.
      _scl.set(t.rad, t.rad, t.len);
      _mtx.compose(t.head, _quat, _scl);
      this.mesh.setMatrixAt(i, _mtx);
      const k = t.bound >= 0 ? 1 : t.fade / t.cool;
      this.mesh.setColorAt(i, _col.setScalar(t.hdr * this.fadeCurve(k)));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
