import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "./helpers.mjs";
import { inspect } from "../dist/internal/Engine.js";
test("unchanged static sensors reuse their open pairs and react to later edits", () => {
  const w = createWorld({ gravity: { x: 0, y: 0, z: 0 } });
  for (let i = 0; i < 100; i++)
    w.createBody({
      type: "static",
      position: { x: i * 3, y: 0, z: 0 },
      colliders: [{ shape: { kind: "sphere", radius: 1 }, sensor: true }],
    });
  const body = w.createBody({
    type: "dynamic",
    position: { x: 0, y: 10, z: 0 },
    colliders: [{ shape: { kind: "sphere", radius: 0.2 } }],
  });
  w.sleep(body);
  w.step(0.05);
  const raw = inspect(w).world,
    query = raw.intersectionsWithShape.bind(raw);
  let queries = 0;
  raw.intersectionsWithShape = (...args) => {
    queries++;
    return query(...args);
  };
  for (let i = 0; i < 10; i++) assert.deepEqual(w.step(0.05), []);
  assert.equal(queries, 0);
  w.teleport(body, { x: 0, y: 0, z: 0 });
  assert.ok(w.step(0.05).some((e) => e.kind === "trigger" && e.started));
  w.sleep(body);
  w.step(0.05);
  const saved = w.snapshot(),
    v = createWorld({});
  v.restore(saved);
  for (let i = 0; i < 10; i++) assert.deepEqual(w.step(0.05), v.step(0.05));
  v.dispose();
  w.dispose();
});
