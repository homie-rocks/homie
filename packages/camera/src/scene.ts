/**
 * ============================================================================
 *  Filling the two stores in `blockers.ts` — the walk, not the query.
 * ============================================================================
 *
 *  `blockers.ts` holds `BoreCeiling.ceilingAt`, `BoxField.propSegment` and
 *  `BoxField.propPush`: the three questions asked of the stores every frame.
 *  This file holds the three walks that FILL them, which were byte-identical in
 *  both racers' cameras — `buildBoreCeiling`, `buildProps` and
 *  `ensureWideBlockers`, character for character, only the numbers and the
 *  name filter differing.
 *
 *  **`blockers.ts`'s header says the builders stayed in the games and that this
 *  was the seam rather than an oversight. That was true of the reason it gave
 *  and false of the conclusion, and this file is the correction.** The reason
 *  was `Ctx`: it carries race, track, items, match and colony, the engine's
 *  rules forbid it crossing a package seam, and `buildProps` takes a `Ctx`. But a
 *  method that takes a `Ctx` is not a method that needs one. List what the walk
 *  actually reads and it is three fields —
 *
 *      ctx.frame        a number
 *      ctx.scene        an Object3D to traverse
 *      ctx.race.karts   things with an `.object`, excluded by identity
 *
 *  — so {@link PropWorld} declares exactly those three, both games' `Ctx`
 *  satisfies it structurally, and nothing about a lap or a colony comes with
 *  it. The bore walk needs less still: a sampler, a box and a list of meshes.
 *
 *  **NO NUMBER IS IN THIS FILE**, for the reason `lens.ts` and `blockers.ts`
 *  both give at length: `PROP_MAX_SPAN` is 13 in both racers today and it is a
 *  parameter anyway, because a package that ships a number two games happen to
 *  agree on has quietly picked one game's feel for every game that ever calls
 *  it, and the frames look completely fine while it does. The name filter is
 *  the clearest case — the kart racer skips `palm|crowd|banana`, the space
 *  racer skips `kesh|magstrip|handrail`, and a handrail runs along 100% of every deck
 *  edge in one game and does not exist in the other.
 *
 *  **THE SCRATCH IS THIS FILE'S, NOT THE GAME'S, AND THAT IS A REAL CHANGE.**
 *  Both games' `_tmp`, `_tmp2`, `_m`, `_m2` and `_box` used to be clobbered by
 *  these walks; they are not any more. Every call site was read before the move
 *  and every one of them writes those scratch vectors before it next reads one
 *  — `lateUpdate` writes `_m` in its `lookAt` and `_tmp` in its teleport test,
 *  `init` holds nothing across `buildBoreCeiling` — so nothing depended on the
 *  clobber. It is written down because the failure it would cause is a value
 *  that SURVIVES where it used to be destroyed, which renders perfectly.
 * ============================================================================
 */
import * as THREE from 'three';
import type { BoxField } from './blockers.ts';

const WORLD_UP = /* @__PURE__ */ new THREE.Vector3(0, 1, 0);

const _tmp = /* @__PURE__ */ new THREE.Vector3();
const _tmp2 = /* @__PURE__ */ new THREE.Vector3();
const _m = /* @__PURE__ */ new THREE.Matrix4();
const _m2 = /* @__PURE__ */ new THREE.Matrix4();
const _box = /* @__PURE__ */ new THREE.Box3();

// ===========================================================================
//  The bore roof
// ===========================================================================

/** The two fields of a track sample the bore walk reads. `TrackSample` in both
 *  games satisfies this and brings nothing else with it. */
export interface BorePoint {
  readonly pos: THREE.Vector3;
  readonly normal: THREE.Vector3;
}

/**
 * One ray straight up from the road at every station, once, at init.
 *
 * Returns the table for {@link BoreCeiling.boreY}, or `null` when no ray found
 * anything — which is what a circuit with no tunnel looks like, and is why the
 * `any` flag exists rather than a table full of `Infinity`.
 *
 * `sample` is a closure rather than a `(t, out)` pair so the caller keeps
 * ownership of its own scratch sample: both games pass
 * `(t) => this.sampleFn!(t, this.smp!)` and the allocation behaviour is
 * unchanged from the copies this replaced.
 */
