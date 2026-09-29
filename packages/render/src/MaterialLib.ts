/**
 * ============================================================================
 *  THE AUTHORING CONTRACT every procedural material in these games obeys.
 * ============================================================================
 *  This was 54 lines at the top of a kart racer's `Materials.ts` and 54
 *  identical lines at the top of a space racer's. It is a set of RULES, not a
 *  description of either game, and a rule kept in two places is a rule that
 *  drifts. It lives here because this is the file holding the `get`,
 *  `worldScale` and `macroMaps` the first and last bullets are about.
 *
 *   • Materials are built LAZILY on first `get()` and cached forever. Asking
 *     twice returns the *same* object — never mutate a material you did not
 *     build. If you need a recoloured copy, use `variant()` / `livery()`,
 *     which clone the material but share the textures.
 *   • Every material ships albedo + normal + packed ORM (R=AO, G=roughness,
 *     B=metalness), all procedurally generated, all with spatially varying
 *     roughness. Normals are Sobel-derived from a real height field.
 *   • **Every surface is built at three scales, not one.** A texture generator
 *     that produces only fine grain makes every material the same material
 *     wearing a different tint, however good the grain is, because grain is the
 *     one frequency that averages to a constant the moment the camera is a metre
 *     away. So each material is:
 *       - a TILE (1024²/512², a few metres across) carrying millimetres to
 *         decimetres, and
 *       - a MACRO MAP (128², built by `macroMaps()`, sampled in WORLD space at a
 *         period of 4-32 m) carrying everything above about a metre: patch
 *         repairs, colour drift, pooling, weathering zones, worn-through ground.
 *     The macro layer modulates **albedo AND roughness**, from two decorrelated
 *     fields — a metre-scale blotch that moves colour alone still lights like a
 *     flat sheet, because the specular response a 14° key rakes across never
 *     changed. Rock and the bore add a third scale on top: world-horizontal
 *     strata, which no isotropic noise field at any frequency can produce.
 *   • **Nothing is isotropic.** Every surface with a natural direction gets one:
 *     road aggregate smeared down the direction of travel, rain run down a wall,
 *     grain along a plank, rock spalling along its bedding. Inside the tile that
 *     is `stretchY` and `directionalBlur`; above a metre it is `streak`, a band
 *     read in the tile's own UV frame at a heavily stretched scale, which follows
 *     the track through every corner for one texture fetch.
 *   • The world-space sampling matters as much as the content: a variation
 *     welded to each mesh's UV layout repeats once per instance and once per
 *     tile. Architecture additionally takes a per-instance UV phase offset and
 *     value jitter, keyed off the instance origin — a hundred houses sharing one
 *     texture set must not share one texture *phase*.
 *   • Low-frequency fbm fields that carry form are `normalize`d. An n-octave sum
 *     piles up around 0.5 by the central limit theorem, so a field consumed as
 *     `(v - 0.5) * k` delivers a fraction of the swing its coefficient claims.
 *     Read `FbmOpts.normalize` before authoring another one.
 *   • Ground materials carry a distance settle: past ~35 m the fine octave
 *     fades into its own local mean and the normal flattens with it, because a
 *     detail layer that holds full contrast to the horizon is a shimmering
 *     carpet the moment the camera moves.
 *   • `worldScale(name)` reports how many metres one tile of the texture is
 *     meant to cover. Build your UVs as `worldPos / worldScale` and every
 *     surface in the game will agree on texel density.
 * ============================================================================
 */

