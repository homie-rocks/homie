/**
 * ============================================================================
 *  matpick — WHICH MATERIAL OWNS THIS PIXEL, AND WHICH MATERIALS FAIL.
 * ============================================================================
 *
 *  THE TWO HANDLES A FRAME-BASED REVIEWER CANNOT DERIVE FROM A PNG.
 *
 *  A reviewer — human or model — names a material by what it LOOKS like, and
 *  a PNG carries no symbol table, so the next sentence is always a guess about
 *  which module owns it. A base-building game measured that guess: one review
 *  routed seven findings by eye and every one of them named the wrong module,
 *  and three review cycles were spent partly on the guess. These two calls
 *  close it.
 *
 *  ── WHY THIS IS PLATFORM, AGAINST A VERDICT THAT SAID IT WAS NOT ───────────
 *
 *  That game's `Materials.ts` carried an earlier verdict of UNIQUE, on this
 *  reasoning, quoted in full so the overturn is legible:
 *
 *      "A record of what THIS game deleted, and an audit of THIS game's scene
 *       graph, are not a package capability."
 *
 *  Half of that was right and half of it was a category error, and the file
 *  itself is the evidence. The record-of-a-deletion half genuinely was that
 *  game's, and it is gone with the file. The audit half is not "an audit of
 *  THIS game's scene graph" — it is an audit of *a* scene graph. Read the code
 *  below: it names no building, no ship, no colony and no lunar anything. It
 *  knows a Mesh, an InstancedMesh, a MeshStandardMaterial, a Texture's
 *  anisotropy and a bounding box, which is exactly the vocabulary this package
 *  is allowed. The engine plan had listed `matPick`/`matAudit` under a
 *  planned surface package since it was written, and no engine package had
 *  ever contained a line of it: PLANNED, NEVER LANDED,
 *  with a live implementation sitting inside one game — one of eight — for the
 *  whole of that time.
 *
 *  ── WHY @homie-rocks/render AND NOT @homie-rocks/diagnostics ───────────────────────────
 *
 *  Both ship to the host and run inside the game, so "which side of the wire"
 *  does not separate them. The subject does. `@homie-rocks/diagnostics` is
 *  FRAME health — `classifyFrame`, tear detection, the acting watchdog — and it
 *  can do its whole job without knowing three.js has a material model.
 *  Everything here is roughness, metalness, envMap binding, map anisotropy and
 *  texel counts, which is surface vocabulary; and the planned surface package,
 *  the row the plan files this under, is the one whose contents landed *here*
 *  (`MaterialLib`, `Textures`, `matlib`, `matpatch`, `Surface`). Putting it
 *  beside them is one fewer package edge than putting it beside
 *  `classifyFrame`.
 *
 *  ── WHAT THE PACKAGE DELIBERATELY DOES NOT KNOW ────────────────────────────
 *
 *  Two things were parameters the moment this left the game, and both were
 *  hard-coded before:
 *
 *  1. THE SCENE. It read a `window.__ctx` global. It now takes a view. A
 *     package that reaches for a global cannot be driven twice in one process,
 *     which is precisely what the probe for it has to do.
 *  2. THE OVERLAY NAMES. `'world-decals'` was a literal in the skip test. That
 *     is a mesh name in one game, so the default here skips NOTHING and the
 *     caller declares its own overlays. The measured reason the skip exists is
 *     kept verbatim on `PickOptions.overlayNames`, because a caller that does
 *     not know the reason will not pass the list.
 *
 *  The four audit thresholds stayed, as `ART_THRESHOLDS`, with an override.
 *  They are not a look constant — nothing here is drawn — they are the numeric
 *  form of four rules, and a default of zero would make the audit answer "all
 *  clear" for a caller who forgot the argument. A check that passes when it is
 *  not configured is a failure that keeps recurring.
 */
import * as THREE from 'three';

/** The three objects an introspection needs. `renderer` is optional and only
 *  affects how a pixel coordinate is turned into NDC — see `pickMaterial`. */
export interface MatView {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer?: THREE.WebGLRenderer | null;
}

/** What `pickMaterial` reports for one screen pixel. */
export interface MatPick {
  /** Screen pixel asked about, top-left origin, CSS pixels. */
  px: [number, number];
  /** Metres from the eye to the hit, or null on a miss. */
  dist: number | null;
  /** Scene-graph path, leaf first — this is the answer to "who owns it". */
  chain: string;
  matName: string;
  matType: string;
  /** Scalar roughness. On a mapped material this is the MULTIPLIER, not the value. */
  roughness: number | null;
  metalness: number | null;
  /** [texels across, anisotropy] for each map, or null if the map is absent. */
  map: [number, number] | null;
  normalMap: [number, number] | null;
  roughnessMap: [number, number] | null;
  envMapBound: boolean;
  envMapIntensity: number | null;
}

