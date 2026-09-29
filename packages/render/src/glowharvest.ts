/**
 * ============================================================================
 *  glowharvest.ts — turn the emissive GEOMETRY already in a scene into a
 *  ranked list of places a real light should go.
 * ============================================================================
 *
 * ## The problem this is the general form of
 *
 * A game builds glowing strips, windows and beacons as emissive geometry, and
 * separately owns a pool of real lights. The two never meet, because meeting
 * them requires a handshake between two subsystems that each think the other
 * will call: **an emissive strip that lights nothing around it is the single
 * loudest amateur tell in a night scene**, and it survives review after review
 * because the strip itself looks right in every screenshot.
 *
 * Waiting to be called is not a plan. This walks the scene instead: it finds
 * the emissive meshes by naming convention, clusters their vertices in world
 * space, averages the vertex colour inside each cluster, and hands back the
 * clusters ranked by how much emissive surface each holds. What the caller does
 * with them — which of its own lights to spend, what colour, how bright — is
 * entirely the caller's.
 *
 * ## Two things in here that look like details and are not
 *
 * **The cell key is a packed integer, not a string.** The key is built once per
 * SAMPLED VERTEX, so a merged world is tens of thousands of key constructions
 * on the one frame the geometry changes, and string concatenation there is the
 * difference between a rebuild nobody sees and a visible hitch. The pack holds
 * ±2048 cells laterally and ±512 vertically and stays inside 2^53.
 *
 * **`signature` is what makes this affordable at all.** Re-clustering every
 * scan interval would be wasted work on a world that has stopped changing, so
 * the caller compares the cheap signature pass — mesh names and vertex counts,
 * exactly what moves when geometry is added or re-merged — and only pays for
 * the cluster pass when it differs.
 *
 * ## What is deliberately NOT here
 *
 * **Every number.** Cell size, vertex stride, the minimum cluster, the ceiling:
 * all required, none defaulted. A cell size is a statement about how far the
 * caller's lights reach, and a default would be one game's road-lighting scale
 * silently applied to another game's corridor.
 *
 * **The palette, the intensity curve and the lift.** `harvestGlow` returns
 * averaged positions and averaged colours. It does not know what colour a
 * fixture is allowed to be or how bright surface area makes it, because those
 * are art direction, and a constant of one game's art direction living in a
 * shared package is how the next game inherits its look while every parity
 * check stays green.
 *
 * **Ticket lifecycle.** Whatever the caller allocates against these clusters,
 * it owns. This module holds no state at all.
 */
import * as THREE from 'three';

/** One spatial cluster of emissive geometry, with its averages resolved. */
export interface GlowCluster {
  /** Centroid of the sampled vertices, world space. */
  x: number; y: number; z: number;
  /** Mean vertex colour over the cluster. White when the geometry has none. */
  r: number; g: number; b: number;
  /** How many vertices were sampled into it — the emissive-area proxy. */
  n: number;
}

export interface GlowHarvestSpec {
  /** Mesh-name suffix that marks emissive geometry. */
  suffix: string;
  /** Cluster cell side, world units. */
  cell: number;
  /** Sample every Nth vertex. 1 samples all of them. */
  stride: number;
  /** Clusters thinner than this are dropped as noise. */
  minVerts: number;
  /** Ceiling on the returned list, after ranking. */
  maxClusters: number;
}

/** Accumulator for one cell. Sums, divided out at the end. */
interface Cell {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
  n: number;
}

const _pos = new THREE.Vector3();

/** True for a mesh this harvest is interested in. */
function eligible(o: THREE.Object3D, suffix: string): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  return m.isMesh === true
    && typeof m.name === 'string' && m.name.endsWith(suffix)
    && m.visible
    && m.geometry?.attributes?.position !== undefined;
}

/**
 * The cheap change detector: mesh names and vertex counts, concatenated.
 *
 * Returns the signature and how many meshes matched. **Zero meshes with a built
 * world means the naming convention moved**, which is the only way this whole
 * mechanism fails silently — nothing throws, no light is ever requested, and
 * the scene simply looks like it did before any of this existed. Callers should
 * shout on that, loudly, rather than treat it as an empty world.
 */
export function glowSignature(
  scene: THREE.Object3D, suffix: string,
): { signature: string; meshes: number } {
  let signature = '';
  let meshes = 0;
  scene.traverse((o) => {
    if (!eligible(o, suffix)) return;
    meshes++;
    const pos = o.geometry.attributes.position as THREE.BufferAttribute;
    signature += o.name + ':' + pos.count + ';';
  });
  return { signature, meshes };
}

/**
 * Cluster every matching mesh's vertices and return the clusters, ranked by
 * vertex count descending so a ceiling drops the THINNEST clusters rather than
 * an arbitrary hash order.
 *
 * World space is resolved through each mesh's own `matrixWorld`, which is
 * correct both for per-object geometry and for a merged batch that has baked
 * world transforms in and left its mesh at the identity — no special case for
 * either. `scene.updateMatrixWorld(false)` is called first, because a cluster
 * built from a stale matrix puts a light where the geometry used to be.
 *
 * Vertex colour is how one emissive material commonly carries several fixture
 * families; geometry without it contributes white, so a game that does not use
 * vertex colour gets one uniform answer rather than a silent zero.
 */
export function harvestGlow(
  scene: THREE.Object3D, spec: GlowHarvestSpec,
): GlowCluster[] {
  const cells = new Map<number, Cell>();
  scene.updateMatrixWorld(false);
  scene.traverse((o) => {
    if (!eligible(o, spec.suffix)) return;
    const geo = o.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = geo.attributes.color as THREE.BufferAttribute | undefined;
    for (let i = 0; i < pos.count; i += spec.stride) {
      _pos.fromBufferAttribute(pos, i);
      _pos.applyMatrix4(o.matrixWorld);
      const ix = THREE.MathUtils.clamp(Math.round(_pos.x / spec.cell), -2048, 2047) + 2048;
      const iy = THREE.MathUtils.clamp(Math.round(_pos.y / spec.cell), -512, 511) + 512;
      const iz = THREE.MathUtils.clamp(Math.round(_pos.z / spec.cell), -2048, 2047) + 2048;
      const key = ix + iz * 4096 + iy * 16777216;
      let c = cells.get(key);
      if (c === undefined) {
        c = { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, n: 0 };
        cells.set(key, c);
      }
      c.x += _pos.x; c.y += _pos.y; c.z += _pos.z;
      if (col !== undefined && col.count > i) {
        c.r += col.getX(i); c.g += col.getY(i); c.b += col.getZ(i);
      } else { c.r += 1; c.g += 1; c.b += 1; }
      c.n++;
    }
  });

  const ranked = [...cells.values()].filter((c) => c.n >= spec.minVerts);
  ranked.sort((a, b) => b.n - a.n);
  const out: GlowCluster[] = [];
  for (const c of ranked) {
    if (out.length >= spec.maxClusters) break;
    const inv = 1 / c.n;
    out.push({
      x: c.x * inv, y: c.y * inv, z: c.z * inv,
      r: c.r * inv, g: c.g * inv, b: c.b * inv,
      n: c.n,
    });
  }
  return out;
}
