/**
 * ============================================================================
 *  meshcensus.ts — what a subtree would actually cost to draw.
 * ============================================================================
 *
 * Every subsystem in these games publishes a `stats()` for its tests, and
 * every one of them wants the same three numbers off a subtree: how many meshes
 * would issue a call, how many triangles they carry, and how many are sitting
 * there hidden. Counting them naively gets two of the three wrong.
 *
 * ── AN LOD DRAWS ONE LEVEL, NOT ALL OF THEM ─────────────────────────────────
 * `THREE.LOD` holds every tier as a child and shows one. Traversing it and
 * counting all of them reports a draw budget the subsystem does not spend —
 * three or four times over on a prop set built with far tiers. So a mesh whose
 * grandparent is an LOD is skipped: three's own LOD structure is
 * `LOD -> Object3D level -> Mesh`, which is why the test is on `parent.parent`
 * and not on `parent`.
 *
 * ── INVISIBLE IS INHERITED, AND THREE CULLS IT BEFORE THE CALL ──────────────
 * `visible = false` anywhere up the chain removes the whole subtree from the
 * render, so a hidden mesh costs nothing to draw. Walking to the root rather
 * than reading the mesh's own flag is the difference between a number and a
 * guess: a building mid-construction hides its finished form on the GROUP.
 *
 * ── BUT HIDDEN IS STILL REPORTED, AND THAT IS THE POINT ─────────────────────
 * "Draw calls are not proof of rendering" cuts both ways: a census that
 * silently drops what it did not count flatters itself, and a subsystem
 * carrying a second colony of invisible meshes is a real memory and build-time
 * cost that no draw-call number will ever show. So `hiddenMeshes` is a
 * first-class row, not a footnote.
 *
 * Triangles are read off the position attribute's count, which is the vertex
 * count of the geometry as uploaded — non-indexed here by construction, which
 * is what every accumulator in these packages emits.
 */
import * as THREE from 'three';

export interface MeshCensus {
  /** Meshes that would issue a draw call: visible, and not a dormant LOD tier. */
  meshes: number;
  /** Meshes present in the subtree that three will cull before the call. */
  hiddenMeshes: number;
  /** Triangles across the counted meshes, rounded. */
  triangles: number;
}

export function meshCensus(root: THREE.Object3D): MeshCensus {
  let meshes = 0, tris = 0, hidden = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.parent && (m.parent.parent as unknown as { isLOD?: boolean })?.isLOD) return;
    let vis = true;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) { vis = false; break; }
    if (!vis) { hidden++; return; }
    meshes++;
    const pos = m.geometry?.attributes?.position;
    if (pos) tris += pos.count / 3;
  });
  return { meshes, hiddenMeshes: hidden, triangles: Math.round(tris) };
}
