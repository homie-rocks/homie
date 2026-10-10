import { createWorld, seeded } from "../dist/World.js";
import * as HF from "../dist/Heightfield.js";
import { sample } from "./restore-attack-fixture.mjs";

// Identical input arithmetic and insertion order in Node, Chromium and workerd.
export function run() {
  const world = createWorld({
    gravity: { x: 0, y: -9.81, z: 0 },
    random: seeded(981),
  });
  world.createBody({
    type: "static",
    colliders: [
      { shape: { kind: "box", halfExtents: { x: 20, y: 0.5, z: 20 } } },
    ],
  });
  const bodies = [];
  for (let i = 0; i < 12; i++)
    bodies.push(
      world.createBody({
        type: "dynamic",
        position: { x: world.random() * 4 - 2, y: 2 + i, z: 0 },
        colliders: [{ shape: { kind: "sphere", radius: 0.4 } }],
        ccd: true,
      }),
    );
  for (let i = 0; i < 120; i++) {
    if (i % 17 === 0)
      world.impulse(bodies[i % bodies.length], {
        x: world.random(),
        y: 1,
        z: 0,
      });
    world.step(1 / 60);
    if (i === 60) world.restore(world.snapshot());
  }
  const result = Array.from(world.snapshot());
  world.dispose();
  const attack = sample({ createWorld, seeded, HF }, [1, 2]);
  if (attack.diverged.length) throw new Error(attack.diverged.join("\n"));
  return { rigid: result, characters: runCharacters(), attack };
}

function runCharacters() {
  const result = [];
  for (const up of ["y", "z"]) {
    const v = (x = 0, h = 0, d = 0) =>
      up === "y" ? { x, y: h, z: d } : { x, y: d, z: h };
    const w = createWorld({ up });
    w.createBody({
      type: "static",
      position: v(0, -0.5),
      colliders: [{ shape: { kind: "box", halfExtents: v(30, 0.5, 30) } }],
    });
    const p = w.createBody({
      type: "kinematic",
      position: v(0, 0.25),
      colliders: [{ shape: { kind: "box", halfExtents: v(3, 0.25, 3) } }],
    });
    const c = w.createCharacter({
      position: v(1, 1.5),
      radius: 0.3,
      height: 1.8,
      stepHeight: 0.35,
      stepMinWidth: 0.2,
      slopeLimit: 0.7,
      snapDistance: 0.2,
      offset: 0.01,
      gravity: 20,
      jumpSpeed: 5,
      acceleration: 10,
    });
    for (let i = 0; i < 120; i++) {
      w.moveKinematic(p, v(i * 0.04, 0.25));
      w.controlCharacter(c, { x: 0.5, jump: i === 30 });
      const original = {};
      try {
        for (const name of [
          "sin",
          "cos",
          "tan",
          "atan2",
          "pow",
          "exp",
          "log",
        ]) {
          original[name] = Math[name];
          Math[name] = () => {
            throw new Error("forbidden " + name);
          };
        }
        w.step(0.05);
      } finally {
        Object.assign(Math, original);
      }
      if (i === 60) w.restore(w.snapshot());
    }
    result.push(Array.from(w.snapshot()));
    w.dispose();
  }
  return result;
}
