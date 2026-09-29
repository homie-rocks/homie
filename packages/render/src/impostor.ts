/**
 * ============================================================================
 *  impostor — the far-LOD bake, and the one call that says why it is invisible.
 * ============================================================================
 *  Five declarations that stood byte-identical (comment wording aside) in the
 *  vehicle-model code of a kart racer and of a space racer: the base-colour map
 *  sampler and its cache, the grid vertex-clusterer, the scene-graph merge that
 *  feeds it, and the shadow-path report a capture harness interrogates.
 *
 *  THE BAKE IS SHARED. THE PARTS LIST IS NOT. Both games reduce a freshly built
 *  machine to one opaque vertex-coloured buffer at rest pose, and every line of
 *  how they do it agreed. What did not agree, and stays in each game beside its
 *  own long argument for it, is WHICH meshes are excluded (`shadowBlob` alone in
 *  the kart racer; `shadowBlob`, `magSkirt` and `shipCores` in the space racer,
 *  because an additive glow merged into an opaque bake is a solid cyan slab) and
 *  which mesh's colour attribute is a CHANNEL rather than a paint. Those are two
 *  sets of strings and one colour. They arrive as arguments.
 *
 * ----------------------------------------------------------------------------
 *  `neutral` IS A VALUE, NOT A FLAG
 * ----------------------------------------------------------------------------
 *  The space racer bakes `shipHeatSkin` with the material's own COLD albedo
 *  substituted for its vertex colour, because that mesh's colour attribute is
 *  the game's reserved violet-and-amber channel and baking it would paint a
 *  violet stripe down every distant machine in the field. The kart racer has no
 *  such mesh.
 *
 *  So `neutral` is omitted by the kart racer, `neutral.names` is empty, the
 *  branch is unreachable, and the loop is the loop the kart racer shipped — the
 *  identity case, the same way a `Math.max` against 0 is the identity. It is
 *  not a parameter that makes the shared function behave two ways; it is a list
 *  of mesh names, and a list nobody populates does nothing.
 *
 *  The names and the colour are ONE field rather than two, deliberately: a
 *  caller that passed the names and forgot the colour would silently bake white
 *  into the biggest surface on its machine, and a screenshot at impostor range
 *  is exactly where nobody would see it. They cannot be separated here.
 *
 * ----------------------------------------------------------------------------
 *  `extra` ON THE SHADOW REPORT
 * ----------------------------------------------------------------------------
 *  Same shape and the same reasoning, one level up: the thirteen fields both
 *  games report are here, and the space racer's three further fields (the bound
 *  pose, the shadow side, the deck gap) are a closure it hands in. A game that
 *  hands in nothing gets `...undefined?.()` — no extra keys, the object
 *  the kart racer shipped. This is a DIAGNOSTIC and nothing draws from it,
 *  which is why a hook is acceptable here and would not be inside the bake.
 *
 *  `_built` — the per-session registry of machines — stays in each game, because
 *  each game's `buildKart` is what pushes to it and a module-level array shared
 *  between two games loaded in one process would report a field of the wrong
 *  vehicles. It is passed in.
 *
 * ----------------------------------------------------------------------------
 *  WHAT THIS DELIBERATELY DOES NOT OWN
 * ----------------------------------------------------------------------------
 *  `impostorMaterial`, the LOD swap distance, and `DrawBudget`'s ownership of
 *  `visible`/`castShadow` are all still per-game and must stay there. This file
 *  builds a buffer and answers questions about one; it decides nothing about
 *  when the buffer is on screen.
 *
 * ----------------------------------------------------------------------------
 *  THE `!` ON THE COMPUTED-INDEX READS
 * ----------------------------------------------------------------------------
 *  Identical reasoning to `bodykit.ts` and `Textures.ts` in this package, whose
 *  comments state it at length: the games run `strict: false`, this package
 *  runs `noUncheckedIndexedAccess`, and `!` erases at emit — so the JavaScript
 *  that ships is character-for-character what the two games shipped. Every one
 *  of them is a read out of a `number[]` or `Float32Array` at `i * 3 + k` inside
 *  a loop bounded by that array's own length, or a cluster id that was written
 *  into `map` two statements earlier. Widen one of those loops and the assertion
 *  is what you have to re-earn; the compiler will not ask you again.
 *
 *  ONE EXCEPTION, and it is called out where it happens: a `!` cannot sit on
 *  the target of a `+=`, so the twelve accumulations inside `clusterDecimate`'s
 *  cluster loop are spelled `x[k] = x[k]! + y` instead. See the comment there.
 *
 *  @homie-rocks/geom faced the same 139 errors and turned the flag OFF with a named
 *  payer instead. That was the right call there — it was the parity commit for
 *  eleven byte-identical geometry kernels and its receipt was the bytes. This is
 *  five functions and about forty reads, in a package where the flag is on for
 *  everything else, so it is paid here rather than deferred.
 * ============================================================================
 */
