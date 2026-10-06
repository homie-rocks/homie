/**
 * ============================================================================
 *  LodProps — one kind of prop, drawn as two instanced meshes by distance.
 * ============================================================================
 *
 *  A level scatters a few hundred rocks, mushrooms or crates. Drawn as one
 *  `InstancedMesh` of the full model they cost the full triangle count at
 *  every distance, including the ones four pixels tall; drawn as individual
 *  meshes so three can cull them they cost a draw call each. This is the
 *  arrangement in between, and it is two draw calls for the whole set:
 *
 *      near < d <= lodAt   the full model            (`hi`)
 *      lodAt < d <= far    a decimated copy of it    (`lo`)
 *      otherwise           not drawn
 *
 *  `update(camera position, bands)` re-buckets every instance and writes each
 *  bucket nearest first, so the depth buffer rejects most of what is hidden
 *  behind a nearer prop before it is shaded.
 *
 *  THE BANDS ARE DATA, PER TIER ({@link LodBands}, {@link LOD_BANDS}): a phone
 *  switches to the low model sooner, stops drawing sooner, and keeps a smaller
 *  share of the set. `density` thins by a fixed hash of the instance index, so
 *  the SAME props survive on every frame and on every device at that tier, and
 *  changing tier needs no rebuild. `near` exists because a prop the lens is
 *  inside is a screen full of back faces.
 *
 *  PER-INSTANCE TINT rides three's own `instanceColor`, which multiplies the
 *  material colour: one material, any number of zones.
 *
 *  THE LOW MODEL can come from a file (an asset pipeline that writes a
 *  decimated copy beside each model) or be made at load by
 *  {@link decimateGeometry} / {@link autoLo}, which is grid vertex clustering:
 *  crude, fast, and unable to open a hole. Good enough for the band it is
 *  drawn in, which starts where the difference stops being visible.
 *
 *  THE SORT IS A PLAIN FUNCTION ({@link sortLod}) over flat arrays with no
 *  three in it, so the bucketing, the order and the culling are tested in Node.
 *
 *  three's own culling is switched off on both meshes for the reason
 *  `instpool.ts` gives: it would test the base geometry's bounds, which sit at
 *  the origin, and drop the whole set when the camera looks away from there.
 * ============================================================================
 */
import * as THREE from 'three';

/** Where each model is drawn, in metres from the camera, and how much of the set is kept. */
export interface LodBands {
  /** Nearer than this is not drawn. 0 draws everything near. */
  readonly near: number;
  /** Up to here the full model; past it the low one. */
  readonly lodAt: number;
  /** Past this is not drawn. */
  readonly far: number;
  /** Fraction of the set kept, 0..1, chosen by a fixed hash of the index. */
  readonly density: number;
}

/** A starting set of bands for three tiers. Copy it and change it. */
export const LOD_BANDS: Readonly<Record<'high' | 'medium' | 'low', LodBands>> = {
  high: { near: 0, lodAt: 45, far: 160, density: 1 },
  medium: { near: 0, lodAt: 28, far: 110, density: 0.65 },
  low: { near: 0, lodAt: 16, far: 70, density: 0.35 },
};

/**
 * Whether instance `i` survives at `density`. A fixed integer hash to 0..1, so
 * the answer for an index never changes, and raising the density only ever
 * ADDS props to the ones already there.
 */
export function lodKeeps(i: number, density: number): boolean {
  if (density >= 1) return true;
  let h = (i + 1) * 0x9e3779b1;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 < density;
}

/**
 * Bucket `n` positions by distance from a point and order each bucket nearest
 * first.
 *
 * `positions` is xyz per instance. On return `order[0 .. hi)` are the indices
 * to draw with the full model and `order[hi .. hi + lo)` with the low one;
 * `d2` (at least `n` long) is scratch that ends holding each index's squared
 * distance. Both are the caller's, so a frame allocates nothing.
 */
