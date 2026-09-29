/**
 * ============================================================================
 *  worldbatch — collapsing a STATIC world into a handful of draw calls, and
 *  the two exceptions that have to stay out of the collapse.
 * ============================================================================
 *
 *  Every scene big enough to have a draw budget arrives at the same three
 *  pieces, and they are here rather than in whichever game hit the budget
 *  first:
 *
 *    StaticMerge   one mesh per MATERIAL for the whole world. A per-object
 *                  merger already collapses what is inside one object; this
 *                  collapses ACROSS objects, which is where the budget actually
 *                  goes once a world has a hundred of them.
 *    DrapedDecals  one mesh for every ground decal in the world, each stamped
 *                  as a grid that FOLLOWS the height field rather than a flat
 *                  quad. Out of the merge because it is transparent and wants
 *                  its own render order.
 *    HingeBatch    an instanced set that AIMS: one hinge axis, a travel limit,
 *                  a stow angle, driven from a world direction. Out of the
 *                  merge because a merged copy of a thing that moves is a
 *                  photograph of one instant, permanently.
 *
 *  ## What the caller binds, and why every one of these is an argument
 *
 *  A merge has to know which material a mesh belongs to (`MergeLib.keyOf`) and
 *  which material to draw the merged result with (`MergeLib.mats`). It must NOT
 *  know what those materials mean. So the two things that are a look — which
 *  keys cast and receive shadows, and what render order the transparent ones
 *  take — arrive as `flags`, one call per merged mesh, and the default is
 *  three's own default rather than any game's answer. The game that
 *  commissioned this passes a function saying that its emissive strips and its
 *  glazing do not cast (a strip's own shadow is a black line through the light
 *  it is casting) and that they draw late. That sentence is about that game and
 *  it stays there.
 *
 *  A parity probe's `batch` battery drives all three
 *  against the pre-move source out of git and compares every float of every
 *  attribute, over a scene with and without every optional attribute, with and
 *  without a release, and with an LOD and an animated node in it that must both
 *  be refused. Its `weld` battery separately proves a DIFFERENT `flags` and a
 *  DIFFERENT `stowBelow` produce a DIFFERENT result, because an extracted
 *  option that is welded shut passes a parity check for ever.
 *
 *  ## The exclusions are load-bearing and they are the caller's to declare
 *
 *  `absorb` refuses any mesh under a `THREE.LOD` (batching one level freezes
 *  the LOD at whichever tier happened to be current) and any mesh under an
 *  object the caller named as animated. Both are silent, plausible failures:
 *  the world still draws, it is simply wrong for ever after.
 *
 *  Arrived from a base-building game's structures module.
 */
import * as THREE from 'three';

/** A one-member height field. Any terrain with `heightAt` satisfies it. */
export interface HeightAt {
  heightAt(x: number, z: number): number;
}

/**
 * The material table a merge works against: forward for drawing the result,
 * reverse for bucketing an arbitrary mesh. `K` is the caller's own key union.
 */
export interface MergeLib<K extends string> {
  mats: Record<K, THREE.Material>;
  keyOf: Map<THREE.Material, K>;
}

