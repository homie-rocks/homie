/**
 * ============================================================================
 *  Rock.ts — an angular, faceted lump. The package had a dome and no rock.
 * ============================================================================
 *
 *  `Landmark.landmassGeo` is a DOME: one radius wobble and one height power
 *  curve. That is the right answer for a rock stack at 20 m. It is the WRONG
 *  answer for fractured stone, because the thing that makes a boulder read as
 *  stone rather than as a potato is that its facets are FLAT and its
 *  silhouette is dominated by proportion rather than by bumps. A smooth blob
 *  under a hard low key light is a potato at any size, and repeated reviews of
 *  a lunar scene said so before this generator was written.
 *
 *  So: an icosahedron displaced along its own vertex directions, three
 *  low-frequency lobes for a front and a back, facet-scale break-up, squashed
 *  underneath, stretched on two horizontal axes, and non-indexed with
 *  `computeVertexNormals` so every face is flat.
 *
 *  ── THE ONE SUBTLE LINE, AND IT IS THE REASON THIS IS A CAPABILITY ─────────
 *
 *  The break-up hash is keyed off the QUANTISED vertex direction:
 *
 *      const qx = Math.round( x * 6 ), qy = ..., qz = ...;
 *      r *= 0.86 + 0.28 * hash( qx * 31 + qz, qy * 17 );
 *
 *  A polyhedron's shared edge arrives as two vertices at the same position in
 *  two different faces. Hashing the raw position gives them displacements that
 *  differ in the last bits, the two faces separate, and the hull develops
 *  cracks you can see the inside of. Quantising first makes both look up the
 *  same cell and the hull stays closed. That is a correctness property of
 *  displaced polyhedra, not a fact about any world, and it is exactly the kind
 *  of thing a generated game rediscovers the hard way.
 *
 *  ── WHAT IS PASSED IN, AND WHY BOTH OF THEM ARE ────────────────────────────
 *
 *  `rng` AND `hash` are arguments, separately, because they are separate
 *  streams and a caller's world is reproducible only if both stay its own.
 *  The game this came from passes `mulberry32(seed)` and its crater field's
 *  `hash2` bound to the same seed; substituting `@homie-rocks/noise`'s `hash2`
 *  — a different stream — would regenerate every rock on the map. That is a
 *  content change wearing a de-duplication costume, and it was refused.
 *
 *  Content the caller keeps: how many rocks, how big, what shape class, which
 *  material, and `uvScale`, which is the nominal diameter divided by the detail
 *  tile's period. This function knows a lump.
 *
 *  A parity probe compares the position, normal and uv buffers of every
 *  geometry this returns against the original game's pinned pre-move source
 *  ELEMENT BY ELEMENT with `Object.is`. A mesher that returns the same
 *  triangle COUNT can return a different SHAPE, so counts are not the test.
 */
import * as THREE from 'three';

/** Scratch for the lobe directions. No allocation per vertex. */
const _p = new THREE.Vector3();

/**
 * One angular rock, radius roughly 1.
 *
 * @param detail    icosahedron subdivision — 0 is 20 triangles, 2 is 320
 * @param rng       the caller's stream. Consumed in a FIXED order: three
 *                  components and an amplitude per lobe, three lobes, then the
 *                  two horizontal stretch factors. Changing that order changes
 *                  every rock a caller has ever generated.
 * @param hash      the caller's lattice hash, already bound to its seed
 * @param uvScale   how many tiles of the caller's detail texture the unit
 *                  sphere's spherical UV should span
 */
export function angularRock(
  detail: number,
  rng: () => number,
  hash: (x: number, y: number) => number,
  uvScale: number,
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // Three fixed lobes per shape: the low-frequency asymmetry that gives the
  // rock a front and a back.
  const lobes: number[][] = [];
  for (let i = 0; i < 3; i++) {
    _p.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    lobes.push([_p.x, _p.y, _p.z, 0.16 + rng() * 0.24]);
  }
  const ax = 0.78 + rng() * 0.42;
  const az = 0.78 + rng() * 0.42;

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let r = 1;
    for (const L of lobes) r += L[3]! * (x * L[0]! + y * L[1]! + z * L[2]!);
    // Facet-scale break-up keyed off the quantised direction, so the two
    // vertices a shared edge produces get identical displacement and the hull
    // stays closed.
    const qx = Math.round(x * 6), qy = Math.round(y * 6), qz = Math.round(z * 6);
    r *= 0.86 + 0.28 * hash(qx * 31 + qz, qy * 17);
    x *= r * ax;
    y *= r * (y < 0 ? 0.62 : 0.88);   // squat, and flatter underneath
    z *= r * az;
    pos.setXYZ(i, x, y, z);
  }
  // Non-indexed polyhedron plus computeVertexNormals gives flat facets, which
  // is the intent.
  g.computeVertexNormals();

  // A unit sphere's spherical UV spans 0..1, so without this scale a 30 cm rock
  // would wear a whole tile of the caller's detail texture and its grain would
  // be forty times too big.
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale);

  g.computeBoundingSphere();
  return g;
}
