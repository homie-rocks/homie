/**
 * ============================================================================
 *  Brush.ts — the authoring half: say `box`, get collision AND geometry.
 * ============================================================================
 *
 *  ## THE SHAPE, AND WHY IT IS SHARED
 *
 *  The first-person shooter this was extracted from built its station in one
 *  1,746-line file, and the overwhelming majority of it is coordinates — where
 *  the hab is, how wide the dock mouth is, which corner the stairs climb. That
 *  is content and it stayed in the game, every literal of it.
 *
 *  Underneath the coordinates was a BUILDER, and the rule here is that when a
 *  game writes a builder to describe its own world, the builder is shared code
 *  even when every call to it is content. Eight methods, and you can say what
 *  each one does without naming a station, a well or a brine tank:
 *
 *      box     — a solid: one collider and one merged BoxGeometry
 *      deco    — visual only, no collider (ceiling pipes, guy wires, panes)
 *      mesh    — a geometry somebody else built, into a material bucket
 *      slab    — a floor or a ceiling, thickness hanging off the named face
 *      wall    — a box that is always the wall surface
 *      doorWall— a wall with a gap in its LONG axis and a header over it
 *      stairs  — a flight of boxes between two heights in one of four dirs
 *      merge   — every bucket collapsed to one mesh per material
 *
 *  A NINTH, `ring` — four walls around a rectangle — WAS NOT TAKEN. It had
 *  ZERO call sites, and dead code is deleted rather than extracted: moving it
 *  would have turned four unreachable lines in one game into four unreachable
 *  lines on a shelf every game reads, which is worse. It was four calls to
 *  `box`.
 *
 *  ## WHAT WAS LIFTED OUT, AND THE ONE THING THAT WAS NOT
 *
 *  Three kinds of number left the builder and went into the game's hands:
 *
 *   · surfaces. `wall()` used the game's `Surface.Concrete` and `stairs()` its
 *     `Surface.Metal`. Concrete is a material in a station; it is not a
 *     platform concept. Both are options and the class is generic over the
 *     game's own enum, so no call site casts in either direction.
 *   · stair geometry (rise 0.175, run 0.30, width 1.7) and the door header
 *     height (2.35). Tuned numbers. Options, defaulted to exactly what the
 *     original station used, so its call sites did not have to grow an
 *     argument each to stand still.
 *   · THE TILE TABLE. `deco()`'s UV pass is two separable things: a RULE about
 *     world-space UVs, and a TABLE saying ice tiles at 14 m over a long span
 *     and salt at 3.2. The rule is here; the table is a callback the game
 *     supplies, because "how big is the grain in brine-stained deck plate" is
 *     art direction and a package that shipped an answer would have shipped
 *     one game's look to every other one.
 *
 *  THE RULE ITSELF IS NOT NEGOTIABLE AND IS NOT A TUNING, WHICH IS WHY IT IS
 *  HERE AND NOT IN THE CALLBACK. A `THREE.BoxGeometry`'s UVs are 0..1 per
 *  face, so a 10 m floor and a 1 m crate get the same number of texture
 *  repeats and the floor is a smear. Scaling by extent-over-tile is what puts
 *  the grain in metres. The `floorish` branch carries a MEASURED defect in its
 *  comment — mapping the two largest extents onto (u,v) stretched every
 *  Z-long floor, 10.8 m of rust grain across 1.8 repeats — and that comment is
 *  load-bearing: the obvious simplification is the bug it was written to fix.
 *
 *  ## WHY THE MERGE IS NOT `@homie-rocks/geom/GeoAccum`
 *
 *  It looks like a twin and it is not one, and collapsing them would be a
 *  picture change in two games at once. `GeoAccum` applies a matrix per
 *  geometry, bakes a tint and an AO term into a `color` attribute, and pushes
 *  through JS arrays. This merge applies a TRANSLATION ONLY, writes no colour
 *  attribute at all, and preallocates typed arrays from a counted total. A
 *  station's materials are not `vertexColors: true`; handing them a colour
 *  attribute is a per-vertex payload nothing reads, and handing an accumulator
 *  that bakes AO a wall it should not darken is a visible change. They stand
 *  side by side with the argument written on them, which is the same call this
 *  repository already made for its two bevelled boxes.
 *
 *  `three` is a peerDependency. Two copies is two `instanceof` universes.
 */
import * as THREE from 'three';
import { CollisionWorld } from './Collide.ts';