import * as THREE from 'three';

const _im = new THREE.Matrix3();
const _iv = new THREE.Vector3();
const _ic = new THREE.Color();
/** World matrix of the part (or instance) currently being baked. */
const _iw = new THREE.Matrix4();

/**
 * Downsampled, linear-space copy of a base-colour map, for baking into the
 * merged mesh's colour attribute.
 *
 * The wheel is the reason this exists. `C_RUBBER` is deliberately pure white —
 * "albedo comes from the wheel atlas" — so a merge that only reads the colour
 * attribute produces a kart on four cream doughnuts. The impostor carries no
 * maps (see `impostorMaterial`), so whatever the map was contributing has to
 * end up in the vertices instead.
 *
 * 64 px, not 1024: the browser's own downscale box-filters the whole atlas for
 * free, which is exactly what is wanted. Sampling the full-resolution tread at
 * a vertex is a coin toss between a groove and a block, and the merged mesh
 * would inherit that noise as per-vertex mottling. What it should inherit is
 * the average, because the average is all that survives at 20 m.
 */
const SAMPLE_RES = 64;
const _mapCache = new WeakMap<THREE.Texture, Float32Array | null>();

export function mapSamples(t: THREE.Texture): Float32Array | null {
  const hit = _mapCache.get(t);
  if (hit !== undefined) return hit;
  let out: Float32Array | null = null;
  try {
    const src = t.image as CanvasImageSource & { width?: number; height?: number };
    if (src && (src.width || 0) > 0) {
      const c = document.createElement('canvas');
      c.width = c.height = SAMPLE_RES;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(src, 0, 0, SAMPLE_RES, SAMPLE_RES);
      const d = g.getImageData(0, 0, SAMPLE_RES, SAMPLE_RES).data;
      const srgb = t.colorSpace === THREE.SRGBColorSpace;
      out = new Float32Array(SAMPLE_RES * SAMPLE_RES * 3);
      for (let i = 0, n = SAMPLE_RES * SAMPLE_RES; i < n; i++) {
        for (let k = 0; k < 3; k++) {
          const v = d[i * 4 + k]! / 255;
          // Vertex colours are consumed in linear working space, so an sRGB
          // map has to be decoded here or the tyres come out two stops light.
          out[i * 3 + k] = srgb
            ? (v < 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
            : v;
        }
      }
    }
  } catch {
    // A cross-origin or not-yet-decoded image is not worth failing a build for;
    // the part just keeps its authored vertex colour.
    out = null;
  }
  _mapCache.set(t, out);
  return out;
}

/** Multiplies `out` by the map's colour at (u, v), honouring flipY/repeat. */
export function sampleMap(s: Float32Array, t: THREE.Texture, u: number, v: number, out: THREE.Color) {
  let x = u * t.repeat.x + t.offset.x;
  let y = v * t.repeat.y + t.offset.y;
  // The upload flips the image when flipY is on, so an unflipped read has to
  // undo it. The wheel atlas is authored flipY off; the surface details are not.
  if (t.flipY) y = 1 - y;
  x -= Math.floor(x);
  y -= Math.floor(y);
  const ix = Math.min(SAMPLE_RES - 1, (x * SAMPLE_RES) | 0);
  const iy = Math.min(SAMPLE_RES - 1, (y * SAMPLE_RES) | 0);
  const i = (iy * SAMPLE_RES + ix) * 3;
  out.r *= s[i]!;
  out.g *= s[i + 1]!;
  out.b *= s[i + 2]!;
}

/**
 * A mesh whose colour attribute is a channel rather than a paint, and the
 * albedo to bake in its place. See the header: omit it and nothing happens.
 */
export interface ImpostorNeutral {
  /** Mesh names, by `Object3D.name`. */
  names: Set<string>;
  /** The colour to bake for those meshes — the material's own cold albedo. */
  colour: THREE.Color;
}

export interface ImpostorBake {
  /** Parts the merged mesh must not swallow, by `Object3D.name`. */
  skip: Set<string>;
  neutral?: ImpostorNeutral;
}

/**
 * Bakes every mesh hanging off a freshly built machine into one buffer, in the
 * root's frame and at rest pose.
 *
 * Rest pose is the whole approximation: the wheels are unsteered and unspun,
 * the body is unrolled and the driver is sitting up straight. That is exactly
 * as wrong as it sounds and exactly as invisible as it needs to be — this mesh
 * is only ever seen from 26 m (where a 4 degree body roll is a pixel) or as a
 * shadow caster under a sun 63 degrees up (where the machine's own shadow is a
 * short blob mostly hidden by the machine standing on it).
 *
 * The source geometries are shared per livery, so nothing here is mutated; the
 * merge reads them and writes a new buffer.
 */
export function mergeToImpostor(root: THREE.Object3D, opt: ImpostorBake): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true);
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let base = 0;

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(m as unknown as { isMesh?: boolean }).isMesh) return;
    if (opt.skip.has(m.name)) return;
    const g = m.geometry;
    const p = g.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!p) return;
    const n = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const u = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const c = g.getAttribute('color') as THREE.BufferAttribute | undefined;
    // The part's own base colour and base-colour map, folded into the vertices.
    // Both matter: the visor's whole albedo is `material.color` (it has no
    // colour attribute at all), and the tyre's is `material.map` (`C_RUBBER` is
    // pure white on purpose, because the atlas is supposed to supply it).
    const src = m.material as THREE.MeshStandardMaterial;
    const baseCol = src?.color;
    const baseMap = src?.map ?? null;
    const samples = baseMap ? mapSamples(baseMap) : null;

    // An InstancedMesh contributes once PER INSTANCE, each at its own matrix.
    // The four tyres are one instanced draw (see the wheel loop in `buildKart`),
    // and baking only the base geometry would put a single wheel at the kart's
    // origin — a far kart on one centre wheel, and a shadow to match, because
    // this bake is also the kart's only shadow caster.
    const inst = m as unknown as { isInstancedMesh?: boolean; count?: number;
      instanceMatrix?: THREE.InstancedBufferAttribute };
    const reps = inst.isInstancedMesh === true ? inst.count ?? 0 : 1;

    for (let r = 0; r < reps; r++) {
      if (inst.isInstancedMesh === true && inst.instanceMatrix) {
        _iw.fromArray(inst.instanceMatrix.array as ArrayLike<number>, r * 16);
        _iw.premultiply(m.matrixWorld);
      } else {
        _iw.copy(m.matrixWorld);
      }
      _im.getNormalMatrix(_iw);
      for (let i = 0; i < p.count; i++) {
        _iv.fromBufferAttribute(p, i).applyMatrix4(_iw);
        pos.push(_iv.x, _iv.y, _iv.z);
        if (n) {
          _iv.fromBufferAttribute(n, i).applyMatrix3(_im).normalize();
          nrm.push(_iv.x, _iv.y, _iv.z);
        } else nrm.push(0, 1, 0);
        const tu = u ? u.getX(i) : 0;
        const tv = u ? u.getY(i) : 0;
        uv.push(tu, tv);

        if (opt.neutral !== undefined && opt.neutral.names.has(m.name)) _ic.copy(opt.neutral.colour);
        else if (c) _ic.setRGB(c.getX(i), c.getY(i), c.getZ(i));
        else _ic.setRGB(1, 1, 1);
        if (baseCol) _ic.multiply(baseCol);
        if (samples && baseMap) sampleMap(samples, baseMap, tu, tv, _ic);
        col.push(_ic.r, _ic.g, _ic.b);
      }
      const index = g.getIndex();
      if (index) for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
      else for (let i = 0; i < p.count; i++) idx.push(base + i);
      base += p.count;
    }
  });

  if (!base) return null;
  return clusterDecimate(pos, nrm, uv, col, idx);
}

