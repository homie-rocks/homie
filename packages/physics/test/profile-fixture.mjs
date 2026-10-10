// Identical workload for Node and workerd. Timing belongs to the caller because
// Workers deliberately freeze their clock while synchronous JavaScript runs.
import { createWorld } from "../dist/World.js";
import { sampleHeightfield } from "../dist/Heightfield.js";
const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const box = (x = 0.45, y = 0.45, z = 0.45) => ({
  kind: "box",
  halfExtents: v(x, y, z),
});
let world, saved;
export function profile({
  action,
  scene = "flat",
  count = 100,
  iterations = 1,
}) {
  if (action === "setup") {
    world?.dispose();
    world = createWorld({});
    if (
      scene === "heightfield" ||
      scene === "characters" ||
      scene === "steps" ||
      scene === "tile"
    ) {
      world.createBody({
        type: "static",
        colliders: [
          sampleHeightfield(
            {
              heightAt: (x, z) =>
                scene === "steps"
                  ? Math.floor((x + 32) / 2) * 0.15
                  : scene === "heightfield"
                    ? 0.15 * Math.sin(x * 0.5) * Math.cos(z * 0.5)
                    : 0,
            },
            { nx: 65, nz: 65, cell: 1, x0: -32, z0: -32 },
          ),
        ],
      });
    } else
      world.createBody({
        type: "static",
        position: v(0, -0.5),
        colliders: [{ shape: box(30, 0.5, 30) }],
      });
    if (scene === "pile")
      for (const p of [v(-3, 2), v(3, 2), v(0, 2, -3), v(0, 2, 3)]) {
        world.createBody({
          type: "static",
          position: p,
          colliders: [{ shape: p.x ? box(0.25, 3, 3) : box(3, 3, 0.25) }],
        });
      }
    const characters = scene === "characters" || scene === "steps";
    if (scene !== "tile")
      for (let i = 0; i < count; i++) {
        if (characters) {
          const x = (i % 10) * 1.5 - 10,
            z = Math.floor(i / 10) * 1.5 - 10;
          const c = world.createCharacter({
            position: v(
              x,
              2 + (scene === "steps" ? Math.floor((x + 32) / 2) * 0.15 : 0),
              z,
            ),
            radius: 0.3,
            height: 1.8,
            stepHeight: 0.35,
            stepMinWidth: 0.2,
            slopeLimit: 0.7,
            snapDistance: 0.2,
            offset: 0.01,
            gravity: 20,
            jumpSpeed: 5,
          });
          world.controlCharacter(c, { x: 2, z: 0 });
        } else
          world.createBody({
            type: "dynamic",
            canSleep: scene === "sleeping",
            position:
              scene === "pile"
                ? v(
                    (i % 5) - 2,
                    0.5 + Math.floor(i / 25) * 1.02,
                    (Math.floor(i / 5) % 5) - 2,
                  )
                : v(
                    (i % 20) - 9.5,
                    0.5 + Math.floor(i / 400) * 1.05,
                    (Math.floor(i / 20) % 20) - 9.5,
                  ),
            colliders: [{ shape: box() }],
          });
      }
    return { ready: true };
  }
  if (action === "step") for (let i = 0; i < iterations; i++) world.step(0.05);
  if (action === "query")
    for (let i = 0; i < iterations; i++)
      world.raycast(v(0.3, 60, 0.2), v(0, -1), 100);
  if (action === "save")
    for (let i = 0; i < iterations; i++) saved = world.snapshot();
  if (action === "restore")
    for (let i = 0; i < iterations; i++) world.restore(saved);
  if (action === "size") {
    saved = world.snapshot();
    return {
      bytes: saved.length,
      chunks: world.snapshotChunks().map((c) => c.length),
    };
  }
  if (action === "dispose") {
    world.dispose();
    world = undefined;
  }
  return { done: true };
}