/** One material's worth of pending geometry, plus where each piece goes. */
type Bucket = { pos: THREE.Vector3[]; geo: THREE.BufferGeometry[]; mat: THREE.Material };

export interface BrushOpts<S extends number, M extends string> {
  /** The collider this builder feeds. Owned by the caller so it can be queried before `merge`. */
  col: CollisionWorld<S>;
  /** The game's material table. Called once per material, the first time it is used. */
  material: (mat: M) => THREE.Material;
  /**
   * Where `merge()` hangs the finished meshes. Supply the game's own node and
   * the scene graph is EXACTLY the shape it was before this builder existed —
   * an extra Group with an identity transform renders identically and is not
   * the same tree, and something always traverses.
   */
  group?: THREE.Group;
  /**
   * Metres of texture per repeat, for this material and this box.
   *
   * `span` is `max(sx, sz)` — the extent the caller will most often be
   * reasoning about, since a long deck and a long wall are the two shapes that
   * smear. Return a constant to ignore all of it.
   */
  tile: (mat: M, span: number, sx: number, sy: number, sz: number) => number;
  /** What `wall()` and `doorWall()` build out of. */
  wallSurface: S;
  /** What `stairs()` builds out of. */
  stairSurface: S;
  /** Height of the opening `doorWall` cuts, metres. */
  doorHeight?: number;
  /** Stair riser / tread / flight width, metres. */
  stairRise?: number;
  stairRun?: number;
  stairWidth?: number;
}

export class BrushKit<S extends number, M extends string> {
  readonly group: THREE.Group;
  private buckets = new Map<M, Bucket>();
  private readonly o: BrushOpts<S, M>;

  constructor(opts: BrushOpts<S, M>) {
    this.o = opts;
    this.group = opts.group ?? new THREE.Group();
  }

  /** A solid: collider plus visible geometry. */
  box(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    mat: M, surface: S, flags?: { floorOnly?: boolean; blockOnly?: boolean },
  ) {
    this.o.col.addBox(x0, y0, z0, x1, y1, z1, surface, flags);
    this.deco(x0, y0, z0, x1, y1, z1, mat);
  }