/**
 * ============================================================================
 *  The material library's own skeleton — the half that is not the materials.
 * ============================================================================
 *  The `Materials.ts` of the kart racer and of the space racer are forks of
 *  each other, and around the ~5,000 lines of generators that make them
 *  DIFFERENT games sat ~145 lines of identical bookkeeping: a name-keyed cache,
 *  an alias table, the tier-and-budget arithmetic that picks a tile size, the
 *  variant store, the env-map fan-out, and a dispose. Measured 2026-08-20 with
 *  a longest-common-run diff: byte-identical in both, including every comment.
 *
 *  IT IS A BASE CLASS AND NOT A BAG OF FUNCTIONS, for one reason: the call
 *  sites. `this.res(name)`, `this.maps(f)`, `this.macroMaps({...})` are called
 *  from ~50 generators across the two files. Inherited, NOT ONE OF THEM
 *  CHANGED — which is the property that makes a move like this reviewable,
 *  because the diff is then confined to the skeleton and cannot be hiding a
 *  changed argument in a generator nobody read.
 *
 *  WHAT THE GAMES KEEP, AND WHY EACH ONE IS A SEAM RATHER THAN AN OMISSION:
 *
 *   · `build(name)` — abstract. It IS the game.
 *   · `finish(entry, key)` — a no-op here. The space racer applies its
 *     geometry-scale wear at exactly this point and the kart racer has no such
 *     layer. An override, not a flag: this class chooses nothing.
 *   · `micro(...)` — a one-line wrapper over `@homie-rocks/noise`'s `microSurface`.
 *     It stays in both games because @homie-rocks/render does not depend on
 *     @homie-rocks/noise and that is deliberate — `canvastex.ts` and `matpatch.ts`
 *     each re-derive a small helper rather than take the dependency, and their
 *     headers say so. 34 duplicated lines is not worth reversing that.
 *   · `dispose()` — the game's, calling `disposeEntries()` then, in ITS OWN
 *     ORDER, `clearCaches()`. Split in two rather than merged into one because
 *     the space racer frees the re-scaled raceway clones BETWEEN them and the
 *     comment explaining why is load-bearing. A single `disposeCore()` would
 *     have quietly reordered a dispose path to make a diff look tidier.
 *
 *  `Ctx` NEVER CROSSES THIS SEAM. `init` takes `MatLibHost` — the two fields it
 *  actually reads — and each game's `Ctx` satisfies it structurally.
 * ============================================================================
 */

import * as THREE from 'three';
import { Quality } from './caps.js';
import {
  buildMaps,
  createCanvas,
  macroTexture,
  textureBudget,
  toImageData,
  type BuildOpts,
  type Canvas2D,
  type Fields,
  type MapSet,
} from './Textures.js';
import { materialLivery, materialVariant } from './MaterialVariant.js';
import type { VariantOpts, VariantStore } from './MaterialVariant.js';

/**
 * The macro layer's resolution, shared because both games spell it 128 and
 * both feed it to every `patchField` / `macroField` call as well as to
 * `macroMaps` — see the size argument on `macroMaps` for why 128 is not a
 * compromise.
 */
export const MACRO_RES = 128;

/** A built material and the textures it owns, so `dispose` can free both. */
export interface MatEntry {
  mat: THREE.Material;
  textures: THREE.Texture[];
}

/**
 * The two things `init` reads off a frame context.
 *
 * NOT `Ctx`. A game's `Ctx` carries race, track, items, match, combat and
 * colony state and must never reach a package; declaring the fields actually
 * read means each game's own `Ctx` satisfies this structurally and no call
 * site changes.
 */
export interface MatLibHost {
  settings: { quality: Quality };
  renderer?: { capabilities: { getMaxAnisotropy(): number } } | null;
}

/** The tables that make one game's library that game's. */
export interface MatLibShape {
  /** authored tile size per material name; 512 where a name has no row */
  baseSize: Record<string, number>;
  /** metres of world one tile of the texture is authored to cover */
  worldScale: Record<string, number>;
  /** old and shorthand names that still resolve to a canonical one */
  aliases: Record<string, string>;
  /**
   * The idempotence registers a variant CLONE has to inherit — see
   * `VariantStore.claims` for what goes wrong without them. Empty is a legal
   * answer and means the game has no injections that guard themselves.
   */
  claims: WeakSet<THREE.Material>[];
}

export abstract class MaterialLib {
  protected readonly shape: MatLibShape;

  protected cache = new Map<string, MatEntry>();
  protected variants = new Map<string, THREE.Material>();
  protected aniso = 8;
  protected quality: Quality = Quality.High;
  protected envConsumers: THREE.MeshStandardMaterial[] = [];
  protected lastEnv: THREE.Texture | null = null;
  protected clock = 0;

  constructor(shape: MatLibShape) {
    this.shape = shape;
  }

  init(ctx: MatLibHost): void {
    this.quality = ctx.settings.quality;
    const caps = ctx.renderer?.capabilities;
    this.aniso = caps ? Math.min(8, caps.getMaxAnisotropy()) : 8;
  }

