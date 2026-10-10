import {
  initPhysics as initialize,
  wasmURL as assetURL,
} from "./internal/Engine.ts";

/** Initialize once per isolate. Omit source in Node and bundled browsers.
 * Workers pass the package's imported CompiledWasm module. Rejects load/version errors.
 * Accepts compiled modules, bytes, a Response, or a fetchable URL; retries after failure.
 */
export async function initPhysics(
  source?: WebAssembly.Module | BufferSource | Response | URL | string,
): Promise<void> {
  if (source === undefined) {
    const { default: encoded } = await import("./vendor/bytes.js");
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    source = bytes;
  }
  try {
    return await initialize(source);
  } catch (cause) {
    if (cause instanceof WebAssembly.CompileError)
      throw new Error(
        "physics: WASM compilation unavailable; in Workers import @homie-rocks/physics/vendor/rapier.wasm and pass it to initPhysics from Worker.js",
        { cause },
      );
    throw cause;
  }
}

/** Resolve the exported WASM asset for hosts that explicitly load bytes.
 * Bundled browsers should use initPhysics() instead. Workers import the module.
 */
export function wasmURL(): URL {
  return assetURL();
}
