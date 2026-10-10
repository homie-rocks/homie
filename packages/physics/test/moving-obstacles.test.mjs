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

const position = (w, c) => w.bodyState(w.characterState(c).body).position;
for (const up of ["y", "z"]) {
  const axes = (x = 0, y = 0, z = 0) => (up === "y" ? v(x, y, z) : v(x, z, y));
  const block = (x, y, z) => ({ kind: "box", halfExtents: axes(x, y, z) });
  for (const hz of [20, 30, 60]) {
    for (const mode of ["parked", "translate", "rotate", "edge", "jump"]) {
      test(`${up} ${hz}Hz: input on ${mode} platform`, () => {
        const w = createWorld({ up });
        try {
          const p = w.createBody({
            type: "kinematic",
            colliders: [{ shape: block(mode === "edge" ? 1 : 8, 0.25, 8) }],
          });
          const c = w.createCharacter({ ...character, position: axes(0, 1.2) });
          ticks(w, 30);
          let distance = 0,
            previous = position(w, c),
            jumped = false;
          for (let i = 1; i <= hz; i++) {
            const angle = mode === "rotate" ? (i / hz) * 0.5 : 0;
            w.moveKinematic(
              p,
              axes(
                0,
                0,
                mode === "translate" || mode === "jump" ? (3 * i) / hz : 0,
              ),
              { ...axes(0, Math.sin(angle / 2)), w: Math.cos(angle / 2) },
            );
            w.controlCharacter(c, {
              x: 2,
              jump: mode === "jump" && i === Math.ceil(hz / 4),
            });
            w.step(1 / hz);
            const now = position(w, c);
            distance += now.x - previous.x;
            jumped ||= now[up] > 1.5;
            previous = now;
          }
          assert.ok(distance > 1.9, `${mode}: ${JSON.stringify(previous)}`);
          if (mode === "translate")
            assert.ok(Math.abs(previous[up === "y" ? "z" : "y"] - 3) < 0.05);
          if (mode === "edge")
            assert.equal(w.characterState(c).grounded, false);
          if (mode === "jump") assert.ok(jumped);
        } finally {
          w.dispose();
        }
      });
    }
    test(`${up} ${hz}Hz: input into, along and away from a parked wall`, () => {
      const w = createWorld({ up });
      try {
        w.createBody({
          type: "static",
          position: axes(0, -0.5),
          colliders: [{ shape: block(30, 0.5, 30) }],
        });
        w.createBody({
          type: "kinematic",
          position: axes(1, 2),
          colliders: [{ shape: block(0.1, 2, 20) }],
        });
        const c = w.createCharacter({ ...character, position: axes(0, 1) });
        ticks(w, 30);
        for (let i = 0; i < hz; i++) {
          w.controlCharacter(c, { x: 2, [up === "y" ? "z" : "y"]: 2 });
          w.step(1 / hz);
        }
        assert.ok(position(w, c)[up] < 0.95, "must not climb wall");
        assert.ok(
          position(w, c)[up === "y" ? "z" : "y"] > 1.9,
          "must slide along wall",
        );
        const start = position(w, c).x;
        for (let i = 0; i < hz; i++) {
          w.controlCharacter(c, { x: -2 });
          w.step(1 / hz);
        }
        assert.ok(start - position(w, c).x > 1.9, "must walk away");
      } finally {
        w.dispose();
      }
    });
    for (const mode of ["press", "lift", "lower"]) {
      test(`${up} ${hz}Hz: ${mode} preserves static geometry under input`, () => {
        const w = createWorld({ up });
        try {
          w.createBody({
            type: "static",
            position: axes(0, -0.5),
            colliders: [{ shape: block(30, 0.5, 30) }],
          });
          if (mode === "lift")
            w.createBody({
              type: "static",
              position: axes(0, 3.1),
              colliders: [{ shape: block(30, 0.15, 30) }],
            });
          const start = mode === "press" ? 3 : mode === "lower" ? 2 : 0.25;
          const p = w.createBody({
            type: "kinematic",
            position: axes(0, start),
            colliders: [{ shape: block(20, 0.25, 20) }],
          });
          const c = w.createCharacter({
            ...character,
            position: axes(0, mode === "press" ? 1 : start + 1.2),
          });
          ticks(w, 30);
          let crushed = false;
          for (let i = 1; i <= hz * 2; i++) {
            w.moveKinematic(
              p,
              axes(0, start + ((mode === "lift" ? 1 : -1.2) * i) / hz),
            );
            w.controlCharacter(c, { x: 2 });
            w.step(1 / hz);
            crushed ||= w.characterState(c).crushed;
            assert.ok(
              position(w, c)[up] >= 0.89,
              JSON.stringify(position(w, c)),
            );
            if (mode === "lift") assert.ok(position(w, c)[up] <= 2.06);
          }
          if (mode !== "lower")
            assert.ok(crushed, "blocked carry/push must report crushed");
        } finally {
          w.dispose();
        }
      });
    }
  }
}

