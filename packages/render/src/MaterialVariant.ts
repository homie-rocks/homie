/**
 * ============================================================================
 *  Recoloured copies of a built material, sharing its textures.
 * ============================================================================
 *  This is how eight vehicle liveries and a dozen stucco pastels cost one
 *  texture set between them, and it was the same text in a kart racer and a
 *  space racer, which are forks of each other.
 *
 *  IT TAKES A STORE RATHER THAN THE MATERIALS CLASS, and that is forced rather
 *  than stylistic: `variants`, `envConsumers` and `lastEnv` are PRIVATE fields
 *  on each game's class, and TypeScript's structural typing will not match a
 *  private member against a public interface — so the "declare the fields you
 *  actually read and be generic over them" move that works elsewhere in this
 *  package cannot work here. The caller hands over the four things this needs
 *  instead, which has the same effect and costs one object literal per call on
 *  a path that is cached and runs maybe twenty times a game.
 * ============================================================================
 */

import * as THREE from 'three';

export interface VariantOpts {
  color?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  clearcoat?: number;
  opacity?: number;
  key?: string;
}

export interface VariantStore {
  /** the game's cache of already-built variants */
  variants: Map<string, THREE.Material>;
  /** the game's own `get`, so the base is built the game's way */
  base(name: string): THREE.Material;
  /** the game's list of materials that receive `ctx.envMap` */
  envConsumers: THREE.MeshStandardMaterial[];
  /** the environment map already handed out, or null before the first one */
  env: THREE.Texture | null;
  /**
   * THE IDEMPOTENCE REGISTERS THE CLONE MUST INHERIT. THIS IS THE HALF THAT WAS
   * MISSING ONCE AND IT BROKE THE FOUNDRY AND STRUCTURE FRAMES FOR A WHOLE
   * REVIEW.
   *
   * Several injections refuse a second application using a WeakSet keyed on the
   * material OBJECT. Carrying `onBeforeCompile` across (below) hands the clone
   * the base's injections — so the clone genuinely carries them — but the clone
   * is a different object, so every one of those WeakSets still reads "never
   * applied". Anything that then asks for the term on the clone gets a SECOND
   * copy of it.
   *
   * That is not hypothetical. `MatLib.shared('hull-plate', …)` in the space
   * racer's `Props.ts` comes through here, and a later change moved the
   * line-light from `Materials.sweepDeck`'s runtime shim into `finishSurfaces`
   * at build time — which is the right move, and it made `M.steel` the one
   * material in the game holding two line-light injections. The uniform block
   * is not `#ifndef`-guarded (deliberately: a double that COMPILES is the worse
   * bug), so it presented as `'uLineA' : redefinition` and every program on the
   * structural steel failed to link.
   *
   * The same applies to the geometric wear, to the normal-relief claim — a
   * clone that inherited `injectBreakup`'s rewritten `<normal_fragment_maps>`
   * no longer HAS the include, so a second relief injection on it would compile
   * to nothing while reporting success — and to the output ceiling, where two
   * Reinhard shoulders in series would not fail to link but would quietly
   * tighten the budget by an amount nobody authored, which is the harder bug of
   * the two to find.
   *
   * A LIST RATHER THAN A CALLBACK, ON PURPOSE. Membership is data; handing this
   * a function would let a game do something other than carry a claim across,
   * and the one thing this seam must never become is a place where the two
   * games behave differently. A game with no WeakSet-guarded injections passes
   * an empty array and gets exactly what it had.
   */
  claims: WeakSet<THREE.Material>[];
}

/**
 * A recoloured (or otherwise tweaked) copy of a base material that SHARES its
 * textures. Cached, so repeated calls are free.
 */
export function materialVariant(store: VariantStore, base: string, o: VariantOpts): THREE.Material {
  const key = `${base}|${o.key ?? JSON.stringify(o)}`;
  const hit = store.variants.get(key);
  if (hit) return hit;
  const src = store.base(base) as THREE.MeshPhysicalMaterial;
  const m = src.clone() as THREE.MeshPhysicalMaterial;
  // `Material.copy()` walks a fixed property list and `onBeforeCompile` is not
  // on it, so a plain clone silently drops every shader injection this library
  // installs. That is how a hundred instanced houses ended up sharing one
  // un-broken-up texture phase: the tiling breakup was never running on the
  // variant at all. Carry both across, and keep the cache key with them or
  // three will hand the clone the base material's compiled program.
  const before = (src as { onBeforeCompile?: THREE.Material['onBeforeCompile'] }).onBeforeCompile;
  if (before && before !== THREE.Material.prototype.onBeforeCompile) {
    m.onBeforeCompile = before.bind(src);
    m.customProgramCacheKey = src.customProgramCacheKey.bind(src);
    // ...and the claims with the closure. See `VariantStore.claims` for what
    // goes wrong without this line, which is not subtle and is not theoretical.
    for (const set of store.claims) if (set.has(src)) set.add(m);
  }
  if (o.color !== undefined) m.color.set(o.color);
  if (o.roughness !== undefined) m.roughness = o.roughness;
  if (o.metalness !== undefined) m.metalness = o.metalness;
  if (o.emissive !== undefined && m.emissive) m.emissive.set(o.emissive);
  if (o.emissiveIntensity !== undefined) m.emissiveIntensity = o.emissiveIntensity;
  if (o.clearcoat !== undefined && 'clearcoat' in m) m.clearcoat = o.clearcoat;
  if (o.opacity !== undefined) {
    m.opacity = o.opacity;
    m.transparent = o.opacity < 1;
  }
  // Clones are not in `envConsumers`, so without this they never receive
  // `ctx.envMap` and fall back to whatever `scene.environment` happens to be —
  // which is how eight liveries' clearcoat and every chrome variant ended up
  // with nothing sharp to reflect.
  store.envConsumers.push(m as unknown as THREE.MeshStandardMaterial);
  if (store.env) { m.envMap = store.env; m.needsUpdate = true; }
  store.variants.set(key, m);
  return m;
}

/**
 * Lacquered bodywork in a roster colour, sharing the painted-metal texture set.
 *
 * Both games keep a bespoke lacquer of their own for the vehicles themselves
 * (the kart racer's two-lobe one is in its `Liveries.ts`) and neither comes
 * through here; this is the fallback for anything else that wants a painted
 * panel — boat hulls, stalls. Since `metal-painted` is authored as galvanised
 * guardrail steel, this has to put the dielectric paint back: kill the
 * metalness the ORM's B channel carries, and re-enable the coat.
 */
export function materialLivery(
  store: VariantStore,
  color: THREE.ColorRepresentation,
  key?: string,
): THREE.MeshPhysicalMaterial {
  const c = new THREE.Color(color);
  const m = materialVariant(store, 'metal-painted', {
    color: c,
    metalness: 0,
    clearcoat: 1,
    key: key ?? `livery${c.getHexString()}`,
  }) as THREE.MeshPhysicalMaterial;
  m.clearcoatRoughness = 0.14;
  return m;
}