export interface PickOptions {
  /**
   * Include meshes named in `overlayNames`. Default false.
   *
   * ── THE OVERLAY IS SKIPPED BY DEFAULT, AND THAT IS THE WHOLE POINT ────────
   *
   * MEASURED in a base-building game: `world-decals` sits 0.035 m proud of the
   * ground, so it is the FIRST raycast hit at essentially every near-field
   * ground pixel — eight of twelve sample points on one pose. A naive first-hit
   * pick therefore answers "world-decals" for the whole foreground and sends
   * the next review after a multiplicative overlay that an ablation says
   * contributes 2.3 counts to the frame. Any game with a decal, wetness or
   * scorch layer laid over its ground has the same shape of problem and should
   * name it here.
   */
  overlays?: boolean;
  /** Mesh names treated as overlays. Default `[]` — the package knows no mesh
   *  name of yours, so an unconfigured pick reports the true first hit. */
  overlayNames?: readonly string[];
  /** Raycaster far plane in metres. Default 20000. */
  far?: number;
}

const _miss = (x: number, y: number, chain: string): MatPick => ({
  px: [x, y], dist: null, chain, matName: '', matType: '',
  roughness: null, metalness: null, map: null, normalMap: null, roughnessMap: null,
  envMapBound: false, envMapIntensity: null,
});

/**
 * WHICH MATERIAL OWNS THIS PIXEL.
 *
 * `pickMaterial(view, 960, 1000)` on a frozen frame. Give it the same screen
 * coordinates the reviewer quoted and it hands back the scene-graph path and
 * the material's real texture state, so a finding can be routed in one call.
 *
 * Raycasting rather than reading a picking buffer is deliberate: it needs no
 * extra render target, no shader variant and no renderer state, so it cannot
 * perturb the frame it is being asked about. It also means this function needs
 * no GL context at all, which is why its probe runs in plain Node.
 *
 * Not on the hot path. It allocates freely and is meant to be driven from a
 * test's `page.evaluate` on a frozen frame.
 */
export function pickMaterial(
  view: MatView, x: number, y: number, opts: PickOptions = {},
): MatPick {
  if (!view || !view.scene || !view.camera) return _miss(x, y, 'NO VIEW');
  const overlayNames = opts.overlayNames ?? [];
  const showOverlays = opts.overlays === true;

  // Size from the renderer, not from window.innerWidth: a capture run uses an
  // explicit backing-store size and a resolution scaler can be between the two.
  // Asking the thing that actually drew the pixel is the only honest source.
  // With no renderer — Node, or a caller that has not passed one — fall back to
  // the window, and to 1x1 when there is no window either, which makes a
  // headless caller's coordinates NDC-shaped rather than silently wrong.
  const size = view.renderer ? view.renderer.getSize(new THREE.Vector2()) : null;
  const win = globalThis as unknown as { innerWidth?: number; innerHeight?: number };
  const vw = size && size.x > 0 ? size.x : (win.innerWidth ?? 1);
  const vh = size && size.y > 0 ? size.y : (win.innerHeight ?? 1);

  view.camera.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  ray.far = opts.far ?? 20000;
  ray.setFromCamera(new THREE.Vector2((x / vw) * 2 - 1, -((y / vh) * 2 - 1)), view.camera);

  const hits = ray.intersectObjects(view.scene.children, true);
  for (const h of hits) {
    const o = h.object as THREE.Mesh;
    if (!o.visible || !o.material) continue;
    if (!showOverlays && overlayNames.indexOf(o.name) >= 0) continue;
    // An ancestor turned off hides the leaf even though the leaf reads visible,
    // and three's raycast does not check the chain. Missing this reports a
    // hidden LOD tier as the visible surface, which is a plausible wrong answer.
    let vis = true;
    for (let p: THREE.Object3D | null = o.parent; p; p = p.parent) if (!p.visible) { vis = false; break; }
    if (!vis) continue;

    const m = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
    const path: string[] = [];
    for (let p: THREE.Object3D | null = o; p; p = p.parent) path.push(p.name || p.type);
    const tex = (t: THREE.Texture | null | undefined): [number, number] | null =>
      (t ? [t.image ? (t.image as { width?: number }).width ?? 0 : 0, t.anisotropy] : null);
    return {
      px: [x, y],
      dist: +h.distance.toFixed(3),
      chain: path.join(' < '),
      matName: m.name || '(unnamed)',
      matType: m.type,
      roughness: typeof m.roughness === 'number' ? m.roughness : null,
      metalness: typeof m.metalness === 'number' ? m.metalness : null,
      map: tex(m.map),
      normalMap: tex(m.normalMap),
      roughnessMap: tex(m.roughnessMap),
      envMapBound: !!m.envMap,
      envMapIntensity: typeof m.envMapIntensity === 'number' ? m.envMapIntensity : null,
    };
  }
  return _miss(x, y, '');
}