  // -- public API ------------------------------------------------------------

  /** Fetch (building on first call) a shared material by name. Never mutate the result. */
  get(name: string): THREE.Material {
    const key = this.shape.aliases[name] ?? name;
    const hit = this.cache.get(key);
    if (hit) return hit.mat;
    const entry = this.build(key);
    this.finish(entry, key);
    this.cache.set(key, entry);
    return entry.mat;
  }

  standard(name: string): THREE.MeshStandardMaterial {
    return this.get(name) as THREE.MeshStandardMaterial;
  }

  physical(name: string): THREE.MeshPhysicalMaterial {
    return this.get(name) as THREE.MeshPhysicalMaterial;
  }

  /** Metres of world one texture tile is authored to cover. */
  worldScale(name: string): number {
    return this.shape.worldScale[this.shape.aliases[name] ?? name] ?? 1;
  }

  /**
   * A recoloured (or otherwise tweaked) copy of a base material that SHARES its
   * textures — this is how eight liveries and a dozen pastels cost one texture
   * set between them. Cached, so repeated calls are free.
   */
  variant(base: string, o: VariantOpts): THREE.Material {
    return materialVariant(this.store(), base, o);
  }

  /** Lacquered bodywork in a roster colour, sharing the painted-metal texture set. */
  livery(color: THREE.ColorRepresentation, key?: string): THREE.MeshPhysicalMaterial {
    return materialLivery(this.store(), color, key);
  }

  /**
   * Read fresh on every call rather than held as a field, because `env` is a
   * VALUE and `lastEnv` changes: a store built once in the constructor would
   * hand every later clone the environment map that existed at bring-up, which
   * is null. The cached-fact trap — ask, do not remember.
   */
  protected store(): VariantStore {
    return {
      variants: this.variants,
      base: (n) => this.get(n),
      envConsumers: this.envConsumers,
      env: this.lastEnv,
      claims: this.shape.claims,
    };
  }

  /**
   * Hand the scene's current environment map to every material that asked for
   * one, and only when it actually changed. Called from each game's `update`.
   */
  protected syncEnv(env: THREE.Texture | null): void {
    if (env !== this.lastEnv) {
      this.lastEnv = env;
      for (const m of this.envConsumers) {
        m.envMap = env;
        m.needsUpdate = true;
      }
    }
  }

  // -- lifecycle -------------------------------------------------------------

  /**
   * Free every built material and every texture it owns.
   *
   * Deliberately NOT merged with `clearCaches` below. The space racer disposes
   * its re-scaled raceway clones between the two, and the comment there — the
   * clones share their `.source` with these originals, so disposing them frees
   * the texture objects and not the images — is load-bearing about the order.
   */
  protected disposeEntries(): void {
    for (const e of this.cache.values()) {
      for (const t of e.textures) t.dispose();
      e.mat.dispose();
    }
    for (const m of this.variants.values()) m.dispose();
  }

  protected clearCaches(): void {
    this.cache.clear();
    this.variants.clear();
    this.envConsumers.length = 0;
  }

  // -- internals -------------------------------------------------------------

  /** The game's own generator table. This is the half that is the game. */
  protected abstract build(name: string): MatEntry;

  /**
   * A last pass over a material the moment it is finished and before it is
   * cached, so `Prewarm` compiles the patched program.
   *
   * Nothing here by default. The space racer overrides it to apply its
   * geometry-scale wear — the one layer that is a property of the OBJECT rather
   * than of the texture, which is why it belongs at the point where a material
   * is finished and not in the middle of a height-field loop.
   */
  protected finish(_entry: MatEntry, _key: string): void { /* no layer by default */ }

  /**
   * The authored size for a material, after the quality tier and the global
   * texture cap have both had their say.
   *
   * Generating small is strictly better than generating big and letting
   * `setTextureBudget` downsample: it costs a quarter of the fill to build, a
   * quarter of the transient heap in `Fields`, and it never allocates the large
   * canvas at all. The cap is still consulted so this can never *exceed* the
   * process budget — one number decides, in one place, and this is the fast
   * path to the same answer.
   *
   * Tier scales, and why 0.25 on Low is not vandalism: at Low the panel is a
   * phone's, and `WORLD_SCALE` for tarmac is 3.5 m. 256² over 3.5 m is 73
   * texels/m; the road fills perhaps 200 of the 390 device pixels the panel
   * has, at a metre or two of depth. The texel density still exceeds the pixel
   * density. Halving again would start to show. This does not.
   */
  protected res(name: string): number {
    const base = this.shape.baseSize[name] ?? 512;
    const scale = this.quality <= Quality.Low ? 0.25 : this.quality <= Quality.Medium ? 0.5 : 1;
    const cap = textureBudget();
    let size = Math.max(64, Math.round(base * scale));
    if (Number.isFinite(cap)) size = Math.min(size, cap);
    return size;
  }

