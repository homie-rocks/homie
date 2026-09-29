/**
 * ============================================================================
 *  mergeStaticSets — instance sets that never move, baked into one mesh a cell.
 * ============================================================================
 *  Takes the sets that pass `isStatic`, flattens every instance's transform
 *  into world space, and buckets the result by material, shadow-casting flag
 *  and a coarse XZ grid. The sets that fail come back in `kept` for the caller
 *  to build as InstancedMeshes exactly as before.
 *
 *  Byte-identical in the two racing games it was extracted from, INCLUDING
 *  the long note on `STATIC_CELL`. Read that note before touching the grid: the
 *  obvious next step from here has been implemented, measured with a real
 *  profiler at 1280x720, and LOST — 60 to 140 extra draw calls to cull thirty
 *  thousand triangles that `patchLod` had already collapsed. The numbers are in
 *  the comment because the argument is more persuasive than the measurement.
 *
 *  The cell size is a DEFAULT here and it is 400 m because both games that
 *  wrote it chose 400 m. It is the one tuned number in this package, it is a
 *  parameter of the function, and a third game with a different draw budget is
 *  expected to pass its own rather than inherit somebody else's circuit.
 */
import * as THREE from 'three';
import { InstSet } from './inst.ts';

const _mm = new THREE.Matrix3();
const _mv = new THREE.Vector3();

/**
 * Edge of the world-space bucketing grid, metres.
 *
 * This is a straight trade between draw calls and culling. One cell for the
 * whole circuit is the fewest possible draws but nothing can ever be rejected;
 * 40 m cells cull beautifully and hand back all the draw calls that were just
 * saved. 150 m is a little over the length of circuit the chase camera can see
 * at once, so a typical frame touches two or three cells per material while the
 * 55 m shadow box usually touches one.
 *
 * ---------------------------------------------------------------------------
 *  DO NOT EXTEND THIS GRID TO THE REST OF THE WORLD. IT HAS BEEN TRIED AND
 *  MEASURED AND IT LOSES.
 * ---------------------------------------------------------------------------
 *  The obvious next step from here is to partition everything else the same
 *  way, and it is very persuasive on paper: one merged village-wall mesh is
 *  110 244 triangles inside a 363 m bounding sphere, one crowd mesh is 116 250
 *  inside a 356 m one, and the near shadow cascade is 110 m across, so neither
 *  can ever be rejected by a frustum.
 *
 *  It was implemented — `GeoAccum` and `InstSet` both got a `buildCells`, every
 *  circuit-spanning merge and every instance set above 60 instances was split
 *  onto a 260 m grid — and measured with a frame profiler at 1280x720. Draw
 *  calls per frame, `typical` (non-cascade-refresh) column, before -> after:
 *
 *      hero   164 -> 226     grid  176 -> 272     boost  164 -> 301
 *
 *  against frame triangles of 3187k -> 3157k, 3284k -> 2922k, 3126k -> 2197k.
 *
 *  Sixty to a hundred and forty extra draw calls to save, at the hero vantage
 *  point, THIRTY THOUSAND triangles. The reason is `patchLod`: distant
 *  instances are already collapsed to a point in the vertex shader, in the
 *  colour pass and in the depth pass alike, so the triangles a spatial split
 *  would have culled were mostly costing nothing already. Culling also barely
 *  fires — the aerial perspective reaches 600 m, so on this circuit the camera
 *  frustum contains most of the cells most of the time and only rejects what is
 *  behind you.
 *
 *  The batching above is worth it because it goes the OTHER way — it turns many
 *  meshes into few. Splitting few into many is the same dial turned the wrong
 *  direction.
 *
 *  Two notes on the instrument, since the numbers above were taken with it and
 *  the next person will want to reproduce them:
 *
 *  - the profiler's draw counts are NOT exactly repeatable. The vantage point
 *    is reached by simulation, not teleport, so the camera lands in a slightly
 *    different place each run. Two consecutive runs of IDENTICAL code differed
 *    by 10 draws at `pack` (157 vs 167) and 2-3 elsewhere. Deltas smaller than
 *    about ten draws at a single vantage point are noise; the 60-140 above are
 *    not.
 *  - its `tris=` banner column is `last.triangles`, a single frame, not the
 *    30-frame statistic the draw counts get. One run printed `tris=0k` for a
 *    shot that plainly rendered. Read it as an order of magnitude.
 */
const STATIC_CELL = 400;

interface StaticBucket {
  mat: THREE.Material;
  cast: boolean;
  vc: boolean;
  pos: number[]; nrm: number[]; uv: number[]; col: number[];
  tint: number[]; iuv: number[]; lod: number[]; org: number[];
  idx: number[]; base: number;
  names: Set<string>;
}

/**
 * Bakes every static set in `sets` into merged meshes, one per material per
 * grid cell. Sets that fail `isStatic` are returned in `kept` for the caller to
 * build as InstancedMeshes exactly as before.
 *
 * `castOf` decides shadow casting per set; sets that disagree are bucketed
 * apart, because `castShadow` is a property of the mesh and cannot be mixed.
 */