export interface MergeOpts<K extends string> {
  /** Name on the group, for a scene-graph dump. */
  groupName?: string;
  /** Name on each merged mesh. Default `merged:<key>`. */
  meshName?: (key: K) => string;
  /**
   * Shadow flags and render order for one merged mesh. Called once, when the
   * mesh is first created. THE DEFAULT IS THREE'S DEFAULT — no cast, no
   * receive, order 0 — because which materials are emissive or transparent is
   * the caller's fact and not this file's.
   */
  flags?: (key: K, mesh: THREE.Mesh) => void;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m4b = new THREE.Matrix4();

// ─────────────────────────────────────────────────────────────────────────────
// The colony-wide static batch — the draw-call fix
//
// `Build` already merges everything INSIDE one building by material, so a
// habitat is four draws and not forty. What it does not do is merge ACROSS
// buildings, and at a mature colony that is where the budget goes: measured on
// an early build, 118 placed nodes produced 568 visible meshes, and against
// four shadow cascades that is most of the 2,716 draw calls the frame spent
// against a budget of 300.
//
// The colony is static. Nothing placed ever moves again — `place()` founds a
// node on the terrain, and from that moment its world matrix is frozen. So
// every node's per-material meshes are baked into world space and concatenated
// into ONE mesh per material for the whole settlement: nine draws for every
// dome, habitat, hall, plant, tank, road, junction, tube and power line on the
// map, however many of them there are.
//
// The rule this follows is explicit that this is the shape of the answer —
// "draw calls are the constraint, not triangles. The answer to a budget problem
// is another instance set, never less content." Not one piece of geometry is
// removed here; the triangle count is identical either side of the change.
//
// WHAT IS DELIBERATELY LEFT OUT, and each exclusion is load-bearing:
//   - anything under a THREE.LOD. Batching a level would freeze the LOD at
//     whichever tier happened to be current, which is the exact aliasing bug
//     the masts and flood masts have LODs to avoid.
//   - anything under a node registered for animation. Solar trackers and
//     scanning dishes move every frame; a merged copy of them would be a
//     photograph of one instant, permanently.
//   - anything mid-construction. `place()` only absorbs at progress 1, and
//     `setProgress` releases a node the moment it drops below that, so a
//     building being printed keeps its own meshes and its rig.
// ─────────────────────────────────────────────────────────────────────────────

interface BatchEntry<K extends string> {
  owner: THREE.Object3D;
  mesh: THREE.Mesh;
  key: K;
  geo: THREE.BufferGeometry;
  m: THREE.Matrix4;
}

const _nm3 = new THREE.Matrix3();

export class StaticMerge<K extends string> {
  readonly group = new THREE.Group();
  private lib: MergeLib<K>;
  private o: MergeOpts<K>;
  private entries: BatchEntry<K>[] = [];
  private meshes = new Map<K, THREE.Mesh>();
  private dirty = false;
  absorbed = 0;

  constructor(lib: MergeLib<K>, o: MergeOpts<K> = {}) {
    this.lib = lib;
    this.o = o;
    this.group.name = o.groupName ?? 'static-merge';
  }

