/**
 * ============================================================================
 *  SurfaceSet — the six members every scenery material library has, and none
 *  of the materials.
 * ============================================================================
 *  A kart racer and a space racer each carry a `MatLib` in their `Props.ts`.
 *  The two classes are 257 and 273 substantive lines and they are NOT the same
 *  class: `build()` is 146 lines of harbour town against 157 lines of
 *  space-station truss, the kart racer has `woodVariant` and `foliage`, the
 *  space racer has `emissive` and `finishSurfaces`, and every material in
 *  either is that game's art with a paragraph beside it explaining a number.
 *  None of that is here and none of it should be.
 *
 *  What IS the same in the two, member for member, is the bookkeeping the art
 *  hangs off:
 *
 *      constructor  shared  std  register  setEnv  dispose
 *
 *  `register`, `setEnv` and `dispose` were byte-identical. `shared` differed in
 *  one string — the tag on its console warning, `[scenery]` against
 *  `[structure]` — which is a value a game supplies, so it is a constructor
 *  argument. `std` differed in one line: the kart racer passes
 *  `envMapIntensity: 1.0` ahead of the caller's overrides and the space racer
 *  does not. That is not a divergence either, because 1.0 is
 *  `MeshStandardMaterial`'s own default for that field — the two spellings
 *  produce the same material, and the explicit one is kept because it is the
 *  one that says out loud what the default is.
 *
 *  THE SEAM. `shared()` reached for the game's own `getMaterials()` singleton,
 *  which is a game module and must not cross into a package. It reads exactly
 *  one method of it, so `VariantSource` below is that one method and the game
 *  hands its own accessor to `super()`. Nothing here knows what a race, a
 *  track, an item or a colony is, and it must stay that way: the moment one of
 *  these six needs to know whose world it is dressing, it was never one class.
 *
 *  WHAT DELIBERATELY DID NOT COME. `setEnv` assigns the MAP and never touches
 *  any material's `envMapIntensity`, and that restraint is load-bearing rather
 *  than tidy. One flat `envMapIntensity` across every material once silently
 *  deleted every metal reflection and clearcoat highlight in the kart racer;
 *  the space racer's copy of this class carries a longer note
 *  saying why it is worse there — half of every lap is inside a shadow cone
 *  with no key at all, so in the eclipse the environment map IS the lighting,
 *  and a structural steel that does not sample it is an unlit truss for 8.3
 *  seconds, ten times a race. Do not add a loop that writes one intensity
 *  across `all`.
 * ============================================================================
 */
import * as THREE from 'three';

/** Albedo + normal + roughness, the triple every procedural generator returns. */
export interface MatMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

/**
 * The ONE method of a game's shared-material singleton that `shared()` calls.
 *
 * Declared here rather than importing the games' `getMaterials`, which is a
 * game module. Both games' specialist satisfies this structurally.
 */
export interface VariantSource {
  variant(name: string, opts: { key: string }): unknown;
}

/**
 * ===========================================================================
 *  TexBase — the memo cache under a procedural texture library.
 * ===========================================================================
 *  Same argument as `SurfaceSet` directly below, one level down. Both racers
 *  carry a `TexLib` in their `Props.ts`; the kart racer's is 955 substantive
 *  lines of harbour town and the space racer's is space-station truss, and the
 *  two share not one generator between them. What they DID share, byte for
 *  byte, is the four lines that make it a library rather than a pile of
 *  functions: a keyed cache, the anisotropy the renderer will actually grant,
 *  and a `memo` that builds on first ask.
 *
 *  THE ONE DIFFERENCE IS THE CACHE'S LIFETIME AND IT IS A VALUE, NOT A
 *  BEHAVIOUR. The kart racer allocates a fresh `Map` per instance; the space
 *  racer hands every instance ONE module-scope map, because `TrackGeometry` and
 *  `Scenery` each own a `TexLib` there and without it both would generate the
 *  same nine 1024² canvases at boot. So the map is a constructor argument and
 *  each game keeps exactly the lifetime it had. Do not "unify" it: making
 *  the kart racer share one would be a real change to when its canvases are
 *  built and freed, and it would arrive as a passenger on a parity move.
 *
 *  `aniso` is capped at 8 in both. That is not a coincidence to be
 *  parameterised — it is the point past which no panel either game was tested
 *  on shows a difference, and both games measured it separately.
 */
export class TexBase {
  readonly aniso: number;
  private cache: Map<string, MatMaps>;

