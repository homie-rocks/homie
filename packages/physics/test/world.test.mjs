import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorld,
  seeded,
  v,
  box,
  sphere,
  options,
  floor,
  ticks,
} from "./helpers.mjs";

test("gravity, impulse, contact begin/end, sleeping and waking are physical", () => {
  const w = createWorld(options);
  const ground = floor(w);
  const b = w.createBody({
    type: "dynamic",
    position: v(0, 3),
    colliders: [{ shape: box() }],
  });
  const events = ticks(w, 240);
  assert.ok(Math.abs(w.bodyState(b).position.y - 0.5) < 0.03);
  assert.ok(
    events.some(
      (e) =>
        e.kind === "contact" &&
        e.started &&
        e.bodyA === ground &&
        e.bodyB === b,
    ),
  );
  assert.equal(w.bodyState(b).sleeping, true);
  w.impulse(b, v(2, 5));
  assert.equal(w.bodyState(b).sleeping, false);
  assert.ok(ticks(w, 20).some((e) => !e.started));
  assert.ok(w.bodyState(b).position.x > 0.4);
  w.sleep(b);
  assert.equal(w.bodyState(b).sleeping, true);
  w.wake(b);
  assert.equal(w.bodyState(b).sleeping, false);
  w.dispose();
  w.dispose();
  assert.throws(() => w.step(0), /disposed/);
});

test("triggers pass through and layers exclude both events and queries", () => {
  const w = createWorld({ gravity: v() });
  const trigger = w.createBody({
    type: "static",
    colliders: [{ shape: box(), sensor: true }],
  });
  const b = w.createBody({
    type: "dynamic",
    position: v(-2),
    velocity: v(4),
    colliders: [{ shape: sphere(0.2) }],
  });
  const events = ticks(w, 60).filter((e) => e.kind === "trigger");
  assert.deepEqual(
    events.map((e) => e.started),
    [true, false],
  );
  assert.ok(events.every((e) => e.bodyA === trigger && e.bodyB === b));
  assert.ok(w.bodyState(b).position.x > 1.9);
  w.dispose();
  const l = createWorld({ gravity: v() });
  l.createBody({
    type: "static",
    colliders: [{ shape: box(), layers: { membership: 1, filter: 1 } }],
  });
  l.createBody({
    type: "dynamic",
    position: v(-2),
    velocity: v(4),
    colliders: [{ shape: sphere(0.2), layers: { membership: 2, filter: 2 } }],
  });
  assert.equal(ticks(l, 60).length, 0);
  assert.equal(
    l.raycast(v(-2), v(1), 3, { layers: { membership: 2, filter: 2 } }),
    null,
  );
  l.dispose();
});

test("queries see inserts and teleports immediately and return plain stable handles", () => {
  const w = createWorld({ gravity: v() });
  const b = w.createBody({ type: "static", colliders: [{ shape: box() }] });
  const c = w.colliders(b)[0];
  const hit = w.raycast(v(-3), v(1), 10);
  assert.equal(hit.body, b);
  assert.equal(hit.collider, c);
  assert.equal(hit.distance, 2.5);
  assert.deepEqual(hit.point, v(-0.5));
  assert.deepEqual(hit.normal, v(-1));
  const sweep = w.castShape(sphere(), v(-3), v(5));
  assert.ok(Math.abs(sweep.fraction - 0.4) < 0.001);
  assert.equal(sweep.collider, c);
  assert.deepEqual(w.overlaps(sphere(), v(0.75)), [c]);
  assert.deepEqual(
    w.overlaps(sphere(), v(0.75), undefined, { excludeBody: b }),
    [],
  );
  w.teleport(b, v(10));
  assert.equal(w.raycast(v(-3), v(1), 4), null);
  w.removeBody(b);
  const next = w.createBody({
    type: "static",
    colliders: [{ shape: sphere() }],
  });
  assert.ok(Number.isSafeInteger(next) && next > c);
  assert.throws(() => w.bodyState(b), /unknown body/);
  assert.equal(w.raycast(v(-3), v(1), 4).body, next);
  w.dispose();
});

test("continuous collision prevents a fast sphere crossing a thin wall", () => {
  function run(ccd) {
    const w = createWorld({ gravity: v() });
    w.createBody({ type: "static", colliders: [{ shape: box(0.025, 5, 5) }] });
    const b = w.createBody({
      type: "dynamic",
      position: v(-2),
      velocity: v(300),
      ccd,
      colliders: [{ shape: sphere(0.1) }],
    });
    w.step(w.fixedDt);
    const x = w.bodyState(b).position.x;
    w.dispose();
    return x;
  }
  // Rapier 0.21 also predicts this collision without CCD; require the CCD guarantee.
  assert.ok(run(true) < 0);
});

