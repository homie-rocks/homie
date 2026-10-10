import assert from "node:assert/strict";
import { createWorld, box, floor, v } from "./helpers.mjs";
import { inspect } from "../dist/internal/Engine.js";
// Deliberately bypass the public handle checks inside the step boundary. The
// solver's raw getter panics on an invalid handle, producing a genuine Rapier
// WASM trap. Growing first makes retention visible independently of allocator reuse.
const memories = [];
for (let i = 0; i < 16; i++) {
  const w = createWorld({});
  floor(w);
  w.createBody({
    type: "dynamic",
    position: v(0, 0.5),
    colliders: [{ shape: box() }],
  });
  const save = w.snapshot();
  {
    const { engine, world } = inspect(w);
    memories.push(new WeakRef(engine.memory));
    world.step = () => {
      engine.memory.grow(128);
      world.bodies.raw.rbTranslation(1e99, new Float32Array(3));
    };
  }
  assert.throws(
    () => w.step(1 / 60),
    (error) => {
      assert.match(error.message, /engine failed/);
      assert.ok(error.cause instanceof WebAssembly.RuntimeError);
      return true;
    },
  );
  if (i % 2) {
    w.restore(save);
    w.step(1 / 60);
  }
  w.dispose();
  // Weak references only become collectible after returning to the event loop.
  await new Promise((resolve) => setImmediate(resolve));
  global.gc();
}
await new Promise((resolve) => setImmediate(resolve));
for (let i = 0; i < 4; i++) {
  global.gc();
  await new Promise((resolve) => setImmediate(resolve));
}
const retained = memories.filter((ref) => ref.deref()).length;
assert.ok(retained <= 1, `${retained} trapped WASM memories retained`);
console.log(JSON.stringify({ cycles: 16, retained }));
