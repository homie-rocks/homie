/** Reproducible alternative-engine experiment, kept out of the default suite. */
import { build } from "esbuild";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import * as cannon from "cannon-es";
import { initPhysics } from "../dist/Engine.js";
import { engine } from "../dist/internal/Engine.js";
await initPhysics();
const require = createRequire(import.meta.url),
  dir = await mkdtemp(join(tmpdir(), "physics-current-"));
try {
  const upstream = dirname(require.resolve("rapier-previous/package.json"));
  const adapter = join(dir, "rapier.mjs");
  await build({
    stdin: {
      contents: `export * from './exports.js';
import * as bindings from './rapier_wasm3d_bg.js';
export function initialize(module) { bindings.__wbg_set_wasm(new WebAssembly.Instance(module, {'./rapier_wasm3d_bg.js':bindings}).exports); }`,
      resolveDir: upstream,
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile: adapter,
    plugins: [
      {
        name: "wasm",
        setup(b) {
          b.onResolve({ filter: /\/rapier_wasm3d$/ }, () => ({
            path: join(upstream, "rapier_wasm3d_bg.js"),
          }));
        },
      },
    ],
  });
  const latest = await import(pathToFileURL(adapter));
  latest.initialize(
    await WebAssembly.compile(
      await readFile(join(upstream, "rapier_wasm3d_bg.wasm")),
    ),
  );
  for (const r of [engine(), latest]) {
    const q = new r.World({ x: 0, y: 0, z: 0 });
    const body = q.createRigidBody(r.RigidBodyDesc.fixed());
    q.createCollider(r.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);
    const ray = new r.Ray({ x: -3, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    const inserted = q.castRay(ray, 10, true)?.timeOfImpact ?? null;
    q.updateSceneQueries?.();
    const refreshed = q.castRay(ray, 10, true)?.timeOfImpact ?? null;
    q.step();
    body.setTranslation({ x: 20, y: 0, z: 0 }, true);
    q.propagateModifiedBodyPositionsToColliders();
    const moved = q.castRay(ray, 10, true)?.timeOfImpact ?? null;
    console.log(
      JSON.stringify({
        engine: r.version(),
        inserted,
        refreshed,
        moved,
        refresh: typeof q.updateSceneQueries,
      }),
    );
    q.free();
    for (const count of [100, 500, 2000]) {
      const w = new r.World({ x: 0, y: -9.81, z: 0 });
      const floor = w.createRigidBody(
        r.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0),
      );
      w.createCollider(r.ColliderDesc.cuboid(30, 0.5, 30), floor);
      for (let i = 0; i < count; i++) {
        const b = w.createRigidBody(
          r.RigidBodyDesc.dynamic()
            .setTranslation(
              (i % 20) - 10,
              0.5 + Math.floor(i / 400) * 1.05,
              (Math.floor(i / 20) % 20) - 10,
            )
            .setCanSleep(false),
        );
        w.createCollider(r.ColliderDesc.cuboid(0.45, 0.45, 0.45), b);
      }
      for (let i = 0; i < 400; i++) w.step();
      let start = performance.now();
      for (let i = 0; i < 180; i++) w.step();
      const stepMs = (performance.now() - start) / 180;
      start = performance.now();
      for (let i = 0; i < 10000; i++) w.castRay(ray, 100, true);
      const queryUs = (performance.now() - start) / 10;
      console.log(
        JSON.stringify({ engine: r.version(), count, stepMs, queryUs }),
      );
      w.free();
    }
  }
  if (process.env.RAPIER_ONLY !== "1")
    for (const count of [100, 500, 2000]) {
      const w = new cannon.World({ gravity: new cannon.Vec3(0, -9.81, 0) });
      w.broadphase = new cannon.SAPBroadphase(w);
      w.addBody(
        new cannon.Body({
          mass: 0,
          shape: new cannon.Box(new cannon.Vec3(30, 0.5, 30)),
          position: new cannon.Vec3(0, -0.5, 0),
        }),
      );
      for (let i = 0; i < count; i++)
        w.addBody(
          new cannon.Body({
            mass: 0.729,
            shape: new cannon.Box(new cannon.Vec3(0.45, 0.45, 0.45)),
            position: new cannon.Vec3(
              (i % 20) - 10,
              0.5 + Math.floor(i / 400) * 1.05,
              (Math.floor(i / 20) % 20) - 10,
            ),
          }),
        );
      for (let i = 0; i < 400; i++) w.step(1 / 60);
      const start = performance.now();
      for (let i = 0; i < 180; i++) w.step(1 / 60);
      console.log(
        JSON.stringify({
          engine: "cannon-es 0.20.0",
          count,
          stepMs: (performance.now() - start) / 180,
        }),
      );
      const original = Math.pow;
      let forbidden = false;
      try {
        Math.pow = () => {
          throw new Error("forbidden");
        };
        w.step(1 / 60);
      } catch {
        forbidden = true;
      } finally {
        Math.pow = original;
      }
      console.log(
        JSON.stringify({
          engine: "cannon-es 0.20.0",
          forbiddenPowReached: forbidden,
        }),
      );
    }
} finally {
  await rm(dir, { recursive: true, force: true });
}