test("all solid collider families support a falling sphere", () => {
  const hull = new Float32Array([
    -2, -0.5, -2, 2, -0.5, -2, -2, -0.5, 2, 2, -0.5, 2, -2, 0.5, -2, 2, 0.5, -2,
    -2, 0.5, 2, 2, 0.5, 2,
  ]);
  const shapes = [
    box(3, 0.5, 3),
    sphere(2),
    { kind: "capsule", radius: 2, halfHeight: 0.5 },
    { kind: "convex", vertices: hull },
    {
      kind: "mesh",
      vertices: new Float32Array([-3, 0, -3, -3, 0, 3, 3, 0, 3, 3, 0, -3]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    },
    {
      kind: "heightfield",
      rows: 1,
      columns: 1,
      heights: new Float32Array(4),
      scale: v(6, 1, 6),
    },
  ];
  shapes.forEach((shape, i) => {
    const w = createWorld(options);
    w.createBody({ type: "static", colliders: [{ shape }] });
    const b = w.createBody({
      type: "dynamic",
      position: v(0, 5),
      lockRotations: true,
      colliders: [{ shape: sphere(0.25) }],
    });
    ticks(w, 150);
    assert.ok(
      w.bodyState(b).position.y > 0.2,
      `shape ${i} supports the sphere`,
    );
    w.dispose();
  });
});

test("fixed, ball, hinge and limited slider joints constrain motion", () => {
  for (const kind of ["fixed", "ball", "hinge", "slider"]) {
    const w = createWorld({ gravity: v() });
    const a = w.createBody({ type: "static" });
    const b = w.createBody({
      type: "dynamic",
      colliders: [{ shape: box(0.2, 0.2, 0.2) }],
    });
    const id = w.createJoint({
      kind,
      bodyA: a,
      bodyB: b,
      anchorA: v(),
      anchorB: v(),
      axis: v(1),
      limits: [-0.5, 0.5],
    });
    w.impulse(b, v(2, 2, 1));
    const replay = createWorld({ gravity: v() });
    for (let i = 0; i < 120; i++) {
      if (i % 20 === 0) replay.restore(w.snapshot());
      assert.deepEqual(w.step(w.fixedDt), replay.step(replay.fixedDt));
      assert.deepEqual(
        w.snapshot(),
        replay.snapshot(),
        `${kind} joint replay ${i}`,
      );
    }
    replay.dispose();
    const p = w.bodyState(b).position;
    assert.ok(
      Math.abs(p.y) < 0.03 && Math.abs(p.z) < 0.03,
      `${kind} holds transverse axes`,
    );
    assert.ok(
      Math.abs(p.x) < (kind === "slider" ? 0.55 : 0.03),
      `${kind} holds anchor/limit`,
    );
    w.removeJoint(id);
    w.impulse(b, v(1, 1));
    ticks(w, 10);
    assert.ok(w.bodyState(b).position.y > 0.1);
    w.dispose();
  }
});

test("invalid data and overload fail before changing a world", () => {
  const w = createWorld(options);
  const before = w.snapshot();
  for (const dt of [-1, NaN, Infinity, 10]) assert.throws(() => w.step(dt));
  assert.throws(() =>
    w.createBody({ type: "dynamic", colliders: [{ shape: sphere(-1) }] }),
  );
  assert.deepEqual(w.snapshot(), before);
  assert.throws(() => w.restore(new Uint8Array([1, 2, 3])), /snapshot/);
  assert.deepEqual(w.snapshot(), before);
  assert.throws(() => w.raycast(v(), v(2), 10), /unit/);
  w.dispose();
});

function scene(seed) {
  const w = createWorld({ ...options, random: seeded(seed) });
  floor(w);
  for (let i = 0; i < 12; i++)
    w.createBody({
      type: "dynamic",
      position: v(w.random() * 4 - 2, 2 + i * 1.1, w.random() * 4 - 2),
      colliders: [{ shape: box() }],
    });
  return w;
}
test("same seed and commands give byte-identical state at every tick", () => {
  const a = scene(13),
    b = scene(13),
    other = scene(14);
  assert.notDeepEqual(a.snapshot(), other.snapshot());
  other.dispose();
  for (let i = 0; i < 200; i++) {
    assert.deepEqual(a.step(a.fixedDt), b.step(b.fixedDt));
    assert.deepEqual(a.snapshot(), b.snapshot(), `tick ${i}`);
  }
  a.dispose();
  b.dispose();
});

test("restoring before every step equals uninterrupted simulation, including contacts and partial time", () => {
  const a = scene(29),
    b = createWorld({ gravity: v() });
  for (let i = 0; i < 120; i++) {
    a.random();
    a.step(a.fixedDt / 3);
    b.restore(a.snapshot());
    assert.deepEqual(b.snapshot(), a.snapshot());
    assert.equal(b.random(), a.random());
    assert.deepEqual(b.step((a.fixedDt * 2) / 3), a.step((a.fixedDt * 2) / 3));
    assert.deepEqual(b.snapshot(), a.snapshot(), `restore tick ${i}`);
  }
  a.dispose();
  b.dispose();
});