export function buildBoreCeiling(
  sample: (t: number) => BorePoint,
  boreBox: THREE.Box3,
  bore: readonly THREE.Object3D[],
  ray: THREE.Raycaster,
  hits: THREE.Intersection[],
  stations: number,
  clear: number,
): Float32Array | null {
  const n = stations;
  const out = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    out[i] = Infinity;
    const s = sample(i / n);
    _tmp.copy(s.pos).addScaledVector(s.normal, 0.3);
    if (!boreBox.containsPoint(_tmp)) continue;
    _tmp2.copy(s.normal);
    if (_tmp2.y < 0.2) _tmp2.copy(WORLD_UP);
    ray.set(_tmp, _tmp2);
    ray.near = 0.2;
    ray.far = 40;
    hits.length = 0;
    ray.intersectObjects(bore as THREE.Object3D[], false, hits);
    if (hits.length) { out[i] = hits[0]!.point.y - clear; any = true; }
  }
  return any ? out : null;
}

// ===========================================================================
//  Trackside furniture — a flat array of AABBs, built a handful of times
// ===========================================================================

/** Exactly the three fields {@link PropBuilder.build} reads off a world. Both
 *  racers' `Ctx` satisfies it; neither has to hand over a `Ctx` to say so. */
export interface PropWorld {
  readonly frame: number;
  readonly scene: THREE.Object3D;
  readonly race?: { readonly karts?: ArrayLike<{ readonly object: THREE.Object3D }> } | null;
}

/** Every number and the one regex the walk needs, all of them the game's. */
export interface PropRules {
  /** Frame numbers at which the walk re-runs, then never again. Scenery is not
   *  all present on frame one and some of it is parented into groups that
   *  already exist, which is why this is a list and not a boolean. */
  readonly buildFrames: readonly number[];
  readonly maxCount: number;
  /** Wider than this is architecture, not furniture; terrain and walls already
   *  answer for that. */
  readonly maxSpan: number;
  readonly maxHeight: number;
  /** An instanced mesh above this count is kerbs, foliage or crowd. */
  readonly maxInstances: number;
  /** Names the sweep must ignore. Wildly different between the two racers and
   *  load-bearing in both — see each game's own `PROP_SKIP`. */
  readonly skip: RegExp;
}

/**
 * Flatten every solid, ground-planted, camera-sized piece of scenery into the
 * flat `Float32Array` of world AABBs a {@link BoxField} queries.
 *
 * Karts are excluded by identity, not by name: they move, so a cached box would
 * be a phantom blocker parked on the grid. Foliage is excluded because a palm's
 * AABB is nine parts air.
 *
 * The stage counter is state, which is why this is a class: the walk is not
 * idempotent, it is a schedule.
 */
export class PropBuilder {
  private stage = 0;

  /** Runs at most once per entry in `rules.buildFrames`, and writes into
   *  `field` only when the walk found something — a build that comes back empty
   *  leaves the previous answer standing rather than blanking it. */
  build(world: PropWorld, rules: PropRules, field: BoxField): void {
    if (this.stage >= rules.buildFrames.length || world.frame < rules.buildFrames[this.stage]!) return;
    this.stage++;

    const skip = new Set<THREE.Object3D>();
    const karts = world.race?.karts;
    if (karts) for (let i = 0; i < karts.length; i++) skip.add(karts[i]!.object);

    const out: number[] = [];
    const push = (b: THREE.Box3) => {
      if (out.length >= rules.maxCount * 6) return;
      const sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
      if (!(sx > 0.05 && sy > 0.35 && sz > 0.05)) return;              // decals, mats
      if (sx > rules.maxSpan || sz > rules.maxSpan || sy > rules.maxHeight) return;
      out.push(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
    };

    world.scene.traverse((o) => {
      // traverse() has no skip-subtree, so mark descendants as they are met.
      if (skip.has(o)) return;
      if (o.parent && skip.has(o.parent)) { skip.add(o); return; }
      const m = o as THREE.Mesh;
      if (!(m as any).isMesh || !m.visible || !m.geometry) return;
      if (rules.skip.test(m.name)) return;
      const geo = m.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) return;
      m.updateWorldMatrix(true, false);

      const inst = m as unknown as THREE.InstancedMesh;
      if ((inst as any).isInstancedMesh) {
        if (inst.count > rules.maxInstances) return;   // kerbs, foliage, crowd
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, _m2);
          _m.multiplyMatrices(m.matrixWorld, _m2);
          push(_box.copy(bb).applyMatrix4(_m));
        }
        return;
      }
      push(_box.copy(bb).applyMatrix4(m.matrixWorld));
    });

    if (out.length) { field.props = new Float32Array(out); field.propCount = out.length / 6; }
  }

  /** A teleport does not invalidate furniture, but a new circuit does. */
  reset(): void { this.stage = 0; }
}