  protected maps(f: Fields, o: BuildOpts = {}): MapSet {
    return buildMaps(f, { anisotropy: this.aniso, ...o });
  }

  /**
   * A canvas holding one RGBA byte buffer, for the generators that hand a
   * canvas to something else (an alpha atlas, a sprite sheet) rather than a
   * texture. Both games had this method, character for character.
   */
  protected bytesCanvas(size: number, bytes: Uint8ClampedArray): HTMLCanvasElement {
    const c: Canvas2D = createCanvas(size);
    c.ctx.putImageData(toImageData(bytes, size), 0, 0);
    return c.canvas as HTMLCanvasElement;
  }

  /**
   * An emissive map from raw RGB bytes, wired the way every other map here is.
   *
   * `sRGB`, because an emissive map is a COLOUR and three multiplies it by
   * `emissive` in linear space after decoding; a linear-tagged emissive is the
   * quiet version of the same bug that puts an albedo map on a normal slot.
   * Mipped and anisotropic for the same reason the rest of the set is — a light
   * fitting seen at 200 m down a straight is the one thing in the frame with
   * enough contrast to strobe.
   */
  protected emissive(size: number, bytes: Uint8ClampedArray): THREE.Texture {
    const t = new THREE.CanvasTexture(this.bytesCanvas(size, bytes));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.aniso;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  /**
   * Build one material's macro layer.
   *
   * Everything above roughly a metre lives here and NOWHERE ELSE. That
   * separation is the point of the whole exercise: a repair patch, a weathering
   * zone or a damp swathe baked into the tile is a feature the size of the tile,
   * so a 30 m patch of road becomes a 3.5 m blob repeating every 3.5 m — which
   * is not "macro variation", it is a second grade of speckle, and it is
   * precisely what the library was doing. Baked here it is sampled in world
   * space at its own period and is genuinely 30 m across.
   *
   * 128² is not a compromise. A field with three octaves off a 2-cell lattice
   * has no information above 16 cycles; magnified over 30 m that is a feature
   * every 1.9 m, resolved by 8 texels each. The whole layer costs 87 KB.
   */
  /**
   * The two-line tail every generator ends with, as one line.
   *
   * A built material owes this class two things and both are easy to half-do:
   * the LIST of textures it owns, so `disposeEntries` can free them and not
   * leak a 1024² set per rebuild; and, for anything that answers the
   * environment, a place on `envConsumers` so `syncEnv` can hand it the probe
   * when the probe is baked or re-baked. Twenty-one generators in one game were
   * spelling both by hand, and a generator that forgot the second is not a
   * crash — it is one surface reflecting nothing, forever, which looks like a
   * material somebody authored dark.
   *
   * `env` defaults TRUE because a material that does not answer the environment
   * is the exception and an omission should fail toward the visible behaviour.
   * Pass `false` for anything with no `envMap` slot to reach.
   */
  protected entry(
    mat: THREE.Material,
    maps: MapSet,
    extra: (THREE.Texture | null | undefined)[] = [],
    env = true,
  ): MatEntry {
    if (env) this.envConsumers.push(mat as THREE.MeshStandardMaterial);
    const textures = maps.all.slice();
    for (const t of extra) if (t) textures.push(t);
    return { mat, textures };
  }

  protected macroMaps(o: {
    /** primary variation — colour drift, patches, weathering zones */
    r: Float32Array;
    /** independent second field — pooling, damp, wear */
    g?: Float32Array | null;
    /** anisotropic source, read in the tile's own UV frame */
    b?: Float32Array | null;
  }): THREE.Texture {
    return macroTexture(MACRO_RES, o.r, o.g, o.b);
  }
}
