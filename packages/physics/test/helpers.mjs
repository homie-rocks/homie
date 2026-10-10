import { readFile } from "node:fs/promises";
import { initPhysics, wasmURL } from "@homie-rocks/physics/Engine.js";
import { createWorld, seeded } from "@homie-rocks/physics/World.js";
await initPhysics(await WebAssembly.compile(await readFile(wasmURL())));
export { createWorld, seeded };
export const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const box = (x = 0.5, y = 0.5, z = 0.5) => ({
  kind: "box",
  halfExtents: v(x, y, z),
});
export const sphere = (radius = 0.5) => ({ kind: "sphere", radius });
export const options = { gravity: v(0, -9.81, 0), random: seeded(123) };
export const floor = (w) =>
  w.createBody({
    type: "static",
    position: v(0, -0.5, 0),
    colliders: [{ shape: box(30, 0.5, 30) }],
  });
export const character = {
  position: v(0, 1, 0),
  radius: 0.3,
  height: 1.8,
  stepHeight: 0.35,
  stepMinWidth: 0.2,
  slopeLimit: 0.7,
  snapDistance: 0.2,
  offset: 0.01,
  gravity: 20,
  jumpSpeed: 5,
};
export function ticks(w, n) {
  const events = [];
  for (let i = 0; i < n; i++) events.push(...w.step(w.fixedDt));
  return events;
}