export function mergeStaticSets(
  sets: InstSet[],
  castOf: (name: string) => boolean,
  cell = STATIC_CELL,
): { merged: THREE.Mesh[]; kept: InstSet[] } {
  const merged: THREE.Mesh[] = [];
  const kept: InstSet[] = [];
  const buckets = new Map<string, StaticBucket>();
  const matKey = new Map<THREE.Material, number>();

  for (const set of sets) {
    if (!set.isStatic || set.count === 0) { kept.push(set); continue; }
    const s = set.snapshot();
    const g = s.geo;
    const p = g.attributes.position;
    if (!p) { kept.push(set); continue; }

    const n = g.attributes.normal;
    const u = g.attributes.uv;
    const c0 = g.attributes.color;
    const index = g.index;
    const vc = (s.mat as { vertexColors?: boolean }).vertexColors === true;
    const cast = castOf(s.name);
    if (!matKey.has(s.mat)) matKey.set(s.mat, matKey.size);
    const mk = matKey.get(s.mat)!;

    for (let inst = 0; inst < s.mats.length; inst++) {
      const m = s.mats[inst];
      // Bucket on the instance origin. Props are small next to the cell, so the
      // origin is a good enough proxy for where the geometry lands.
      const cx = Math.floor(m.elements[12] / cell);
      const cz = Math.floor(m.elements[14] / cell);
      const key = mk + '|' + (cast ? 1 : 0) + '|' + cx + '|' + cz;
      let b = buckets.get(key);
      if (!b) {
        b = {
          mat: s.mat, cast, vc,
          pos: [], nrm: [], uv: [], col: [], tint: [], iuv: [], lod: [], org: [],
          idx: [], base: 0, names: new Set(),
        };
        buckets.set(key, b);
      }
      b.names.add(s.name);
      _mm.getNormalMatrix(m);

      const tr = s.useCol ? s.cols[inst * 3] : 1;
      const tg = s.useCol ? s.cols[inst * 3 + 1] : 1;
      const tb = s.useCol ? s.cols[inst * 3 + 2] : 1;
      const ux = s.useUv ? s.uvs[inst * 4] : 1;
      const uy = s.useUv ? s.uvs[inst * 4 + 1] : 1;
      const uz = s.useUv ? s.uvs[inst * 4 + 2] : 0;
      const uw = s.useUv ? s.uvs[inst * 4 + 3] : 0;
      const lod = s.useLod ? s.lods[inst] : 0;
      // The instance origin, in the merged geometry's (object) space, so the
      // baked-flat LOD collapse in `patchLod` has something to scale about.
      const ox = m.elements[12], oy = m.elements[13], oz = m.elements[14];

      for (let i = 0; i < p.count; i++) {
        _mv.fromBufferAttribute(p, i).applyMatrix4(m);
        b.pos.push(_mv.x, _mv.y, _mv.z);
        if (n) {
          _mv.fromBufferAttribute(n, i).applyMatrix3(_mm).normalize();
          b.nrm.push(_mv.x, _mv.y, _mv.z);
        } else b.nrm.push(0, 1, 0);
        if (u) b.uv.push(u.getX(i), u.getY(i));
        else b.uv.push(0, 0);
        if (vc) {
          if (c0) b.col.push(c0.getX(i), c0.getY(i), c0.getZ(i));
          else b.col.push(1, 1, 1);
        }
        // The three per-instance channels, flattened to per-vertex constants.
        // `aUv` in particular must always be written: it is a multiply-add on
        // the map UVs, and an absent attribute reads (0,0,0,1) in GL, which
        // would collapse every texture in the batch onto one texel.
        b.tint.push(tr, tg, tb);
        b.iuv.push(ux, uy, uz, uw);
        b.lod.push(lod);
        b.org.push(ox, oy, oz);
      }
      if (index) for (let i = 0; i < index.count; i++) b.idx.push(b.base + index.getX(i));
      else for (let i = 0; i < p.count; i++) b.idx.push(b.base + i);
      b.base += p.count;
    }
  }

  for (const b of buckets.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    if (b.vc) g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(b.tint, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(b.iuv, 4));
    g.setAttribute('aLod', new THREE.Float32BufferAttribute(b.lod, 1));
    g.setAttribute('aOrigin', new THREE.Float32BufferAttribute(b.org, 3));
    g.setIndex(b.idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, b.mat);
    mesh.name = 'static-' + [...b.names].sort().join('+');
    mesh.castShadow = b.cast;
    mesh.receiveShadow = true;
    // Same trap as `InstSet.build` above, and worse here: a baked cell is one
    // mesh holding hundreds of props across a whole range of `aLod` distances,
    // so a depth material carrying `patchLod` collapses the entire cell in the
    // shadow pass. No `customDepthMaterial` here either.
    mesh.matrixAutoUpdate = false;
    merged.push(mesh);
  }
  return { merged, kept };
}