/**
 * Cluster cell, metres. Both racers arrived at 3 cm INDEPENDENTLY and their
 * sweeps agreed line for line, which is why it is one constant here and not an
 * argument — see the table below.
 *
 * A cell that is a fraction of the mean triangle edge reduces nothing and one
 * that is a multiple of it eats the silhouette; the second bound is what the
 * sweep measured, and vertices are averaged rather than snapped to cell centres
 * because snapping puts the error at a full cell instead of half of one and
 * quantises a smooth revolve into visible steps.
 *
 * DO NOT RAISE THIS TO BUY TRIANGLES. The curve was swept in-page,
 * re-clustering the built impostor at six cell sizes, and it is shallow because
 * the machine is not over-tessellated for these two uses in the first place —
 * its mean triangle edge is already about three centimetres:
 *
 *     cell    tris    vs the un-clustered 11 962
 *     3 cm    9 209        77%      <- here
 *     4 cm    7 811        65%
 *     5 cm    6 821        57%
 *     6 cm    6 326        53%
 *     8 cm    4 821        40%
 *    10 cm    3 637        30%
 *
 * Every rung past 3 cm is bought from the silhouette, and the silhouette is the
 * entire justification `DrawBudget` gives for swapping to this mesh at all. The
 * whole field is ~200k of a 3.2M-triangle frame, so the most an aggressive
 * setting could win is around 2% of the frame's triangles in exchange for
 * chunking the one thing the far LOD exists to preserve. Not a good trade.
 */
