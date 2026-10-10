import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorld,
  v,
  box,
  sphere,
  character,
  ticks,
  floor,
} from "./helpers.mjs";

test("resting contact and sliding do not repeatedly emit impact", () => {
  const w = createWorld({});
  try {
    const ground = floor(w);
    const b = w.createBody({
      type: "dynamic",
      mass: 10,
      position: v(0, 5),
      canSleep: false,
      colliders: [{ shape: box() }],
    });
    assert.equal(ticks(w, 120).filter((e) => e.kind === "impact").length, 1);
    const force = w.contactForce(w.colliders(ground)[0], w.colliders(b)[0]);
    assert.ok(force > 90 && force < 110, `sustained force ${force}`);
    w.setVelocity(b, v(2));
    assert.equal(ticks(w, 60).filter((e) => e.kind === "impact").length, 0);
  } finally {
    w.dispose();
  }
});
test("no-op collider updates preserve an occupied trigger", () => {
  const w = createWorld({ gravity: v() });
  try {
    const zone = w.createBody({
      type: "static",
      colliders: [{ shape: box(2, 2, 2), sensor: true }],
    });
    w.createBody({ type: "dynamic", colliders: [{ shape: sphere() }] });
    assert.equal(
      ticks(w, 1).filter((e) => e.kind === "trigger" && e.started).length,
      1,
    );
    for (const update of [
      { sensor: true },
      { layers: { membership: 65535, filter: 65535 } },
    ]) {
      w.updateCollider(w.colliders(zone)[0], update);
      assert.equal(ticks(w, 10).filter((e) => e.kind === "trigger").length, 0);
    }
  } finally {
    w.dispose();
  }
});

test("sensor and layer changes maintain alternating pairs", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const w = createWorld({ gravity: v(), random: { state: seed } });
    const open = new Set();
    const check = (events) => {
      for (const e of events) {
        if (e.kind === "impact") continue;
        const key = `${e.kind}:${e.colliderA}:${e.colliderB}`;
        assert.equal(open.has(key), !e.started, `${key} @ ${e.tick}`);
        if (e.started) open.add(key);
        else open.delete(key);
      }
    };
    try {
      const a = w.createBody({
        type: "static",
        colliders: [{ shape: box(2, 2, 2), sensor: true }],
      });
      const b = w.createBody({
        type: "dynamic",
        colliders: [{ shape: sphere() }],
      });
      for (let i = 0; i < 100; i++) {
        const id = w.colliders(a)[0];
        if (w.random() < 0.5)
          w.updateCollider(id, { sensor: w.random() < 0.5 });
        else
          w.updateCollider(id, {
            layers: { membership: 1, filter: w.random() < 0.5 ? 0 : 65535 },
          });
        check(w.step(1 / 20));
      }
      w.removeBody(b);
      check(w.step(1 / 20));
      assert.equal(open.size, 0);
    } finally {
      w.dispose();
    }
  }
});

test("continuous character ground and crate contacts do not flap", () => {
  const w = createWorld({});
  try {
    const ground = floor(w);
    const prop = w.createBody({
      type: "dynamic",
      position: v(1.5, 0.4),
      colliders: [{ shape: box(0.4, 0.4, 0.4) }],
    });
    const c = w.createCharacter(character);
    const body = w.characterState(c).body;
    const events = ticks(w, 30);
    w.controlCharacter(c, { x: 2 });
    events.push(...ticks(w, 180));
    for (const other of [ground, prop]) {
      const contacts = events.filter(
        (e) =>
          e.kind === "contact" &&
          ((e.bodyA === body && e.bodyB === other) ||
            (e.bodyB === body && e.bodyA === other)),
      );
      assert.equal(
        contacts.filter((e) => e.started).length,
        1,
        JSON.stringify(contacts),
      );
      assert.equal(
        contacts.filter((e) => !e.started).length,
        0,
        JSON.stringify(contacts),
      );
    }
  } finally {
    w.dispose();
  }
});
test("character sensor/filter edits pair correctly and replay before stepping", () => {
  const w = createWorld({}),
    restored = createWorld({}),
    open = new Set();
  const check = (events) => {
    for (const e of events) {
      if (e.kind !== "trigger" && e.kind !== "contact") continue;
      const key = `${e.kind}:${e.colliderA}:${e.colliderB}`;
      assert.equal(open.has(key), !e.started, key);
      if (e.started) open.add(key);
      else open.delete(key);
    }
  };
  try {
    floor(w);
    const zone = w.createBody({
      type: "static",
      position: v(0, 1),
      colliders: [{ shape: box(2, 2, 2), sensor: true }],
    });
    const c = w.createCharacter(character),
      capsule = w.characterState(c).collider;
    check(ticks(w, 30));
    for (let i = 0; i < 100; i++) {
      w.controlCharacter(c, { x: i % 2 ? 1 : -1 });
      w.updateCollider(
        i % 3 ? capsule : w.colliders(zone)[0],
        i % 2
          ? { sensor: i % 4 === 1 }
          : { layers: { membership: 1, filter: i % 4 === 0 ? 0 : 65535 } },
      );
      restored.restore(w.snapshot());
      const events = w.step(0.05);
      assert.deepEqual(restored.step(0.05), events);
      check(events);
      assert.deepEqual(restored.snapshot(), w.snapshot());
    }
    w.removeCharacter(c);
    w.removeBody(zone);
    check(w.step(0.05));
    assert.equal(open.size, 0);
  } finally {
    w.dispose();
    restored.dispose();
  }
});
test("changing character collider layers changes its movement queries", () => {
  const w = createWorld({});
  try {
    floor(w);
    const c = w.createCharacter(character);
    ticks(w, 30);
    w.updateCollider(w.characterState(c).collider, {
      layers: { membership: 1, filter: 0 },
    });
    w.controlCharacter(c, { x: 2 });
    w.step(0.05);
    assert.equal(w.characterState(c).grounded, false);
  } finally {
    w.dispose();
  }
});
