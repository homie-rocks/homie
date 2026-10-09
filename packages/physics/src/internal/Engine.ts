/** Private adapter. Browser/Node loading is owned here; Workers supply compiled modules. */
import type * as Rapier from "@dimforge/rapier3d-deterministic";
let loaded: typeof Rapier | undefined;
let compiled: WebAssembly.Module;
let factory: typeof import("../vendor/rapier.js").createEngine;
const pool: (typeof Rapier)[] = [];
const inspections = new WeakMap<
  object,
  () => { engine: typeof Rapier; world: Rapier.World }
>();
export function registerWorld(
  owner: object,
  read: () => { engine: typeof Rapier; world: Rapier.World },
): void {
  inspections.set(owner, read);
}
export function inspect(owner: object) {
  return inspections.get(owner)!();
}
let pending: Promise<void> | undefined;

/** Initialize once per isolate from owned bytes, explicit bytes/Response/URL, or a Worker module. */
export function initPhysics(
  source?: WebAssembly.Module | BufferSource | Response | URL | string,
): Promise<void> {
  if (loaded) return Promise.resolve();
  return (pending ??= (async () => {
    let input = source;
    if (input === undefined)
      throw new Error(
        "physics: Workers must import @homie-rocks/physics/vendor/rapier.wasm and pass the compiled module to initPhysics",
      );
    if (
      typeof input === "string" ||
      (typeof URL !== "undefined" && input instanceof URL)
    )
      input = await fetch(input);
    if (typeof Response !== "undefined" && input instanceof Response) {
      if (!input.ok)
        throw new Error(`physics: WASM request failed (${input.status})`);
      input = await input.arrayBuffer();
    }
    const module =
      input instanceof WebAssembly.Module
        ? input
        : await WebAssembly.compile(input as BufferSource);
    factory = (await import("../vendor/rapier.js")).createEngine;
    compiled = module;
    const r = factory();
    r.initialize(module);
    if (r.version() !== "0.21.0")
      throw new Error("physics: wrong Rapier version");
    loaded = r;
  })().catch((error: unknown) => {
    pending = undefined;
    throw error;
  }));
}

/** The explicit asset URL; fetch it in a browser or read it in Node. */
export function wasmURL(): URL {
  if (!import.meta.url)
    throw new Error("physics: this host must supply an imported WASM module");
  return new URL("../vendor/rapier.wasm", import.meta.url);
}

/** @internal */
export function engine(): typeof Rapier {
  if (!loaded)
    throw new Error(
      "physics: await initPhysics(module) before creating a world",
    );
  return loaded;
}

/** Private ownership boundary: failed instances are never pooled. */
export function acquireEngine(): typeof Rapier {
  engine();
  const reused = pool.pop();
  if (reused) return reused;
  const r = factory();
  r.initialize(compiled);
  return r;
}
export function releaseEngine(r: typeof Rapier): void {
  if (pool.length < 1) pool.push(r);
}