export const IMPOSTOR_CELL = 0.030;

/**
 * Grid vertex clustering — the merge's actual reduction step.
 *
 * Vertices sharing a cell collapse to one, and any triangle left with two
 * corners in the same cluster is dropped. That is the whole algorithm; it is
 * chosen over anything smarter because it is O(n), allocation-light, runs once
 * at build time, and cannot fail in a way that produces a hole — collapsing a
 * cluster too eagerly loses a triangle, never opens one.
 *
 * The cluster key carries a coarse COLOUR bucket as well as the cell. The
 * impostor has no maps, so its whole albedo lives in the colour attribute, and
 * a purely spatial cell three centimetres across happily spans the tyre and the
 * rim, or the driver's glove and their sleeve. Averaging those gives a merged
 * mesh that is right in shape and muddy in colour — the one thing the far LOD
 * is supposed to preserve verbatim, because the livery is how a player tells
 * the field apart. Four levels per channel on a square-root ramp (these are
 * linear-space values, and a linear ramp puts almost every painted surface in
 * the bottom bucket) keeps those pairs apart and costs very little reduction.
 */
export function clusterDecimate(
  pos: number[], nrm: number[], uv: number[], col: number[], idx: number[],
): THREE.BufferGeometry {
  const n = pos.length / 3;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const inv = 1 / IMPOSTOR_CELL;
  // +1 so a vertex exactly on the max face gets its own cell rather than
  // indexing one past the end of the grid.
  const nx = Math.max(1, Math.floor((maxX - minX) * inv) + 1);
  const ny = Math.max(1, Math.floor((maxY - minY) * inv) + 1);

  /** 0..3 per channel on a sqrt ramp; see the colour note above. */
  const bucket = (c: number) => {
    const q = Math.sqrt(c < 0 ? 0 : c > 1 ? 1 : c) * 3.999;
    return q < 0 ? 0 : q > 3 ? 3 : q | 0;
  };

  // Cluster id per source vertex, and per-cluster running sums.
  const map = new Int32Array(n).fill(-1);
  const keys = new Map<number, number>();
  const cPos: number[] = [], cNrm: number[] = [], cUv: number[] = [], cCol: number[] = [];
  const cCount: number[] = [];
  for (let i = 0; i < n; i++) {
    const cx = Math.floor((pos[i * 3]! - minX) * inv);
    const cy = Math.floor((pos[i * 3 + 1]! - minY) * inv);
    const cz = Math.floor((pos[i * 3 + 2]! - minZ) * inv);
    const cell = (cz * ny + cy) * nx + cx;
    const tint = (bucket(col[i * 3]!) << 4) | (bucket(col[i * 3 + 1]!) << 2) | bucket(col[i * 3 + 2]!);
    const key = cell * 64 + tint;
    let c = keys.get(key);
    if (c === undefined) {
      c = cCount.length;
      keys.set(key, c);
      cPos.push(0, 0, 0); cNrm.push(0, 0, 0); cUv.push(0, 0); cCol.push(0, 0, 0);
      cCount.push(0);
    }
    map[i] = c;
    // THE TWELVE ACCUMULATIONS BELOW ARE THE ONE PLACE THE MOVED SOURCE IS NOT
    // CHARACTER-FOR-CHARACTER WHAT THE GAMES SHIPPED, and it is worth the two
    // lines to say why rather than leaving a reader to wonder. Both games wrote
    // `cPos[c * 3] += pos[i * 3]`. A `!` cannot be placed on the target of a
    // compound assignment, so under `noUncheckedIndexedAccess` the read half of
    // every `+=` and the `++` are errors. `x[k] += y` and `x[k] = x[k] + y` are
    // the same operation whenever `k` is free of side effects, and `c`, `c * 3`
    // and `c * 3 + 1` are arithmetic on two loop-local numbers. The arithmetic
    // is untouched; only the spelling is.
    cCount[c] = cCount[c]! + 1;
    cPos[c * 3] = cPos[c * 3]! + pos[i * 3]!; cPos[c * 3 + 1] = cPos[c * 3 + 1]! + pos[i * 3 + 1]!; cPos[c * 3 + 2] = cPos[c * 3 + 2]! + pos[i * 3 + 2]!;
    cNrm[c * 3] = cNrm[c * 3]! + nrm[i * 3]!; cNrm[c * 3 + 1] = cNrm[c * 3 + 1]! + nrm[i * 3 + 1]!; cNrm[c * 3 + 2] = cNrm[c * 3 + 2]! + nrm[i * 3 + 2]!;
    cUv[c * 2] = cUv[c * 2]! + uv[i * 2]!; cUv[c * 2 + 1] = cUv[c * 2 + 1]! + uv[i * 2 + 1]!;
    cCol[c * 3] = cCol[c * 3]! + col[i * 3]!; cCol[c * 3 + 1] = cCol[c * 3 + 1]! + col[i * 3 + 1]!; cCol[c * 3 + 2] = cCol[c * 3 + 2]! + col[i * 3 + 2]!;
  }

  const m = cCount.length;
  const oPos = new Float32Array(m * 3);
  const oNrm = new Float32Array(m * 3);
  const oUv = new Float32Array(m * 2);
  const oCol = new Float32Array(m * 3);
  for (let c = 0; c < m; c++) {
    const k = 1 / cCount[c]!;
    oPos[c * 3] = cPos[c * 3]! * k;
    oPos[c * 3 + 1] = cPos[c * 3 + 1]! * k;
    oPos[c * 3 + 2] = cPos[c * 3 + 2]! * k;
    // A cluster that straddles both faces of a thin panel — a wing, the visor —
    // sums to nothing. Renormalising that gives NaN, and a single NaN normal is
    // enough for the whole draw to come out black on some drivers, so fall back
    // to straight up rather than trusting the average.
    let nxv = cNrm[c * 3]!, nyv = cNrm[c * 3 + 1]!, nzv = cNrm[c * 3 + 2]!;
    const len = Math.hypot(nxv, nyv, nzv);
    if (len > 1e-4) { nxv /= len; nyv /= len; nzv /= len; } else { nxv = 0; nyv = 1; nzv = 0; }
    oNrm[c * 3] = nxv; oNrm[c * 3 + 1] = nyv; oNrm[c * 3 + 2] = nzv;
    oUv[c * 2] = cUv[c * 2]! * k; oUv[c * 2 + 1] = cUv[c * 2 + 1]! * k;
    oCol[c * 3] = cCol[c * 3]! * k;
    oCol[c * 3 + 1] = cCol[c * 3 + 1]! * k;
    oCol[c * 3 + 2] = cCol[c * 3 + 2]! * k;
  }

  const oIdx: number[] = [];
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = map[idx[i]!]!, b = map[idx[i + 1]!]!, d = map[idx[i + 2]!]!;
    if (a === b || b === d || a === d) continue;
    oIdx.push(a, b, d);
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(oPos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(oNrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(oUv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(oCol, 3));
  out.setIndex(m > 65535 ? new THREE.Uint32BufferAttribute(oIdx, 1) : new THREE.Uint16BufferAttribute(oIdx, 1));
  out.computeBoundingSphere();
  // What the reduction actually was, so `__kartShadow.report()` can state it
  // rather than a harness having to rebuild the un-clustered mesh to find out.
  out.userData.mergedVerts = n;
  out.userData.mergedTris = idx.length / 3;
  return out;
}

/**
 * Bake, install, and hand the whole machine's shadow over to the one mesh.
 *
 * This is the second half of `mergeToImpostor` and it stood in both racers'
 * `buildKart` line for line: the same guard, the same four flags, the same
 * traverse that stops every detail mesh casting. It is called LAST, after every
 * part is in place and posed, because it is a bake of the assembled machine.
 *
 * THE TRAVERSE IS THE POINT, not the mesh. From here on this one geometry is
 * the machine's entire contribution to every cascade — near or far — and a
 * draw-budget layer decides per frame whether it is also what the camera sees.
 * Leaving the detail meshes as casters costs ~15 extra shadow draws per machine
 * and changes no pixel, which is why it survived unnoticed in one game once.
 *
 * Returns null when there was nothing to bake, and the caller must handle that
 * rather than assume: a machine built with every part skipped is a real state
 * and a silent null-deref in a render hook is not a good way to find out.
 *
 * @param renderOrder where the shadow-only pose sits in the queue. AFTER the
 *                    opaque queue, so it is killed at early-Z — but the number
 *                    is the game's, because it is a position relative to that
 *                    game's own ordering and nothing here can know it.
 */
export function installImpostor(
  root: THREE.Group, name: string, material: THREE.Material,
  bake: ImpostorBake, renderOrder: number,
): THREE.Mesh | null {
  const geo = mergeToImpostor(root, bake);
  if (!geo) return null;
  const impostor = new THREE.Mesh(geo, material);
  impostor.name = name;
  impostor.castShadow = true;
  impostor.receiveShadow = true;
  impostor.renderOrder = renderOrder;
  root.add(impostor);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if ((m as unknown as { isMesh?: boolean }).isMesh && m !== impostor) m.castShadow = false;
  });
  return impostor;
}

