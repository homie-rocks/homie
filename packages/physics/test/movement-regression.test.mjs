import assert from "node:assert/strict";
import test from "node:test";
import { createWorld, v, box, character, ticks, floor } from "./helpers.mjs";
const pos = (w, c) => w.bodyState(w.characterState(c).body).position;
test("kinematic speed is uniform at non-divisor outer rates", () => {
  const results = [];
  for (const hz of [20, 24, 30, 50, 60, 120]) {
    const w = createWorld({});
    try {
      const p = w.createBody({
        type: "kinematic",
        colliders: [{ shape: box(10, 0.25, 3), friction: 1 }],
      });
      const rider = w.createBody({
        type: "dynamic",
        position: v(0, 0.76),
        colliders: [{ shape: box(), friction: 1 }],
      });
      ticks(w, 120);
      for (let i = 1; i <= hz * 4; i++) {
        w.moveKinematic(p, v((i * 2) / hz));
        w.step(1 / hz);
      }
      results.push(w.bodyState(rider).position.x);
    } finally {
      w.dispose();
    }
  }
  assert.ok(
    Math.max(...results) - Math.min(...results) < 0.04,
    JSON.stringify(results),
  );
});
for (const height of [0.34, 0.36])
  test(`declared .35m step ${height}`, () => {
    const w = createWorld({});
    try {
      floor(w);
      w.createBody({
        type: "static",
        position: v(2, height / 2),
        colliders: [{ shape: box(1, height / 2, 2) }],
      });
      const c = w.createCharacter(character);
      ticks(w, 30);
      w.controlCharacter(c, { x: 2 });
      ticks(w, 120);
      assert.equal(pos(w, c).x > 2.5, height < 0.35, JSON.stringify(pos(w, c)));
    } finally {
      w.dispose();
    }
  });
test("separate air control, facing, stance and jump/land signals", () => {
  const w = createWorld({});
  try {
    floor(w);
    const c = w.createCharacter({
      ...character,
      acceleration: 30,
      braking: 40,
      airAcceleration: 2,
      slideControl: 0.2,
    });
    ticks(w, 30);
    assert.equal(w.characterState(c).stance, "planted");
    w.controlCharacter(c, { x: 3 });
    ticks(w, 30);
    w.controlCharacter(c, { x: 3, jump: true });
    w.step(0.05);
    assert.ok(w.characterState(c).jumped);
    assert.equal(w.characterState(c).stance, "rising");
    assert.ok(w.characterState(c).facing.x > 0.9);
    const start = pos(w, c).x;
    w.controlCharacter(c, { x: -3 });
    ticks(w, 12);
    assert.ok(pos(w, c).x - start > 0.4, "air reversal should not be instant");
    let landed = false,
      peak = pos(w, c).y;
    for (let i = 0; i < 60; i++) {
      w.step(1 / 60);
      peak = Math.max(peak, pos(w, c).y);
      if (w.characterState(c).landed) {
        landed = true;
        assert.ok(w.characterState(c).landingSpeed > 3);
      }
    }
    assert.ok(landed);
    assert.ok(Math.abs(peak - (0.91 + 0.625)) < 0.015, `apex ${peak}`);
  } finally {
    w.dispose();
  }
});
test("a staircase keeps commanded horizontal speed", () => {
  const w = createWorld({});
  try {
    floor(w);
    for (let i = 0; i < 8; i++)
      w.createBody({
        type: "static",
        position: v(1 + i * 0.6, ((i + 1) * 0.15) / 2),
        colliders: [{ shape: box(0.3, ((i + 1) * 0.15) / 2, 2) }],
      });
    const c = w.createCharacter(character);
    ticks(w, 30);
    w.controlCharacter(c, { x: 2 });
    ticks(w, 180);
    assert.ok(pos(w, c).x > 5.7, JSON.stringify(pos(w, c)));
  } finally {
    w.dispose();
  }
});
test("opposing steep faces support a character at the bottom of a valley", async () => {
  const { sampleHeightfield } = await import("../dist/Heightfield.js");
  const w = createWorld({});
  try {
    w.createBody({
      type: "static",
      colliders: [
        sampleHeightfield(
          { heightAt: (x) => Math.abs(x) },
          { nx: 41, nz: 5, cell: 0.25, x0: -5, z0: -0.5 },
        ),
      ],
    });
    const c = w.createCharacter({ ...character, position: v(0, 3) });
    ticks(w, 180);
    assert.equal(w.characterState(c).grounded, true);
    w.controlCharacter(c, { x: 0.1, jump: true });
    ticks(w, 5);
    assert.ok(w.characterState(c).verticalVelocity > 0);
  } finally {
    w.dispose();
  }
});
test("a soft boundary slows outward input and allows retreat", () => {
  const w = createWorld({});
  try {
    floor(w);
    const c = w.createCharacter({
      ...character,
      softBoundary: { halfExtent: 3, margin: 1, strength: 10 },
    });
    ticks(w, 30);
    w.controlCharacter(c, { x: 3 });
    ticks(w, 180);
    assert.ok(pos(w, c).x < 3.05);
    const before = pos(w, c).x;
    w.controlCharacter(c, { x: -3 });
    ticks(w, 30);
    assert.ok(pos(w, c).x < before - 1.3);
  } finally {
    w.dispose();
  }
});
test("character input still climbs terrain when a kinematic obstacle exists", async () => {
  const { sampleHeightfield } = await import("../dist/Heightfield.js");
  const w = createWorld({});
  try {
    floor(w);
    w.createBody({
      type: "static",
      colliders: [
        sampleHeightfield(
          { heightAt: (x) => Math.max(0, x) * 0.3 },
          { nx: 31, nz: 5, cell: 0.25, x0: -2, z0: -0.5 },
        ),
      ],
    });
    w.createBody({
      type: "kinematic",
      position: v(20, 0),
      colliders: [{ shape: box() }],
    });
    const c = w.createCharacter({ ...character, position: v(-1, 1) });
    ticks(w, 30);
    w.controlCharacter(c, { x: 2 });
    ticks(w, 100);
    assert.ok(pos(w, c).x > 1.5, JSON.stringify(pos(w, c)));
  } finally {
    w.dispose();
  }
});
test("facing turns through a full reversal", () => {
  const w = createWorld({});
  try {
    floor(w);
    const c = w.createCharacter(character);
    ticks(w, 30);
    w.controlCharacter(c, { x: 2 });
    ticks(w, 30);
    w.controlCharacter(c, { x: -2 });
    ticks(w, 60);
    assert.ok(
      w.characterState(c).facing.x < -0.99,
      JSON.stringify(w.characterState(c).facing),
    );
  } finally {
    w.dispose();
  }
});
test("the soft boundary returns a character displaced beyond it", () => {
  const w = createWorld({});
  try {
    floor(w);
    const c = w.createCharacter({
      ...character,
      position: v(4, 1),
      softBoundary: { halfExtent: 3, margin: 1, strength: 10 },
    });
    ticks(w, 60);
    assert.ok(pos(w, c).x < 3.8, JSON.stringify(pos(w, c)));
  } finally {
    w.dispose();
  }
});
