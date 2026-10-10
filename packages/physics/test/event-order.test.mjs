import test from "node:test";
import assert from "node:assert/strict";
import { createWorld, box, v, floor } from "./helpers.mjs";
import { inspect } from "../dist/internal/Engine.js";
test("collision transitions retain engine order within each pair", () => {
  const w = createWorld({});
  try {
    const a = w.createBody({
        type: "static",
        colliders: [{ shape: box(), sensor: true }],
      }),
      b = w.createBody({
        type: "dynamic",
        position: v(4),
        colliders: [{ shape: box() }],
      });
    const { engine } = inspect(w);
    const original = engine.EventQueue.prototype.drainCollisionEvents;
    const handles = [];
    inspect(w).world.colliders.forEach((c) => handles.push(c.handle));
    engine.EventQueue.prototype.drainCollisionEvents = function (callback) {
      original.call(this, () => {});
      callback(...handles, true);
      callback(...handles, false);
      callback(...handles, true);
      callback(...handles, false);
    };
    try {
      const events = w.step(1 / 60).filter((e) => e.kind === "trigger");
      assert.deepEqual(
        events.map((e) => e.started),
        [true, false, true, false],
      );
    } finally {
      engine.EventQueue.prototype.drainCollisionEvents = original;
    }
  } finally {
    w.dispose();
  }
});
test("a non-trap exception leaves the world usable", () => {
  const w = createWorld({});
  floor(w);
  const { world } = inspect(w),
    step = world.step;
  world.step = () => {
    throw new RangeError("controlled host failure");
  };
  assert.throws(() => w.step(1 / 60), /controlled host failure/);
  world.step = step;
  assert.doesNotThrow(() => w.step(1 / 60));
  w.dispose();
});
const burstSize = process.env.PHYSICS_FULL ? 1000 : 100;
test(`${burstSize} coincident bodies do not overflow event appends`, () => {
  const w = createWorld({ gravity: v() });
  try {
    for (let i = 0; i < burstSize; i++)
      w.createBody({
        type: "dynamic",
        colliders: [{ shape: box(0.1, 0.1, 0.1) }],
      });
    assert.doesNotThrow(() => w.step(1 / 60));
    // Health is a public query after the burst; serializing its enormous
    // transient contact graph would test save throughput, not event appends.
    assert.doesNotThrow(() => w.raycast(v(0, 10), v(0, -1), 20));
  } finally {
    w.dispose();
  }
});