export function sortLod(
  positions: ArrayLike<number>, n: number, cx: number, cy: number, cz: number,
  bands: LodBands, order: Uint32Array, d2: Float32Array, out: { hi: number; lo: number },
): { hi: number; lo: number } {
  const near2 = bands.near * bands.near, lod2 = bands.lodAt * bands.lodAt, far2 = bands.far * bands.far;
  // Full-model indices fill from the front, low-model ones from the back, so
  // one pass buckets both without a second array.
  let hi = 0, back = n;
  for (let i = 0; i < n; i++) {
    const dx = (positions[i * 3] as number) - cx;
    const dy = (positions[i * 3 + 1] as number) - cy;
    const dz = (positions[i * 3 + 2] as number) - cz;
    const d = dx * dx + dy * dy + dz * dz;
    d2[i] = d;
    if (d < near2 || d > far2 || !lodKeeps(i, bands.density)) continue;
    if (d <= lod2) order[hi++] = i;
    else order[--back] = i;
  }
  const lo = n - back;
  const byDistance = (a: number, b: number) => (d2[a] as number) - (d2[b] as number) || a - b;
  order.subarray(0, hi).sort(byDistance);
  order.copyWithin(hi, back, n);
  order.subarray(hi, hi + lo).sort(byDistance);
  out.hi = hi; out.lo = lo;
  return out;
}

export interface LodPropsOpts {
  /**
   * How far from the origin an instance may be, in world units. Required, for
   * the reason `instpool.ts` gives at length: it is the bounding sphere the
   * shadow pass and anything else that asks will be handed.
   */
  spread: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export class LodProps {
  /** The full model and the low one. Add both to the scene (or add `group`). */
  readonly hi: THREE.InstancedMesh;
  readonly lo: THREE.InstancedMesh;
  readonly group = new THREE.Group();
  /** What the last `update` drew. */
  readonly drawn = { hi: 0, lo: 0 };

  private n = 0;
  private readonly cap: number;
  private readonly matrices: Float32Array;
  private readonly positions: Float32Array;
  private readonly tints: Float32Array;
  private readonly order: Uint32Array;
  private readonly d2: Float32Array;

  /** `loMaterial` defaults to the same material: the tint and the lighting then match exactly. */
  constructor(
    hiGeo: THREE.BufferGeometry, loGeo: THREE.BufferGeometry, material: THREE.Material,
    capacity: number, opts: LodPropsOpts, loMaterial: THREE.Material = material,
  ) {
    this.cap = capacity;
    this.matrices = new Float32Array(capacity * 16);
    this.positions = new Float32Array(capacity * 3);
    this.tints = new Float32Array(capacity * 3).fill(1);
    this.order = new Uint32Array(capacity);
    this.d2 = new Float32Array(capacity);
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.InstancedMesh(geo, mat, capacity);
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(), opts.spread);
      m.castShadow = opts.castShadow ?? true;
      m.receiveShadow = opts.receiveShadow ?? true;
      this.group.add(m);
      return m;
    };
    this.hi = make(hiGeo, material);
    this.lo = make(loGeo, loMaterial);
  }

  get count(): number { return this.n; }

  /** Add one prop. Returns its index, or -1 when the set is full. */
  add(matrix: THREE.Matrix4, tint?: THREE.Color): number {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    const e = matrix.elements;
    this.matrices.set(e, i * 16);
    this.positions[i * 3] = e[12] as number;
    this.positions[i * 3 + 1] = e[13] as number;
    this.positions[i * 3 + 2] = e[14] as number;
    if (tint) this.setTint(i, tint);
    return i;
  }

  /** Tint one prop. Takes effect at the next `update`. */
  setTint(i: number, tint: THREE.Color): void {
    this.tints[i * 3] = tint.r; this.tints[i * 3 + 1] = tint.g; this.tints[i * 3 + 2] = tint.b;
  }

  /** Remove every prop. */
  clear(): void {
    this.n = 0;
    this.hi.count = 0; this.lo.count = 0;
    this.drawn.hi = 0; this.drawn.lo = 0;
  }

  /**
   * Re-bucket and re-order for a camera at (x, y, z). Call it when the camera
   * has moved enough to matter (every frame is fine for a few thousand props;
   * every half metre of travel is the same picture for less).
   */
  update(x: number, y: number, z: number, bands: LodBands): { hi: number; lo: number } {
    sortLod(this.positions, this.n, x, y, z, bands, this.order, this.d2, this.drawn);
    this.fill(this.hi, 0, this.drawn.hi);
    this.fill(this.lo, this.drawn.hi, this.drawn.lo);
    return this.drawn;
  }

  private fill(mesh: THREE.InstancedMesh, from: number, count: number): void {
    const m = mesh.instanceMatrix.array as Float32Array;
    const c = mesh.instanceColor!.array as Float32Array;
    for (let k = 0; k < count; k++) {
      const i = this.order[from + k] as number;
      m.set(this.matrices.subarray(i * 16, i * 16 + 16), k * 16);
      c[k * 3] = this.tints[i * 3] as number;
      c[k * 3 + 1] = this.tints[i * 3 + 1] as number;
      c[k * 3 + 2] = this.tints[i * 3 + 2] as number;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
  }

  /** Releases the two instance buffers. The geometries and materials are the caller's. */
  dispose(): void {
    this.hi.dispose(); this.lo.dispose();
  }
}