/** One material's row in the audit report. */
export interface MatAuditRow {
  matName: string;
  matType: string;
  /** How many visible meshes in the scene wear it. Instance counts folded in. */
  users: number;
  /** Largest world-space bounding-box face area across those meshes, m². */
  areaM2: number;
  roughness: number | null;
  metalness: number | null;
  hasRoughnessMap: boolean;
  hasNormalMap: boolean;
  hasMap: boolean;
  envMapBound: boolean;
  minAnisotropy: number;
  /** Which automatic-fail conditions this material trips. */
  fails: string[];
}

export interface MatAudit {
  rows: MatAuditRow[];
  visibleMeshes: number;
  failing: number;
}

/**
 * The four numbers the fail conditions are stated in. Exported so a caller can
 * read the defaults it is accepting rather than inherit them silently.
 *
 * These are the art-direction rules of the games these came from. A game with a
 * different rule passes its own; a game that passes nothing gets a checklist
 * that is at least *a* checklist, which is the only safe direction for a
 * check's default to be wrong in.
 */
export const ART_THRESHOLDS = {
  /** A roughness scalar with no roughnessMap on a surface over this many m² is
   *  `constant-roughness`. The single most-repeated finding across ten reviews. */
  flatAreaM2: 2,
  /** Metalness above this with envMap unbound is `metal-no-env`. A metal with
   *  no environment has nothing to reflect. */
  metalness: 0.5,
  /** Only surfaces over this many m² are graded for anisotropy: the rule is
   *  about a grazing sampling footprint, not about the module the mesh is from. */
  grazingAreaM2: 64,
  /** A graded surface sampling under this is `low-anisotropy:<n>`. */
  minAnisotropy: 8,
} as const;

export type AuditThresholds = { -readonly [K in keyof typeof ART_THRESHOLDS]: number };

/**
 * THE CHECKLIST, RUN AGAINST THE SCENE THAT IS ACTUALLY ON SCREEN.
 *
 * Every row is a material that some visible mesh wears, with the automatic-fail
 * conditions stated as rules rather than as taste:
 *
 *   constant-roughness   a roughness scalar with no roughnessMap on a surface
 *                        over `flatAreaM2`.
 *   untextured           a MeshStandardMaterial with no map at all.
 *   metal-no-env         metalness above `metalness` with envMap unbound. Also
 *                        the detector for three OVERWRITING envMapIntensity
 *                        every frame on exactly these materials.
 *   low-anisotropy       a ground-scale surface sampling under `minAnisotropy`.
 *
 * IT REPORTS A LIST, NOT A SCORE. A statistic can rise while the picture gets
 * worse, so this hands back the rows and lets the reader look. `fails` empty on
 * every row is a real pass; a material missing from the list entirely means
 * nothing visible wears it, which is a different thing and worth noticing.
 *
 * ── THE ONE PLACE `areaM2` IS STILL NOT A SURFACE, SAID OUT LOUD ────────────
 *
 * A static batcher merges whole groups into single meshes, so a batch's world
 * bounding box is the extent of everything it swallowed — one base-building
 * game's far-tier ring rows report 8.5e9 m². That is not a lie about the
 * FAILURE (a merged
 * batch genuinely is one surface bigger than 2 m², so `constant-roughness` and
 * `untextured` stay correct on it) but it IS a lie about the number, and
 * `low-anisotropy` is the one test it can trip spuriously. Read the fails, not
 * the areas, on any row over about 10,000 m², and do not build a check on that
 * field. The instanced case is handled properly below; the merged case is not,
 * because a merged mesh has genuinely lost the piece boundaries by then.
 */
