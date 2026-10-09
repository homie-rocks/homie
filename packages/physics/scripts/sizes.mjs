/** Reproducible shipping sizes, including the Worker dependency graph. */
import { build } from "esbuild";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "physics-sizes-"));
try {
  for (const file of ["rapier.wasm", "bytes.js"]) {
    const bytes = await readFile(join(root, "dist/vendor", file));
    console.log(
      JSON.stringify({
        file,
        bytes: bytes.length,
        gzip: gzipSync(bytes).length,
        brotli: brotliCompressSync(bytes).length,
      }),
    );
  }
  for (const worker of [false, true]) {
    const result = await build({
      stdin: {
        contents: worker
          ? `import wasm from './dist/vendor/rapier.wasm'; import {initPhysics,createWorld} from './dist/Worker.js'; await initPhysics(wasm); globalThis.world=createWorld({});`
          : `import {initPhysics} from './dist/Engine.js'; import {createWorld} from './dist/World.js'; await initPhysics(); globalThis.world=createWorld({});`,
        resolveDir: root,
      },
      bundle: true,
      format: "esm",
      splitting: true,
      minify: true,
      write: false,
      outdir: dir,
      external: worker ? ["*.wasm"] : [],
      metafile: true,
    });
    const bytes = Buffer.concat(result.outputFiles.map((f) => f.contents));
    console.log(
      JSON.stringify({
        runtime: worker
          ? "Worker JS (WASM separate)"
          : "Browser JS (WASM embedded)",
        bytes: bytes.length,
        gzip: gzipSync(bytes).length,
        embedded: Object.keys(result.metafile.inputs).some((p) =>
          p.endsWith("/bytes.js"),
        ),
      }),
    );
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