test("explicit mass survives a later collider", () => {
  const w = createWorld({ gravity: v() });
  try {
    const b = w.createBody({ type: "dynamic", mass: 5 });
    w.createCollider(b, { shape: box() });
    w.impulse(b, v(10));
    assert.ok(Math.abs(w.bodyState(b).velocity.x - 2) < 1e-5);
  } finally {
    w.dispose();
  }
});
test("negative gravity is mutable", () => {
  const w = createWorld({});
  try {
    const b = w.createBody({ type: "dynamic", colliders: [{ shape: box() }] });
    assert.doesNotThrow(() => w.updateBody(b, { gravityScale: -1 }));
  } finally {
    w.dispose();
  }
});
test("sensor-only dynamic bodies require a solid shape", () => {
  const w = createWorld({});
  try {
    assert.throws(
      () =>
        w.createBody({
          type: "dynamic",
          colliders: [{ shape: sphere(), sensor: true }],
        }),
      /solid/,
    );
  } finally {
    w.dispose();
  }
});
for (const up of ["y", "z"])
  for (const hz of [20, 30, 60]) {
    const axes = (x = 0, y = 0, z = 0) =>
      up === "y" ? v(x, y, z) : v(x, z, y);
    const block = (x, y, z) => ({ kind: "box", halfExtents: axes(x, y, z) });
    test(`${up} ${hz}Hz: input while pushed, then away and into the moving wall`, () => {
      const w = createWorld({ up });
      try {
        w.createBody({
          type: "static",
          position: axes(0, -0.5),
          colliders: [{ shape: block(30, 0.5, 30) }],
        });
        const wall = w.createBody({
          type: "kinematic",
          position: axes(-1, 2),
          colliders: [{ shape: block(0.1, 2, 20) }],
        });
        const c = w.createCharacter({ ...character, position: axes(0, 1) });
        ticks(w, 30);
        for (let i = 1; i <= hz; i++) {
          w.moveKinematic(wall, axes(-1 + (3 * i) / hz, 2));
          w.controlCharacter(c, { x: 1 });
          w.step(1 / hz);
        }
        assert.ok(position(w, c).x > 2.39);
        assert.ok(position(w, c)[up] < 0.95);
        const before = position(w, c).x;
        for (let i = 0; i < hz; i++) {
          w.controlCharacter(c, { x: 2 });
          w.step(1 / hz);
        }
        assert.ok(position(w, c).x - before > 1.9);
        for (let i = 0; i < 2 * hz; i++) {
          w.controlCharacter(c, { x: -2 });
          w.step(1 / hz);
        }
        assert.ok(position(w, c)[up] < 0.95);
        assert.ok(position(w, c).x >= 2.39);
      } finally {
        w.dispose();
      }
    });
  }

test("hits and sustained crushing accumulate across an outer tick", () => {
  const w = createWorld({});
  try {
    floor(w);
    w.createBody({
      type: "static",
      position: v(1, 1),
      colliders: [{ shape: box(0.1, 1, 2) }],
    });
    const wall = w.createBody({
      type: "kinematic",
      position: v(-1, 1),
      colliders: [{ shape: box(0.1, 1, 2) }],
    });
    const c = w.createCharacter(character);
    ticks(w, 30);
    w.controlCharacter(c, { x: 1 });
    w.moveKinematic(wall, v(0.8, 1));
    w.step(0.05);
    assert.equal(w.characterState(c).crushed, true);
    assert.ok(w.characterState(c).hits.includes(w.colliders(wall)[0]));
    assert.ok(position(w, c).x < 0.61);
  } finally {
    w.dispose();
  }
});
for (const up of ["y", "z"])
  for (const hz of [20, 30, 60])
    test(`${up} ${hz}Hz: input between kinematic walls`, () => {
      const axes = (x = 0, y = 0, z = 0) =>
        up === "y" ? v(x, y, z) : v(x, z, y);
      const block = (x, y, z) => ({ kind: "box", halfExtents: axes(x, y, z) });
      const w = createWorld({ up });
      try {
        w.createBody({
          type: "static",
          position: axes(0, -0.5),
          colliders: [{ shape: block(30, 0.5, 30) }],
        });
        for (const side of [-1, 1])
          w.createBody({
            type: "kinematic",
            position: axes(0, 2, side * 0.42),
            colliders: [{ shape: block(20, 2, 0.1) }],
          });
        const c = w.createCharacter({ ...character, position: axes(0, 1) });
        ticks(w, 30);
        for (let i = 0; i < hz; i++) {
          w.controlCharacter(c, { x: 2 });
          w.step(1 / hz);
        }
        assert.ok(position(w, c).x > 1.9, JSON.stringify(position(w, c)));
        assert.ok(position(w, c)[up] < 0.95);
      } finally {
        w.dispose();
      }
    });
test("a slow press cannot accumulate penetration through the floor", () => {
  const w = createWorld({});
  try {
    floor(w);
    const p = w.createBody({
      type: "kinematic",
      position: v(0, 3),
      colliders: [{ shape: box(20, 0.25, 20) }],
    });
    const c = w.createCharacter(character);
    ticks(w, 30);
    w.moveKinematic(p, v(0, 2.07));
    w.step(0.05);
    for (let i = 1; i <= 1200; i++) {
      w.moveKinematic(p, v(0, 2.07 - (0.001 * i) / 20));
      w.controlCharacter(c, { x: 0.1 });
      w.step(0.05);
      assert.ok(position(w, c).y >= 0.899, JSON.stringify(position(w, c)));
    }
    assert.equal(w.characterState(c).crushed, true);
  } finally {
    w.dispose();
  }
});