  /**
   * Pull every static mesh under `node` into the batch and hide the originals.
   *
   * The originals are HIDDEN, not removed and not disposed. A node can come
   * back — `setProgress` below a threshold releases it, and the sim can lower a
   * finished building's progress when it is damaged — and rebuilding its
   * geometry from nothing at that moment would be both slow and a second place
   * where the building is defined. Hidden meshes cost no draw calls: three
   * culls them before it issues one.
   */
  absorb(node: THREE.Object3D, animated: Set<THREE.Object3D>): number {
    if ((node.userData as any).inStaticMerge) return 0;
    (node.userData as any).inStaticMerge = true;
    node.updateMatrixWorld(true);
    let n = 0;
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      for (let p: THREE.Object3D | null = o; p && p !== node.parent; p = p.parent) {
        if ((p as any).isLOD || animated.has(p)) return;
      }
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!mat) return;
      const key = this.lib.keyOf.get(mat);
      if (!key) return;
      this.entries.push({ owner: node, mesh, key, geo: mesh.geometry, m: mesh.matrixWorld.clone() });
      mesh.visible = false;
      n++;
    });
    if (n > 0) { this.dirty = true; this.absorbed += n; }
    return n;
  }

  /** Hand a node's meshes back to it and drop them from the batch. */
  release(node: THREE.Object3D) {
    if (!(node.userData as any).inStaticMerge) return;
    (node.userData as any).inStaticMerge = false;
    let hit = false;
    this.entries = this.entries.filter((e) => {
      if (e.owner !== node) return true;
      e.mesh.visible = true;
      this.absorbed--;
      hit = true;
      return false;
    });
    if (hit) this.dirty = true;
  }

  /**
   * Rebuild the merged meshes. Cheap because it is DEFERRED: the 118 `place()`
   * calls of a scenario seed all land inside one frame and collapse into a
   * single rebuild on the next tick, and after that the batch only rebuilds
   * when a building's construction state actually changes.
   */
  flush() {
    if (!this.dirty) return;
    this.dirty = false;

    const counts = new Map<K, number>();
    for (const e of this.entries) {
      const p = e.geo.attributes.position;
      if (!p) continue;
      counts.set(e.key, (counts.get(e.key) ?? 0) + p.count);
    }

    for (const [key, total] of counts) {
      const pos = new Float32Array(total * 3);
      const nor = new Float32Array(total * 3);
      const uv = new Float32Array(total * 2);
      const col = new Float32Array(total * 3);
      const vars = new Float32Array(total * 4);
      let w = 0;
      for (const e of this.entries) {
        if (e.key !== key) continue;
        const g = e.geo;
        const pa = g.attributes.position;
        if (!pa) continue;
        const p = pa.array as ArrayLike<number>;
        const na = g.attributes.normal ? (g.attributes.normal.array as ArrayLike<number>) : null;
        const ua = g.attributes.uv ? (g.attributes.uv.array as ArrayLike<number>) : null;
        const ca = g.attributes.color ? (g.attributes.color.array as ArrayLike<number>) : null;
        const va = g.attributes.aVar ? (g.attributes.aVar.array as ArrayLike<number>) : null;
        _nm3.getNormalMatrix(e.m);
        for (let i = 0; i < pa.count; i++, w++) {
          _v.set(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!).applyMatrix4(e.m);
          pos[w * 3] = _v.x; pos[w * 3 + 1] = _v.y; pos[w * 3 + 2] = _v.z;
          if (na) {
            _v2.set(na[i * 3]!, na[i * 3 + 1]!, na[i * 3 + 2]!).applyMatrix3(_nm3).normalize();
            nor[w * 3] = _v2.x; nor[w * 3 + 1] = _v2.y; nor[w * 3 + 2] = _v2.z;
          } else nor[w * 3 + 1] = 1;
          if (ua) { uv[w * 2] = ua[i * 2]!; uv[w * 2 + 1] = ua[i * 2 + 1]!; }
          // Missing colour defaults to WHITE, not to zero. An unset vertex
          // colour multiplies the albedo, and a black one would paint the piece
          // out of the frame rather than leaving it untinted.
          if (ca) { col[w * 3] = ca[i * 3]!; col[w * 3 + 1] = ca[i * 3 + 1]!; col[w * 3 + 2] = ca[i * 3 + 2]!; }
          else { col[w * 3] = 1; col[w * 3 + 1] = 1; col[w * 3 + 2] = 1; }
          if (va) {
            vars[w * 4] = va[i * 4]!; vars[w * 4 + 1] = va[i * 4 + 1]!;
            vars[w * 4 + 2] = va[i * 4 + 2]!; vars[w * 4 + 3] = va[i * 4 + 3]!;
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('aVar', new THREE.Float32BufferAttribute(vars, 4));
      g.computeBoundingSphere();

      let mesh = this.meshes.get(key);
      if (!mesh) {
        mesh = new THREE.Mesh(g, this.lib.mats[key]);
        mesh.name = this.o.meshName ? this.o.meshName(key) : 'merged:' + key;
        // WHICH keys cast, receive and draw late is the CALLER'S fact. See the
        // header: hard-coding one game's answer here is how the next game
        // inherits its shadow policy with every parity check still green.
        this.o.flags?.(key, mesh);
        this.meshes.set(key, mesh);
        this.group.add(mesh);
      } else {
        mesh.geometry.dispose();
        mesh.geometry = g;
      }
      mesh.visible = total > 0;
    }
    // A material that lost its last contributor keeps its mesh (so the program
    // stays warm and the light count never changes) and simply stops drawing.
    for (const [key, mesh] of this.meshes) if (!counts.has(key)) mesh.visible = false;
  }

  stats() {
    let tris = 0, drawn = 0;
    for (const [, m] of this.meshes) {
      if (!m.visible) continue;
      drawn++;
      tris += (m.geometry.attributes.position?.count ?? 0) / 3;
    }
    return { batchDraws: drawn, batchedMeshes: this.absorbed, batchTriangles: Math.round(tris) };
  }

  dispose() {
    for (const [, m] of this.meshes) m.geometry.dispose();
    this.meshes.clear();
    this.entries.length = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Draped ground decals
//
// One batched mesh for the whole world rather than one per object: forty
// objects would otherwise spend forty draw calls on their own grounding, which
// on a 300-call budget is an eighth of it spent on shadows under things.
// ─────────────────────────────────────────────────────────────────────────────

export class DrapedDecals {
  readonly mesh: THREE.Mesh;
  private pos: number[] = [];
  private uv: number[] = [];
  private nor: number[] = [];
  private dirty = false;

  constructor(mat: THREE.Material) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.name = 'draped-decals';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = false;
    this.mesh.castShadow = false;
  }

  /**
   * Stamp a decal that FOLLOWS THE GROUND.
   *
   * A flat quad is wrong the moment the terrain under a 20 m dome is not level,
   * and the failure is the exact one the decal exists to prevent: a dark square
   * hovering next to the contact it was meant to hide. Sampled on a 6x6 grid.
   */
  stamp(terrain: HeightAt | null, cx: number, cz: number, radius: number) {
    const N = 6;
    const grid: THREE.Vector3[][] = [];
    for (let i = 0; i <= N; i++) {
      const row: THREE.Vector3[] = [];
      for (let j = 0; j <= N; j++) {
        const x = cx + (i / N - 0.5) * radius * 2;
        const z = cz + (j / N - 0.5) * radius * 2;
        // 40 mm of lift plus the material's polygon offset. Either alone
        // z-fights somewhere in the zoom range this game asks for (5 km to 2 m).
        row.push(new THREE.Vector3(x, (terrain ? terrain.heightAt(x, z) : 0) + 0.04, z));
      }
      grid.push(row);
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const quad = [grid[i]![j]!, grid[i + 1]![j]!, grid[i + 1]![j + 1]!, grid[i]![j + 1]!];
      const uvq = [[i / N, j / N], [(i + 1) / N, j / N], [(i + 1) / N, (j + 1) / N], [i / N, (j + 1) / N]];
      const idx = [0, 1, 2, 0, 2, 3];
      for (const k of idx) {
        this.pos.push(quad[k]!.x, quad[k]!.y, quad[k]!.z);
        this.uv.push(uvq[k]![0]!, uvq[k]![1]!);
        this.nor.push(0, 1, 0);
      }
    }
    this.dirty = true;
    this.mesh.visible = true;
  }

  /**
   * Empty the accumulated stamps.
   *
   * Whoever re-seeds a world MUST call this. It shipped without one: a second
   * scenario seed left the first one's contact patches in the buffer, under
   * nothing, and they render perfectly.
   */
  clear() {
    this.pos.length = 0;
    this.uv.length = 0;
    this.nor.length = 0;
    this.dirty = true;
    this.flush();
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.pos.length === 0) {
      this.mesh.visible = false;
      this.mesh.geometry.dispose();
      this.mesh.geometry = new THREE.BufferGeometry();
      return;
    }
    this.mesh.visible = true;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }
}

interface HingeInst {
  parent: THREE.Object3D;
  local: THREE.Matrix4;
  limit: number;
  sig: string;
}

export interface HingeOpts<K extends string> {
  groupName?: string;
  meshName?: (key: K) => string;
  /**
   * Below this component of the aim direction along the hinge's own +Y, the
   * whole set STOWS at angle zero rather than holding its last angle.
   *
   * It is an argument because "there is nothing to aim at" is a fact about the
   * world, not about hinges: a solar farm through a 354-hour lunar night and a
   * radar on a ship in fog want different thresholds, and a field frozen at a
   * random angle reads as a bug in both.
   */
  stowBelow?: number;
  /** Flags for each instanced mesh. Default: cast and receive. */
  flags?: (key: K, mesh: THREE.InstancedMesh) => void;
}

const _tm = new THREE.Matrix4();
const _trot = new THREE.Matrix4();
const _tsun = new THREE.Vector3();

export class HingeBatch<K extends string> {
  readonly group = new THREE.Group();
  private lib: MergeLib<K>;
  private o: HingeOpts<K>;
  private inst: HingeInst[] = [];
  private geos = new Map<string, Map<K, THREE.BufferGeometry>>();
  private meshes = new Map<string, Map<K, THREE.InstancedMesh>>();
  private dirty = false;

  constructor(lib: MergeLib<K>, o: HingeOpts<K> = {}) {
    this.lib = lib;
    this.o = o;
    this.group.name = o.groupName ?? 'hinge-batch';
  }

  /**
   * Register one instance. `make` builds the PROTOTYPE row for `sig` and is
   * called at most once per signature — the fourteenth array with the same
   * column count costs one matrix, not one mesh.
   */
  add(parent: THREE.Object3D, local: THREE.Matrix4, limit: number, make: () => THREE.Object3D, sig: string) {
    if (!this.geos.has(sig)) {
      const g = make();
      const map = new Map<K, THREE.BufferGeometry>();
      for (const child of g.children) {
        const m = child as THREE.Mesh;
        const mm = Array.isArray(m.material) ? m.material[0] : m.material;
        const key = mm ? this.lib.keyOf.get(mm) : undefined;
        if (key) map.set(key, m.geometry);
      }
      this.geos.set(sig, map);
    }
    this.inst.push({ parent, local: local.clone(), limit, sig });
    this.dirty = true;
  }

  /**
   * Rebuild the instanced meshes. `InstancedMesh` capacity is fixed at
   * construction, so a new array means a new mesh — deferred and batched the
   * same way the static batch is, so a whole scenario seed costs one rebuild.
   */
  private rebuild() {
    this.dirty = false;
    for (const [sig, protos] of this.geos) {
      const n = this.inst.reduce((a, i) => a + (i.sig === sig ? 1 : 0), 0);
      let set = this.meshes.get(sig);
      if (!set) this.meshes.set(sig, (set = new Map()));
      for (const [key, geo] of protos) {
        const old = set.get(key);
        if (old && old.count === n) continue;
        if (old) { old.removeFromParent(); old.dispose(); }
        const im = new THREE.InstancedMesh(geo, this.lib.mats[key], Math.max(1, n));
        im.name = this.o.meshName ? this.o.meshName(key) : 'hinged:' + key;
        im.castShadow = true;
        im.receiveShadow = true;
        this.o.flags?.(key, im);
        // A merged instance set spans the colony; its own bounding sphere is
        // one row's, so leaving culling on would pop the whole farm out of
        // frame the moment the prototype's sphere left it.
        im.frustumCulled = false;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        set.set(key, im);
        this.group.add(im);
      }
    }
  }

  /** Aim every instance. `aim` is the world-space direction to point at. */
  update(aim: THREE.Vector3) {
    if (this.dirty) this.rebuild();
    const idx = new Map<string, number>();
    for (const t of this.inst) {
      const i = idx.get(t.sig) ?? 0;
      idx.set(t.sig, i + 1);
      t.parent.updateWorldMatrix(true, false);
      // Sun into the tracker's own frame. Doing this in world space would have
      // every array on the map agreeing about a rotation none of them share,
      // because each one is yawed by its building's placement.
      _tm.copy(t.parent.matrixWorld).multiply(t.local);
      _tsun.copy(aim).transformDirection(_m4b.copy(_tm).invert());
      // Stowed flat when there is nothing to aim at — see `stowBelow`. The
      // default matches the game this arrived from; it is an argument because a
      // field frozen at a random angle reads as a bug in every game.
      const want = _tsun.y < (this.o.stowBelow ?? 0.03) ? 0 : Math.atan2(_tsun.z, _tsun.y);
      const a = Math.max(-t.limit, Math.min(t.limit, want));
      _trot.makeRotationX(a);
      _tm.multiply(_trot);
      const set = this.meshes.get(t.sig);
      if (!set) continue;
      for (const [, im] of set) if (i < im.count) im.setMatrixAt(i, _tm);
    }
    for (const [, set] of this.meshes) for (const [, im] of set) im.instanceMatrix.needsUpdate = true;
  }

  get instances() { return this.inst.length; }
  get draws() { let n = 0; for (const [, s] of this.meshes) n += s.size; return n; }
  dispose() { for (const [, s] of this.meshes) for (const [, im] of s) im.dispose(); }
}