export function auditMaterials(
  scene: THREE.Scene | null | undefined,
  thresholds: Partial<AuditThresholds> = {},
): MatAudit {
  if (!scene) return { rows: [], visibleMeshes: 0, failing: 0 };
  const T: AuditThresholds = { ...ART_THRESHOLDS, ...thresholds };

  const by = new Map<THREE.Material, MatAuditRow>();
  const box = new THREE.Box3();
  const sz = new THREE.Vector3();
  const scl = new THREE.Vector3();
  let visibleMeshes = 0;

  scene.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material || !mesh.geometry) return;
    visibleMeshes++;
    // Instanced sets get their instance count folded into `users`, because "one
    // material on 4,800 boulders" and "one material on one crate" are not the
    // same risk and a row that cannot tell them apart is not worth reading.
    const inst = (mesh as unknown as { isInstancedMesh?: boolean; count?: number });
    const n = inst.isInstancedMesh ? Math.max(1, inst.count ?? 1) : 1;

    // ── AREA IS PER-PIECE, NOT PER-SET, AND THE FIRST VERSION GOT IT WRONG ───
    //
    // The rule is about ONE SURFACE, so the number has to be the size of a piece
    // the eye sees at once. Taking the world bounding box of an InstancedMesh
    // measures the box around 26,002 scattered boulders and came back at
    // 40,420,250 m² for a material whose actual subject is a 0.4 m rock — a
    // confident, precise, entirely fictional reading. So an instanced set is
    // measured on its GEOMETRY's own box scaled by the object's world scale,
    // which is one instance, and only a non-instanced mesh uses its world box.
    let area: number;
    if (inst.isInstancedMesh) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      mesh.geometry.boundingBox!.getSize(sz);
      mesh.getWorldScale(scl);
      sz.set(sz.x * Math.abs(scl.x), sz.y * Math.abs(scl.y), sz.z * Math.abs(scl.z));
    } else {
      box.setFromObject(mesh, true);
      box.getSize(sz);
    }
    // Largest FACE of the bounding box, which is the honest cheap proxy for "how
    // much of this surface can the eye see at once". A ground chunk is wide and
    // flat, so its top face is the number the 2 m² rule wants.
    area = Math.max(sz.x * sz.z, sz.x * sz.y, sz.y * sz.z);

    for (const raw of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
      const m = raw as THREE.MeshStandardMaterial;
      let row = by.get(m);
      if (!row) {
        const aniso = [m.map, m.normalMap, m.roughnessMap]
          .filter(Boolean).map((t) => (t as THREE.Texture).anisotropy);
        row = {
          matName: m.name || '(unnamed)',
          matType: m.type,
          users: 0,
          areaM2: 0,
          roughness: typeof m.roughness === 'number' ? +m.roughness.toFixed(3) : null,
          metalness: typeof m.metalness === 'number' ? +m.metalness.toFixed(3) : null,
          hasRoughnessMap: !!m.roughnessMap,
          hasNormalMap: !!m.normalMap,
          hasMap: !!m.map,
          envMapBound: !!m.envMap,
          minAnisotropy: aniso.length ? Math.min(...aniso) : 0,
          fails: [],
        };
        by.set(m, row);
      }
      row.users += n;
      if (area > row.areaM2) row.areaM2 = +area.toFixed(1);
    }
  });

  for (const [m, row] of by) {
    const std = m as THREE.MeshStandardMaterial;
    // A ShaderMaterial has none of these properties and is not a subject of the
    // checklist: it carries its own shading and the rules cannot see inside it.
    // Saying so explicitly beats emitting four false failures per overlay.
    if (!(std as unknown as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial
      && !(std as unknown as { isMeshPhysicalMaterial?: boolean }).isMeshPhysicalMaterial) {
      row.fails.push('not-a-standard-material:unchecked');
      continue;
    }
    if (!row.hasRoughnessMap && row.areaM2 > T.flatAreaM2) row.fails.push('constant-roughness');
    if (!row.hasMap) row.fails.push('untextured');
    if ((row.metalness ?? 0) > T.metalness && !row.envMapBound) row.fails.push('metal-no-env');
    if (row.areaM2 > T.grazingAreaM2 && row.minAnisotropy > 0 && row.minAnisotropy < T.minAnisotropy) {
      row.fails.push('low-anisotropy:' + row.minAnisotropy);
    }
  }

  const rows = [...by.values()].sort((a, b) => b.areaM2 - a.areaM2);
  return { rows, visibleMeshes, failing: rows.filter((r) => r.fails.length > 0).length };
}
