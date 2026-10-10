import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "./helpers.mjs";
import { inspect } from "../dist/internal/Engine.js";
test("structural edits never serialize the world", () => {
  const w = createWorld({}),
    r = inspect(w).world;
  let snapshots = 0;
  const take = r.takeSnapshot.bind(r);
  r.takeSnapshot = () => {
    snapshots++;
    return take();
  };
  const make = () =>
    w.createBody({
      type: "dynamic",
      colliders: [{ shape: { kind: "sphere", radius: 0.3 } }],
    });
  const a = make(),
    b = make();
  w.step(1 / 60);
  const joint = w.createJoint({
    kind: "ball",
    bodyA: a,
    bodyB: b,
    anchorA: { x: 0, y: 0, z: 0 },
    anchorB: { x: 0, y: 0, z: 0 },
  });
  w.removeJoint(joint);
  w.removeBody(a);
  const character = w.createCharacter({
    position: { x: 10, y: 10, z: 0 }, radius: 0.3, height: 1.8,
    stepHeight: 0.35, stepMinWidth: 0.2, slopeLimit: 0.7,
    snapDistance: 0.2, offset: 0.01, gravity: 20, jumpSpeed: 5,
  });
  w.removeCharacter(character);
  assert.equal(snapshots, 0);
  const save = w.snapshot(),
    v = createWorld({});
  v.restore(save);
  assert.deepEqual(v.step(1 / 60), w.step(1 / 60));
  assert.deepEqual(v.bodyState(b), w.bodyState(b));
  v.dispose();
  w.dispose();
});

test("pending removals disappear from every public spatial query", () => {
  const w = createWorld({});
  const body = w.createBody({
    type: "static",
    colliders: [{ shape: { kind: "sphere", radius: 1 } }],
  });
  w.step(1 / 60);
  w.removeBody(body);
  const p = { x: 0, y: 0, z: 0 },
    delta = { x: 1, y: 0, z: 0 },
    shape = { kind: "sphere", radius: 0.2 };
  assert.deepEqual(w.overlaps(shape, p), []);
  assert.equal(w.raycast(p, delta, 10), null);
  assert.deepEqual(w.raycastAll(p, delta, 10), []);
  assert.equal(w.castShape(shape, p, delta), null);
  const v = createWorld({});
  v.restore(w.snapshot());
  assert.deepEqual(v.overlaps(shape, p), []);
  v.step(1 / 60);
  w.step(1 / 60);
  assert.deepEqual(v.snapshot(), w.snapshot());
  v.dispose();
  w.dispose();
});