// ===========================================================================
//  Wide-mode sightline check (harness only, never on a gameplay frame)
// ===========================================================================

/**
 * Everything a ray from the establishing plate could plausibly hit.
 *
 * The name filter here IS shared and is not a tuning knob: it names the classes
 * of object that are not occluders in any 3D game — sky, water, backdrop,
 * terrain — rather than anything either circuit contains. The two numbers are
 * arguments for the usual reason.
 */
export function buildWideBlockers(
  scene: THREE.Object3D,
  maxInstances: number,
  maxRadius: number,
): THREE.Object3D[] {
  const list: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(m as any).isMesh || !m.visible || !m.geometry) return;
    if (/sky|cloud|sea|water|ocean|backdrop|horizon|fog|terrain|ground/i.test(m.name)) return;
    const inst = m as unknown as THREE.InstancedMesh;
    if ((inst as any).isInstancedMesh && inst.count > maxInstances) return;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    const r = m.geometry.boundingSphere?.radius ?? 0;
    m.updateWorldMatrix(true, false);
    if (r * _tmp2.setFromMatrixScale(m.matrixWorld).length() * 0.5774 > maxRadius) return;
    list.push(m);
  });
  return list;
}

/**
 * Collect the meshes a tunnel roof is made of, and the world box around them.
 *
 * The fourth scene walk, and the one that runs BEFORE
 * {@link buildBoreCeiling}: that function fires a ray per station at the
 * meshes this one found, so a missed mesh here is a roof that silently is not
 * there. Both racers ran this character for character inside `init`.
 *
 * **THE NAME TEST IS A PARAMETER, WHICH IS THE WHOLE SEAM.** Naming the meshes
 * a roof is made of is the one thing only a game can do — `blockers.ts` and
 * this file both argue at length that a package which decides that has decided
 * it for every game that ever calls it. So `pattern` comes in; today both games
 * pass `/tunnel|bore/i` and that is a fact about two circuits, not a default
 * worth shipping. So does `pad`, the margin the box is grown by so a lens just
 * outside the bore still tests against it.
 *
 * Instanced meshes are skipped rather than handled. An `InstancedMesh` has no
 * single world matrix to union and a bore is one continuous piece of geometry
 * in both circuits; the day one is instanced, this returns false and the roof
 * is honestly absent rather than quietly wrong.
 *
 * `bore` and `boreBox` are the CALLER's, filled in place — they are read every
 * frame by `blockers.ts` and allocating new ones here would leave the rig
 * holding the old pair.
 *
 * @returns whether anything was found, i.e. whether there is a roof to build.
 */
export function collectBores(
  group: THREE.Object3D,
  pattern: RegExp,
  pad: number,
  bore: THREE.Mesh[],
  boreBox: THREE.Box3,
): boolean {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(m as any).isMesh || (m as any).isInstancedMesh) return;
    if (!pattern.test(m.name)) return;
    m.updateWorldMatrix(true, false);
    bore.push(m);
    boreBox.union(new THREE.Box3().setFromObject(m));
  });
  if (!bore.length) return false;
  boreBox.expandByScalar(pad);
  return true;
}