// ---------------------------------------------------------------------------
// Shadow debugging
// ---------------------------------------------------------------------------

export interface KartShadowDebug {
  /** Per machine: is it in the scene, is its impostor visible, is it casting. */
  report(): Array<Record<string, unknown>>;
  /** Hide the contact shadows, to judge the cascade's own shadow alone. */
  contact(on: boolean): void;
  /**
   * Put every detail mesh back in the shadow map. Costs ~15 extra shadow draws
   * per machine, so it is a diagnostic and never a shipping state.
   */
  detailShadows(on: boolean): void;
}

/** Further report fields a game wants beside the thirteen shared ones. */
export type ShadowReportExtra = (
  root: THREE.Group,
  impostor: THREE.Mesh | null,
  blob: THREE.Mesh | undefined,
) => Record<string, unknown>;

/**
 * Interrogate the shadow path of every machine built this session, without
 * reaching through Race into Kart into `visual`.
 *
 * Why this exists: a machine's ENTIRE contribution to both cascades is one mesh
 * (`kartImpostor`) — `buildKart` force-clears `castShadow` on all fifteen
 * detail meshes the moment the bake succeeds, and `DrawBudget` then owns that
 * mesh's `visible` and `castShadow` flags from `lateUpdate`. So there are four
 * independent ways for a machine to end up casting nothing at all, and from a
 * screenshot they are indistinguishable from each other and from "the cascade
 * never saw it". `__kartShadow.report()` separates them in one call, and
 * `detailShadows(true)` is the A/B: if the machine's shadow appears with the
 * detail meshes casting, the bake or its flags are at fault; if it still does
 * not, the caster was never the problem and the cascade is.
 *
 * @param built  the game's own registry of every machine built this session.
 *               Passed rather than held here: `buildKart` is what pushes to it,
 *               and a module-level array would merge two games' fields.
 */
