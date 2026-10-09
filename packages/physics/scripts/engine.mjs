// Bundle upstream's extensionless ESM, replacing only its implicit WASM import.
// The solver and bindings are unchanged. No runtime compiler, fetch or base64.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const upstream = dirname(
  require.resolve("@dimforge/rapier3d-deterministic/package.json"),
);
const out = fileURLToPath(new URL("../dist/vendor/", import.meta.url));
await mkdir(out, { recursive: true });
const bundled = await build({
  stdin: {
    contents: `export * from './exports.js';
import * as bindings from './rapier_wasm3d_bg.js';
export let memory;
export function initialize(module) {
  const instance = new WebAssembly.Instance(module, { './rapier_wasm3d_bg.js': bindings });
  bindings.__wbg_set_wasm(instance.exports);
  memory = instance.exports.memory;
}`,
    resolveDir: upstream,
    sourcefile: "loader.js",
  },
  bundle: true,
  format: "iife",
  globalName: "api",
  write: false,
  platform: "neutral",
  target: "es2022",
  outfile: join(out, "rapier.js"),
  plugins: [
    {
      name: "explicit-wasm",
      setup(b) {
        b.onResolve({ filter: /\/rapier_wasm3d$/ }, () => ({
          path: join(upstream, "rapier_wasm3d_bg.js"),
        }));
      },
    },
  ],
});
await writeFile(
  join(out, "rapier.js"),
  `export function createEngine() {\n${bundled.outputFiles[0].text}\nreturn api;\n}\n`,
);
await copyFile(
  join(upstream, "rapier_wasm3d_bg.wasm"),
  join(out, "rapier.wasm"),
);
await copyFile(join(upstream, "LICENSE"), join(out, "LICENSE"));

// The default browser/Node door carries its own version-locked bytes. Bundlers
// cannot relocate a hidden URL. Workers use the exported compiled module instead.
const bytes = await readFile(join(out, "rapier.wasm"));
await writeFile(
  join(out, "bytes.js"),
  `export default "${bytes.toString("base64")}";\n`,
);

await writeFile(
  join(out, "rapier.wasm.d.ts"),
  "/** Version-locked module imported by a Worker CompiledWasm rule. */\ndeclare const module: WebAssembly.Module;\nexport default module;\n",
);
