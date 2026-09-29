/**
 * ============================================================================
 *  chainpatch — install an `onBeforeCompile` injection WITHOUT throwing away
 *  the ones already on the material.
 * ============================================================================
 *
 * Nine lines that were written out by hand at every shader-injection site in
 * this repository, character for character:
 *
 *     const prev = m.onBeforeCompile;
 *     const prevKey = m.customProgramCacheKey;
 *     m.onBeforeCompile = (shader, renderer) => {
 *       prev?.call(m, shader, renderer);
 *       … the injection …
 *     };
 *     const key = `…`;
 *     m.customProgramCacheKey =
 *       prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
 *         ? () => prevKey.call(m) + key
 *         : () => key;
 *     m.needsUpdate = true;
 *
 * `SpecularAA.ts`, `MaterialEnv.ts` and `MaterialBreakup.ts` in this package
 * each carry a copy, and a space racer's livery code carried six more.
 *
 * ## Why this is not `matpatch.patch()`
 *
 * There is a shader-patch REGISTRY in this package already and routing these
 * through it would be the obvious tidy. `SpecularAA.ts`'s header spells out why
 * that is wrong and the argument applies unchanged here: `patch()` joins its
 * keys with `|` and prefixes an incumbent with `base:`, so adopting it would
 * change the cache-key STRING of every material in two games. That is a shared
 * solve quietly retuning both callers — nothing renders differently, and a
 * shader-text parity probe would report a wholesale change with no defect
 * behind it. This helper reproduces the hand-written spelling EXACTLY, which is
 * the whole of its job: every key it emits is the byte-identical string the
 * site it replaced emitted.
 *
 * `patch()` remains the right tool for a material that needs the WeakMap —
 * `clonePatched` and `depthMaterialFor` can only see patches registered there.
 * Nothing that uses this helper is cloned or casts a displaced shadow.
 *
 * ## The two subtleties, both load-bearing
 *
 * **`prev` runs FIRST.** Materials handed out by the shared library already
 * carry their own `onBeforeCompile` — the tiling-breakup injection lives in one
 * — and simply assigning over it reintroduces a visible one-tile repeat with no
 * error. Capturing and calling the incumbent is what makes an injection safe to
 * install onto a material somebody else built.
 *
 * **The `!== THREE.Material.prototype.customProgramCacheKey` test.** Without
 * it, a FRESH material would get the prototype's empty string prepended and
 * every key in the game would change for no reason. With it, a material that
 * carries nothing else gets exactly `key` and a material that carries three
 * other injections gets their key with `key` appended — which is what makes a
 * key that DISCARDS its predecessors the defect it is. A key that drops what
 * came before is a program collision waiting for the next material that differs
 * by source rather than by uniform, and that failure renders as one team's
 * shader on another team's ship, which no test in this repository would catch.
 *
 * ## Ordering
 *
 * This CHAINS, so it is safe to install after a patcher that REPLACES
 * `onBeforeCompile` and unsafe to install before one. Both racers have such a
 * patcher (their rim lights) and both games' `kartMaterials` carry a comment
 * about the ordering. Nothing here changes that ordering; a site converted to
 * this helper occupies the same position in the same sequence it always did.
 */
import * as THREE from 'three';

/**
 * What three.js hands an `onBeforeCompile` hook.
 *
 * Deliberately loose. The call sites read `shader.uniforms`,
 * `shader.vertexShader` and `shader.fragmentShader` and nothing else, and
 * three's own parameter type has been renamed twice across the versions this
 * repository has run. A narrow structural type is what the code actually needs
 * and it cannot rot with three's spelling.
 */
export interface PatchableShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

/**
 * Install `inject` on `m`, keeping whatever was already there.
 *
 * @param m      the material. Any `THREE.Material` — the injections that use
 *               this are written against Standard and Physical, but nothing
 *               here reads a field of either.
 * @param key    this injection's contribution to the program cache key. It must
 *               carry every value that changes the emitted SOURCE (and none of
 *               the ones that only change a uniform), because two materials
 *               whose source differs and whose key does not are two draws
 *               sharing one program.
 * @param inject runs after the incumbent hook, with the same arguments.
 */
export function chainPatch(
  m: THREE.Material,
  key: string,
  inject: (shader: PatchableShader, renderer: unknown) => void,
): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = ((shader: PatchableShader, renderer: unknown) => {
    prev?.call(m, shader as never, renderer as never);
    inject(shader, renderer);
  }) as typeof m.onBeforeCompile;
  m.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(m) + key
      : () => key;
  m.needsUpdate = true;
}