export function kartShadowDebug(built: THREE.Group[], extra?: ShadowReportExtra): KartShadowDebug {
  const live = () => built.filter((r) => r.parent !== null);
  return {
    report: () => live().map((r) => {
      const imp = r.userData.impostor as THREE.Mesh | null;
      const blob = r.userData.shadowBlob as THREE.Mesh | undefined;
      const geo = imp?.geometry;
      if (geo && !geo.boundingSphere) geo.computeBoundingSphere();
      let casters = 0;
      r.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.castShadow) casters++; });
      return {
        kart: r.name,
        worldY: r.getWorldPosition(_iv).y.toFixed(3),
        impostor: imp ? 'built' : 'MISSING',
        impostorVisible: imp?.visible ?? false,
        impostorCastShadow: imp?.castShadow ?? false,
        impostorRadius: geo?.boundingSphere?.radius.toFixed(3) ?? '-',
        impostorTris: geo?.getIndex() ? geo.getIndex()!.count / 3 : 0,
        // Before clustering, so the far LOD's reduction is readable in one call.
        // See IMPOSTOR_CELL: the bake used to be a draw-call reduction only.
        mergedTris: geo?.userData?.mergedTris ?? 0,
        impostorVerts: geo?.getAttribute('position')?.count ?? 0,
        mergedVerts: geo?.userData?.mergedVerts ?? 0,
        meshesCastingShadow: casters,
        contactShadowVisible: blob?.visible ?? false,
        ...extra?.(r, imp, blob),
      };
    }),
    contact: (on: boolean) => {
      for (const r of live()) {
        const b = r.userData.shadowBlob as THREE.Mesh | undefined;
        if (b) b.visible = on;
      }
    },
    detailShadows: (on: boolean) => {
      for (const r of live()) {
        const imp = r.userData.impostor as THREE.Mesh | null;
        r.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m !== imp && m.name !== 'shadowBlob') m.castShadow = on;
        });
      }
    },
  };
}