  /** Visual-only box. Ceiling pipes, guy wires and window panes must not snag the capsule. */
  deco(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    mat: M,
  ) {
    const sx = Math.abs(x1 - x0), sy = Math.abs(y1 - y0), sz = Math.abs(z1 - z0);
    if (sx < 1e-3 || sy < 1e-3 || sz < 1e-3) return;
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    // world-space UVs so tiling is in metres, not per-box
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    // Box +Y is u=X, v=Z. Mapping the two largest extents onto (u,v)
    // stretched every Z-long floor (10.8 m of rust grain on 1.8 repeats,
    // which read as orange/teal boards).
    const a = Math.max(sx, sy, sz);
    const b = sx + sy + sz - a - Math.min(sx, sy, sz);
    const span = Math.max(sx, sz);
    const floorish = sy < Math.min(sx, sz) * 0.4;
    const tile = this.o.tile(mat, span, sx, sy, sz);
    const uScale = floorish ? sx / tile : a / tile;
    const vScale = floorish ? sz / tile : b / tile;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale);
    }
    this.bucket(mat).geo.push(geo);
    this.bucket(mat).pos.push(new THREE.Vector3((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5));
  }

  /** A geometry the caller built, dropped into a material bucket at a point. */
  mesh(mat: M, geo: THREE.BufferGeometry, x: number, y: number, z: number) {
    this.bucket(mat).geo.push(geo);
    this.bucket(mat).pos.push(new THREE.Vector3(x, y, z));
  }

  /**
   * A floor or a ceiling. `thick` hangs BELOW `y` for a ceiling and above it
   * for a floor, so both are named by the face a person can see.
   */
  slab(
    x0: number, z0: number, x1: number, z1: number, y: number, thick: number,
    mat: M, surface: S, ceiling = false,
  ) {
    const y0 = ceiling ? y - thick : y;
    const y1 = ceiling ? y : y + thick;
    this.box(x0, y0, z0, x1, y1, z1, mat, surface, ceiling ? { blockOnly: true } : { floorOnly: false });
  }

  wall(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: M) {
    this.box(x0, y0, z0, x1, y1, z1, mat, this.o.wallSurface);
  }

  doorWall(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    doorW: number, mat: M,
  ) {
    // Gap the LONG axis. The old branches were swapped, so a north-south
    // wall grew a 2 m plug in X and the pump halls had no door.
    const head = this.o.doorHeight ?? 2.35;
    const longX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    if (longX) {
      const mid = (x0 + x1) * 0.5;
      this.wall(x0, y0, z0, mid - doorW * 0.5, y1, z1, mat);
      this.wall(mid + doorW * 0.5, y0, z0, x1, y1, z1, mat);
      this.wall(mid - doorW * 0.5, y0 + head, z0, mid + doorW * 0.5, y1, z1, mat);
    } else {
      const mid = (z0 + z1) * 0.5;
      this.wall(x0, y0, z0, x1, y1, mid - doorW * 0.5, mat);
      this.wall(x0, y0, mid + doorW * 0.5, x1, y1, z1, mat);
      this.wall(x0, y0 + head, mid - doorW * 0.5, x1, y1, mid + doorW * 0.5, mat);
    }
  }

  /** A flight between two heights. `dir` is +X, +Z, -X, -Z. */
  stairs(x: number, z: number, y0: number, y1: number, dir: 0 | 1 | 2 | 3, mat: M) {
    const rise = this.o.stairRise ?? 0.175;
    const run = this.o.stairRun ?? 0.30;
    const steps = Math.round((y1 - y0) / rise);
    const w = this.o.stairWidth ?? 1.7;
    for (let i = 0; i < steps; i++) {
      const y = y0 + i * rise;
      let x0 = x, z0 = z, x1 = x + w, z1 = z + run;
      if (dir === 0) { x0 = x + i * run; x1 = x0 + run + 0.02; z0 = z; z1 = z + w; }
      else if (dir === 2) { x0 = x - i * run; x1 = x0 + run + 0.02; z0 = z; z1 = z + w; }
      else if (dir === 1) { z0 = z + i * run; z1 = z0 + run + 0.02; x0 = x; x1 = x + w; }
      else { z0 = z - i * run; z1 = z0 + run + 0.02; x0 = x; x1 = x + w; }
      this.box(x0, y, z0, x1, y + rise, z1, mat, this.o.stairSurface);
    }
  }

  private bucket(mat: M): Bucket {
    let b = this.buckets.get(mat);
    if (!b) {
      b = { pos: [], geo: [], mat: this.o.material(mat) };
      this.buckets.set(mat, b);
    }
    return b;
  }

  /**
   * Collapse every bucket to one mesh. After this the builder is empty: the
   * source geometries are translated in place, merged and disposed, so calling
   * a method afterwards starts a second batch rather than corrupting the first.
   */
  merge() {
    for (const [, b] of this.buckets) {
      if (!b.geo.length) continue;
      const geos: THREE.BufferGeometry[] = [];
      for (let i = 0; i < b.geo.length; i++) {
        const g = b.geo[i]!;
        const at = b.pos[i]!;
        g.translate(at.x, at.y, at.z);
        geos.push(g);
      }
      const merged = mergeBuffers(geos);
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      for (const g of geos) g.dispose();
    }
    this.buckets.clear();
  }
}

/**
 * Many geometries, one indexed buffer. Position, normal, uv, index — nothing
 * else, and no transform: the caller has already put every vertex where it
 * goes.
 *
 * three's own `BufferGeometryUtils` lives under `examples/`, which is a path
 * that has broken this repository's sandbox before. See this file's header for
 * why this is not `@homie-rocks/geom`'s `GeoAccum` either.
 */
export function mergeBuffers(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let verts = 0, idxs = 0;
  for (const g of geos) {
    verts += g.attributes.position!.count;
    idxs += g.index ? g.index.count : g.attributes.position!.count;
  }
  const pos = new Float32Array(verts * 3);
  const nrm = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const index = new Uint32Array(idxs);
  let vo = 0, io = 0, uo = 0, iwrite = 0;
  for (const g of geos) {
    const p = g.attributes.position!.array as Float32Array;
    const n = g.attributes.normal?.array as Float32Array | undefined;
    const u = g.attributes.uv?.array as Float32Array | undefined;
    pos.set(p, vo);
    if (n) nrm.set(n, vo);
    if (u) uv.set(u, uo);
    const base = vo / 3;
    if (g.index) {
      const id = g.index.array;
      for (let i = 0; i < id.length; i++) index[iwrite++] = id[i]! + base;
    } else {
      for (let i = 0; i < p.length / 3; i++) index[iwrite++] = i + base;
    }
    vo += p.length;
    uo += u ? u.length : 0;
    io += g.index ? g.index.count : p.length / 3;
  }
  void io;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  if (!geos[0]?.attributes.normal) out.computeVertexNormals();
  return out;
}