/** Triangles in a geometry, indexed or not. */
export function triangleCount(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position');
  return Math.floor((geo.index ? geo.index.count : pos ? pos.count : 0) / 3);
}

/**
 * A lower-triangle copy of `geo` by grid vertex clustering: every vertex in
 * the same `cell`-sized cube becomes one (at their average, with `uv` and
 * `color` averaged too), and a triangle left with two corners in one cube is
 * dropped. Normals are recomputed. It can lose a thin feature; it cannot tear
 * a surface, because a collapsed cluster removes triangles and never moves a
 * shared vertex to two places.
 *
 * Skinned and morphed geometry is not handled: the result carries only
 * `position`, `normal`, and `uv` / `color` when the source has them.
 */
export function decimateGeometry(geo: THREE.BufferGeometry, cell: number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const col = geo.getAttribute('color');
  const colSize = col ? col.itemSize : 0;
  const n = pos.count;
  const inv = 1 / cell;

  const cluster = new Uint32Array(n);
  const ids = new Map<string, number>();
  const sumP: number[] = [], sumUv: number[] = [], sumC: number[] = [], members: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.floor(x * inv)},${Math.floor(y * inv)},${Math.floor(z * inv)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = members.length;
      ids.set(key, id);
      members.push(0); sumP.push(0, 0, 0);
      if (uv) sumUv.push(0, 0);
      for (let k = 0; k < colSize; k++) sumC.push(0);
    }
    cluster[i] = id;
    members[id] = (members[id] as number) + 1;
    sumP[id * 3] = (sumP[id * 3] as number) + x;
    sumP[id * 3 + 1] = (sumP[id * 3 + 1] as number) + y;
    sumP[id * 3 + 2] = (sumP[id * 3 + 2] as number) + z;
    if (uv) {
      sumUv[id * 2] = (sumUv[id * 2] as number) + uv.getX(i);
      sumUv[id * 2 + 1] = (sumUv[id * 2 + 1] as number) + uv.getY(i);
    }
    for (let k = 0; k < colSize; k++) sumC[id * colSize + k] = (sumC[id * colSize + k] as number) + col!.getComponent(i, k);
  }

  const count = members.length;
  const index: number[] = [];
  const tris = triangleCount(geo);
  const at = (k: number) => cluster[geo.index ? geo.index.getX(k) : k] as number;
  for (let t = 0; t < tris; t++) {
    const a = at(t * 3), b = at(t * 3 + 1), c = at(t * 3 + 2);
    if (a !== b && b !== c && a !== c) index.push(a, b, c);
  }

  const out = new THREE.BufferGeometry();
  const mean = (sum: number[], size: number) => {
    const a = new Float32Array(count * size);
    for (let id = 0; id < count; id++) {
      for (let k = 0; k < size; k++) a[id * size + k] = (sum[id * size + k] as number) / (members[id] as number);
    }
    return new THREE.BufferAttribute(a, size);
  };
  out.setAttribute('position', mean(sumP, 3));
  if (uv) out.setAttribute('uv', mean(sumUv, 2));
  if (col) out.setAttribute('color', mean(sumC, colSize));
  out.setIndex(index);
  out.computeVertexNormals();
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/**
 * The low model for `geo`, made automatically: the finest clustering whose
 * triangle count is at or under `ratio` times the source's (0.25 keeps about
 * a quarter). Twelve bisections of the cell size, once, at load.
 */
export function autoLo(geo: THREE.BufferGeometry, ratio: number): THREE.BufferGeometry {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 1e-6);
  const want = Math.max(1, Math.floor(triangleCount(geo) * ratio));
  // At a cell the size of the model everything is one vertex; at a
  // thousandth of it nothing merges. The answer is between.
  let fine = span / 1024, coarse = span;
  let best: THREE.BufferGeometry | null = null;
  for (let i = 0; i < 12; i++) {
    const mid = Math.sqrt(fine * coarse);
    const g = decimateGeometry(geo, mid);
    if (triangleCount(g) <= want) { best?.dispose(); best = g; coarse = mid; } else { g.dispose(); fine = mid; }
  }
  return best ?? decimateGeometry(geo, coarse);
}
