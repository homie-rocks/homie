/**
 * ============================================================================
 *  FallbackLib — "ask the shared library first, and if it cannot help, build
 *  it yourself; and if you need vertex colours, clone WITHOUT losing the
 *  library's shader work."
 * ============================================================================
 *
 *  A world that generates its own materials has two suppliers: a shared
 *  specialist that owns the good textures, and its own procedural fallbacks
 *  for the surfaces the specialist has never heard of. This is the bookkeeping
 *  between them. It is NOT `SurfaceSet` in `matlib.ts`, and the two live side
 *  by side deliberately:
 *
 *   · `SurfaceSet` pulls PRIVATE VARIANTS (`variant(name, {key})`) and owns
 *     the env-map adopt and the disposal list for a scenery library.
 *   · This asks for a SHARED SINGLETON (`get(name)`), memoises its own
 *     fallbacks under a prefixed name, and exists mostly for `vc()`.
 *
 *  ── `vc()` IS WHY THIS FILE EXISTS AND ITS FAILURE MODE IS SILENT ──────────
 *
 *  A road needs vertex colours — a racing line, shoulder grime, a sand drift,
 *  a kerb's joint dirt are per-metre masks and a 3.5 m tiling texture cannot
 *  carry one by definition. The shared library enables `vertexColors` nowhere,
 *  which is right for a wall and fatal for a road, so the road takes a clone
 *  and flips the flag on the copy rather than mutating a material somebody
 *  else holds a reference to.
 *
 *  AND `Material.copy()` WALKS A FIXED PROPERTY LIST THAT `onBeforeCompile` IS
 *  NOT ON. So a bare clone silently loses whatever the library injected —
 *  triplanar projection, tile breakup, a distance settle — and renders a
 *  perfectly good frame with a visible 3.5 m repeat in it. Carrying the hook
 *  AND its `customProgramCacheKey` across, bound to the ORIGINAL so its
 *  closure state is still the original's, is the whole job. three folds
 *  `vertexColors` into the program cache key itself, so the two variants
 *  cannot collide onto one program even though they share a key function.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS NOT ──────────────────────────────────────
 *
 *   · MECHANISM — the cache, the shared-first order, the `!shared.map`
 *     placeholder rule, the clone-and-carry, the anisotropy cap.
 *   · CONTENT — every `make()`, every `extra()`, every fallback world scale,
 *     and the `prefix` a world names its own materials with.
 *
 *  ── THE `!shared.map` RULE, WHICH LOOKS LIKE A HEURISTIC AND IS NOT ────────
 *
 *  A standard material with no albedo map is the specialist's boot
 *  placeholder, handed out before its textures have baked. Rendering flat grey
 *  is worse than rendering a procedural fallback, and the alternative — wait
 *  for the specialist — is a world that does not boot when the specialist is
 *  absent. Preferring ours is the choice that always produces a picture.
 * ============================================================================
 */
import * as THREE from 'three';

/**
 * The two methods of a game's shared-material singleton this calls, both
 * optional. Declared structurally rather than imported, because the singleton
 * is a game module and this package may not depend on one.
 */
export interface SharedMatLib {
  get?(name: string): THREE.Material | null | undefined;
  worldScale?(name: string): number | undefined;
}

export class FallbackLib {
  private cache = new Map<string, THREE.Material>();
  readonly aniso: number;
  /** Clones made by `vc()`, so a caller can keep their env map in step. */
  readonly clones: THREE.MeshStandardMaterial[] = [];

  /**
   * @param src      the shared singleton, or null when it could not be reached
   * @param renderer asked for its real max anisotropy; a generator must never
   *                 request filtering the GPU will silently ignore. Capped at
   *                 8, which is the point past which no panel it was tested on
   *                 shows a difference.
   * @param prefix   what this library names the materials it owns, so a debug
   *                 view can tell them from the shared ones at a glance.
   */
  constructor(
    private readonly src: SharedMatLib | null,
    renderer: THREE.WebGLRenderer | null | undefined,
    private readonly prefix: string,
  ) {
    const cap = renderer?.capabilities;
    this.aniso = cap ? Math.min(8, cap.getMaxAnisotropy()) : 8;
  }

  /** Ask the shared library first; fall back to our own procedural set. */
  get(name: string, make: () => THREE.Material): THREE.Material {
    let shared: THREE.Material | null | undefined = null;
    try {
      shared = this.src?.get?.(name);
    } catch (e) {
      // One material failing to bake must not take the whole world with it.
      console.warn(`[${this.prefix}] shared material "${name}" unavailable, using fallback`, e);
    }
    // See the header: a standard material with no albedo map is the boot
    // placeholder, and flat grey is worse than our own procedural surface.
    if (shared && (shared as THREE.MeshStandardMaterial).map) return shared;
    return this.own(name, make);
  }

  /** A material this library owns outright, memoised and named. */
  own(name: string, make: () => THREE.Material): THREE.Material {
    let m = this.cache.get(name);
    if (!m) {
      m = make();
      m.name = this.prefix + '-' + name;
      this.cache.set(name, m);
    }
    return m;
  }

  /**
   * As `get()`, but guaranteed to consume the mesh's vertex colours.
   *
   * `extra` is shader work that rides on the CLONE, never on the shared
   * original: the library hands the same material to walls, props and the
   * minimap, and a road-specific fade has no business on any of them.
   */
  vc(name: string, make: () => THREE.Material, extra?: (m: THREE.Material) => void): THREE.Material {
    const key = name + (extra ? '|vc+x' : '|vc');
    const hit = this.cache.get(key);
    if (hit) return hit;
    const base = this.get(name, make) as THREE.MeshStandardMaterial;
    if (base.vertexColors && !extra) return base; // our own fallbacks already do
    const c = base.clone();
    // See the header. `Material.copy()` does not walk these two.
    const before = (base as unknown as { onBeforeCompile?: THREE.Material['onBeforeCompile'] }).onBeforeCompile;
    if (before && before !== THREE.Material.prototype.onBeforeCompile) {
      c.onBeforeCompile = before.bind(base);
      c.customProgramCacheKey = base.customProgramCacheKey.bind(base);
    }
    c.vertexColors = true;
    c.name = (base.name || name) + '-vc';
    if (extra) extra(c);
    c.needsUpdate = true;
    this.cache.set(key, c);
    this.clones.push(c);
    return c;
  }

  /** Metres of world one texture tile of `name` covers, or the fallback. */
  scale(name: string, fallback: number): number {
    const s = this.src?.worldScale?.(name);
    return s && s > 0 ? s : fallback;
  }
}