  /**
   * @param renderer  asked for its real max anisotropy; a generator must never
   *                  request filtering the GPU will silently ignore.
   * @param cache     a map to share, or omitted for one per instance.
   */
  constructor(renderer: THREE.WebGLRenderer, cache?: Map<string, MatMaps>) {
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.cache = cache ?? new Map<string, MatMaps>();
  }

  protected memo(key: string, gen: () => MatMaps): MatMaps {
    let m = this.cache.get(key);
    if (!m) {
      m = gen();
      this.cache.set(key, m);
    }
    return m;
  }
}

export class SurfaceSet {
  /** Every material this set owns, for the late env adopt and for disposal. */
  protected all: THREE.Material[] = [];
  protected env: THREE.Texture | null = null;
  private sharedDown = false;

  /**
   * @param source  the game's shared-material accessor, called lazily — the
   *                singleton may not exist yet when a set is constructed.
   * @param tag     what this set calls itself in a console warning. One word,
   *                and it is the game's, because "[scenery]" and "[structure]"
   *                are the two rooms these two dress.
   */
  constructor(
    private readonly source: () => VariantSource,
    private readonly tag: string,
  ) {}

  /**
   * Pull a surface from the material specialist's shared cache. `Ctx` has no
   * slot for that system, so it publishes a module singleton; `variant()` hands
   * back a private clone that shares the texture set, which is the only safe
   * thing to patch. Falls back to our own generator if the call fails — the
   * scenery must not refuse to boot because another module moved underneath it.
   */
  protected shared(name: string, key: string, tweak?: (m: any) => void): THREE.MeshStandardMaterial | null {
    if (this.sharedDown) return null;
    try {
      const m = this.source().variant(name, { key }) as THREE.MeshStandardMaterial;
      if (!m || !(m as any).isMaterial) return null;
      tweak?.(m);
      this.all.push(m);
      return m;
    } catch (e) {
      // One failure means the shared cache cannot build here at all; retrying
      // for every surface would repeat its texture work a dozen times over.
      this.sharedDown = true;
      console.warn(`[${this.tag}] shared materials unavailable, using local set`, e);
      return null;
    }
  }

  /** A standard material off one generator's triple, registered for disposal. */
  protected std(maps: MatMaps, o: Partial<THREE.MeshStandardMaterialParameters> = {}, normalScale = 1): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      map: maps.map,
      normalMap: maps.normalMap,
      roughnessMap: maps.roughnessMap,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 1.0,
      ...o,
    });
    m.normalScale.set(normalScale, normalScale);
    this.all.push(m);
    return m;
  }

  /**
   * The contact-shadow decal — the soft dark patch under every scattered prop.
   *
   * Twelve lines, spelled identically in both racers, and the ENTIRE divergence
   * between them is the two values this takes: 0.44 / #33241c in a sunlit
   * harbour, 0.52 / #141b2e in the void. Both are the game's own darkest
   * ambient family and neither is black, which is the rule that matters — the
   * art direction in one game and the same sentence in the other: an occlusion
   * sitting outside the fill's colour family reads as a hole punched in the
   * frame rather than as shade.
   *
   * The rest is not tunable and that is why it is in here. `depthWrite: false`
   * with the polygon offset is what lets the decal lie ON the ground without
   * z-fighting it; `fog: true` on a Basic material is what stops it staying
   * crisp black at the far draw distance while everything it sits under has
   * faded; `toneMapped: false` keeps it from being lifted back out of the
   * shadows by the grade. Get any one of those wrong and the symptom is a
   * flickering or floating smudge, not an error.
   */
  protected contactDecal(map: THREE.Texture, opacity: number, color: number): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      opacity,
      color,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -6,
      fog: true,
      toneMapped: false,
    });
    this.all.push(m);
    return m;
  }

  /** Adopt a material this set did not build, so it gets the env and the dispose. */
  register(m: THREE.Material) {
    this.all.push(m);
  }

  /**
   * The sky agent produces the env map after us on some quality paths; adopt it
   * late. Assigns the MAP ONLY — see the header for why the intensity must
   * never be written here.
   */
  setEnv(env: THREE.Texture | null) {
    if (env === this.env) return;
    this.env = env;
    for (const m of this.all) {
      const a = m as any;
      if ('envMap' in a) {
        a.envMap = env;
        a.needsUpdate = true;
      }
    }
  }

  dispose() {
    for (const m of this.all) m.dispose();
  }
}
